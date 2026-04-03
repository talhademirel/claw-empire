import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { generateText, extractJsonFromResponse } from "./ai-client.ts";
import { collectTeamContext } from "./file-context.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface DepartmentRecommendation {
  id: string;
  name: string;
  icon: string;
  color: string;
  description: string;
}

interface AgentRecommendation {
  name: string;
  department_id: string;
  role: "team_leader" | "senior" | "junior" | "intern";
  cli_provider: "claude" | "codex" | "gemini" | "copilot";
  avatar_emoji: string;
  personality: string;
}

interface TeamRecommendation {
  team_summary: string;
  departments: DepartmentRecommendation[];
  agents: AgentRecommendation[];
}

type DbLike = {
  prepare: (sql: string) => {
    get: (...args: unknown[]) => unknown;
    all: (...args: unknown[]) => unknown[];
    run: (...args: unknown[]) => void;
  };
};

const VALID_ROLES = new Set(["team_leader", "senior", "junior", "intern"]);
const VALID_PROVIDERS = new Set(["claude", "codex", "gemini", "opencode", "kimi", "copilot", "antigravity"]);
const DEPT_ID_REGEX = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export async function analyzeTeam(
  db: DbLike,
  projectId: string,
  onProgress?: (phase: string, progress: number) => void,
): Promise<TeamRecommendation> {
  const project = db.prepare("SELECT id, name, project_path, core_goal FROM projects WHERE id = ?").get(projectId) as
    | { id: string; name: string; project_path: string; core_goal: string }
    | undefined;
  if (!project) throw new Error(`Project not found: ${projectId}`);

  onProgress?.("collecting_context", 10);
  const context = collectTeamContext(project.project_path);

  onProgress?.("analyzing", 30);
  const promptPath = path.join(__dirname, "prompts", "team-discovery.md");
  const systemPrompt = fs.readFileSync(promptPath, "utf8");
  const userPrompt = `## Project: ${project.name}\n## Core Goal: ${project.core_goal}\n\n${context}`;

  onProgress?.("generating_team", 50);
  const response = await generateText(db, systemPrompt, userPrompt, { maxTokens: 8192, model: "opus", temperature: 0 });

  onProgress?.("parsing", 80);
  const result = extractJsonFromResponse<TeamRecommendation>(response);

  // Validate and sanitize
  const departments = (result.departments || [])
    .map((d) => ({
      id: String(d.id || "").toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, 64),
      name: String(d.name || "Unnamed"),
      icon: String(d.icon || "📁"),
      color: /^#[0-9a-fA-F]{3,6}$/.test(d.color) ? d.color : "#6b7280",
      description: String(d.description || ""),
    }))
    .filter((d) => DEPT_ID_REGEX.test(d.id));

  const deptIds = new Set(departments.map((d) => d.id));
  const agents = (result.agents || [])
    .map((a) => ({
      name: String(a.name || "Agent"),
      department_id: String(a.department_id || ""),
      role: (VALID_ROLES.has(a.role) ? a.role : "junior") as AgentRecommendation["role"],
      cli_provider: (VALID_PROVIDERS.has(a.cli_provider) ? a.cli_provider : "claude") as AgentRecommendation["cli_provider"],
      avatar_emoji: String(a.avatar_emoji || "🤖"),
      personality: String(a.personality || ""),
    }))
    .filter((a) => deptIds.has(a.department_id));

  onProgress?.("done", 100);
  return {
    team_summary: result.team_summary || "Team structure generated",
    departments,
    agents,
  };
}

export function applyTeam(
  db: DbLike,
  recommendation: TeamRecommendation,
  options: {
    clearExisting: boolean;
    broadcast: (event: string, payload: unknown) => void;
  },
): { departmentsCreated: number; agentsCreated: number } {
  let departmentsCreated = 0;
  let agentsCreated = 0;

  if (options.clearExisting) {
    // NULL out FK references before deleting (no ON DELETE CASCADE defined)
    db.prepare("UPDATE tasks SET assigned_agent_id = NULL, department_id = NULL").run();
    db.prepare("UPDATE subtasks SET assigned_agent_id = NULL").run();
    db.prepare("UPDATE meeting_minute_entries SET speaker_agent_id = NULL").run();
    db.prepare("UPDATE project_review_decision_states SET planner_agent_id = NULL").run();
    db.prepare("UPDATE review_round_decision_states SET planner_agent_id = NULL").run();
    db.prepare("UPDATE task_report_archives SET generated_by_agent_id = NULL").run();
    db.prepare("DELETE FROM agents").run();
    db.prepare("DELETE FROM departments").run();
    options.broadcast("departments_changed", {});
  }

  // Create departments
  const maxSortOrderRow = db.prepare("SELECT COALESCE(MAX(sort_order), 0) AS max_order FROM departments").get() as { max_order: number };
  let nextSortOrder = maxSortOrderRow.max_order + 1;

  for (const dept of recommendation.departments) {
    const existing = db.prepare("SELECT id FROM departments WHERE id = ?").get(dept.id);
    if (existing) continue;

    db.prepare(
      `INSERT INTO departments (id, name, name_ko, name_ja, name_zh, icon, color, description, sort_order, created_at)
       VALUES (?, ?, '', '', '', ?, ?, ?, ?, ?)`,
    ).run(dept.id, dept.name, dept.icon, dept.color, dept.description, nextSortOrder++, Date.now());
    departmentsCreated++;
  }

  if (departmentsCreated > 0) {
    options.broadcast("departments_changed", {});
  }

  // Create agents
  for (const agent of recommendation.agents) {
    const deptExists = db.prepare("SELECT id FROM departments WHERE id = ?").get(agent.department_id);
    if (!deptExists) continue;

    const agentId = randomUUID();
    db.prepare(
      `INSERT INTO agents (id, name, name_ko, name_ja, name_zh, department_id, role, cli_provider, avatar_emoji, personality, status, created_at)
       VALUES (?, ?, '', '', '', ?, ?, ?, ?, ?, 'idle', ?)`,
    ).run(agentId, agent.name, agent.department_id, agent.role, agent.cli_provider, agent.avatar_emoji, agent.personality, Date.now());

    const created = db.prepare(
      `SELECT a.*, d.name AS department_name, d.color AS department_color
       FROM agents a LEFT JOIN departments d ON a.department_id = d.id
       WHERE a.id = ?`,
    ).get(agentId);
    options.broadcast("agent_created", created);
    agentsCreated++;
  }

  return { departmentsCreated, agentsCreated };
}
