import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Trash2, Edit2, Users, Check, X, ChevronDown, ChevronUp, Wand2 } from "lucide-react";
import type { Agent } from "../../types";
import { getProjects } from "../../api";
import type { Project } from "../../types";
import {
  listAgentTeams,
  getAgentTeam,
  createAgentTeam,
  updateAgentTeam,
  deleteAgentTeam,
  addTeamMembers,
  removeTeamMember,
  analyzeTeamSSE,
  applyTeamRecommendation,
  type AgentTeam,
  type AgentTeamDetail,
  type TeamRecommendation,
} from "../../api/organization-projects";

const TEAM_PHASE_LOGS: Record<string, string> = {
  collecting_context: "Scanning project files...",
  analyzing: "Reading project structure...",
  generating_team: "Asking Opus to build your team...",
  parsing: "Parsing team recommendations...",
  done: "Team ready!",
};

interface AgentTeamsTabProps {
  agents: Agent[];
  onAgentsChange?: () => void;
}

export default function AgentTeamsTab({ agents, onAgentsChange }: AgentTeamsTabProps) {
  const [teams, setTeams] = useState<AgentTeam[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedDetail, setExpandedDetail] = useState<AgentTeamDetail | null>(null);

  // Create
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createDesc, setCreateDesc] = useState("");
  const [creating, setCreating] = useState(false);

  // Edit / delete
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Member management
  const [addingMembersTo, setAddingMembersTo] = useState<string | null>(null);
  const [selectedToAdd, setSelectedToAdd] = useState<Set<string>>(new Set());

  // Build team with AI
  const [showBuildAI, setShowBuildAI] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [buildRunning, setBuildRunning] = useState(false);
  const [buildLogs, setBuildLogs] = useState<string[]>([]);
  const [buildRecommendation, setBuildRecommendation] = useState<TeamRecommendation | null>(null);
  const [saveTeamName, setSaveTeamName] = useState("");
  const [savingTeam, setSavingTeam] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const buildAbortRef = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [buildLogs]);

  const fetchTeams = useCallback(async () => {
    try {
      const data = await listAgentTeams();
      setTeams(data);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchTeams(); }, [fetchTeams]);

  useEffect(() => {
    if (showBuildAI && projects.length === 0) {
      getProjects().then((res) => {
        setProjects(res.projects);
        if (res.projects.length > 0) setSelectedProjectId(res.projects[0].id);
      }).catch(() => {});
    }
  }, [showBuildAI, projects.length]);

  /* ── Expand / collapse ─────────────────────────────────────────── */
  const toggleExpand = async (teamId: string) => {
    if (expandedId === teamId) { setExpandedId(null); setExpandedDetail(null); return; }
    setExpandedId(teamId);
    try { setExpandedDetail(await getAgentTeam(teamId)); } catch { /* ignore */ }
  };

  /* ── Create team ───────────────────────────────────────────────── */
  const handleCreate = async () => {
    if (!createName.trim()) return;
    setCreating(true);
    try {
      await createAgentTeam({ name: createName.trim(), description: createDesc.trim() || undefined });
      setCreateName(""); setCreateDesc(""); setShowCreate(false);
      await fetchTeams();
    } finally { setCreating(false); }
  };

  /* ── Rename ────────────────────────────────────────────────────── */
  const handleRename = async (teamId: string) => {
    if (!editName.trim()) return;
    setSaving(true);
    try {
      await updateAgentTeam(teamId, { name: editName.trim() });
      setEditingId(null);
      await fetchTeams();
    } finally { setSaving(false); }
  };

  /* ── Delete ────────────────────────────────────────────────────── */
  const handleDelete = async (teamId: string) => {
    try {
      await deleteAgentTeam(teamId);
      if (expandedId === teamId) { setExpandedId(null); setExpandedDetail(null); }
      await fetchTeams();
    } finally { setConfirmDeleteId(null); }
  };

  /* ── Members ───────────────────────────────────────────────────── */
  const handleRemoveMember = async (teamId: string, agentId: string) => {
    try {
      await removeTeamMember(teamId, agentId);
      setExpandedDetail(await getAgentTeam(teamId));
      await fetchTeams();
    } catch { /* ignore */ }
  };

  const handleAddMembers = async (teamId: string) => {
    if (selectedToAdd.size === 0) return;
    try {
      await addTeamMembers(teamId, [...selectedToAdd]);
      setExpandedDetail(await getAgentTeam(teamId));
      await fetchTeams();
    } catch { /* ignore */ }
    setAddingMembersTo(null);
    setSelectedToAdd(new Set());
  };

  /* ── Build Team with AI ────────────────────────────────────────── */
  const handleBuildAI = () => {
    if (!selectedProjectId) return;
    setBuildRunning(true);
    setBuildLogs([]);
    setBuildRecommendation(null);
    setSaveError(null);

    const ctrl = analyzeTeamSSE(selectedProjectId, {
      onProgress: (data) => {
        const msg = TEAM_PHASE_LOGS[data.phase] || data.phase;
        setBuildLogs((prev) => [...prev, `[${data.progress}%] ${msg}`]);
      },
      onRecommendation: (data) => {
        setBuildRecommendation(data);
        const project = projects.find((p) => p.id === selectedProjectId);
        setSaveTeamName(project ? `${project.name} Team` : "New Team");
        setBuildLogs((prev) => [...prev, `[100%] ${data.departments.length} depts, ${data.agents.length} agents ready.`]);
      },
      onDone: () => setBuildRunning(false),
      onError: (err) => { setBuildLogs((prev) => [...prev, `[ERR] ${err}`]); setBuildRunning(false); },
    });
    buildAbortRef.current = ctrl;
  };

  const handleSaveTeam = async (clearExisting: boolean) => {
    if (!buildRecommendation || !saveTeamName.trim() || !selectedProjectId) return;
    setSavingTeam(true);
    setSaveError(null);
    try {
      // 1. Apply recommendation (creates agents + departments)
      await applyTeamRecommendation(selectedProjectId, buildRecommendation, clearExisting);

      // 2. Create team record
      const team = await createAgentTeam({
        name: saveTeamName.trim(),
        description: buildRecommendation.team_summary,
        source: "ai_generated",
      });

      // 3. Find newly created agents by name match and add to team
      const { getAgents } = await import("../../api");
      const freshAgents = await getAgents();
      const recAgentNames = new Set(buildRecommendation.agents.map((a) => a.name.toLowerCase()));
      const matchedIds = freshAgents
        .filter((a) => recAgentNames.has(a.name.toLowerCase()))
        .map((a) => a.id);

      if (matchedIds.length > 0) {
        await addTeamMembers(team.id, matchedIds);
      }

      onAgentsChange?.();
      await fetchTeams();
      setBuildRecommendation(null);
      setBuildLogs([]);
      setShowBuildAI(false);
    } catch (err) {
      setSaveError(`Failed: ${err}`);
    } finally {
      setSavingTeam(false);
    }
  };

  const memberIds = expandedDetail?.members.map((m) => m.id) ?? [];
  const availableToAdd = agents.filter((a) => !memberIds.includes(a.id));

  if (loading) {
    return <div className="flex items-center justify-center py-16 text-gray-400">Loading teams...</div>;
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-gray-400" />
          <span className="text-sm font-medium text-gray-200">Agent Teams</span>
          <span className="text-xs text-gray-500">{teams.length} teams</span>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => { setShowBuildAI((v) => !v); setBuildRecommendation(null); setBuildLogs([]); }}
            className="flex items-center gap-1 px-3 py-1.5 text-xs bg-emerald-700 hover:bg-emerald-600 text-white rounded-md transition-colors"
          >
            <Wand2 className="w-3.5 h-3.5" />
            Build with AI
          </button>
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1 px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded-md transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            New Team
          </button>
        </div>
      </div>

      {/* Build with AI panel */}
      {showBuildAI && (
        <div className="rounded-lg border border-emerald-700 bg-emerald-900/10 p-4 space-y-3">
          <p className="text-xs font-semibold text-emerald-200">AI Team Builder</p>

          {/* Project selector */}
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-400 shrink-0">Project:</label>
            <select
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
              className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-gray-200 outline-none focus:border-emerald-500"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleBuildAI}
              disabled={buildRunning || !selectedProjectId}
              className="flex items-center gap-1 px-3 py-1 text-xs bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white rounded transition-colors"
            >
              <Wand2 className="w-3 h-3" />
              {buildRunning ? "Analyzing..." : "Analyze"}
            </button>
          </div>

          {/* Terminal log */}
          {buildLogs.length > 0 && (
            <div ref={logRef} className="max-h-28 overflow-y-auto rounded-md bg-black/70 p-2.5 font-mono text-[10px] leading-relaxed">
              {buildLogs.map((line, i) => (
                <p key={i} className={
                  line.startsWith("[ERR]") ? "text-red-400" :
                  line.startsWith("[OK]") ? "text-emerald-400" :
                  line.startsWith("[100%]") ? "text-emerald-300" : "text-green-500"
                }>
                  <span className="text-slate-600 mr-1">$</span>{line}
                </p>
              ))}
              {buildRunning && <p className="text-green-500 animate-pulse"><span className="text-slate-600 mr-1">$</span>▋</p>}
            </div>
          )}

          {/* Recommendation preview */}
          {buildRecommendation && (
            <div className="space-y-3 rounded-lg border border-emerald-700/50 bg-emerald-950/30 p-3">
              <p className="text-[11px] text-emerald-200">{buildRecommendation.team_summary}</p>

              <div className="space-y-1">
                {buildRecommendation.departments.map((d) => (
                  <div key={d.id} className="flex items-center gap-2 text-[11px]">
                    <span>{d.icon}</span>
                    <span className="font-medium text-slate-200">{d.name}</span>
                    <span className="text-slate-500">—</span>
                    <span className="text-slate-400">{d.description}</span>
                  </div>
                ))}
              </div>

              <div className="space-y-1">
                {buildRecommendation.agents.map((a, i) => (
                  <div key={i} className="flex items-center gap-2 text-[11px]">
                    <span>{a.avatar_emoji}</span>
                    <span className="font-medium text-slate-200">{a.name}</span>
                    <span className="rounded-full bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">{a.role}</span>
                    <span className="rounded-full bg-slate-800 px-1.5 py-0.5 text-[10px] text-blue-300">{a.cli_provider}</span>
                  </div>
                ))}
              </div>

              {/* Team name input */}
              <div className="pt-1 border-t border-emerald-800/50">
                <input
                  value={saveTeamName}
                  onChange={(e) => setSaveTeamName(e.target.value)}
                  placeholder="Team name..."
                  className="w-full bg-gray-800 border border-gray-600 rounded px-2.5 py-1.5 text-sm text-gray-100 placeholder-gray-500 outline-none focus:border-emerald-500 mb-2"
                />
                <div className="flex gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => handleSaveTeam(false)}
                    disabled={savingTeam || !saveTeamName.trim()}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white rounded transition-colors"
                  >
                    <Check className="w-3 h-3" />
                    {savingTeam ? "Saving..." : "Save & Add to Existing"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm("This will remove ALL existing agents and departments. Continue?")) {
                        handleSaveTeam(true);
                      }
                    }}
                    disabled={savingTeam || !saveTeamName.trim()}
                    className="px-3 py-1.5 text-xs border border-red-700 bg-red-900/30 text-red-300 rounded hover:bg-red-900/50 disabled:opacity-50 transition-colors"
                  >
                    Save & Replace All
                  </button>
                  <button
                    type="button"
                    onClick={() => setBuildRecommendation(null)}
                    className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 transition-colors"
                  >
                    Dismiss
                  </button>
                </div>
                {saveError && <p className="mt-1 text-xs text-red-400">{saveError}</p>}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Manual create form */}
      {showCreate && (
        <div className="rounded-lg border border-blue-700 bg-blue-900/20 p-3 space-y-2">
          <input
            autoFocus
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") setShowCreate(false); }}
            placeholder="Team name..."
            className="w-full bg-gray-800 border border-gray-600 rounded px-2.5 py-1.5 text-sm text-gray-100 placeholder-gray-500 outline-none focus:border-blue-500"
          />
          <input
            value={createDesc}
            onChange={(e) => setCreateDesc(e.target.value)}
            placeholder="Description (optional)"
            className="w-full bg-gray-800 border border-gray-600 rounded px-2.5 py-1.5 text-sm text-gray-100 placeholder-gray-500 outline-none focus:border-blue-500"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleCreate}
              disabled={creating || !createName.trim()}
              className="flex items-center gap-1 px-3 py-1 text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded transition-colors"
            >
              <Check className="w-3 h-3" />
              {creating ? "Creating..." : "Create"}
            </button>
            <button type="button" onClick={() => setShowCreate(false)} className="px-3 py-1 text-xs text-gray-400 hover:text-gray-200 transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Empty state */}
      {teams.length === 0 && !showCreate && !showBuildAI && (
        <div className="flex flex-col items-center justify-center py-12 text-gray-500 gap-2">
          <Users className="w-8 h-8 opacity-30" />
          <p className="text-sm">No teams yet. Create one or use AI Builder.</p>
        </div>
      )}

      {/* Team list */}
      {teams.map((team) => (
        <div key={team.id} className="rounded-lg border border-gray-700 bg-gray-800 overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3">
            <button
              type="button"
              onClick={() => toggleExpand(team.id)}
              className="flex-1 flex items-center gap-3 text-left min-w-0"
            >
              {expandedId === team.id
                ? <ChevronUp className="w-4 h-4 text-gray-500 shrink-0" />
                : <ChevronDown className="w-4 h-4 text-gray-500 shrink-0" />
              }
              <div className="flex-1 min-w-0">
                {editingId === team.id ? (
                  <input
                    autoFocus
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleRename(team.id); if (e.key === "Escape") setEditingId(null); }}
                    onClick={(e) => e.stopPropagation()}
                    className="bg-gray-700 border border-blue-500 rounded px-2 py-0.5 text-sm text-gray-100 outline-none w-48"
                  />
                ) : (
                  <span className="text-sm font-medium text-gray-100 truncate">{team.name}</span>
                )}
                {team.description && (
                  <p className="text-xs text-gray-500 truncate mt-0.5">{team.description}</p>
                )}
              </div>
              <span className="text-xs text-gray-500 shrink-0 flex items-center gap-1">
                <Users className="w-3 h-3" />{team.member_count}
              </span>
              {team.source === "ai_generated" && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-900/50 text-purple-300 border border-purple-800 shrink-0">AI</span>
              )}
            </button>

            <div className="flex items-center gap-1 shrink-0">
              {editingId === team.id ? (
                <>
                  <button type="button" onClick={() => handleRename(team.id)} disabled={saving} className="text-green-400 hover:text-green-300 p-1"><Check className="w-3.5 h-3.5" /></button>
                  <button type="button" onClick={() => setEditingId(null)} className="text-gray-500 hover:text-gray-300 p-1"><X className="w-3.5 h-3.5" /></button>
                </>
              ) : (
                <>
                  <button type="button" onClick={() => { setEditingId(team.id); setEditName(team.name); }} className="text-gray-600 hover:text-gray-300 p-1 transition-colors">
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  {confirmDeleteId === team.id ? (
                    <>
                      <button type="button" onClick={() => handleDelete(team.id)} className="text-red-400 hover:text-red-300 text-xs px-1.5 py-0.5">Delete?</button>
                      <button type="button" onClick={() => setConfirmDeleteId(null)} className="text-gray-500 hover:text-gray-300 p-1"><X className="w-3 h-3" /></button>
                    </>
                  ) : (
                    <button type="button" onClick={() => setConfirmDeleteId(team.id)} className="text-gray-600 hover:text-red-400 p-1 transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Expanded members */}
          {expandedId === team.id && expandedDetail && (
            <div className="border-t border-gray-700 px-4 py-3 space-y-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-gray-400 font-medium">Members</span>
                <button
                  type="button"
                  onClick={() => { setAddingMembersTo(team.id); setSelectedToAdd(new Set()); }}
                  className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
                >
                  <Plus className="w-3 h-3" /> Add members
                </button>
              </div>

              {expandedDetail.members.length === 0 && (
                <p className="text-xs text-gray-600 py-2">No members yet.</p>
              )}

              {expandedDetail.members.map((agent) => (
                <div key={agent.id} className="flex items-center gap-2 py-1 group">
                  <span className="text-base leading-none">{agent.avatar_emoji || "🤖"}</span>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-gray-200">{agent.name}</span>
                    <span className="text-xs text-gray-500 ml-2">{agent.role}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveMember(team.id, agent.id)}
                    className="text-gray-700 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all p-1"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}

              {addingMembersTo === team.id && (
                <div className="mt-2 border-t border-gray-700 pt-2 space-y-1">
                  {availableToAdd.length === 0 ? (
                    <p className="text-xs text-gray-500">All agents already in team.</p>
                  ) : (
                    <>
                      <p className="text-xs text-gray-400 mb-1">Select agents to add:</p>
                      <div className="max-h-40 overflow-y-auto space-y-0.5">
                        {availableToAdd.map((agent) => (
                          <label key={agent.id} className="flex items-center gap-2 py-1 px-2 rounded hover:bg-gray-700 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={selectedToAdd.has(agent.id)}
                              onChange={(e) => {
                                setSelectedToAdd((prev) => {
                                  const next = new Set(prev);
                                  if (e.target.checked) next.add(agent.id);
                                  else next.delete(agent.id);
                                  return next;
                                });
                              }}
                              className="accent-blue-500"
                            />
                            <span className="text-sm">{agent.avatar_emoji || "🤖"}</span>
                            <span className="text-sm text-gray-200">{agent.name}</span>
                            <span className="text-xs text-gray-500">{agent.role}</span>
                          </label>
                        ))}
                      </div>
                      <div className="flex gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => handleAddMembers(team.id)}
                          disabled={selectedToAdd.size === 0}
                          className="flex items-center gap-1 px-3 py-1 text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded transition-colors"
                        >
                          <Check className="w-3 h-3" /> Add {selectedToAdd.size > 0 ? `(${selectedToAdd.size})` : ""}
                        </button>
                        <button type="button" onClick={() => setAddingMembersTo(null)} className="px-3 py-1 text-xs text-gray-400 hover:text-gray-200">
                          Cancel
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
