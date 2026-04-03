import type { Express } from "express";
import type { DatabaseSync } from "node:sqlite";
import { analyzeProject, createTasksFromAnalysis } from "../../../ai/auto-task-engine.ts";

interface AutoTaskRouteOptions {
  app: Express;
  db: DatabaseSync;
  broadcast: (event: string, payload: unknown) => void;
  appendTaskLog: (taskId: string | null, kind: string, message: string) => void;
  nowMs: () => number;
  runTask?: (taskId: string) => Promise<void>;
}

export function registerAutoTaskRoutes({ app, db, broadcast, appendTaskLog, nowMs, runTask }: AutoTaskRouteOptions): void {
  // POST /api/projects/:id/auto-task — Analyze project and generate tasks
  app.post("/api/projects/:id/auto-task", async (req, res) => {
    try {
      const projectId = req.params.id;
      const body = (req.body ?? {}) as {
        mode?: "quick" | "deep";
        auto_assign?: boolean;
        auto_run?: boolean;
      };
      const mode = body.mode === "deep" ? "deep" : "quick";
      const autoAssign = Boolean(body.auto_assign);
      const autoRun = Boolean(body.auto_run);

      // Set up SSE
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });

      const sendSSE = (event: string, data: unknown) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      // Run analysis
      const result = await analyzeProject(db as any, projectId, mode, (phase, progress, partialTasks) => {
        sendSSE("progress", { phase, progress, task_count: partialTasks?.length || 0 });
      });

      sendSSE("analysis_complete", {
        summary: result.summary,
        task_count: result.tasks.length,
        tasks: result.tasks,
      });

      // Create tasks
      const taskIds = await createTasksFromAnalysis(db as any, projectId, result.tasks, {
        autoAssign,
        autoRun,
        broadcast,
        appendTaskLog,
        runTask,
        nowMs,
      });

      sendSSE("tasks_created", { task_ids: taskIds, count: taskIds.length });
      sendSSE("done", { success: true });
      res.end();
    } catch (err: any) {
      const message = err?.message || String(err);
      if (!res.headersSent) {
        res.status(500).json({ ok: false, error: message });
      } else {
        res.write(`event: error\ndata: ${JSON.stringify({ error: message })}\n\n`);
        res.end();
      }
    }
  });
}
