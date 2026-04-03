import { useState, useEffect } from "react";
import { Map } from "lucide-react";
import { getProjects } from "../../api";
import type { Project } from "../../types";
import RoadmapView from "./RoadmapView";
import { useI18n } from "../../i18n";

export default function RoadmapPageView() {
  const { t } = useI18n();
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await getProjects();
        setProjects(res.projects);
        if (res.projects.length > 0 && !selectedProjectId) {
          setSelectedProjectId(res.projects[0].id);
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedProject = projects.find((p) => p.id === selectedProjectId);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-400">
        {t({ ko: "불러오는 중...", en: "Loading...", ja: "読み込み中...", zh: "加载中..." })}
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-slate-500">
        <Map className="w-10 h-10 mb-3 opacity-40" />
        <p>{t({ ko: "프로젝트가 없습니다", en: "No projects found", ja: "プロジェクトがありません", zh: "没有项目" })}</p>
        <p className="text-xs mt-1">
          {t({
            ko: "먼저 프로젝트를 추가하세요",
            en: "Add a project first via Task Board → Project Manager",
            ja: "まずプロジェクトを追加してください",
            zh: "请先添加项目",
          })}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Project Selector */}
      <div className="flex items-center gap-3">
        <label className="text-sm text-slate-400">
          {t({ ko: "프로젝트", en: "Project", ja: "プロジェクト", zh: "项目" })}:
        </label>
        <select
          value={selectedProjectId || ""}
          onChange={(e) => setSelectedProjectId(e.target.value)}
          className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-200 outline-none focus:border-blue-500"
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {/* Roadmap View */}
      {selectedProject && (
        <RoadmapView projectId={selectedProject.id} projectName={selectedProject.name} />
      )}
    </div>
  );
}
