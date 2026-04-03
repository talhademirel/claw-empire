import { CheckCircle, ListTodo, Loader } from "lucide-react";

export interface AutoTaskProgressProps {
  phase: string;
  progress: number;
  taskCount: number;
  tasks?: unknown[];
  isComplete: boolean;
  summary?: string;
}

const PHASE_LABELS: Record<string, string> = {
  collecting_context: "Collecting project files...",
  analyzing: "AI analyzing project...",
  generating_tasks: "Generating tasks...",
  parsing_results: "Processing results...",
  done: "Complete!",
};

function getPhaseLabel(phase: string): string {
  return PHASE_LABELS[phase] ?? phase;
}

export default function AutoTaskProgress({
  phase,
  progress,
  taskCount,
  isComplete,
  summary,
}: AutoTaskProgressProps) {
  const clampedProgress = Math.min(100, Math.max(0, progress));

  return (
    <div className="space-y-3">
      {/* Phase label and task count */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isComplete ? (
            <CheckCircle className="h-4 w-4 text-emerald-400" />
          ) : (
            <Loader className="h-4 w-4 animate-spin text-indigo-400" />
          )}
          <span className="text-sm font-medium text-gray-200">
            {getPhaseLabel(phase)}
          </span>
        </div>
        {taskCount > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-indigo-500/20 px-2.5 py-0.5 text-xs font-medium text-indigo-300">
            <ListTodo className="h-3 w-3" />
            {taskCount} {taskCount === 1 ? "task" : "tasks"}
          </span>
        )}
      </div>

      {/* Progress bar */}
      <div className="h-2 w-full overflow-hidden rounded-full bg-gray-700">
        <div
          className="h-full rounded-full bg-indigo-500 transition-all duration-500 ease-out"
          style={{ width: `${clampedProgress}%` }}
        />
      </div>

      {/* Percentage */}
      <p className="text-right text-xs text-gray-400">
        {Math.round(clampedProgress)}%
      </p>

      {/* Summary when complete */}
      {isComplete && summary && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
          {summary}
        </div>
      )}
    </div>
  );
}
