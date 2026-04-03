import { useEffect, useState } from "react";
import {
  CheckCircle,
  Code2,
  FileText,
  Layout,
  Loader2,
  Play,
  Shield,
  Zap,
} from "lucide-react";
import type { IdeationIdea } from "../../api/organization-projects";
import { getIdeationIdeas, runIdeationSSE } from "../../api/organization-projects";
import IdeaCard from "./IdeaCard";

interface IdeationPanelProps {
  projectId: string;
  projectName: string;
}

interface CategoryMeta {
  key: string;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  color: string;       // tailwind text color
  bgColor: string;     // tailwind bg for the icon badge
  borderColor: string; // tailwind ring/border accent
}

const CATEGORIES: CategoryMeta[] = [
  {
    key: "code_improvements",
    label: "Code Improvements",
    icon: Code2,
    color: "text-blue-400",
    bgColor: "bg-blue-900/40",
    borderColor: "border-blue-700",
  },
  {
    key: "ui_ux_improvements",
    label: "UI / UX Improvements",
    icon: Layout,
    color: "text-purple-400",
    bgColor: "bg-purple-900/40",
    borderColor: "border-purple-700",
  },
  {
    key: "security_hardening",
    label: "Security Hardening",
    icon: Shield,
    color: "text-red-400",
    bgColor: "bg-red-900/40",
    borderColor: "border-red-700",
  },
  {
    key: "performance_optimizations",
    label: "Performance",
    icon: Zap,
    color: "text-yellow-400",
    bgColor: "bg-yellow-900/40",
    borderColor: "border-yellow-700",
  },
  {
    key: "documentation_gaps",
    label: "Documentation Gaps",
    icon: FileText,
    color: "text-green-400",
    bgColor: "bg-green-900/40",
    borderColor: "border-green-700",
  },
  {
    key: "code_quality",
    label: "Code Quality",
    icon: CheckCircle,
    color: "text-orange-400",
    bgColor: "bg-orange-900/40",
    borderColor: "border-orange-700",
  },
];

export default function IdeationPanel({ projectId, projectName }: IdeationPanelProps) {
  const [ideas, setIdeas] = useState<IdeationIdea[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [categoryProgress, setCategoryProgress] = useState<Record<string, "pending" | "done">>({});
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  // Count ideas per category
  const countByCategory = (key: string) => ideas.filter((i) => i.type === key).length;

  // Fetch ideas on mount
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getIdeationIdeas(projectId)
      .then((data) => {
        if (!cancelled) setIdeas(data);
      })
      .catch(() => {
        /* silently fail; ideas stay empty */
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Run analysis
  function handleRunAnalysis() {
    setRunning(true);
    const progress: Record<string, "pending" | "done"> = {};
    for (const c of CATEGORIES) progress[c.key] = "pending";
    setCategoryProgress(progress);

    runIdeationSSE(projectId, undefined, {
      onTypeProgress(data) {
        setCategoryProgress((prev) => ({ ...prev, [data.type]: data.status === "done" ? "done" : "pending" }));
      },
      async onDone() {
        try {
          const refreshed = await getIdeationIdeas(projectId);
          setIdeas(refreshed);
        } catch {
          /* keep existing */
        }
        setCategoryProgress({});
        setRunning(false);
      },
      onError() {
        setCategoryProgress({});
        setRunning(false);
      },
    });
  }

  // Filtered ideas for selected category
  const filteredIdeas = selectedCategory
    ? ideas.filter((i) => i.type === selectedCategory)
    : [];

  // Refresh after convert/dismiss
  async function refreshIdeas() {
    try {
      const refreshed = await getIdeationIdeas(projectId);
      setIdeas(refreshed);
    } catch {
      /* keep existing */
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-200">Ideation</h2>
          <p className="text-sm text-gray-500">{projectName}</p>
        </div>
        <button
          type="button"
          disabled={running}
          onClick={handleRunAnalysis}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {running ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
          {running ? "Analyzing..." : "Run Analysis"}
        </button>
      </div>

      {/* Category grid */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={24} className="animate-spin text-gray-500" />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {CATEGORIES.map((cat) => {
            const Icon = cat.icon;
            const count = countByCategory(cat.key);
            const isSelected = selectedCategory === cat.key;
            const isRunningCat = running && categoryProgress[cat.key] === "pending";

            return (
              <button
                key={cat.key}
                type="button"
                onClick={() => setSelectedCategory(isSelected ? null : cat.key)}
                className={`flex flex-col items-center gap-2 rounded-lg border p-4 text-center transition-colors ${
                  isSelected
                    ? `bg-gray-800 ${cat.borderColor} border-2`
                    : "bg-gray-800 border-gray-700 hover:border-gray-600"
                }`}
              >
                <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${cat.bgColor}`}>
                  {isRunningCat ? (
                    <Loader2 size={20} className={`animate-spin ${cat.color}`} />
                  ) : (
                    <Icon size={20} className={cat.color} />
                  )}
                </div>
                <span className="text-xs font-medium text-gray-300">{cat.label}</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-lg font-bold text-gray-200">{count}</span>
                  <span className="text-xs text-gray-500">ideas</span>
                </div>
                {/* Status indicator */}
                {running && categoryProgress[cat.key] === "done" && (
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-400" />
                )}
                {running && categoryProgress[cat.key] === "pending" && (
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-yellow-400 animate-pulse" />
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Filtered idea list */}
      {selectedCategory && (
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-medium text-gray-400">
            {CATEGORIES.find((c) => c.key === selectedCategory)?.label ?? selectedCategory}
            <span className="ml-2 text-gray-600">({filteredIdeas.length})</span>
          </h3>
          {filteredIdeas.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-600">No ideas in this category yet.</p>
          ) : (
            filteredIdeas.map((idea) => (
              <IdeaCard
                key={idea.id}
                idea={idea}
                onConvert={() => refreshIdeas()}
                onDismiss={() => refreshIdeas()}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
