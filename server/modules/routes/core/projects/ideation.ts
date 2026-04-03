import type { Express } from "express";
import type { DatabaseSync } from "node:sqlite";
import { runIdeation, convertIdeaToTask, IDEATION_TYPES, type IdeationType } from "../../../ai/ideation-engine.ts";

interface IdeationRouteOptions {
  app: Express;
  db: DatabaseSync;
  broadcast: (event: string, payload: unknown) => void;
  appendTaskLog: (taskId: string | null, kind: string, message: string) => void;
  nowMs: () => number;
}

export function registerIdeationRoutes({ app, db, broadcast, appendTaskLog, nowMs }: IdeationRouteOptions): void {
  // POST /api/projects/:id/ideation — Run ideation analysis
  app.post("/api/projects/:id/ideation", async (req, res) => {
    try {
      const projectId = req.params.id;
      const body = (req.body ?? {}) as { types?: string[] };
      const types = body.types?.filter((t): t is IdeationType =>
        IDEATION_TYPES.includes(t as IdeationType),
      );

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

      const ideas = await runIdeation(db as any, projectId, types, (type, status, typeIdeas) => {
        sendSSE("type_progress", { type, status, idea_count: typeIdeas?.length || 0 });
      });

      sendSSE("done", { success: true, total_ideas: ideas.length });
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

  // GET /api/projects/:id/ideation — List ideas
  app.get("/api/projects/:id/ideation", (req, res) => {
    try {
      const projectId = req.params.id;
      const type = req.query.type as string | undefined;
      const status = req.query.status as string | undefined;

      let sql = "SELECT * FROM ideation_ideas WHERE project_id = ?";
      const params: unknown[] = [projectId];

      if (type && IDEATION_TYPES.includes(type as IdeationType)) {
        sql += " AND type = ?";
        params.push(type);
      }
      if (status && ["active", "converted", "dismissed"].includes(status)) {
        sql += " AND status = ?";
        params.push(status);
      }
      sql += " ORDER BY created_at DESC";

      const ideas = (db as any).prepare(sql).all(...params);
      res.json({ ok: true, ideas });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  });

  // POST /api/projects/:id/ideation/:ideaId/convert — Convert idea to task
  app.post("/api/projects/:id/ideation/:ideaId/convert", (req, res) => {
    try {
      const { id: projectId, ideaId } = req.params;
      const taskId = convertIdeaToTask(db as any, ideaId, projectId, nowMs);

      appendTaskLog(taskId, "ideation", `Converted from ideation idea ${ideaId}`);

      const task = (db as any).prepare("SELECT * FROM tasks WHERE id = ?").get(taskId);
      broadcast("task_update", task);

      res.json({ ok: true, task_id: taskId });
    } catch (err: any) {
      res.status(400).json({ ok: false, error: err?.message || String(err) });
    }
  });

  // PATCH /api/projects/:id/ideation/:ideaId — Update idea (dismiss, etc.)
  app.patch("/api/projects/:id/ideation/:ideaId", (req, res) => {
    try {
      const { id: projectId, ideaId } = req.params;
      const body = (req.body ?? {}) as { status?: string };

      if (body.status && ["active", "dismissed"].includes(body.status)) {
        (db as any)
          .prepare("UPDATE ideation_ideas SET status = ? WHERE id = ? AND project_id = ?")
          .run(body.status, ideaId, projectId);
      }

      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  });
}
