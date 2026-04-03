import type { Express } from "express";
import type { DatabaseSync } from "node:sqlite";
import { generateRoadmap, convertFeatureToTask } from "../../../ai/roadmap-engine.ts";

interface RoadmapRouteOptions {
  app: Express;
  db: DatabaseSync;
  broadcast: (event: string, payload: unknown) => void;
  appendTaskLog: (taskId: string | null, kind: string, message: string) => void;
  nowMs: () => number;
}

export function registerRoadmapRoutes({ app, db, broadcast, appendTaskLog, nowMs }: RoadmapRouteOptions): void {
  // POST /api/projects/:id/roadmap/generate — Generate roadmap
  app.post("/api/projects/:id/roadmap/generate", async (req, res) => {
    try {
      const projectId = req.params.id;

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

      const result = await generateRoadmap(db as any, projectId, (phase, progress) => {
        sendSSE("progress", { phase, progress });
      });

      sendSSE("done", {
        success: true,
        discovery: {
          target_audience: result.discovery.target_audience,
          product_vision: result.discovery.product_vision,
        },
        feature_count: result.features.length,
      });
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

  // GET /api/projects/:id/roadmap — Get roadmap data
  app.get("/api/projects/:id/roadmap", (req, res) => {
    try {
      const projectId = req.params.id;

      const discovery = (db as any)
        .prepare("SELECT * FROM roadmap_discovery WHERE project_id = ?")
        .get(projectId);

      const features = (db as any)
        .prepare("SELECT * FROM roadmap_features WHERE project_id = ? ORDER BY phase, sort_order, priority ASC")
        .all(projectId);

      res.json({ ok: true, discovery: discovery || null, features: features || [] });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  });

  // PATCH /api/projects/:id/roadmap/features/:featureId — Update feature
  app.patch("/api/projects/:id/roadmap/features/:featureId", (req, res) => {
    try {
      const { id: projectId, featureId } = req.params;
      const body = (req.body ?? {}) as {
        phase?: string;
        status?: string;
        priority?: number;
        sort_order?: number;
      };

      const validPhases = new Set(["backlog", "phase_1", "phase_2", "phase_3", "phase_4"]);
      const validStatuses = new Set(["backlog", "planned", "in_progress", "completed"]);
      const updates: string[] = [];
      const params: unknown[] = [];

      if (body.phase && validPhases.has(body.phase)) {
        updates.push("phase = ?");
        params.push(body.phase);
      }
      if (body.status && validStatuses.has(body.status)) {
        updates.push("status = ?");
        params.push(body.status);
      }
      if (typeof body.priority === "number") {
        updates.push("priority = ?");
        params.push(body.priority);
      }
      if (typeof body.sort_order === "number") {
        updates.push("sort_order = ?");
        params.push(body.sort_order);
      }

      if (updates.length > 0) {
        updates.push("updated_at = ?");
        params.push(Date.now());
        params.push(featureId, projectId);
        (db as any)
          .prepare(`UPDATE roadmap_features SET ${updates.join(", ")} WHERE id = ? AND project_id = ?`)
          .run(...params);
      }

      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  });

  // POST /api/projects/:id/roadmap/features/:featureId/convert — Convert feature to task
  app.post("/api/projects/:id/roadmap/features/:featureId/convert", (req, res) => {
    try {
      const { id: projectId, featureId } = req.params;
      const taskId = convertFeatureToTask(db as any, featureId, projectId, nowMs);

      appendTaskLog(taskId, "roadmap", `Converted from roadmap feature ${featureId}`);

      const task = (db as any).prepare("SELECT * FROM tasks WHERE id = ?").get(taskId);
      broadcast("task_update", task);

      res.json({ ok: true, task_id: taskId });
    } catch (err: any) {
      res.status(400).json({ ok: false, error: err?.message || String(err) });
    }
  });

  // DELETE /api/projects/:id/roadmap/features/:featureId — Delete feature
  app.delete("/api/projects/:id/roadmap/features/:featureId", (req, res) => {
    try {
      const { id: projectId, featureId } = req.params;
      (db as any)
        .prepare("DELETE FROM roadmap_features WHERE id = ? AND project_id = ?")
        .run(featureId, projectId);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  });
}
