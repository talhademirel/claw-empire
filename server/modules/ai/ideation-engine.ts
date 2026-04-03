import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { generateText, extractJsonFromResponse } from "./ai-client.ts";
import { collectProjectContext } from "./file-context.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const IDEATION_TYPES = [
  "code_improvements",
  "ui_ux_improvements",
  "security_hardening",
  "performance_optimizations",
  "documentation_gaps",
  "code_quality",
] as const;

export type IdeationType = (typeof IDEATION_TYPES)[number];

export interface IdeationIdea {
  id: string;
  project_id: string;
  type: IdeationType;
  title: string;
  description: string;
  rationale: string | null;
  estimated_effort: "low" | "medium" | "high" | null;
  affected_files: string | null; // JSON array
  implementation_approach: string | null;
  converted_task_id: string | null;
  status: "active" | "converted" | "dismissed";
  created_at: number;
}

interface IdeaFromAI {
  title: string;
  description: string;
  rationale?: string;
  estimated_effort?: string;
  affected_files?: string[];
  implementation_approach?: string;
}

type DbLike = {
  prepare: (sql: string) => {
    get: (...args: unknown[]) => unknown;
    all: (...args: unknown[]) => unknown[];
    run: (...args: unknown[]) => void;
  };
};

const PROMPT_FILES: Record<IdeationType, string> = {
  code_improvements: "ideation-code-improvements.md",
  ui_ux_improvements: "ideation-ui-ux-improvements.md",
  security_hardening: "ideation-security-hardening.md",
  performance_optimizations: "ideation-performance-optimizations.md",
  documentation_gaps: "ideation-documentation-gaps.md",
  code_quality: "ideation-code-quality.md",
};

async function runSingleIdeation(
  db: DbLike,
  projectId: string,
  type: IdeationType,
  context: string,
  projectName: string,
): Promise<IdeationIdea[]> {
  const promptFile = PROMPT_FILES[type];
  const promptPath = path.join(__dirname, "prompts", promptFile);
  const systemPrompt = fs.readFileSync(promptPath, "utf8");
  const userPrompt = `## Project: ${projectName}\n\n${context}`;

  const response = await generateText(db, systemPrompt, userPrompt, {
    maxTokens: 4096,
    temperature: 0.4,
  });

  const parsed = extractJsonFromResponse<{ ideas: IdeaFromAI[] }>(response);
  const now = Date.now();

  return (parsed.ideas || []).map((idea) => ({
    id: randomUUID(),
    project_id: projectId,
    type,
    title: String(idea.title || "Untitled"),
    description: String(idea.description || ""),
    rationale: idea.rationale ? String(idea.rationale) : null,
    estimated_effort: (["low", "medium", "high"].includes(idea.estimated_effort || "")
      ? (idea.estimated_effort as "low" | "medium" | "high")
      : null),
    affected_files: idea.affected_files ? JSON.stringify(idea.affected_files) : null,
    implementation_approach: idea.implementation_approach ? String(idea.implementation_approach) : null,
    converted_task_id: null,
    status: "active" as const,
    created_at: now,
  }));
}

export async function runIdeation(
  db: DbLike,
  projectId: string,
  types?: IdeationType[],
  onProgress?: (type: IdeationType, status: "running" | "done" | "error", ideas?: IdeationIdea[]) => void,
): Promise<IdeationIdea[]> {
  const project = db.prepare("SELECT id, name, project_path, core_goal FROM projects WHERE id = ?").get(projectId) as
    | { id: string; name: string; project_path: string; core_goal: string }
    | undefined;
  if (!project) throw new Error(`Project not found: ${projectId}`);

  const context = collectProjectContext(project.project_path, 50000);
  const typesToRun = types?.length ? types : [...IDEATION_TYPES];

  // Run all types in parallel
  const results = await Promise.allSettled(
    typesToRun.map(async (type) => {
      onProgress?.(type, "running");
      try {
        const ideas = await runSingleIdeation(db, projectId, type, context, project.name);
        onProgress?.(type, "done", ideas);
        return ideas;
      } catch (err) {
        onProgress?.(type, "error");
        throw err;
      }
    }),
  );

  const allIdeas: IdeationIdea[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      allIdeas.push(...result.value);
    }
  }

  // Save to DB
  const insertStmt = db.prepare(
    `INSERT OR IGNORE INTO ideation_ideas (id, project_id, type, title, description, rationale, estimated_effort, affected_files, implementation_approach, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
  );
  for (const idea of allIdeas) {
    insertStmt.run(
      idea.id,
      idea.project_id,
      idea.type,
      idea.title,
      idea.description,
      idea.rationale,
      idea.estimated_effort,
      idea.affected_files,
      idea.implementation_approach,
      idea.created_at,
    );
  }

  return allIdeas;
}

export function convertIdeaToTask(
  db: DbLike,
  ideaId: string,
  projectId: string,
  nowMs: () => number,
): string {
  const idea = db.prepare("SELECT * FROM ideation_ideas WHERE id = ? AND project_id = ?").get(ideaId, projectId) as
    | IdeationIdea
    | undefined;
  if (!idea) throw new Error(`Idea not found: ${ideaId}`);
  if (idea.status === "converted") throw new Error("Idea already converted to task");

  const project = db.prepare("SELECT project_path, default_pack_key FROM projects WHERE id = ?").get(projectId) as
    | { project_path: string; default_pack_key: string }
    | undefined;

  const taskId = randomUUID();
  const affectedFiles = idea.affected_files ? JSON.parse(idea.affected_files).join(", ") : "N/A";
  const description = [
    idea.description,
    idea.rationale ? `\n**Rationale:** ${idea.rationale}` : "",
    idea.implementation_approach ? `\n**Approach:** ${idea.implementation_approach}` : "",
    `\n**Affected files:** ${affectedFiles}`,
    idea.estimated_effort ? `\n**Effort:** ${idea.estimated_effort}` : "",
  ].join("");

  const taskType = idea.type === "ui_ux_improvements" ? "design" : idea.type === "documentation_gaps" ? "documentation" : "development";

  db.prepare(
    `INSERT INTO tasks (id, title, description, project_id, project_path, status, priority, task_type, workflow_pack_key, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'inbox', ?, ?, ?, ?, ?)`,
  ).run(
    taskId,
    idea.title,
    description,
    projectId,
    project?.project_path || null,
    idea.estimated_effort === "high" ? 1 : idea.estimated_effort === "medium" ? 2 : 3,
    taskType,
    project?.default_pack_key || "development",
    nowMs(),
    nowMs(),
  );

  db.prepare("UPDATE ideation_ideas SET converted_task_id = ?, status = 'converted' WHERE id = ?").run(taskId, ideaId);

  return taskId;
}
