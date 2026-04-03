import { useCallback, useEffect, useState } from "react";
import { ArrowRight, ChevronDown, ChevronUp, Map, Plus, Trash2 } from "lucide-react";
import {
  convertFeatureToTask,
  deleteRoadmapFeature,
  getRoadmap,
  type RoadmapDiscovery,
  type RoadmapFeature,
} from "../../api/organization-projects";
import RoadmapGenerateModal from "./RoadmapGenerateModal";

interface RoadmapViewProps {
  projectId: string;
  projectName: string;
}

const PHASES = [
  { key: "phase_1", label: "Phase 1", border: "border-red-800", header: "bg-red-900/40", number: "text-red-700", bar: "bg-red-500" },
  { key: "phase_2", label: "Phase 2", border: "border-yellow-800", header: "bg-yellow-900/40", number: "text-yellow-700", bar: "bg-yellow-500" },
  { key: "phase_3", label: "Phase 3", border: "border-blue-800", header: "bg-blue-900/40", number: "text-blue-700", bar: "bg-blue-500" },
  { key: "phase_4", label: "Phase 4", border: "border-green-800", header: "bg-green-900/40", number: "text-green-700", bar: "bg-green-500" },
  { key: "backlog", label: "Backlog", border: "border-gray-600", header: "bg-gray-700/40", number: "text-gray-600", bar: "bg-gray-500" },
] as const;


function buildPhaseDescription(features: RoadmapFeature[]): string {
  if (features.length === 0) return "No features planned yet.";
  const mustCount = features.filter((f) => f.priority <= 1).length;
  const categories = [...new Set(features.map((f) => f.category).filter(Boolean))] as string[];
  const efforts = [...new Set(features.map((f) => f.estimated_effort).filter(Boolean))] as string[];
  const parts: string[] = [];
  if (mustCount > 0) parts.push(`${mustCount} must-have feature${mustCount > 1 ? "s" : ""}`);
  if (categories.length > 0) parts.push(`covering ${categories.slice(0, 3).join(", ")}`);
  if (efforts.length > 0) parts.push(`estimated ${efforts.slice(0, 2).join(" – ")} effort`);
  return parts.length > 0 ? parts.join(" · ") + "." : `${features.length} features planned.`;
}

function getPhaseStatus(features: RoadmapFeature[]): { label: string; className: string } {
  if (features.length === 0) return { label: "planned", className: "bg-gray-700 text-gray-300" };
  const converted = features.filter((f) => f.converted_task_id).length;
  if (converted === features.length) return { label: "done", className: "bg-green-900/60 text-green-300" };
  if (converted > 0) return { label: "in progress", className: "bg-blue-900/60 text-blue-300" };
  return { label: "planned", className: "bg-gray-700 text-gray-300" };
}

const COLLAPSED_LIMIT = 5;

export default function RoadmapView({ projectId, projectName }: RoadmapViewProps) {
  const [features, setFeatures] = useState<RoadmapFeature[]>([]);
  const [discovery, setDiscovery] = useState<RoadmapDiscovery | null>(null);
  const [loading, setLoading] = useState(true);
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [expandedPhases, setExpandedPhases] = useState<Set<string>>(new Set());

  const fetchRoadmap = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getRoadmap(projectId);
      setFeatures(data.features);
      setDiscovery(data.discovery);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchRoadmap();
  }, [fetchRoadmap]);

  const handleConvert = useCallback(
    async (featureId: string) => {
      try {
        await convertFeatureToTask(projectId, featureId);
        await fetchRoadmap();
      } catch {
        /* ignore */
      }
    },
    [projectId, fetchRoadmap],
  );

  const handleDelete = useCallback(
    async (featureId: string) => {
      try {
        await deleteRoadmapFeature(projectId, featureId);
        setFeatures((prev) => prev.filter((f) => f.id !== featureId));
      } catch {
        /* ignore */
      }
    },
    [projectId],
  );

  const toggleExpand = (key: string) => {
    setExpandedPhases((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const featuresByPhase = (phaseKey: string) =>
    features.filter((f) => f.phase === phaseKey).sort((a, b) => a.sort_order - b.sort_order);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        <Map className="w-6 h-6 animate-pulse mr-2" />
        Loading roadmap...
      </div>
    );
  }

  const visiblePhases = PHASES.filter(({ key }) => featuresByPhase(key).length > 0 || key !== "backlog");

  return (
    <div className="flex flex-col h-full bg-gray-900">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <Map className="w-5 h-5 text-gray-400" />
          <h2 className="text-lg font-semibold text-white">{projectName} Roadmap</h2>
          <span className="text-xs text-gray-500 ml-2">{features.length} features</span>
        </div>
        <button
          type="button"
          onClick={() => setShowGenerateModal(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded-md transition-colors"
        >
          <Plus className="w-4 h-4" />
          Generate Roadmap
        </button>
      </div>

      {/* Discovery context */}
      {discovery?.product_vision && (
        <div className="px-4 py-2 border-b border-gray-700 text-xs text-gray-400 italic">
          {discovery.product_vision}
        </div>
      )}

      {/* Empty state */}
      {features.length === 0 && (
        <div className="flex flex-col items-center justify-center flex-1 text-gray-500 gap-3">
          <Map className="w-10 h-10 opacity-30" />
          <p className="text-sm">No roadmap yet. Generate one to get started.</p>
        </div>
      )}

      {/* Phase sections */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {visiblePhases.map(({ key, label, border, header, number, bar }, index) => {
          const phaseFeatures = featuresByPhase(key);
          if (phaseFeatures.length === 0) return null;
          const status = getPhaseStatus(phaseFeatures);
          const converted = phaseFeatures.filter((f) => f.converted_task_id).length;
          const isExpanded = expandedPhases.has(key);
          const shown = isExpanded ? phaseFeatures : phaseFeatures.slice(0, COLLAPSED_LIMIT);
          const hidden = phaseFeatures.length - COLLAPSED_LIMIT;

          return (
            <div key={key} className={`bg-gray-800 rounded-lg border ${border} overflow-hidden`}>
              {/* Phase header */}
              <div className={`flex items-start gap-4 px-5 py-4 border-b ${border} ${header}`}>
                <span className={`text-2xl font-bold leading-none mt-0.5 w-6 shrink-0 ${number}`}>
                  {index + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-base font-semibold text-white">{label}</h3>
                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${status.className}`}>
                      {status.label}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">
                    {buildPhaseDescription(phaseFeatures)}
                  </p>
                </div>
              </div>

              {/* Progress */}
              <div className={`flex items-center gap-3 px-5 py-2 border-b border-gray-700/50`}>
                <span className="text-xs text-gray-500">Progress</span>
                <div className="flex-1 bg-gray-700 rounded-full h-1">
                  <div
                    className={`${bar} h-1 rounded-full transition-all`}
                    style={{ width: phaseFeatures.length > 0 ? `${(converted / phaseFeatures.length) * 100}%` : "0%" }}
                  />
                </div>
                <span className="text-xs text-gray-500 shrink-0">
                  {converted}/{phaseFeatures.length} features
                </span>
              </div>

              {/* Features */}
              <div className="px-5 py-3">
                <p className="text-xs font-medium text-gray-400 mb-3">Features ({phaseFeatures.length})</p>
                <div className="space-y-2">
                  {shown.map((feature) => (
                    <FeatureCard
                      key={feature.id}
                      feature={feature}
                      onConvert={handleConvert}
                      onDelete={handleDelete}
                    />
                  ))}
                </div>

                {phaseFeatures.length > COLLAPSED_LIMIT && (
                  <button
                    type="button"
                    onClick={() => toggleExpand(key)}
                    className="mt-3 w-full flex items-center justify-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors py-1"
                  >
                    {isExpanded ? (
                      <>
                        <ChevronUp className="w-3.5 h-3.5" />
                        Show less
                      </>
                    ) : (
                      <>
                        <ChevronDown className="w-3.5 h-3.5" />
                        Show {hidden} more feature{hidden !== 1 ? "s" : ""}
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <RoadmapGenerateModal
        projectId={projectId}
        isOpen={showGenerateModal}
        onClose={() => setShowGenerateModal(false)}
        onComplete={fetchRoadmap}
      />
    </div>
  );
}

/* ── Feature Card ────────────────────────────────────────────────── */

// Engine produces priority 0–3 (0 = highest urgency)
const PRIORITY_BADGE: Record<number, { label: string; className: string }> = {
  0: { label: "Must Have", className: "bg-red-900/70 text-red-300 border border-red-700" },
  1: { label: "Must Have", className: "bg-red-900/70 text-red-300 border border-red-700" },
  2: { label: "Should Have", className: "bg-yellow-900/70 text-yellow-300 border border-yellow-700" },
  3: { label: "Could Have", className: "bg-gray-700 text-gray-300 border border-gray-600" },
};

const EFFORT_BADGE: Record<string, string> = {
  low: "bg-gray-800 text-gray-400 border border-gray-600",
  medium: "bg-gray-800 text-yellow-400 border border-yellow-800",
  high: "bg-gray-800 text-orange-400 border border-orange-800",
  very_high: "bg-gray-800 text-red-400 border border-red-800",
};

function FeatureCard({
  feature,
  onConvert,
  onDelete,
}: {
  feature: RoadmapFeature;
  onConvert: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [converting, setConverting] = useState(false);
  const priorityBadge = PRIORITY_BADGE[feature.priority] ?? PRIORITY_BADGE[5];
  const effortKey = feature.estimated_effort?.toLowerCase() ?? "";
  const effortClass = EFFORT_BADGE[effortKey] ?? "bg-gray-800 text-gray-400 border border-gray-600";

  const handleConvert = async () => {
    setConverting(true);
    try {
      await onConvert(feature.id);
    } finally {
      setConverting(false);
    }
  };

  return (
    <div className="group rounded-lg bg-gray-900/70 border border-gray-700/60 hover:border-gray-600 transition-colors px-4 py-3">
      {/* Badges row */}
      <div className="flex items-center gap-1.5 flex-wrap mb-2">
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${priorityBadge.className}`}>
          {priorityBadge.label}
        </span>
        {feature.estimated_effort && (
          <span className={`text-[10px] px-2 py-0.5 rounded ${effortClass}`}>
            {feature.estimated_effort}
          </span>
        )}
        {feature.category && (
          <span className="text-[10px] px-2 py-0.5 rounded bg-indigo-900/50 text-indigo-300 border border-indigo-800">
            {feature.category}
          </span>
        )}
      </div>

      {/* Title + action */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-semibold text-gray-100">{feature.title}</h4>
          {feature.description && (
            <p className="text-xs text-gray-400 mt-1 leading-relaxed line-clamp-2">{feature.description}</p>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0 mt-0.5">
          {feature.converted_task_id ? (
            <span className="text-[10px] text-green-400 font-medium">Built</span>
          ) : (
            <button
              type="button"
              disabled={converting}
              onClick={handleConvert}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-blue-300 disabled:opacity-50 transition-colors"
            >
              <ArrowRight className="w-3.5 h-3.5" />
              {converting ? "..." : "Build"}
            </button>
          )}
          <button
            type="button"
            onClick={() => onDelete(feature.id)}
            className="text-gray-700 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 ml-1"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
