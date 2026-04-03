import type { Express } from "express";
import type { DatabaseSync } from "node:sqlite";
import { analyzeTeam, applyTeam } from "../../../ai/team-engine.ts";

interface TeamRouteOptions {
  app: Express;
  db: DatabaseSync;
  broadcast: (event: string, payload: unknown) => void;
}

export function registerTeamRoutes({ app, db, broadcast }: TeamRouteOptions): void {
  // POST /api/projects/:id/team/analyze — AI analyzes project and recommends team
  app.post("/api/projects/:id/team/analyze", async (req, res) => {
    try {
      const projectId = req.params.id;

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });

      const sendSSE = (event: string, data: unknown) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      const result = await analyzeTeam(db as any, projectId, (phase, progress) => {
        sendSSE("progress", { phase, progress });
      });

      sendSSE("recommendation", {
        team_summary: result.team_summary,
        departments: result.departments,
        agents: result.agents,
      });
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

  // POST /api/projects/:id/team/apply — Apply recommended team structure
  app.post("/api/projects/:id/team/apply", (req, res) => {
    try {
      const body = (req.body ?? {}) as {
        departments: Array<{ id: string; name: string; icon: string; color: string; description: string }>;
        agents: Array<{ name: string; department_id: string; role: string; cli_provider: string; avatar_emoji: string; personality: string }>;
        team_summary?: string;
        clear_existing?: boolean;
      };

      if (!body.departments?.length || !body.agents?.length) {
        return res.status(400).json({ ok: false, error: "departments and agents required" });
      }

      const result = applyTeam(
        db as any,
        {
          team_summary: body.team_summary || "",
          departments: body.departments,
          agents: body.agents as any,
        },
        {
          clearExisting: Boolean(body.clear_existing),
          broadcast,
        },
      );

      res.json({
        ok: true,
        departments_created: result.departmentsCreated,
        agents_created: result.agentsCreated,
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  });
}
