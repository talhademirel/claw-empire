import { bootstrapSession, del, patch, post, request, withAuthHeaders } from "./core";

import type {
  Agent,
  Department,
  MeetingPresence,
  Project,
  SubTask,
  Task,
  TaskLog,
  TaskStatus,
  TaskType,
  WorkflowPackKey,
} from "../types";

// Departments
export async function getDepartments(options?: {
  workflowPackKey?: WorkflowPackKey;
  includeSeed?: boolean;
}): Promise<Department[]> {
  const params = new URLSearchParams();
  if (options?.workflowPackKey) params.set("workflow_pack_key", options.workflowPackKey);
  if (options?.includeSeed) params.set("include_seed", "1");
  const query = params.toString();
  const j = await request<{ departments: Department[] }>(`/api/departments${query ? `?${query}` : ""}`);
  return j.departments;
}

export async function getDepartment(
  id: string,
  options?: { workflowPackKey?: WorkflowPackKey; includeSeed?: boolean },
): Promise<{ department: Department; agents: Agent[] }> {
  const params = new URLSearchParams();
  if (options?.workflowPackKey) params.set("workflow_pack_key", options.workflowPackKey);
  if (options?.includeSeed) params.set("include_seed", "1");
  const query = params.toString();
  return request(`/api/departments/${id}${query ? `?${query}` : ""}`);
}

export async function createDepartment(data: {
  id: string;
  name: string;
  name_ko?: string;
  name_ja?: string;
  name_zh?: string;
  icon?: string;
  color?: string;
  description?: string;
  prompt?: string;
  workflow_pack_key?: WorkflowPackKey;
}): Promise<Department> {
  const j = await request<{ department: Department }>("/api/departments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return j.department;
}

export async function updateDepartment(
  id: string,
  data: Partial<
    Pick<
      Department,
      "name" | "name_ko" | "name_ja" | "name_zh" | "icon" | "color" | "description" | "prompt" | "sort_order"
    >
  > & { workflow_pack_key?: WorkflowPackKey },
): Promise<void> {
  const params = new URLSearchParams();
  if (data.workflow_pack_key) params.set("workflow_pack_key", data.workflow_pack_key);
  const query = params.toString();
  await patch(`/api/departments/${id}${query ? `?${query}` : ""}`, data);
}

export async function deleteDepartment(id: string, options?: { workflowPackKey?: WorkflowPackKey }): Promise<void> {
  const params = new URLSearchParams();
  if (options?.workflowPackKey) params.set("workflow_pack_key", options.workflowPackKey);
  const query = params.toString();
  await del(`/api/departments/${id}${query ? `?${query}` : ""}`);
}

export async function reorderDepartments(
  orders: { id: string; sort_order: number }[],
  options?: { workflowPackKey?: WorkflowPackKey },
): Promise<void> {
  const params = new URLSearchParams();
  if (options?.workflowPackKey) params.set("workflow_pack_key", options.workflowPackKey);
  const query = params.toString();
  await patch(`/api/departments/reorder${query ? `?${query}` : ""}`, {
    orders,
    ...(options?.workflowPackKey ? { workflow_pack_key: options.workflowPackKey } : {}),
  });
}

// Agents
export async function getAgents(options?: { includeSeed?: boolean }): Promise<Agent[]> {
  const params = new URLSearchParams();
  if (options?.includeSeed) params.set("include_seed", "1");
  const q = params.toString();
  const j = await request<{ agents: Agent[] }>(`/api/agents${q ? "?" + q : ""}`);
  return j.agents;
}

export async function getAgent(id: string): Promise<Agent> {
  const j = await request<{ agent: Agent }>(`/api/agents/${id}`);
  return j.agent;
}

export async function getMeetingPresence(): Promise<MeetingPresence[]> {
  const j = await request<{ presence: MeetingPresence[] }>("/api/meeting-presence");
  return j.presence;
}

export async function updateAgent(
  id: string,
  data: Partial<
    Pick<
      Agent,
      | "name"
      | "name_ko"
      | "name_ja"
      | "name_zh"
      | "status"
      | "current_task_id"
      | "department_id"
      | "role"
      | "acts_as_planning_leader"
      | "cli_provider"
      | "oauth_account_id"
      | "api_provider_id"
      | "api_model"
      | "cli_model"
      | "cli_reasoning_level"
      | "avatar_emoji"
      | "sprite_number"
      | "personality"
    >
  > & {
    workflow_pack_key?: WorkflowPackKey;
    force_planning_leader_override?: boolean;
  },
): Promise<void> {
  await patch(`/api/agents/${id}`, data);
}

export async function createAgent(data: {
  name: string;
  name_ko: string;
  name_ja?: string;
  name_zh?: string;
  department_id: string | null;
  role: string;
  cli_provider: string;
  avatar_emoji: string;
  sprite_number?: number | null;
  personality: string | null;
  workflow_pack_key?: WorkflowPackKey;
}): Promise<Agent> {
  const j = (await post("/api/agents", data)) as { ok: boolean; agent: Agent };
  return j.agent;
}

export async function deleteAgent(id: string): Promise<void> {
  await del(`/api/agents/${id}`);
}

export async function processSprite(imageBase64: string): Promise<{
  ok: boolean;
  previews: Record<string, string>;
  suggestedNumber: number;
}> {
  return post<{
    ok: boolean;
    previews: Record<string, string>;
    suggestedNumber: number;
  }>("/api/sprites/process", { image: imageBase64 });
}

export async function registerSprite(
  sprites: Record<string, string>,
  spriteNumber: number,
): Promise<{
  ok: boolean;
  spriteNumber: number;
  saved: string[];
}> {
  return post<{
    ok: boolean;
    spriteNumber: number;
    saved: string[];
  }>("/api/sprites/register", { sprites, spriteNumber });
}

// Tasks
export async function getTasks(filters?: {
  status?: TaskStatus;
  department_id?: string;
  agent_id?: string;
  project_id?: string;
  workflow_pack_key?: WorkflowPackKey;
}): Promise<Task[]> {
  const params = new URLSearchParams();
  if (filters?.status) params.set("status", filters.status);
  if (filters?.department_id) params.set("department_id", filters.department_id);
  if (filters?.agent_id) params.set("agent_id", filters.agent_id);
  if (filters?.project_id) params.set("project_id", filters.project_id);
  if (filters?.workflow_pack_key) params.set("workflow_pack_key", filters.workflow_pack_key);
  const q = params.toString();
  const j = await request<{ tasks: Task[] }>(`/api/tasks${q ? "?" + q : ""}`);
  return j.tasks;
}

export async function getTask(id: string): Promise<{ task: Task; logs: TaskLog[]; subtasks: SubTask[] }> {
  return request(`/api/tasks/${id}`);
}

export async function createTask(input: {
  title: string;
  description?: string;
  department_id?: string;
  task_type?: TaskType;
  priority?: number;
  project_id?: string;
  project_path?: string;
  assigned_agent_id?: string;
  workflow_pack_key?: WorkflowPackKey;
  workflow_meta_json?: Record<string, unknown> | string;
  output_format?: string;
}): Promise<string> {
  const j = (await post("/api/tasks", input)) as { id: string };
  return j.id;
}

export async function updateTask(
  id: string,
  data: Partial<
    Pick<
      Task,
      | "title"
      | "description"
      | "status"
      | "priority"
      | "task_type"
      | "department_id"
      | "project_id"
      | "project_path"
      | "workflow_pack_key"
      | "workflow_meta_json"
      | "output_format"
      | "hidden"
    >
  >,
): Promise<void> {
  await patch(`/api/tasks/${id}`, data);
}

export async function bulkHideTasks(statuses: string[], hidden: 0 | 1): Promise<void> {
  await post("/api/tasks/bulk-hide", { statuses, hidden });
}

export async function deleteTask(id: string): Promise<void> {
  await del(`/api/tasks/${id}`);
}

export async function assignTask(id: string, agentId: string): Promise<void> {
  await post(`/api/tasks/${id}/assign`, { agent_id: agentId });
}

export async function runTask(id: string): Promise<void> {
  await post(`/api/tasks/${id}/run`);
}

export async function stopTask(id: string): Promise<void> {
  await post(`/api/tasks/${id}/stop`, { mode: "cancel" });
}

export async function pauseTask(id: string): Promise<{
  ok: boolean;
  stopped: boolean;
  status: string;
  pid?: number;
  rolled_back?: boolean;
  message?: string;
  interrupt?: {
    session_id: string;
    control_token: string;
    requires_csrf: boolean;
  } | null;
}> {
  await bootstrapSession({ promptOnUnauthorized: false });
  return post(`/api/tasks/${id}/stop`, { mode: "pause" });
}

export async function resumeTask(id: string): Promise<void> {
  await bootstrapSession({ promptOnUnauthorized: false });
  await post(`/api/tasks/${id}/resume`);
}

export async function injectTaskPrompt(
  id: string,
  input: {
    session_id: string;
    interrupt_token: string;
    prompt: string;
  },
): Promise<{ ok: boolean; queued: boolean; session_id: string; prompt_hash: string; pending_count: number }> {
  await bootstrapSession({ promptOnUnauthorized: false });
  return post(`/api/tasks/${id}/inject`, input);
}

// Projects
export interface ProjectTaskHistoryItem {
  id: string;
  title: string;
  status: string;
  task_type: string;
  priority: number;
  source_task_id?: string | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
  assigned_agent_id: string | null;
  assigned_agent_name: string;
  assigned_agent_name_ko: string;
}

export interface ProjectReportHistoryItem {
  id: string;
  title: string;
  completed_at: number | null;
  created_at: number;
  assigned_agent_id: string | null;
  agent_name: string;
  agent_name_ko: string;
  dept_name: string;
  dept_name_ko: string;
}

export interface ProjectDecisionEventItem {
  id: number;
  snapshot_hash: string | null;
  event_type:
    | "planning_summary"
    | "representative_pick"
    | "followup_request"
    | "start_review_meeting"
    | "start_review_meeting_blocked";
  summary: string;
  selected_options_json: string | null;
  note: string | null;
  task_id: string | null;
  meeting_id: string | null;
  created_at: number;
}

export interface ProjectDetailResponse {
  project: Project;
  assigned_agents?: Agent[];
  tasks: ProjectTaskHistoryItem[];
  reports: ProjectReportHistoryItem[];
  decision_events: ProjectDecisionEventItem[];
}

export async function getProjects(params?: { page?: number; page_size?: number; search?: string }): Promise<{
  projects: Project[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}> {
  const sp = new URLSearchParams();
  if (params?.page) sp.set("page", String(params.page));
  if (params?.page_size) sp.set("page_size", String(params.page_size));
  if (params?.search) sp.set("search", params.search);
  const q = sp.toString();
  return request(`/api/projects${q ? `?${q}` : ""}`);
}

export async function createProject(input: {
  name: string;
  project_path: string;
  core_goal: string;
  default_pack_key?: WorkflowPackKey;
  create_path_if_missing?: boolean;
  github_repo?: string;
  assignment_mode?: "auto" | "manual";
  agent_ids?: string[];
}): Promise<Project> {
  const j = (await post("/api/projects", input)) as { ok: boolean; project: Project };
  return j.project;
}

export async function updateProject(
  id: string,
  patchData: Partial<Pick<Project, "name" | "project_path" | "core_goal" | "default_pack_key">> & {
    create_path_if_missing?: boolean;
    github_repo?: string | null;
    assignment_mode?: "auto" | "manual";
    agent_ids?: string[];
  },
): Promise<Project> {
  const j = (await patch(`/api/projects/${id}`, patchData)) as { ok: boolean; project: Project };
  return j.project;
}

export interface ProjectPathCheckResult {
  normalized_path: string;
  exists: boolean;
  is_directory: boolean;
  can_create: boolean;
  nearest_existing_parent: string | null;
}

export interface ProjectPathBrowseEntry {
  name: string;
  path: string;
}

export interface ProjectPathBrowseResult {
  current_path: string;
  parent_path: string | null;
  entries: ProjectPathBrowseEntry[];
  truncated: boolean;
}

export async function checkProjectPath(pathInput: string): Promise<ProjectPathCheckResult> {
  const sp = new URLSearchParams();
  sp.set("path", pathInput);
  const j = await request<{ ok: boolean } & ProjectPathCheckResult>(`/api/projects/path-check?${sp.toString()}`);
  return {
    normalized_path: j.normalized_path,
    exists: j.exists,
    is_directory: j.is_directory,
    can_create: j.can_create,
    nearest_existing_parent: j.nearest_existing_parent,
  };
}

export async function getProjectPathSuggestions(query: string, limit = 30): Promise<string[]> {
  const sp = new URLSearchParams();
  if (query.trim()) sp.set("q", query.trim());
  sp.set("limit", String(limit));
  const j = await request<{ ok: boolean; paths: string[] }>(`/api/projects/path-suggestions?${sp.toString()}`);
  return j.paths ?? [];
}

export async function browseProjectPath(pathInput?: string): Promise<ProjectPathBrowseResult> {
  const sp = new URLSearchParams();
  if (pathInput && pathInput.trim()) sp.set("path", pathInput.trim());
  const q = sp.toString();
  const j = await request<{
    ok: boolean;
    current_path: string;
    parent_path: string | null;
    entries: ProjectPathBrowseEntry[];
    truncated: boolean;
  }>(`/api/projects/path-browse${q ? `?${q}` : ""}`);
  return {
    current_path: j.current_path,
    parent_path: j.parent_path,
    entries: j.entries ?? [],
    truncated: Boolean(j.truncated),
  };
}

export async function pickProjectPathNative(): Promise<{ cancelled: boolean; path: string | null }> {
  const j = await request<{
    ok: boolean;
    cancelled?: boolean;
    path?: string;
  }>("/api/projects/path-native-picker", { method: "POST" });
  if (!j.ok) {
    return { cancelled: Boolean(j.cancelled), path: null };
  }
  return { cancelled: false, path: j.path ?? null };
}

export async function deleteProject(id: string): Promise<void> {
  await del(`/api/projects/${id}`);
}

export async function getProjectDetail(id: string): Promise<ProjectDetailResponse> {
  return request(`/api/projects/${id}`);
}

// ── Auto Task ──────────────────────────────────────────────────────
export function analyzeProjectSSE(
  projectId: string,
  options: { mode: "quick" | "deep"; auto_assign: boolean; auto_run: boolean },
  callbacks: {
    onProgress?: (data: { phase: string; progress: number; task_count: number }) => void;
    onAnalysisComplete?: (data: { summary: string; task_count: number; tasks: unknown[] }) => void;
    onTasksCreated?: (data: { task_ids: string[]; count: number }) => void;
    onDone?: () => void;
    onError?: (error: string) => void;
  },
): AbortController {
  const controller = new AbortController();
  const baseUrl = "";

  console.log(`[AutoTask] Starting analysis for project ${projectId}`, options);
  fetch(`${baseUrl}/api/projects/${projectId}/auto-task`, {
    method: "POST",
    headers: Object.fromEntries(withAuthHeaders({ "Content-Type": "application/json" }, "POST")),
    credentials: "same-origin",
    body: JSON.stringify(options),
    signal: controller.signal,
  }).then(async (response) => {
    console.log(`[AutoTask] Response status: ${response.status}`);
    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => "");
      console.error(`[AutoTask] Request failed: ${response.status} ${text}`);
      callbacks.onError?.(`Request failed (${response.status}): ${text}`);
      return;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      let eventName = "";
      for (const line of lines) {
        if (line.startsWith("event: ")) eventName = line.slice(7).trim();
        else if (line.startsWith("data: ") && eventName) {
          try {
            const data = JSON.parse(line.slice(6));
            console.log(`[AutoTask] SSE event: ${eventName}`, data);
            if (eventName === "progress") callbacks.onProgress?.(data);
            else if (eventName === "analysis_complete") callbacks.onAnalysisComplete?.(data);
            else if (eventName === "tasks_created") callbacks.onTasksCreated?.(data);
            else if (eventName === "done") callbacks.onDone?.();
            else if (eventName === "error") callbacks.onError?.(data.error);
          } catch { /* ignore */ }
          eventName = "";
        }
      }
    }
    console.log(`[AutoTask] Stream ended`);
  }).catch((err) => {
    if (err.name !== "AbortError") {
      console.error(`[AutoTask] Error:`, err);
      callbacks.onError?.(String(err));
    }
  });

  return controller;
}

// ── Ideation ──────────────────────────────────────────────────────
export function runIdeationSSE(
  projectId: string,
  types?: string[],
  callbacks?: {
    onTypeProgress?: (data: { type: string; status: string; idea_count: number }) => void;
    onDone?: (data: { total_ideas: number }) => void;
    onError?: (error: string) => void;
  },
): AbortController {
  const controller = new AbortController();
  const baseUrl = "";

  console.log(`[Ideation] Starting analysis for project ${projectId}`, types || "all");
  fetch(`${baseUrl}/api/projects/${projectId}/ideation`, {
    method: "POST",
    headers: Object.fromEntries(withAuthHeaders({ "Content-Type": "application/json" }, "POST")),
    credentials: "same-origin",
    body: JSON.stringify({ types }),
    signal: controller.signal,
  }).then(async (response) => {
    console.log(`[Ideation] Response status: ${response.status}`);
    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => "");
      console.error(`[Ideation] Request failed: ${response.status} ${text}`);
      callbacks?.onError?.(`Request failed (${response.status}): ${text}`);
      return;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      let eventName = "";
      for (const line of lines) {
        if (line.startsWith("event: ")) eventName = line.slice(7).trim();
        else if (line.startsWith("data: ") && eventName) {
          try {
            const data = JSON.parse(line.slice(6));
            console.log(`[Ideation] SSE event: ${eventName}`, data);
            if (eventName === "type_progress") callbacks?.onTypeProgress?.(data);
            else if (eventName === "done") callbacks?.onDone?.(data);
            else if (eventName === "error") callbacks?.onError?.(data.error);
          } catch { /* ignore */ }
          eventName = "";
        }
      }
    }
    console.log(`[Ideation] Stream ended`);
  }).catch((err) => {
    if (err.name !== "AbortError") {
      console.error(`[Ideation] Error:`, err);
      callbacks?.onError?.(String(err));
    }
  });

  return controller;
}

export interface IdeationIdea {
  id: string;
  project_id: string;
  type: string;
  title: string;
  description: string;
  rationale: string | null;
  estimated_effort: "low" | "medium" | "high" | null;
  affected_files: string | null;
  implementation_approach: string | null;
  converted_task_id: string | null;
  status: "active" | "converted" | "dismissed";
  created_at: number;
}

export async function getIdeationIdeas(
  projectId: string,
  filters?: { type?: string; status?: string },
): Promise<IdeationIdea[]> {
  const sp = new URLSearchParams();
  if (filters?.type) sp.set("type", filters.type);
  if (filters?.status) sp.set("status", filters.status);
  const q = sp.toString();
  const j = await request<{ ok: boolean; ideas: IdeationIdea[] }>(
    `/api/projects/${projectId}/ideation${q ? `?${q}` : ""}`,
  );
  return j.ideas;
}

export async function convertIdeaToTask(projectId: string, ideaId: string): Promise<string> {
  const j = (await post(`/api/projects/${projectId}/ideation/${ideaId}/convert`)) as { ok: boolean; task_id: string };
  return j.task_id;
}

export async function dismissIdea(projectId: string, ideaId: string): Promise<void> {
  await patch(`/api/projects/${projectId}/ideation/${ideaId}`, { status: "dismissed" });
}

// ── Roadmap ──────────────────────────────────────────────────────
export function generateRoadmapSSE(
  projectId: string,
  callbacks?: {
    onProgress?: (data: { phase: string; progress: number }) => void;
    onDone?: (data: { discovery: unknown; feature_count: number }) => void;
    onError?: (error: string) => void;
  },
): AbortController {
  const controller = new AbortController();
  const baseUrl = "";

  console.log(`[Roadmap] Starting generation for project ${projectId}`);
  fetch(`${baseUrl}/api/projects/${projectId}/roadmap/generate`, {
    method: "POST",
    headers: Object.fromEntries(withAuthHeaders({ "Content-Type": "application/json" }, "POST")),
    credentials: "same-origin",
    signal: controller.signal,
  }).then(async (response) => {
    console.log(`[Roadmap] Response status: ${response.status}`);
    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => "");
      console.error(`[Roadmap] Request failed: ${response.status} ${text}`);
      callbacks?.onError?.(`Request failed (${response.status}): ${text}`);
      return;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      let eventName = "";
      for (const line of lines) {
        if (line.startsWith("event: ")) eventName = line.slice(7).trim();
        else if (line.startsWith("data: ") && eventName) {
          try {
            const data = JSON.parse(line.slice(6));
            console.log(`[Roadmap] SSE event: ${eventName}`, data);
            if (eventName === "progress") callbacks?.onProgress?.(data);
            else if (eventName === "done") callbacks?.onDone?.(data);
            else if (eventName === "error") callbacks?.onError?.(data.error);
          } catch { /* ignore */ }
          eventName = "";
        }
      }
    }
    console.log(`[Roadmap] Stream ended`);
  }).catch((err) => {
    if (err.name !== "AbortError") {
      console.error(`[Roadmap] Error:`, err);
      callbacks?.onError?.(String(err));
    }
  });

  return controller;
}

export interface RoadmapFeature {
  id: string;
  project_id: string;
  title: string;
  description: string;
  phase: string;
  status: string;
  priority: number;
  estimated_effort: string | null;
  category: string | null;
  dependencies: string | null;
  converted_task_id: string | null;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

export interface RoadmapDiscovery {
  id: string;
  project_id: string;
  target_audience: string | null;
  product_vision: string | null;
  current_state: string | null;
  raw_analysis: string | null;
  created_at: number;
  updated_at: number;
}

export async function getRoadmap(projectId: string): Promise<{
  discovery: RoadmapDiscovery | null;
  features: RoadmapFeature[];
}> {
  const j = await request<{
    ok: boolean;
    discovery: RoadmapDiscovery | null;
    features: RoadmapFeature[];
  }>(`/api/projects/${projectId}/roadmap`);
  return { discovery: j.discovery, features: j.features };
}

export async function updateRoadmapFeature(
  projectId: string,
  featureId: string,
  data: { phase?: string; status?: string; priority?: number; sort_order?: number },
): Promise<void> {
  await patch(`/api/projects/${projectId}/roadmap/features/${featureId}`, data);
}

export async function convertFeatureToTask(projectId: string, featureId: string): Promise<string> {
  const j = (await post(`/api/projects/${projectId}/roadmap/features/${featureId}/convert`)) as {
    ok: boolean;
    task_id: string;
  };
  return j.task_id;
}

export async function deleteRoadmapFeature(projectId: string, featureId: string): Promise<void> {
  await del(`/api/projects/${projectId}/roadmap/features/${featureId}`);
}

// ── Team Discovery ──────────────────────────────────────────────────
export interface TeamDepartment {
  id: string;
  name: string;
  icon: string;
  color: string;
  description: string;
}

export interface TeamAgent {
  name: string;
  department_id: string;
  role: string;
  cli_provider: string;
  avatar_emoji: string;
  personality: string;
}

export interface TeamRecommendation {
  team_summary: string;
  departments: TeamDepartment[];
  agents: TeamAgent[];
}

export function analyzeTeamSSE(
  projectId: string,
  callbacks?: {
    onProgress?: (data: { phase: string; progress: number }) => void;
    onRecommendation?: (data: TeamRecommendation) => void;
    onDone?: () => void;
    onError?: (error: string) => void;
  },
): AbortController {
  const controller = new AbortController();
  const baseUrl = "";

  console.log(`[Team] Starting team analysis for project ${projectId}`);
  fetch(`${baseUrl}/api/projects/${projectId}/team/analyze`, {
    method: "POST",
    headers: Object.fromEntries(withAuthHeaders({ "Content-Type": "application/json" }, "POST")),
    credentials: "same-origin",
    signal: controller.signal,
  }).then(async (response) => {
    console.log(`[Team] Response status: ${response.status}`);
    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => "");
      console.error(`[Team] Request failed: ${response.status} ${text}`);
      callbacks?.onError?.(`Request failed (${response.status}): ${text}`);
      return;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      let eventName = "";
      for (const line of lines) {
        if (line.startsWith("event: ")) eventName = line.slice(7).trim();
        else if (line.startsWith("data: ") && eventName) {
          try {
            const data = JSON.parse(line.slice(6));
            console.log(`[Team] SSE event: ${eventName}`, data);
            if (eventName === "progress") callbacks?.onProgress?.(data);
            else if (eventName === "recommendation") callbacks?.onRecommendation?.(data);
            else if (eventName === "done") callbacks?.onDone?.();
            else if (eventName === "error") callbacks?.onError?.(data.error);
          } catch { /* ignore */ }
          eventName = "";
        }
      }
    }
    console.log(`[Team] Stream ended`);
  }).catch((err) => {
    if (err.name !== "AbortError") {
      console.error(`[Team] Error:`, err);
      callbacks?.onError?.(String(err));
    }
  });

  return controller;
}

export async function applyTeamRecommendation(
  projectId: string,
  recommendation: TeamRecommendation,
  clearExisting: boolean,
): Promise<{ departments_created: number; agents_created: number }> {
  return post(`/api/projects/${projectId}/team/apply`, {
    ...recommendation,
    clear_existing: clearExisting,
  }) as Promise<{ departments_created: number; agents_created: number }>;
}
