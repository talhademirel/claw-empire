import fs from "node:fs";
import path from "node:path";

type SignalPattern = {
  key: string;
  regex: RegExp;
};

const REMOTION_PATTERNS: SignalPattern[] = [
  { key: "remotion_render", regex: /\bremotion\s+render\b/i },
  { key: "remotion_browser_ensure", regex: /\bremotion\s+browser\s+ensure\b/i },
  { key: "remotion_package", regex: /@remotion\//i },
  { key: "remotion_register_root", regex: /\bregisterRoot\b/i },
];

const FORBIDDEN_PATTERNS: SignalPattern[] = [
  { key: "moviepy", regex: /\bmoviepy\b/gi },
  { key: "pillow", regex: /\bpillow\b/gi },
  { key: "pil_import", regex: /\b(?:from\s+PIL|import\s+PIL)\b/gi },
];

const NEGATION_HINT = /(do not|don't|never|not\s+use|금지|쓰지\s*마|사용\s*금지|禁止|不要)/i;

function hasNegationHintNearby(source: string, index: number): boolean {
  const start = Math.max(0, index - 28);
  const end = Math.min(source.length, index + 18);
  const windowText = source.slice(start, end);
  return NEGATION_HINT.test(windowText);
}

function detectSignals(text: string): { remotionSignals: string[]; forbiddenSignals: string[] } {
  const remotionSignals: string[] = [];
  for (const pattern of REMOTION_PATTERNS) {
    if (pattern.regex.test(text)) remotionSignals.push(pattern.key);
  }

  const forbiddenSignals = new Set<string>();
  for (const pattern of FORBIDDEN_PATTERNS) {
    pattern.regex.lastIndex = 0;
    let matched = pattern.regex.exec(text);
    while (matched) {
      const idx = matched.index ?? 0;
      if (!hasNegationHintNearby(text, idx)) {
        forbiddenSignals.add(pattern.key);
        break;
      }
      matched = pattern.regex.exec(text);
    }
  }

  return {
    remotionSignals,
    forbiddenSignals: [...forbiddenSignals],
  };
}

export type RemotionGateScan = {
  taskId: string;
  foundLog: boolean;
  remotionSignals: string[];
  forbiddenSignals: string[];
};

export type RemotionGateResult = {
  passed: boolean;
  checkedTaskIds: string[];
  remotionEvidenceTaskIds: string[];
  forbiddenEngineTaskIds: string[];
  scans: RemotionGateScan[];
};

export function evaluateRemotionOnlyGateFromLogFiles(args: {
  logsDir: string;
  taskIds: string[];
}): RemotionGateResult {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const raw of args.taskIds) {
    const id = String(raw ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }

  const scans: RemotionGateScan[] = ids.map((taskId) => {
    const logPath = path.join(args.logsDir, `${taskId}.log`);
    let source = "";
    try {
      if (fs.existsSync(logPath)) {
        source = fs.readFileSync(logPath, "utf8");
      }
    } catch {
      source = "";
    }

    const foundLog = source.length > 0;
    const signals = foundLog ? detectSignals(source) : { remotionSignals: [], forbiddenSignals: [] };
    return {
      taskId,
      foundLog,
      remotionSignals: signals.remotionSignals,
      forbiddenSignals: signals.forbiddenSignals,
    };
  });

  const remotionEvidenceTaskIds = scans.filter((scan) => scan.remotionSignals.length > 0).map((scan) => scan.taskId);
  const forbiddenEngineTaskIds = scans.filter((scan) => scan.forbiddenSignals.length > 0).map((scan) => scan.taskId);

  return {
    passed: remotionEvidenceTaskIds.length > 0 && forbiddenEngineTaskIds.length === 0,
    checkedTaskIds: ids,
    remotionEvidenceTaskIds,
    forbiddenEngineTaskIds,
    scans,
  };
}
