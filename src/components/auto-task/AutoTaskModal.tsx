import { useCallback, useRef, useState } from "react";
import { Search, Sparkles, X, Zap } from "lucide-react";
import { analyzeProjectSSE } from "../../api/organization-projects";
import AutoTaskProgress from "./AutoTaskProgress";

export interface AutoTaskModalProps {
  projectId: string;
  projectName: string;
  isOpen: boolean;
  onClose: () => void;
  onTasksCreated?: () => void;
}

type AnalysisMode = "quick" | "deep";

interface ProgressState {
  phase: string;
  progress: number;
  taskCount: number;
  tasks: unknown[];
  isComplete: boolean;
  summary?: string;
}

const INITIAL_PROGRESS: ProgressState = {
  phase: "",
  progress: 0,
  taskCount: 0,
  tasks: [],
  isComplete: false,
};

export default function AutoTaskModal({
  projectId,
  projectName,
  isOpen,
  onClose,
  onTasksCreated,
}: AutoTaskModalProps) {
  const [mode, setMode] = useState<AnalysisMode>("quick");
  const [autoAssign, setAutoAssign] = useState(false);
  const [autoRun, setAutoRun] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [progress, setProgress] = useState<ProgressState>(INITIAL_PROGRESS);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const resetState = useCallback(() => {
    setIsAnalyzing(false);
    setProgress(INITIAL_PROGRESS);
    setError(null);
  }, []);

  const handleClose = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    resetState();
    onClose();
  }, [onClose, resetState]);

  const handleAnalyze = useCallback(() => {
    setIsAnalyzing(true);
    setError(null);
    setProgress(INITIAL_PROGRESS);

    const controller = analyzeProjectSSE(
      projectId,
      { mode, auto_assign: autoAssign, auto_run: autoRun },
      {
        onProgress(data) {
          setProgress((prev) => ({
            ...prev,
            phase: data.phase,
            progress: data.progress,
            taskCount: data.task_count,
          }));
        },
        onAnalysisComplete(data) {
          setProgress((prev) => ({
            ...prev,
            phase: "done",
            progress: 100,
            taskCount: data.task_count,
            tasks: data.tasks,
            isComplete: true,
            summary: data.summary,
          }));
        },
        onTasksCreated() {
          onTasksCreated?.();
        },
        onDone() {
          setIsAnalyzing(false);
          abortRef.current = null;
        },
        onError(err) {
          setError(err);
          setIsAnalyzing(false);
          abortRef.current = null;
        },
      },
    );

    abortRef.current = controller;
  }, [projectId, mode, autoAssign, autoRun, onTasksCreated]);

  if (!isOpen) return null;

  const showProgress = isAnalyzing || progress.isComplete;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={handleClose}
    >
      <div
        className="relative mx-4 w-full max-w-lg rounded-2xl border border-gray-700 bg-gray-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-700 px-6 py-4">
          <div className="flex items-center gap-3">
            <Sparkles className="h-5 w-5 text-indigo-400" />
            <div>
              <h2 className="text-lg font-bold text-white">Auto Task</h2>
              <p className="text-xs text-gray-400">{projectName}</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition hover:bg-gray-800 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-5 px-6 py-5">
          {!showProgress ? (
            <>
              {/* Mode selection */}
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-200">
                  Analysis Mode
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setMode("quick")}
                    className={`flex items-center gap-2 rounded-lg border px-4 py-3 text-sm transition ${
                      mode === "quick"
                        ? "border-indigo-500 bg-indigo-500/10 text-indigo-300"
                        : "border-gray-700 bg-gray-800 text-gray-300 hover:border-gray-600"
                    }`}
                  >
                    <Zap className="h-4 w-4" />
                    Quick
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode("deep")}
                    className={`flex items-center gap-2 rounded-lg border px-4 py-3 text-sm transition ${
                      mode === "deep"
                        ? "border-indigo-500 bg-indigo-500/10 text-indigo-300"
                        : "border-gray-700 bg-gray-800 text-gray-300 hover:border-gray-600"
                    }`}
                  >
                    <Search className="h-4 w-4" />
                    Deep
                  </button>
                </div>
              </div>

              {/* Toggle switches */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-200">Auto-assign to agents</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={autoAssign}
                    onClick={() => setAutoAssign((v) => !v)}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                      autoAssign ? "bg-indigo-500" : "bg-gray-600"
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
                        autoAssign ? "translate-x-5" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-200">Auto-run tasks</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={autoRun}
                    onClick={() => setAutoRun((v) => !v)}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                      autoRun ? "bg-indigo-500" : "bg-gray-600"
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
                        autoRun ? "translate-x-5" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>
              </div>

              {/* Error */}
              {error && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                  {error}
                </div>
              )}
            </>
          ) : (
            /* Progress view */
            <AutoTaskProgress
              phase={progress.phase}
              progress={progress.progress}
              taskCount={progress.taskCount}
              tasks={progress.tasks}
              isComplete={progress.isComplete}
              summary={progress.summary}
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-gray-700 px-6 py-4">
          <button
            type="button"
            onClick={handleClose}
            className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 transition hover:bg-gray-800 hover:text-white"
          >
            {progress.isComplete ? "Close" : "Cancel"}
          </button>
          {!showProgress && (
            <button
              type="button"
              onClick={handleAnalyze}
              disabled={isAnalyzing}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Sparkles className="h-4 w-4" />
              Analyze
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
