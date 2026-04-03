import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateText, extractJsonFromResponse } from "./ai-client.ts";
import { collectProjectContext } from "./file-context.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface DiscoveredTask {
  title: string;
  description: string;
  task_type: "development" | "design" | "analysis" | "documentation";
  priority: number;
  department_hint: string;
  estimated_complexity: "low" | "medium" | "high";
  affected_files: string[];
}

interface AnalysisResult {
  analysis_summary: string;
  tasks: DiscoveredTask[];
}

type DbLike = {
  prepare: (sql: string) => {
    get: (...args: unknown[]) => unknown;
    all: (...args: unknown[]) => unknown[];
    run: (...args: unknown[]) => void;
  };
};

const DEPT_KEYWORD_MAP: Record<string, string[]> = {
  Development: ["development", "dev", "engineering", "backend", "frontend"],
  "QA-QC": ["qa", "qc", "testing", "quality", "test"],
  Design: ["design", "ui", "ux", "visual"],
  Planning: ["planning", "management", "strategy"],
  Research: ["research", "analysis", "investigation"],
};

function matchDepartment(hint: string, departments: { id: string; name: string }[]): string | null {
  const hintLower = hint.toLowerCase();
  for (const dept of departments) {
    // Direct name match
    if (dept.name.toLowerCase() === hintLower) return dept.id;
    // Keyword match
    for (const [key, keywords] of Object.entries(DEPT_KEYWORD_MAP)) {
      if (key.toLowerCase() === hintLower || keywords.some((k) => hintLower.includes(k))) {
        const match = departments.find(
          (d) =>
            d.name.toLowerCase().includes(key.toLowerCase()) ||
            keywords.some((kw) => d.name.toLowerCase().includes(kw)),
        );
        if (match) return match.id;
      }
    }
  }
  // Default to first department
  return departments[0]?.id || null;
}

function findBestIdleAgent(
  db: DbLike,
  departmentId: string | null,
): { id: string; name: string } | null {
  const agents = db
    .prepare(
      `SELECT id, name, role, stats_tasks_done FROM agents
       WHERE status = 'idle' AND cli_provider IS NOT NULL AND current_task_id IS NULL
       ${departmentId ? "AND department_id = ?" : ""}
       ORDER BY
         CASE role WHEN 'team_leader' THEN 4 WHEN 'senior' THEN 3 WHEN 'junior' THEN 2 ELSE 1 END DESC,
         stats_tasks_done ASC
       LIMIT 1`,
    )
    .all(...(departmentId ? [departmentId] : [])) as { id: string; name: string }[];
  return agents[0] || null;
}

export async function analyzeProject(
  db: DbLike,
  projectId: string,
  mode: "quick" | "deep" = "quick",
  onProgress?: (phase: string, progress: number, partialTasks?: DiscoveredTask[]) => void,
): Promise<{ summary: string; tasks: DiscoveredTask[] }> {
  // 1. Get project info
  const project = db.prepare("SELECT id, name, project_path, core_goal FROM projects WHERE id = ?").get(projectId) as
    | { id: string; name: string; project_path: string; core_goal: string }
    | undefined;
  if (!project) throw new Error(`Project not found: ${projectId}`);

  onProgress?.("collecting_context", 10);

  // 2. Collect project context
  const maxChars = mode === "deep" ? 100000 : 50000;
  const context = collectProjectContext(project.project_path, maxChars);

  onProgress?.("analyzing", 30);

  // 3. Load prompt template
  const promptPath = path.join(__dirname, "prompts", "auto-task-discovery.md");
  let systemPrompt = fs.readFileSync(promptPath, "utf8");
  systemPrompt = systemPrompt.replace("{{CORE_GOAL}}", project.core_goal);

  // 4. Call AI
  const userPrompt = `## Project: ${project.name}\n\n${context}`;

  onProgress?.("generating_tasks", 50);

  const response = await generateText(db, systemPrompt, userPrompt, {
    maxTokens: mode === "deep" ? 16384 : 8192,
    temperature: 0.3,
  });

  onProgress?.("parsing_results", 80);

  // 5. Parse response
  const result = extractJsonFromResponse<AnalysisResult>(response);

  // Validate and sanitize
  const tasks = (result.tasks || []).map((t) => ({
    title: String(t.title || "Untitled Task"),
    description: String(t.description || ""),
    task_type: (["development", "design", "analysis", "documentation"].includes(t.task_type)
      ? t.task_type
      : "development") as DiscoveredTask["task_type"],
    priority: Math.min(Math.max(Number(t.priority) || 2, 0), 3),
    department_hint: String(t.department_hint || "Development"),
    estimated_complexity: (["low", "medium", "high"].includes(t.estimated_complexity)
      ? t.estimated_complexity
      : "medium") as DiscoveredTask["estimated_complexity"],
    affected_files: Array.isArray(t.affected_files) ? t.affected_files.map(String) : [],
  }));

  onProgress?.("done", 100, tasks);

  return {
    summary: result.analysis_summary || "Analysis complete",
    tasks,
  };
}

export async function createTasksFromAnalysis(
  db: DbLike,
  projectId: string,
  tasks: DiscoveredTask[],
  options: {
    autoAssign: boolean;
    autoRun: boolean;
    workflowPackKey?: string;
    broadcast: (event: string, payload: unknown) => void;
    appendTaskLog: (taskId: string | null, kind: string, message: string) => void;
    runTask?: (taskId: string) => Promise<void>;
    nowMs: () => number;
  },
): Promise<string[]> {
  const { randomUUID } = await import("node:crypto");

  const project = db.prepare("SELECT id, project_path, default_pack_key FROM projects WHERE id = ?").get(projectId) as
    | { id: string; project_path: string; default_pack_key: string }
    | undefined;
  if (!project) throw new Error(`Project not found: ${projectId}`);

  const departments = db.prepare("SELECT id, name FROM departments").all() as { id: string; name: string }[];
  const taskIds: string[] = [];

  for (const task of tasks) {
    const taskId = randomUUID();
    const departmentId = matchDepartment(task.department_hint, departments);
    const packKey = options.workflowPackKey || project.default_pack_key || "development";

    db.prepare(
      `INSERT INTO tasks (id, title, description, department_id, project_id, project_path, status, priority, task_type, workflow_pack_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'inbox', ?, ?, ?, ?, ?)`,
    ).run(
      taskId,
      task.title,
      `${task.description}\n\n**Affected files:** ${task.affected_files.join(", ") || "N/A"}\n**Complexity:** ${task.estimated_complexity}`,
      departmentId,
      projectId,
      project.project_path,
      task.priority,
      task.task_type,
      packKey,
      options.nowMs(),
      options.nowMs(),
    );

    options.appendTaskLog(taskId, "auto-task", `Auto-generated from project analysis`);

    // Auto-assign if requested
    if (options.autoAssign && departmentId) {
      const agent = findBestIdleAgent(db, departmentId);
      if (agent) {
        db.prepare("UPDATE tasks SET assigned_agent_id = ?, status = 'planned' WHERE id = ?").run(agent.id, taskId);
        db.prepare("UPDATE agents SET current_task_id = ? WHERE id = ?").run(taskId, agent.id);
        options.appendTaskLog(taskId, "assign", `Auto-assigned to ${agent.name}`);
      }
    }

    const createdTask = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId);
    options.broadcast("task_update", createdTask);
    taskIds.push(taskId);
  }

  // Auto-run if requested
  if (options.autoRun && options.runTask) {
    for (const taskId of taskIds) {
      const task = db.prepare("SELECT assigned_agent_id, status FROM tasks WHERE id = ?").get(taskId) as
        | { assigned_agent_id: string | null; status: string }
        | undefined;
      if (task?.assigned_agent_id && task.status === "planned") {
        try {
          await options.runTask(taskId);
        } catch (err) {
          options.appendTaskLog(taskId, "error", `Auto-run failed: ${err}`);
        }
      }
    }
  }

  return taskIds;
}
