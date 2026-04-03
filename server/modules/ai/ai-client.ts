import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";

type DbLike = { prepare: (sql: string) => { get: (...args: unknown[]) => unknown } };

/**
 * Resolve which mode to use: "cli" (Claude Code CLI) or "api" (Anthropic SDK).
 * Default is "cli" — uses the user's existing Claude Code subscription.
 */
function resolveAiMode(db: DbLike): "cli" | "api" {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get("ai_mode") as { value: string } | undefined;
  if (row?.value === "api") return "api";
  return "cli";
}

/** Read the default CLI provider from the same settings as task execution */
function resolveDefaultProvider(db: DbLike): string {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'defaultProvider'").get() as { value: string } | undefined;
  return row?.value?.replace(/"/g, "") || "claude";
}

/** Read providerModelConfig — same source as task execution agents */
function resolveProviderModelConfig(db: DbLike): Record<string, { model?: string; subModel?: string }> {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'providerModelConfig'").get() as { value: string } | undefined;
  if (!row?.value) return {};
  try { return JSON.parse(row.value); } catch { return {}; }
}

/**
 * Resolve model using the SAME settings as task execution:
 * 1. providerModelConfig[defaultProvider].model (e.g. "claude-opus-4-6")
 * 2. AI_MODEL env override
 * 3. Fallback: "sonnet"
 *
 * For CLI mode, converts full model IDs to CLI-friendly aliases.
 */
function resolveAiModel(db: DbLike): string {
  // Check explicit ai_model override first
  const override = db.prepare("SELECT value FROM settings WHERE key = 'ai_model'").get() as { value: string } | undefined;
  if (override?.value) return override.value;

  if (process.env.AI_MODEL) return process.env.AI_MODEL;

  // Use same config as task execution
  const provider = resolveDefaultProvider(db);
  const config = resolveProviderModelConfig(db);
  const providerConfig = config[provider];
  if (providerConfig?.model) return providerConfig.model;

  return "sonnet";
}

/** Map full model IDs to Claude CLI aliases for CLI mode */
function toCliModelAlias(model: string): string {
  if (model.includes("opus")) return "opus";
  if (model.includes("haiku")) return "haiku";
  if (model.includes("sonnet")) return "sonnet";
  // If it's already an alias or unknown, pass through
  return model;
}

function resolveClaudeCliPath(): string {
  return process.env.CLAUDE_CLI_PATH || "claude";
}

const CLI_PATH_FALLBACK_DIRS =
  process.platform === "win32"
    ? [
        path.join(process.env.ProgramFiles || "C:\\Program Files", "nodejs"),
        path.join(process.env.LOCALAPPDATA || "", "Programs", "nodejs"),
        path.join(process.env.APPDATA || "", "npm"),
      ].filter(Boolean)
    : [
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
        path.join(os.homedir(), ".local", "bin"),
        path.join(os.homedir(), "bin"),
        path.join(os.homedir(), ".npm-global", "bin"),
        path.join(os.homedir(), ".nvm/versions/node", process.version, "bin"),
      ];

function buildEnhancedPath(): string {
  const parts = (process.env.PATH ?? "")
    .split(path.delimiter)
    .map((p) => p.trim())
    .filter(Boolean);
  const seen = new Set(parts);
  for (const dir of CLI_PATH_FALLBACK_DIRS) {
    if (!dir || seen.has(dir)) continue;
    parts.push(dir);
    seen.add(dir);
  }
  return parts.join(path.delimiter);
}

/**
 * Run Claude CLI in print mode: `claude -p "prompt" --output-format text`
 * Uses the user's existing Claude Code CLI subscription — no API key needed.
 */
function runClaudeCli(
  fullPrompt: string,
  options?: { model?: string; maxTokens?: number; signal?: AbortSignal },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const cliPath = resolveClaudeCliPath();
    const args = ["-p", "--output-format", "text", "--max-turns", "1"];
    if (options?.model) {
      args.push("--model", options.model);
    }

    const cleanEnv = { ...process.env };
    // Remove all Claude Code env vars to prevent CLI interference
    for (const key of Object.keys(cleanEnv)) {
      if (key.startsWith("CLAUDE") || key.startsWith("CMUX_CLAUDE")) delete cleanEnv[key];
    }
    cleanEnv.PATH = buildEnhancedPath();
    cleanEnv.NO_COLOR = "1";
    cleanEnv.FORCE_COLOR = "0";

    const child = spawn(cliPath, args, {
      cwd: os.tmpdir(),
      env: cleanEnv,
      stdio: ["pipe", "pipe", "pipe"],
      shell: process.platform === "win32",
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    // Send prompt via stdin
    child.stdin?.write(fullPrompt);
    child.stdin?.end();

    // Handle abort
    if (options?.signal) {
      options.signal.addEventListener("abort", () => {
        try { child.kill("SIGTERM"); } catch { /* ignore */ }
        reject(new Error("Aborted"));
      }, { once: true });
    }

    child.on("error", (err) => {
      reject(new Error(`Claude CLI spawn failed: ${err.message}. Is 'claude' installed and in PATH?`));
    });

    child.on("close", (code) => {
      if (stderr) {
        console.error(`[AI-Client] Claude CLI stderr: ${stderr.slice(0, 1000)}`);
      }
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        console.error(`[AI-Client] Claude CLI exit code ${code}, stdout length=${stdout.length}, stderr length=${stderr.length}`);
        reject(
          new Error(
            `Claude CLI exited with code ${code}${stderr ? `: ${stderr.slice(0, 500)}` : ""}`,
          ),
        );
      }
    });
  });
}

/**
 * Run Claude CLI with streaming output.
 */
function runClaudeCliStream(
  fullPrompt: string,
  callbacks: StreamCallbacks,
  options?: { model?: string; signal?: AbortSignal },
): void {
  const cliPath = resolveClaudeCliPath();
  const args = ["-p", "--output-format", "text", "--max-turns", "1"];
  if (options?.model) {
    args.push("--model", options.model);
  }

  const cleanEnv = { ...process.env };
  delete cleanEnv.CLAUDECODE;
  delete cleanEnv.CLAUDE_CODE;
  cleanEnv.PATH = buildEnhancedPath();
  cleanEnv.NO_COLOR = "1";
  cleanEnv.FORCE_COLOR = "0";

  const child = spawn(cliPath, args, {
    cwd: os.tmpdir(),
    env: cleanEnv,
    stdio: ["pipe", "pipe", "pipe"],
    shell: process.platform === "win32",
  });

  let fullText = "";

  child.stdout?.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    fullText += text;
    callbacks.onText?.(text);
  });

  child.stdin?.write(fullPrompt);
  child.stdin?.end();

  if (options?.signal) {
    options.signal.addEventListener("abort", () => {
      try { child.kill("SIGTERM"); } catch { /* ignore */ }
    }, { once: true });
  }

  child.on("error", (err) => {
    callbacks.onError?.(new Error(`Claude CLI spawn failed: ${err.message}`));
  });

  child.on("close", (code) => {
    if (code === 0) {
      callbacks.onDone?.(fullText.trim());
    } else {
      callbacks.onError?.(new Error(`Claude CLI exited with code ${code}`));
    }
  });
}

// ── Anthropic SDK fallback (optional, for users with API keys) ──

async function runAnthropicApi(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  options?: { maxTokens?: number; temperature?: number },
): Promise<string> {
  // Dynamic import so the SDK is only loaded if needed
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model,
    max_tokens: options?.maxTokens ?? 8192,
    temperature: options?.temperature ?? 0.3,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  return response.content
    .filter((block) => block.type === "text")
    .map((block) => (block as any).text)
    .join("");
}

function resolveAiApiKey(db: DbLike): string | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get("ai_api_key") as { value: string } | undefined;
  if (row?.value) return row.value;
  const envKey = process.env.ANTHROPIC_API_KEY || process.env.AI_API_KEY;
  return envKey || null;
}

// ── Public API ──

export interface StreamCallbacks {
  onText?: (text: string) => void;
  onDone?: (fullText: string) => void;
  onError?: (error: Error) => void;
}

/**
 * Generate text using Claude CLI (default) or Anthropic API (if configured).
 * CLI mode uses the user's Claude Code subscription — no API key needed.
 */
export async function generateText(
  db: DbLike,
  systemPrompt: string,
  userPrompt: string,
  options?: { maxTokens?: number; temperature?: number; model?: string },
): Promise<string> {
  const mode = resolveAiMode(db);
  const model = options?.model || resolveAiModel(db);

  if (mode === "api") {
    const apiKey = resolveAiApiKey(db);
    if (!apiKey) throw new Error("API mode selected but no API key configured.");
    return runAnthropicApi(apiKey, model, systemPrompt, userPrompt, options);
  }

  // CLI mode (default) — convert model ID to CLI alias
  const cliModel = toCliModelAlias(model);
  console.log(`[AI-Client] Using model: ${model} → CLI alias: ${cliModel} (provider: ${resolveDefaultProvider(db)})`);
  const fullPrompt = `${systemPrompt}\n\n---\n\n${userPrompt}`;
  return runClaudeCli(fullPrompt, { model: cliModel, maxTokens: options?.maxTokens });
}

/**
 * Stream text using Claude CLI (default) or Anthropic API.
 */
export async function streamText(
  db: DbLike,
  systemPrompt: string,
  userPrompt: string,
  callbacks: StreamCallbacks,
  options?: { maxTokens?: number; temperature?: number; model?: string; signal?: AbortSignal },
): Promise<void> {
  const mode = resolveAiMode(db);
  const model = options?.model || resolveAiModel(db);

  if (mode === "api") {
    const apiKey = resolveAiApiKey(db);
    if (!apiKey) {
      callbacks.onError?.(new Error("API mode selected but no API key configured."));
      return;
    }
    try {
      const text = await runAnthropicApi(apiKey, model, systemPrompt, userPrompt, options);
      callbacks.onText?.(text);
      callbacks.onDone?.(text);
    } catch (err) {
      callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
    return;
  }

  // CLI mode (default) — convert model ID to CLI alias
  const cliModel = toCliModelAlias(model);
  const fullPrompt = `${systemPrompt}\n\n---\n\n${userPrompt}`;
  runClaudeCliStream(fullPrompt, callbacks, { model: cliModel, signal: options?.signal });
}

/**
 * Extract JSON from AI response text (handles markdown code blocks, raw JSON, etc.)
 */
export function extractJsonFromResponse<T = unknown>(text: string): T {
  // Try direct parse first
  try {
    return JSON.parse(text) as T;
  } catch {
    // noop
  }
  // Try to find JSON in markdown code block (handles ```json\n...\n```)
  const codeBlockMatch = text.match(/```(?:json)?\s*\n([\s\S]*?)\n\s*```/);
  if (codeBlockMatch?.[1]) {
    try {
      return JSON.parse(codeBlockMatch[1].trim()) as T;
    } catch {
      // noop
    }
  }
  // Also try without newlines (compact code blocks)
  const compactMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (compactMatch?.[1]) {
    try {
      return JSON.parse(compactMatch[1].trim()) as T;
    } catch {
      // noop
    }
  }
  // Try to find first { ... } or [ ... ]
  const jsonMatch = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (jsonMatch?.[1]) {
    return JSON.parse(jsonMatch[1]) as T;
  }
  throw new Error("Could not extract JSON from AI response");
}
