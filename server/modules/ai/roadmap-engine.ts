import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { generateText, extractJsonFromResponse } from "./ai-client.ts";
import { collectProjectContext } from "./file-context.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface RoadmapDiscovery {
  id: string;
  project_id: string;
  target_audience: string | null;
  product_vision: string | null;
  current_state: string | null; // JSON
  raw_analysis: string | null;
  created_at: number;
  updated_at: number;
}

export type FeaturePhase = "backlog" | "phase_1" | "phase_2" | "phase_3" | "phase_4";
export type FeatureStatus = "backlog" | "planned" | "in_progress" | "completed";

export interface RoadmapFeature {
  id: string;
  project_id: string;
  title: string;
  description: string;
  phase: FeaturePhase;
  status: FeatureStatus;
  priority: number;
  estimated_effort: "low" | "medium" | "high" | "very_high" | null;
  category: string | null;
  dependencies: string | null; // JSON array of feature IDs
  converted_task_id: string | null;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

interface DiscoveryFromAI {
  target_audience: string;
  product_vision: string;
  current_state: {
    features: string[];
    tech_stack: string[];
    maturity: string;
    strengths: string[];
    weaknesses: string[];
  };
  gaps: { area: string; description: string; impact: string }[];
}

interface FeatureFromAI {
  title: string;
  description: string;
  phase: string;
  priority: number;
  estimated_effort: string;
  category: string;
  dependencies: string[];
}

type DbLike = {
  prepare: (sql: string) => {
    get: (...args: unknown[]) => unknown;
    all: (...args: unknown[]) => unknown[];
    run: (...args: unknown[]) => void;
  };
};

async function runDiscovery(
  db: DbLike,
  projectId: string,
  context: string,
  projectName: string,
  coreGoal: string,
): Promise<DiscoveryFromAI> {
  const promptPath = path.join(__dirname, "prompts", "roadmap-discovery.md");
  const systemPrompt = fs.readFileSync(promptPath, "utf8");
  const userPrompt = `## Project: ${projectName}\n## Core Goal: ${coreGoal}\n\n${context}`;

  const response = await generateText(db, systemPrompt, userPrompt, {
    maxTokens: 4096,
    model: "opus",
  });

  return extractJsonFromResponse<DiscoveryFromAI>(response);
}

async function runFeatureGeneration(
  db: DbLike,
  discoveryData: DiscoveryFromAI,
  context: string,
  projectName: string,
): Promise<FeatureFromAI[]> {
  const promptPath = path.join(__dirname, "prompts", "roadmap-features.md");
  let systemPrompt = fs.readFileSync(promptPath, "utf8");
  systemPrompt = systemPrompt.replace("{{DISCOVERY_CONTEXT}}", JSON.stringify(discoveryData, null, 2));

  const userPrompt = `## Project: ${projectName}\n\n${context}`;

  const response = await generateText(db, systemPrompt, userPrompt, {
    maxTokens: 8192,
    model: "opus",
  });

  const parsed = extractJsonFromResponse<{ features: FeatureFromAI[] }>(response);
  return parsed.features || [];
}

export async function generateRoadmap(
  db: DbLike,
  projectId: string,
  onProgress?: (phase: string, progress: number) => void,
): Promise<{ discovery: RoadmapDiscovery; features: RoadmapFeature[] }> {
  const project = db.prepare("SELECT id, name, project_path, core_goal FROM projects WHERE id = ?").get(projectId) as
    | { id: string; name: string; project_path: string; core_goal: string }
    | undefined;
  if (!project) throw new Error(`Project not found: ${projectId}`);

  onProgress?.("collecting_context", 10);
  const context = collectProjectContext(project.project_path, 60000);

  // Step 1: Discovery
  onProgress?.("discovery", 20);
  const discoveryData = await runDiscovery(db, projectId, context, project.name, project.core_goal);

  const now = Date.now();
  const discoveryId = randomUUID();
  const discovery: RoadmapDiscovery = {
    id: discoveryId,
    project_id: projectId,
    target_audience: discoveryData.target_audience || null,
    product_vision: discoveryData.product_vision || null,
    current_state: JSON.stringify(discoveryData.current_state),
    raw_analysis: JSON.stringify(discoveryData),
    created_at: now,
    updated_at: now,
  };

  // Upsert discovery
  db.prepare(
    `INSERT INTO roadmap_discovery (id, project_id, target_audience, product_vision, current_state, raw_analysis, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id) DO UPDATE SET
       target_audience = excluded.target_audience,
       product_vision = excluded.product_vision,
       current_state = excluded.current_state,
       raw_analysis = excluded.raw_analysis,
       updated_at = excluded.updated_at`,
  ).run(
    discovery.id,
    discovery.project_id,
    discovery.target_audience,
    discovery.product_vision,
    discovery.current_state,
    discovery.raw_analysis,
    discovery.created_at,
    discovery.updated_at,
  );

  // Step 2: Feature Generation
  onProgress?.("generating_features", 50);
  const featuresFromAI = await runFeatureGeneration(db, discoveryData, context, project.name);

  // Step 3: Save features
  onProgress?.("saving_features", 80);

  // Atomic replace: delete old + insert new in a single transaction-like block
  const validPhases = new Set(["backlog", "phase_1", "phase_2", "phase_3", "phase_4"]);
  const validEfforts = new Set(["low", "medium", "high", "very_high"]);

  // Prepare all features first, then atomic delete+insert
  const features: RoadmapFeature[] = featuresFromAI.map((f, idx) => {
    const phase = validPhases.has(f.phase) ? (f.phase as FeaturePhase) : "backlog";
    return {
      id: randomUUID(),
      project_id: projectId,
      title: String(f.title || "Untitled Feature"),
      description: String(f.description || ""),
      phase,
      status: "backlog" as FeatureStatus,
      priority: Math.min(Math.max(Number(f.priority) || 2, 0), 3),
      estimated_effort: validEfforts.has(f.estimated_effort)
        ? (f.estimated_effort as RoadmapFeature["estimated_effort"])
        : null,
      category: f.category || null,
      dependencies: f.dependencies?.length ? JSON.stringify(f.dependencies) : null,
      converted_task_id: null,
      sort_order: idx,
      created_at: now,
      updated_at: now,
    };
  });

  // Delete old and insert new atomically
  db.prepare("DELETE FROM roadmap_features WHERE project_id = ?").run(projectId);
  const insertStmt = db.prepare(
    `INSERT INTO roadmap_features (id, project_id, title, description, phase, status, priority, estimated_effort, category, dependencies, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'backlog', ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const feature of features) {
    insertStmt.run(
      feature.id,
      feature.project_id,
      feature.title,
      feature.description,
      feature.phase,
      feature.priority,
      feature.estimated_effort,
      feature.category,
      feature.dependencies,
      feature.sort_order,
      feature.created_at,
      feature.updated_at,
    );
  }

  onProgress?.("done", 100);
  return { discovery, features };
}

export function convertFeatureToTask(
  db: DbLike,
  featureId: string,
  projectId: string,
  nowMs: () => number,
): string {
  const feature = db.prepare("SELECT * FROM roadmap_features WHERE id = ? AND project_id = ?").get(featureId, projectId) as
    | RoadmapFeature
    | undefined;
  if (!feature) throw new Error(`Feature not found: ${featureId}`);
  if (feature.converted_task_id) throw new Error("Feature already converted to task");

  const project = db.prepare("SELECT project_path, default_pack_key FROM projects WHERE id = ?").get(projectId) as
    | { project_path: string; default_pack_key: string }
    | undefined;

  const taskId = randomUUID();
  const description = [
    feature.description,
    feature.category ? `\n**Category:** ${feature.category}` : "",
    feature.estimated_effort ? `\n**Effort:** ${feature.estimated_effort}` : "",
    `\n**Phase:** ${feature.phase.replace("_", " ")}`,
  ].join("");

  db.prepare(
    `INSERT INTO tasks (id, title, description, project_id, project_path, status, priority, task_type, workflow_pack_key, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'inbox', ?, 'development', ?, ?, ?)`,
  ).run(
    taskId,
    feature.title,
    description,
    projectId,
    project?.project_path || null,
    feature.priority,
    project?.default_pack_key || "development",
    nowMs(),
    nowMs(),
  );

  db.prepare("UPDATE roadmap_features SET converted_task_id = ?, status = 'planned', updated_at = ? WHERE id = ?").run(
    taskId,
    nowMs(),
    featureId,
  );

  return taskId;
}
