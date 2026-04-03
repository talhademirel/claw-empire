type DbLike = {
  prepare: (sql: string) => {
    get: (...args: unknown[]) => unknown;
    all: (...args: unknown[]) => unknown[];
    run: (...args: unknown[]) => void;
  };
};

interface AgentCandidate {
  id: string;
  name: string;
  role: string;
  stats_tasks_done: number;
  current_task_id: string | null;
}

export function findBestAgent(
  db: DbLike,
  departmentId: string | null,
  workflowPackKey?: string,
): AgentCandidate | null {
  let sql = `
    SELECT id, name, role, stats_tasks_done, current_task_id
    FROM agents
    WHERE status = 'idle'
      AND cli_provider IS NOT NULL
      AND current_task_id IS NULL
      AND role != 'team_leader'
  `;
  const params: unknown[] = [];

  if (departmentId) {
    sql += " AND department_id = ?";
    params.push(departmentId);
  }
  if (workflowPackKey) {
    sql += " AND workflow_pack_key = ?";
    params.push(workflowPackKey);
  }

  sql += `
    ORDER BY
      CASE role WHEN 'senior' THEN 3 WHEN 'junior' THEN 2 WHEN 'intern' THEN 1 ELSE 0 END DESC,
      stats_tasks_done ASC
    LIMIT 1
  `;

  const agent = db.prepare(sql).all(...params) as AgentCandidate[];
  return agent[0] || null;
}

export function autoAssignTask(
  db: DbLike,
  taskId: string,
  options: {
    broadcast: (event: string, payload: unknown) => void;
    appendTaskLog: (taskId: string | null, kind: string, message: string) => void;
    nowMs: () => number;
  },
): { agentId: string; agentName: string } | null {
  const task = db
    .prepare("SELECT id, department_id, workflow_pack_key, assigned_agent_id, status FROM tasks WHERE id = ?")
    .get(taskId) as
    | { id: string; department_id: string | null; workflow_pack_key: string; assigned_agent_id: string | null; status: string }
    | undefined;

  if (!task) return null;
  if (task.assigned_agent_id) return null; // Already assigned
  if (task.status !== "inbox") return null; // Only assign inbox tasks

  const agent = findBestAgent(db, task.department_id, task.workflow_pack_key);
  if (!agent) return null;

  db.prepare("UPDATE tasks SET assigned_agent_id = ?, status = 'planned', updated_at = ? WHERE id = ?").run(
    agent.id,
    options.nowMs(),
    taskId,
  );
  db.prepare("UPDATE agents SET current_task_id = ? WHERE id = ?").run(taskId, agent.id);

  options.appendTaskLog(taskId, "auto-assign", `Auto-assigned to ${agent.name}`);

  const updatedTask = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId);
  options.broadcast("task_update", updatedTask);

  return { agentId: agent.id, agentName: agent.name };
}

export function getNextInboxTask(db: DbLike, departmentId?: string): string | null {
  let sql = "SELECT id FROM tasks WHERE status = 'inbox' AND assigned_agent_id IS NULL";
  const params: unknown[] = [];

  if (departmentId) {
    sql += " AND department_id = ?";
    params.push(departmentId);
  }
  sql += " ORDER BY priority ASC, created_at ASC LIMIT 1";

  const row = db.prepare(sql).get(...params) as { id: string } | undefined;
  return row?.id || null;
}

export function autoRunNextForAgent(
  db: DbLike,
  agentId: string,
  options: {
    broadcast: (event: string, payload: unknown) => void;
    appendTaskLog: (taskId: string | null, kind: string, message: string) => void;
    nowMs: () => number;
    runTask: (taskId: string) => Promise<void>;
  },
): void {
  // Check if auto-run is enabled
  const setting = db.prepare("SELECT value FROM settings WHERE key = 'auto_run_enabled'").get() as
    | { value: string }
    | undefined;
  if (setting?.value !== "1" && setting?.value !== "true") return;

  // Get agent's department
  const agent = db.prepare("SELECT id, department_id, status FROM agents WHERE id = ?").get(agentId) as
    | { id: string; department_id: string | null; status: string }
    | undefined;
  if (!agent || agent.status !== "idle") return;

  // Find next task
  const taskId = getNextInboxTask(db, agent.department_id || undefined);
  if (!taskId) return;

  // Assign and run
  const assigned = autoAssignTask(db, taskId, options);
  if (assigned) {
    options.runTask(taskId).catch((err) => {
      options.appendTaskLog(taskId, "error", `Auto-run failed: ${err}`);
    });
  }
}
