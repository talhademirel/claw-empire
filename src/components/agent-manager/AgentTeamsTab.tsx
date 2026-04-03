import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, Edit2, Users, Check, X, ChevronDown, ChevronUp } from "lucide-react";
import type { Agent } from "../../types";
import {
  listAgentTeams,
  getAgentTeam,
  createAgentTeam,
  updateAgentTeam,
  deleteAgentTeam,
  addTeamMembers,
  removeTeamMember,
  type AgentTeam,
  type AgentTeamDetail,
} from "../../api/organization-projects";

interface AgentTeamsTabProps {
  agents: Agent[];
}

export default function AgentTeamsTab({ agents }: AgentTeamsTabProps) {
  const [teams, setTeams] = useState<AgentTeam[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedDetail, setExpandedDetail] = useState<AgentTeamDetail | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createDesc, setCreateDesc] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [addingMembersTo, setAddingMembersTo] = useState<string | null>(null);
  const [selectedToAdd, setSelectedToAdd] = useState<Set<string>>(new Set());

  const fetchTeams = useCallback(async () => {
    try {
      const data = await listAgentTeams();
      setTeams(data);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchTeams(); }, [fetchTeams]);

  const toggleExpand = async (teamId: string) => {
    if (expandedId === teamId) {
      setExpandedId(null);
      setExpandedDetail(null);
      return;
    }
    setExpandedId(teamId);
    try {
      const detail = await getAgentTeam(teamId);
      setExpandedDetail(detail);
    } catch { /* ignore */ }
  };

  const handleCreate = async () => {
    if (!createName.trim()) return;
    setCreating(true);
    try {
      await createAgentTeam({ name: createName.trim(), description: createDesc.trim() || undefined });
      setCreateName("");
      setCreateDesc("");
      setShowCreate(false);
      await fetchTeams();
    } finally {
      setCreating(false);
    }
  };

  const handleRename = async (teamId: string) => {
    if (!editName.trim()) return;
    setSaving(true);
    try {
      await updateAgentTeam(teamId, { name: editName.trim() });
      setEditingId(null);
      await fetchTeams();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (teamId: string) => {
    try {
      await deleteAgentTeam(teamId);
      if (expandedId === teamId) { setExpandedId(null); setExpandedDetail(null); }
      await fetchTeams();
    } finally {
      setConfirmDeleteId(null);
    }
  };

  const handleRemoveMember = async (teamId: string, agentId: string) => {
    try {
      await removeTeamMember(teamId, agentId);
      const detail = await getAgentTeam(teamId);
      setExpandedDetail(detail);
      await fetchTeams();
    } catch { /* ignore */ }
  };

  const handleAddMembers = async (teamId: string) => {
    if (selectedToAdd.size === 0) return;
    try {
      await addTeamMembers(teamId, [...selectedToAdd]);
      const detail = await getAgentTeam(teamId);
      setExpandedDetail(detail);
      await fetchTeams();
    } catch { /* ignore */ }
    setAddingMembersTo(null);
    setSelectedToAdd(new Set());
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
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1 px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded-md transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          New Team
        </button>
      </div>

      {/* Create form */}
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
      {teams.length === 0 && !showCreate && (
        <div className="flex flex-col items-center justify-center py-12 text-gray-500 gap-2">
          <Users className="w-8 h-8 opacity-30" />
          <p className="text-sm">No teams yet. Create one or use AI Build Team.</p>
        </div>
      )}

      {/* Team list */}
      {teams.map((team) => (
        <div key={team.id} className="rounded-lg border border-gray-700 bg-gray-800 overflow-hidden">
          {/* Team row */}
          <div className="flex items-center gap-3 px-4 py-3">
            <button
              type="button"
              onClick={() => toggleExpand(team.id)}
              className="flex-1 flex items-center gap-3 text-left min-w-0"
            >
              {expandedId === team.id ? (
                <ChevronUp className="w-4 h-4 text-gray-500 shrink-0" />
              ) : (
                <ChevronDown className="w-4 h-4 text-gray-500 shrink-0" />
              )}
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
                <Users className="w-3 h-3" />
                {team.member_count}
              </span>
              {team.source === "ai_generated" && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-900/50 text-purple-300 border border-purple-800 shrink-0">AI</span>
              )}
            </button>

            {/* Actions */}
            <div className="flex items-center gap-1 shrink-0">
              {editingId === team.id ? (
                <>
                  <button type="button" onClick={() => handleRename(team.id)} disabled={saving} className="text-green-400 hover:text-green-300 p-1">
                    <Check className="w-3.5 h-3.5" />
                  </button>
                  <button type="button" onClick={() => setEditingId(null)} className="text-gray-500 hover:text-gray-300 p-1">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => { setEditingId(team.id); setEditName(team.name); }}
                    className="text-gray-600 hover:text-gray-300 p-1 transition-colors"
                  >
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

              {/* Add members picker */}
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
