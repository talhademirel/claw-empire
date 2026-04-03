import type { Express } from "express";
import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

interface AgentTeamsRouteOptions {
  app: Express;
  db: DatabaseSync;
  broadcast: (event: string, payload: unknown) => void;
}

export function registerAgentTeamRoutes({ app, db, broadcast }: AgentTeamsRouteOptions): void {

  // GET /api/agent-teams — list all teams with member count
  app.get("/api/agent-teams", (_req, res) => {
    try {
      const teams = db.prepare(`
        SELECT t.*, COUNT(m.agent_id) as member_count
        FROM agent_teams t
        LEFT JOIN agent_team_members m ON m.team_id = t.id
        GROUP BY t.id
        ORDER BY t.created_at DESC
      `).all();
      res.json({ ok: true, teams });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  // GET /api/agent-teams/:id — get single team with full member details
  app.get("/api/agent-teams/:id", (req, res) => {
    try {
      const team = db.prepare("SELECT * FROM agent_teams WHERE id = ?").get(req.params.id);
      if (!team) return res.status(404).json({ ok: false, error: "Team not found" });
      const members = db.prepare(`
        SELECT a.* FROM agents a
        JOIN agent_team_members m ON m.agent_id = a.id
        WHERE m.team_id = ?
        ORDER BY a.role, a.name
      `).all(req.params.id);
      res.json({ ok: true, team, members });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  // POST /api/agent-teams — create team
  app.post("/api/agent-teams", (req, res) => {
    try {
      const { name, description, agent_ids, source } = req.body ?? {};
      if (!name?.trim()) return res.status(400).json({ ok: false, error: "name required" });
      const id = randomUUID();
      const now = Date.now();
      db.prepare(
        "INSERT INTO agent_teams (id, name, description, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
      ).run(id, name.trim(), description ?? null, source ?? "manual", now, now);
      if (Array.isArray(agent_ids)) {
        const stmt = db.prepare("INSERT OR IGNORE INTO agent_team_members (team_id, agent_id, added_at) VALUES (?, ?, ?)");
        for (const agentId of agent_ids) stmt.run(id, agentId, now);
      }
      const team = db.prepare("SELECT * FROM agent_teams WHERE id = ?").get(id);
      broadcast("agent_team_created", { team });
      res.json({ ok: true, team });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  // PATCH /api/agent-teams/:id — update team name/description
  app.patch("/api/agent-teams/:id", (req, res) => {
    try {
      const { name, description } = req.body ?? {};
      const team = db.prepare("SELECT id FROM agent_teams WHERE id = ?").get(req.params.id);
      if (!team) return res.status(404).json({ ok: false, error: "Team not found" });
      if (name !== undefined) {
        db.prepare("UPDATE agent_teams SET name = ?, updated_at = ? WHERE id = ?").run(name.trim(), Date.now(), req.params.id);
      }
      if (description !== undefined) {
        db.prepare("UPDATE agent_teams SET description = ?, updated_at = ? WHERE id = ?").run(description, Date.now(), req.params.id);
      }
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  // DELETE /api/agent-teams/:id — delete team
  app.delete("/api/agent-teams/:id", (req, res) => {
    try {
      db.prepare("DELETE FROM agent_teams WHERE id = ?").run(req.params.id);
      broadcast("agent_team_deleted", { id: req.params.id });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  // POST /api/agent-teams/:id/members — add agents to team
  app.post("/api/agent-teams/:id/members", (req, res) => {
    try {
      const { agent_ids } = req.body ?? {};
      if (!Array.isArray(agent_ids) || agent_ids.length === 0) {
        return res.status(400).json({ ok: false, error: "agent_ids required" });
      }
      const team = db.prepare("SELECT id FROM agent_teams WHERE id = ?").get(req.params.id);
      if (!team) return res.status(404).json({ ok: false, error: "Team not found" });
      const stmt = db.prepare("INSERT OR IGNORE INTO agent_team_members (team_id, agent_id, added_at) VALUES (?, ?, ?)");
      for (const agentId of agent_ids) stmt.run(req.params.id, agentId, Date.now());
      db.prepare("UPDATE agent_teams SET updated_at = ? WHERE id = ?").run(Date.now(), req.params.id);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  // DELETE /api/agent-teams/:id/members/:agentId — remove agent from team
  app.delete("/api/agent-teams/:id/members/:agentId", (req, res) => {
    try {
      db.prepare("DELETE FROM agent_team_members WHERE team_id = ? AND agent_id = ?").run(req.params.id, req.params.agentId);
      db.prepare("UPDATE agent_teams SET updated_at = ? WHERE id = ?").run(Date.now(), req.params.id);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });

  // POST /api/projects/:id/assign-team — assign team to project
  app.post("/api/projects/:id/assign-team", (req, res) => {
    try {
      const { team_id } = req.body ?? {};
      // team_id can be null to unassign
      db.prepare("UPDATE projects SET team_id = ?, updated_at = ? WHERE id = ?").run(
        team_id ?? null, Date.now(), req.params.id
      );
      broadcast("project_team_assigned", { project_id: req.params.id, team_id: team_id ?? null });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message });
    }
  });
}
