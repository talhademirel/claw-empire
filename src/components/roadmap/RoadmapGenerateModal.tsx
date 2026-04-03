import { useCallback, useEffect, useRef, useState } from "react";
import { Map, X } from "lucide-react";
import { generateRoadmapSSE, getRoadmap } from "../../api/organization-projects";

interface RoadmapGenerateModalProps {
  projectId: string;
  isOpen: boolean;
  onClose: () => void;
  onComplete?: () => void;
}

// Staggered log lines per phase — fired with delays to feel like real analysis
const PHASE_SCRIPTS: Record<string, Array<{ delay: number; text: string; color?: string }>> = {
  collecting_context: [
    { delay: 0,   text: "Scanning project directory..." },
    { delay: 400, text: "Reading package.json..." },
    { delay: 800, text: "Parsing README.md and CLAUDE.md..." },
    { delay: 1200, text: "Building file tree..." },
  ],
  discovery: [
    { delay: 0,    text: "Analyzing tech stack and dependencies..." },
    { delay: 600,  text: "Identifying target audience..." },
    { delay: 1400, text: "Mapping existing feature coverage..." },
    { delay: 2400, text: "Detecting product gaps and weaknesses..." },
    { delay: 3600, text: "Formulating product vision..." },
  ],
  generating_features: [
    { delay: 0,    text: "Brainstorming feature ideas from gaps..." },
    { delay: 800,  text: "Scoring features by user impact..." },
    { delay: 1800, text: "Estimating effort levels..." },
    { delay: 2800, text: "Assigning roadmap phases (1–4)..." },
    { delay: 3800, text: "Resolving feature dependencies..." },
    { delay: 4800, text: "Finalizing feature list..." },
  ],
  saving_features: [
    { delay: 0,   text: "Writing features to roadmap..." },
    { delay: 500, text: "Indexing roadmap entries..." },
  ],
  done: [
    { delay: 0, text: "Roadmap generation complete!", color: "text-emerald-400" },
  ],
};

type LogLine = { text: string; color?: string };

export default function RoadmapGenerateModal({
  projectId,
  isOpen,
  onClose,
  onComplete,
}: RoadmapGenerateModalProps) {
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [featureCount, setFeatureCount] = useState(0);
  const [discoveryResult, setDiscoveryResult] = useState<{
    target_audience?: string;
    product_vision?: string;
  } | null>(null);
  const [error, setError] = useState("");
  const [hasExisting, setHasExisting] = useState(false);
  const [done, setDone] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const timerRefs = useRef<ReturnType<typeof setTimeout>[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  // Auto-scroll logs
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs]);

  const clearTimers = () => {
    timerRefs.current.forEach(clearTimeout);
    timerRefs.current = [];
  };

  const firePhaseScript = (phase: string) => {
    const script = PHASE_SCRIPTS[phase];
    if (!script) return;
    script.forEach(({ delay, text, color }) => {
      const t = setTimeout(() => {
        setLogs((prev) => [...prev, { text, color }]);
      }, delay);
      timerRefs.current.push(t);
    });
  };

  // Reset on open
  useEffect(() => {
    if (!isOpen) return;
    clearTimers();
    setDone(false);
    setError("");
    setLogs([]);
    setProgress(0);
    setFeatureCount(0);
    setDiscoveryResult(null);
    setGenerating(false);

    getRoadmap(projectId)
      .then((data) => setHasExisting(data.features.length > 0))
      .catch(() => setHasExisting(false));
  }, [isOpen, projectId]);

  useEffect(() => {
    return () => {
      clearTimers();
      abortRef.current?.abort();
    };
  }, []);

  const handleGenerate = useCallback(() => {
    clearTimers();
    setGenerating(true);
    setError("");
    setDone(false);
    setLogs([]);
    setProgress(0);

    firePhaseScript("collecting_context");

    const controller = generateRoadmapSSE(projectId, {
      onProgress: (data) => {
        setProgress(data.progress);
        if (data.phase !== "collecting_context") {
          firePhaseScript(data.phase);
        }
      },
      onDone: (data) => {
        clearTimers();
        setDone(true);
        setGenerating(false);
        setProgress(100);
        setFeatureCount(data.feature_count);
        if (data.discovery && typeof data.discovery === "object") {
          const d = data.discovery as Record<string, unknown>;
          setDiscoveryResult({
            target_audience: typeof d.target_audience === "string" ? d.target_audience : undefined,
            product_vision: typeof d.product_vision === "string" ? d.product_vision : undefined,
          });
        }
        firePhaseScript("done");
        if (data.feature_count > 0) {
          setTimeout(() => {
            setLogs((prev) => [
              ...prev,
              { text: `${data.feature_count} features written across roadmap phases.`, color: "text-blue-400" },
            ]);
          }, 300);
        }
        onComplete?.();
      },
      onError: (err) => {
        clearTimers();
        setError(err);
        setGenerating(false);
        setLogs((prev) => [...prev, { text: `ERROR: ${err}`, color: "text-red-400" }]);
      },
    });

    abortRef.current = controller;
  }, [projectId, onComplete]);

  const handleClose = () => {
    if (generating) {
      clearTimers();
      abortRef.current?.abort();
      setGenerating(false);
    }
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-lg mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <Map className="w-5 h-5 text-blue-400" />
            <h3 className="text-base font-semibold text-white">Generate Roadmap</h3>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="text-gray-500 hover:text-gray-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          {/* Warning for existing roadmap */}
          {hasExisting && !generating && !done && (
            <div className="text-xs text-yellow-400 bg-yellow-900/20 border border-yellow-800/50 rounded-md px-3 py-2">
              This will regenerate the entire roadmap. Existing features will be replaced.
            </div>
          )}

          {/* Terminal */}
          {(generating || done || logs.length > 0) && (
            <div
              ref={logRef}
              className="rounded-lg bg-black/80 border border-gray-800 p-3 font-mono text-[11px] leading-relaxed max-h-52 overflow-y-auto"
            >
              {logs.map((line, i) => (
                <p key={i} className={line.color ?? "text-green-400"}>
                  <span className="text-gray-600 select-none mr-1.5">$</span>
                  {line.text}
                </p>
              ))}
              {generating && (
                <p className="text-green-400">
                  <span className="text-gray-600 select-none mr-1.5">$</span>
                  <span className="animate-pulse">▋</span>
                </p>
              )}
            </div>
          )}

          {/* Progress bar */}
          {(generating || done) && (
            <div className="space-y-1">
              <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-[10px] text-gray-600 text-right">{Math.round(progress)}%</p>
            </div>
          )}

          {/* Discovery summary */}
          {done && discoveryResult && (
            <div className="space-y-2 bg-gray-800/50 rounded-md p-3 border border-gray-700/50">
              {discoveryResult.target_audience && (
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-0.5">Target Audience</p>
                  <p className="text-xs text-gray-300">{discoveryResult.target_audience}</p>
                </div>
              )}
              {discoveryResult.product_vision && (
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-0.5">Product Vision</p>
                  <p className="text-xs text-gray-300">{discoveryResult.product_vision}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-800">
          {done ? (
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 text-white rounded-md transition-colors"
            >
              Close
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-1.5 text-sm text-gray-400 hover:text-gray-200 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleGenerate}
                disabled={generating}
                className="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-md transition-colors"
              >
                {generating ? "Generating..." : "Generate"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
