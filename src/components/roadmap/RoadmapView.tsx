import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Map, Plus, Trash2 } from "lucide-react";
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
  { key: "backlog", label: "Backlog", color: "gray" },
  { key: "phase_1", label: "Phase 1", color: "red" },
  { key: "phase_2", label: "Phase 2", color: "yellow" },
  { key: "phase_3", label: "Phase 3", color: "blue" },
  { key: "phase_4", label: "Phase 4", color: "green" },
] as const;

const PHASE_COLORS: Record<string, { header: string; badge: string; border: string }> = {
  gray: { header: "bg-gray-700", badge: "bg-gray-600 text-gray-200", border: "border-gray-600" },
  red: { header: "bg-red-900/60", badge: "bg-red-800 text-red-200", border: "border-red-800" },
  yellow: { header: "bg-yellow-900/60", badge: "bg-yellow-800 text-yellow-200", border: "border-yellow-800" },
  blue: { header: "bg-blue-900/60", badge: "bg-blue-800 text-blue-200", border: "border-blue-800" },
  green: { header: "bg-green-900/60", badge: "bg-green-800 text-green-200", border: "border-green-800" },
};

const PRIORITY_INDICATOR: Record<number, string> = {
  1: "bg-red-500",
  2: "bg-orange-500",
  3: "bg-yellow-500",
  4: "bg-blue-500",
  5: "bg-gray-500",
};

export default function RoadmapView({ projectId, projectName }: RoadmapViewProps) {
  const [features, setFeatures] = useState<RoadmapFeature[]>([]);
  const [discovery, setDiscovery] = useState<RoadmapDiscovery | null>(null);
  const [loading, setLoading] = useState(true);
  const [showGenerateModal, setShowGenerateModal] = useState(false);

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

      {/* Columns */}
      <div className="flex-1 overflow-x-auto p-4">
        <div className="flex gap-4 min-w-max h-full">
          {PHASES.map(({ key, label, color }) => {
            const phaseFeatures = featuresByPhase(key);
            const colors = PHASE_COLORS[color];
            return (
              <div
                key={key}
                className="flex flex-col w-72 bg-gray-800 rounded-lg border border-gray-700 shrink-0"
              >
                {/* Column header */}
                <div
                  className={`flex items-center justify-between px-3 py-2 rounded-t-lg ${colors.header}`}
                >
                  <span className="text-sm font-medium text-white">{label}</span>
                  <span
                    className={`text-xs px-1.5 py-0.5 rounded-full ${colors.badge}`}
                  >
                    {phaseFeatures.length}
                  </span>
                </div>

                {/* Cards */}
                <div className="flex-1 overflow-y-auto p-2 space-y-2">
                  {phaseFeatures.length === 0 && (
                    <p className="text-xs text-gray-500 text-center py-4">No features</p>
                  )}
                  {phaseFeatures.map((feature) => (
                    <FeatureCard
                      key={feature.id}
                      feature={feature}
                      color={color}
                      onConvert={handleConvert}
                      onDelete={handleDelete}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Generate modal */}
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

function FeatureCard({
  feature,
  color,
  onConvert,
  onDelete,
}: {
  feature: RoadmapFeature;
  color: string;
  onConvert: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [converting, setConverting] = useState(false);
  const colors = PHASE_COLORS[color];
  const priorityDot = PRIORITY_INDICATOR[feature.priority] ?? "bg-gray-500";

  const handleConvert = async () => {
    setConverting(true);
    try {
      await onConvert(feature.id);
    } finally {
      setConverting(false);
    }
  };

  return (
    <div className={`bg-gray-900 rounded-md border ${colors.border} p-3 space-y-2`}>
      {/* Title row */}
      <div className="flex items-start gap-2">
        <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${priorityDot}`} />
        <h4 className="text-sm font-medium text-gray-100 leading-tight">{feature.title}</h4>
      </div>

      {/* Description */}
      {feature.description && (
        <p className="text-xs text-gray-400 line-clamp-2">{feature.description}</p>
      )}

      {/* Tags */}
      <div className="flex flex-wrap gap-1.5">
        {feature.estimated_effort && (
          <span className="text-[10px] px-1.5 py-0.5 bg-gray-700 text-gray-300 rounded">
            {feature.estimated_effort}
          </span>
        )}
        {feature.category && (
          <span className="text-[10px] px-1.5 py-0.5 bg-indigo-900/50 text-indigo-300 rounded">
            {feature.category}
          </span>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 pt-1 border-t border-gray-800">
        {feature.converted_task_id ? (
          <span className="text-[10px] text-green-400">Converted</span>
        ) : (
          <button
            type="button"
            disabled={converting}
            onClick={handleConvert}
            className="flex items-center gap-1 text-[10px] text-blue-400 hover:text-blue-300 disabled:opacity-50 transition-colors"
          >
            <ArrowRight className="w-3 h-3" />
            {converting ? "Converting..." : "Convert to Task"}
          </button>
        )}
        <button
          type="button"
          onClick={() => onDelete(feature.id)}
          className="ml-auto text-gray-600 hover:text-red-400 transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
