import { useState } from "react";
import { ArrowRight, ChevronDown, ChevronUp, X } from "lucide-react";
import type { IdeationIdea } from "../../api/organization-projects";
import { convertIdeaToTask, dismissIdea } from "../../api/organization-projects";

interface IdeaCardProps {
  idea: IdeationIdea;
  onConvert?: (taskId: string) => void;
  onDismiss?: () => void;
}

const EFFORT_COLORS: Record<string, string> = {
  low: "bg-green-900/50 text-green-300 border-green-700",
  medium: "bg-yellow-900/50 text-yellow-300 border-yellow-700",
  high: "bg-red-900/50 text-red-300 border-red-700",
};

export default function IdeaCard({ idea, onConvert, onDismiss }: IdeaCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [converting, setConverting] = useState(false);
  const [dismissing, setDismissing] = useState(false);

  const isInactive = idea.status === "converted" || idea.status === "dismissed";
  const affectedFiles: string[] = (() => {
    if (!idea.affected_files) return [];
    try { return JSON.parse(idea.affected_files); } catch { return []; }
  })();

  const descriptionLines = idea.description.split("\n");
  const isLong = descriptionLines.length > 2;
  const visibleDescription = expanded ? idea.description : descriptionLines.slice(0, 2).join("\n");

  async function handleConvert() {
    setConverting(true);
    try {
      const taskId = await convertIdeaToTask(idea.project_id, idea.id);
      onConvert?.(taskId);
    } catch {
      /* allow parent to handle */
    } finally {
      setConverting(false);
    }
  }

  async function handleDismiss() {
    setDismissing(true);
    try {
      await dismissIdea(idea.project_id, idea.id);
      onDismiss?.();
    } catch {
      /* allow parent to handle */
    } finally {
      setDismissing(false);
    }
  }

  return (
    <div
      className={`rounded-lg border bg-gray-800 border-gray-700 p-4 transition-opacity ${
        isInactive ? "opacity-60" : ""
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <h4 className="text-sm font-semibold text-gray-200">{idea.title}</h4>
        <div className="flex shrink-0 items-center gap-2">
          {idea.estimated_effort && (
            <span
              className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium ${
                EFFORT_COLORS[idea.estimated_effort] ?? "bg-gray-700 text-gray-300 border-gray-600"
              }`}
            >
              {idea.estimated_effort}
            </span>
          )}
          {idea.status === "converted" && (
            <span className="inline-flex items-center rounded bg-blue-900/50 border border-blue-700 px-2 py-0.5 text-xs font-medium text-blue-300">
              converted
            </span>
          )}
          {idea.status === "dismissed" && (
            <span className="inline-flex items-center rounded bg-gray-700 border border-gray-600 px-2 py-0.5 text-xs font-medium text-gray-400">
              dismissed
            </span>
          )}
        </div>
      </div>

      {/* Description (collapsible) */}
      <p className="mt-2 whitespace-pre-line text-sm text-gray-400">{visibleDescription}</p>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          {expanded ? "Show less" : "Show more"}
        </button>
      )}

      {/* Rationale */}
      {idea.rationale && (
        <p className="mt-2 text-xs italic text-gray-500">{idea.rationale}</p>
      )}

      {/* Affected files */}
      {affectedFiles.length > 0 && (
        <div className="mt-3">
          <span className="text-xs font-medium text-gray-500">Affected files</span>
          <div className="mt-1 flex flex-wrap gap-1">
            {affectedFiles.map((file) => (
              <span
                key={file}
                className="inline-block rounded bg-gray-900 px-2 py-0.5 text-xs font-mono text-gray-400"
              >
                {file}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      {!isInactive && (
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            disabled={converting}
            onClick={handleConvert}
            className="inline-flex items-center gap-1.5 rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <ArrowRight size={14} />
            {converting ? "Converting..." : "Convert to Task"}
          </button>
          <button
            type="button"
            disabled={dismissing}
            onClick={handleDismiss}
            className="inline-flex items-center gap-1.5 rounded border border-gray-600 bg-gray-700 px-3 py-1.5 text-xs font-medium text-gray-300 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <X size={14} />
            {dismissing ? "Dismissing..." : "Dismiss"}
          </button>
        </div>
      )}
    </div>
  );
}
