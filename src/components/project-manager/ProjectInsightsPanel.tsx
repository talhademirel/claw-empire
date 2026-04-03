import { useEffect, useRef, useState } from "react";
import type { ProjectDecisionEventItem, ProjectReportHistoryItem, ProjectTaskHistoryItem } from "../../api";
import {
  analyzeProjectSSE,
  analyzeTeamSSE,
  applyTeamRecommendation,
  type TeamRecommendation,
} from "../../api/organization-projects";
import type { Project } from "../../types";
import type { GroupedProjectTaskCard, ProjectI18nTranslate } from "./types";
import { fmtTime } from "./utils";

const TEAM_PHASE_LOGS: Record<string, string> = {
  collecting_context: "Scanning project files...",
  analyzing: "Reading project structure...",
  generating_team: "Asking Opus to build your team...",
  parsing: "Parsing team recommendations...",
  done: "Team ready!",
};

interface ProjectInsightsPanelProps {
  t: ProjectI18nTranslate;
  selectedProject: Project | null;
  loadingDetail: boolean;
  isCreating: boolean;
  groupedTaskCards: GroupedProjectTaskCard[];
  sortedReports: ProjectReportHistoryItem[];
  sortedDecisionEvents: ProjectDecisionEventItem[];
  getDecisionEventLabel: (eventType: ProjectDecisionEventItem["event_type"]) => string;
  handleOpenTaskDetail: (taskId: string) => Promise<void>;
}

export default function ProjectInsightsPanel({
  t,
  selectedProject,
  loadingDetail,
  isCreating,
  groupedTaskCards,
  sortedReports,
  sortedDecisionEvents,
  getDecisionEventLabel,
  handleOpenTaskDetail,
}: ProjectInsightsPanelProps) {
  const [autoTaskRunning, setAutoTaskRunning] = useState(false);
  const [autoTaskResult, setAutoTaskResult] = useState<string | null>(null);
  const [teamRunning, setTeamRunning] = useState(false);
  const [teamLogs, setTeamLogs] = useState<string[]>([]);
  const [teamRecommendation, setTeamRecommendation] = useState<TeamRecommendation | null>(null);
  const [teamApplying, setTeamApplying] = useState(false);
  const [teamApplyError, setTeamApplyError] = useState<string | null>(null);
  const teamLogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (teamLogRef.current) {
      teamLogRef.current.scrollTop = teamLogRef.current.scrollHeight;
    }
  }, [teamLogs]);

  const handleBuildTeam = () => {
    if (!selectedProject) return;
    setTeamRunning(true);
    setTeamLogs([]);
    setTeamRecommendation(null);
    setTeamApplyError(null);
    analyzeTeamSSE(selectedProject.id, {
      onProgress: (data) => {
        const msg = TEAM_PHASE_LOGS[data.phase] || data.phase;
        setTeamLogs((prev) => [...prev, `[${data.progress}%] ${msg}`]);
      },
      onRecommendation: (data) => {
        setTeamRecommendation(data);
        setTeamLogs((prev) => [
          ...prev,
          `[100%] ${data.departments.length} departments, ${data.agents.length} agents ready.`,
        ]);
      },
      onDone: () => setTeamRunning(false),
      onError: (err) => {
        setTeamLogs((prev) => [...prev, `[ERR] ${err}`]);
        setTeamRunning(false);
      },
    });
  };

  const handleApplyTeam = async (clearExisting: boolean) => {
    if (!selectedProject || !teamRecommendation) return;
    setTeamApplying(true);
    setTeamApplyError(null);
    try {
      const result = await applyTeamRecommendation(selectedProject.id, teamRecommendation, clearExisting);
      setTeamLogs((prev) => [
        ...prev,
        `[OK] ${result.departments_created} departments + ${result.agents_created} agents created.`,
      ]);
      setTeamRecommendation(null);
    } catch (err) {
      setTeamApplyError(`Apply failed: ${err}`);
    } finally {
      setTeamApplying(false);
    }
  };

  const handleAutoTask = () => {
    if (!selectedProject) return;
    setAutoTaskRunning(true);
    setAutoTaskResult(null);
    analyzeProjectSSE(
      selectedProject.id,
      { mode: "quick", auto_assign: false, auto_run: false },
      {
        onTasksCreated: (data) => setAutoTaskResult(`${data.count} tasks created`),
        onDone: () => setAutoTaskRunning(false),
        onError: (err) => { setAutoTaskResult(`Error: ${err}`); setAutoTaskRunning(false); },
      },
    );
  };

  return (
    <div className="min-w-0 space-y-4">
      <div className="min-w-0 rounded-xl border border-slate-700 bg-slate-800/40 p-4">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-white">
            {t({ ko: "프로젝트 정보", en: "Project Info", ja: "プロジェクト情報", zh: "项目信息" })}
          </h4>
          {selectedProject?.github_repo && (
            <a
              href={`https://github.com/${selectedProject.github_repo}`}
              target="_blank"
              rel="noopener noreferrer"
              title={selectedProject.github_repo}
              className="flex items-center gap-1 rounded-md border border-slate-600 px-2 py-0.5 text-[11px] text-slate-300 transition hover:border-blue-500 hover:text-white"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
              </svg>
              {selectedProject.github_repo}
            </a>
          )}
        </div>
        {loadingDetail ? (
          <p className="mt-2 text-xs text-slate-400">
            {t({ ko: "불러오는 중...", en: "Loading...", ja: "読み込み中...", zh: "加载中..." })}
          </p>
        ) : isCreating ? (
          <p className="mt-2 text-xs text-slate-500">
            {t({
              ko: "신규 프로젝트를 입력 중입니다",
              en: "Creating a new project",
              ja: "新規プロジェクトを入力中です",
              zh: "正在输入新项目",
            })}
          </p>
        ) : !selectedProject ? (
          <p className="mt-2 text-xs text-slate-500">
            {t({ ko: "프로젝트를 선택하세요", en: "Select a project", ja: "プロジェクトを選択", zh: "请选择项目" })}
          </p>
        ) : (
          <div className="mt-2 space-y-2 text-xs">
            <p className="text-slate-200">
              <span className="text-slate-500">ID:</span> {selectedProject.id}
            </p>
            <p className="break-all text-slate-200">
              <span className="text-slate-500">Path:</span> {selectedProject.project_path}
            </p>
            <p className="break-all text-slate-200">
              <span className="text-slate-500">Goal:</span> {selectedProject.core_goal}
            </p>
          </div>
        )}
      </div>

      {/* AI Actions */}
      {selectedProject && !isCreating && (
        <div className="min-w-0 rounded-xl border border-purple-800/50 bg-purple-900/10 p-4">
          <h4 className="text-sm font-semibold text-purple-200">
            ✨ {t({ ko: "AI 분석", en: "AI Analysis", ja: "AI分析", zh: "AI分析" })}
          </h4>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={handleAutoTask}
              disabled={autoTaskRunning}
              className="rounded-lg border border-purple-600 bg-purple-900/40 px-3 py-1.5 text-[11px] font-medium text-purple-200 transition hover:bg-purple-900/60 disabled:opacity-50"
            >
              {autoTaskRunning ? "⏳ Analyzing..." : "🔍 Auto Task"}
            </button>
            <button
              onClick={handleBuildTeam}
              disabled={teamRunning}
              className="rounded-lg border border-emerald-600 bg-emerald-900/40 px-3 py-1.5 text-[11px] font-medium text-emerald-200 transition hover:bg-emerald-900/60 disabled:opacity-50"
            >
              {teamRunning ? "⏳ Analyzing..." : "👥 Build Team"}
            </button>
          </div>
          {autoTaskResult && (
            <p className="mt-2 text-[11px] text-purple-300">{autoTaskResult}</p>
          )}

          {/* Terminal log */}
          {teamLogs.length > 0 && (
            <div
              ref={teamLogRef}
              className="mt-3 max-h-28 overflow-y-auto rounded-md bg-black/70 p-2.5 font-mono text-[10px] leading-relaxed"
            >
              {teamLogs.map((line, i) => (
                <p
                  key={i}
                  className={
                    line.startsWith("[ERR]")
                      ? "text-red-400"
                      : line.startsWith("[OK]")
                        ? "text-emerald-400"
                        : line.startsWith("[100%]")
                          ? "text-emerald-300"
                          : "text-green-500"
                  }
                >
                  <span className="text-slate-600 mr-1">$</span>{line}
                </p>
              ))}
              {teamRunning && (
                <p className="text-green-500 animate-pulse">
                  <span className="text-slate-600 mr-1">$</span>▋
                </p>
              )}
            </div>
          )}

          {teamApplyError && (
            <p className="mt-2 text-[11px] text-red-400">{teamApplyError}</p>
          )}

          {/* Team Recommendation Preview */}
          {teamRecommendation && (
            <div className="mt-3 space-y-2 rounded-lg border border-emerald-700/50 bg-emerald-950/30 p-3">
              <p className="text-[11px] text-emerald-200">{teamRecommendation.team_summary}</p>
              <div className="space-y-1">
                {teamRecommendation.departments.map((d) => (
                  <div key={d.id} className="flex items-center gap-2 text-[11px]">
                    <span>{d.icon}</span>
                    <span className="font-medium text-slate-200">{d.name}</span>
                    <span className="text-slate-500">—</span>
                    <span className="text-slate-400">{d.description}</span>
                  </div>
                ))}
              </div>
              <div className="space-y-1">
                {teamRecommendation.agents.map((a, i) => (
                  <div key={i} className="flex items-center gap-2 text-[11px]">
                    <span>{a.avatar_emoji}</span>
                    <span className="font-medium text-slate-200">{a.name}</span>
                    <span className="rounded-full bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">{a.role}</span>
                    <span className="rounded-full bg-slate-800 px-1.5 py-0.5 text-[10px] text-blue-300">{a.cli_provider}</span>
                    <span className="text-slate-500">{a.department_id}</span>
                  </div>
                ))}
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => handleApplyTeam(false)}
                  disabled={teamApplying}
                  className="rounded-lg bg-emerald-700 px-3 py-1.5 text-[11px] font-medium text-white transition hover:bg-emerald-600 disabled:opacity-50"
                >
                  {teamApplying ? "Applying..." : "➕ Add to Existing"}
                </button>
                <button
                  onClick={() => {
                    if (window.confirm("This will remove ALL existing departments and agents. Continue?")) {
                      handleApplyTeam(true);
                    }
                  }}
                  disabled={teamApplying}
                  className="rounded-lg border border-red-700 bg-red-900/30 px-3 py-1.5 text-[11px] font-medium text-red-300 transition hover:bg-red-900/50 disabled:opacity-50"
                >
                  🔄 Replace All
                </button>
                <button
                  onClick={() => setTeamRecommendation(null)}
                  className="rounded-lg border border-slate-600 px-3 py-1.5 text-[11px] text-slate-400 transition hover:bg-slate-800"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="min-w-0 rounded-xl border border-slate-700 bg-slate-800/40 p-4">
        <h4 className="text-sm font-semibold text-white">
          {t({ ko: "작업 이력", en: "Task History", ja: "作業履歴", zh: "任务历史" })}
        </h4>
        {!selectedProject ? (
          <p className="mt-2 text-xs text-slate-500">-</p>
        ) : groupedTaskCards.length === 0 ? (
          <p className="mt-2 text-xs text-slate-500">
            {t({ ko: "연결된 작업이 없습니다", en: "No mapped tasks", ja: "紐づくタスクなし", zh: "没有映射任务" })}
          </p>
        ) : (
          <div className="mt-2 max-h-56 overflow-x-hidden overflow-y-auto space-y-2 pr-1">
            {groupedTaskCards.map((group) => (
              <button
                key={group.root.id}
                type="button"
                onClick={() => void handleOpenTaskDetail(group.root.id)}
                className="w-full min-w-0 overflow-hidden rounded-lg border border-slate-700/70 bg-slate-900/60 px-3 py-2 text-left transition hover:border-blue-500/70 hover:bg-slate-900"
              >
                <p className="whitespace-pre-wrap break-all text-xs font-semibold text-slate-100">{group.root.title}</p>
                <p className="mt-1 break-all text-[11px] text-slate-400">
                  {group.root.status} · {group.root.task_type} · {fmtTime(group.root.created_at)}
                </p>
                <p className="mt-1 break-all text-[11px] text-slate-500">
                  {t({ ko: "담당", en: "Owner", ja: "担当", zh: "负责人" })}:{" "}
                  {group.root.assigned_agent_name_ko || group.root.assigned_agent_name || "-"}
                </p>
                <p className="mt-1 text-[11px] text-blue-300">
                  {t({ ko: "하위 작업", en: "Sub tasks", ja: "サブタスク", zh: "子任务" })}: {group.children.length}
                </p>
                {group.children.length > 0 && (
                  <div className="mt-1 space-y-1">
                    {group.children.slice(0, 3).map((child: ProjectTaskHistoryItem) => (
                      <p key={child.id} className="whitespace-pre-wrap break-all text-[11px] text-slate-500">
                        - {child.title}
                      </p>
                    ))}
                    {group.children.length > 3 && (
                      <p className="text-[11px] text-slate-500">+{group.children.length - 3}</p>
                    )}
                  </div>
                )}
                <p className="mt-2 text-right text-[11px] text-emerald-300">
                  {t({
                    ko: "카드 클릭으로 상세 보기",
                    en: "Click card for details",
                    ja: "クリックで詳細表示",
                    zh: "点击卡片查看详情",
                  })}
                </p>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="min-w-0 rounded-xl border border-slate-700 bg-slate-800/40 p-4">
        <h4 className="text-sm font-semibold text-white">
          {t({ ko: "보고서 이력(프로젝트 매핑)", en: "Mapped Reports", ja: "紐づくレポート", zh: "映射报告" })}
        </h4>
        {!selectedProject ? (
          <p className="mt-2 text-xs text-slate-500">-</p>
        ) : sortedReports.length === 0 ? (
          <p className="mt-2 text-xs text-slate-500">
            {t({
              ko: "연결된 보고서가 없습니다",
              en: "No mapped reports",
              ja: "紐づくレポートなし",
              zh: "没有映射报告",
            })}
          </p>
        ) : (
          <div className="mt-2 max-h-56 overflow-x-hidden overflow-y-auto space-y-2 pr-1">
            {sortedReports.map((row) => (
              <div
                key={row.id}
                className="flex min-w-0 items-center justify-between gap-2 rounded-lg border border-slate-700/70 bg-slate-900/60 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="whitespace-pre-wrap break-all text-xs font-medium text-slate-100">{row.title}</p>
                  <p className="text-[11px] text-slate-400">{fmtTime(row.completed_at || row.created_at)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleOpenTaskDetail(row.id)}
                  className="shrink-0 rounded-md bg-emerald-700 px-2 py-1 text-[11px] text-white hover:bg-emerald-600"
                >
                  {t({ ko: "열람", en: "Open", ja: "表示", zh: "查看" })}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="min-w-0 rounded-xl border border-slate-700 bg-slate-800/40 p-4">
        <h4 className="text-sm font-semibold text-white">
          {t({ ko: "대표 선택사항", en: "Representative Decisions", ja: "代表選択事項", zh: "代表选择事项" })}
        </h4>
        {!selectedProject ? (
          <p className="mt-2 text-xs text-slate-500">-</p>
        ) : sortedDecisionEvents.length === 0 ? (
          <p className="mt-2 text-xs text-slate-500">
            {t({
              ko: "기록된 대표 의사결정이 없습니다",
              en: "No representative decision records",
              ja: "代表意思決定の記録はありません",
              zh: "暂无代表决策记录",
            })}
          </p>
        ) : (
          <div className="mt-2 max-h-56 overflow-x-hidden overflow-y-auto space-y-2 pr-1">
            {sortedDecisionEvents.map((event) => {
              let selectedLabels: string[] = [];
              if (event.selected_options_json) {
                try {
                  const parsed = JSON.parse(event.selected_options_json) as Array<{ label?: unknown }>;
                  selectedLabels = Array.isArray(parsed)
                    ? parsed
                        .map((row) => (typeof row?.label === "string" ? row.label.trim() : ""))
                        .filter((label) => label.length > 0)
                    : [];
                } catch {
                  selectedLabels = [];
                }
              }

              return (
                <div
                  key={`${event.id}-${event.created_at}`}
                  className="rounded-lg border border-slate-700/70 bg-slate-900/60 px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="min-w-0 truncate text-xs font-semibold text-slate-100">
                      {getDecisionEventLabel(event.event_type)}
                    </p>
                    <p className="text-[11px] text-slate-400">{fmtTime(event.created_at)}</p>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap break-all text-[11px] text-slate-300">{event.summary}</p>
                  {selectedLabels.length > 0 && (
                    <p className="mt-1 whitespace-pre-wrap break-all text-[11px] text-blue-300">
                      {t({ ko: "선택 내용", en: "Selected Items", ja: "選択内容", zh: "已选内容" })}:{" "}
                      {selectedLabels.join(" / ")}
                    </p>
                  )}
                  {event.note && event.note.trim().length > 0 && (
                    <p className="mt-1 whitespace-pre-wrap break-all text-[11px] text-emerald-300">
                      {t({ ko: "추가 요청사항", en: "Additional Request", ja: "追加要請事項", zh: "追加请求事项" })}:{" "}
                      {event.note}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
