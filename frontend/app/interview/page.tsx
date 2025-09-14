"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import AudioControls from "@/components/AudioControls";
import CameraPreview from "@/components/CameraPreview";

export default function InterviewPage() {
  const params = useSearchParams();
  const sessionId = params.get("session_id");

  // Ensure we don't render differing content between server and client
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Load session data only on client after mount to avoid SSR mismatch
  const [initialData, setInitialData] = useState<{
    questions: string[];
    domain?: string;
    total_questions?: number;
  } | null>(null);

  useEffect(() => {
    if (!mounted) return;
    if (!sessionId) return;
    try {
      const raw = sessionStorage.getItem(`interview:${sessionId}`);
      setInitialData(raw ? JSON.parse(raw) : { questions: [], domain: undefined });
    } catch {
      setInitialData({ questions: [], domain: undefined });
    }
  }, [mounted, sessionId]);

  const [idx, setIdx] = useState(0);
  const [transcripts, setTranscripts] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Track local submit state and a finished flag; results are shown on a dedicated page
  const [finished, setFinished] = useState(false);
  // Permissions gate: require both camera and microphone
  const [permChecked, setPermChecked] = useState(false);
  const [permOk, setPermOk] = useState(false);
  const [permDetail, setPermDetail] = useState<{ camera: "granted" | "denied" | "prompt"; mic: "granted" | "denied" | "prompt" }>({ camera: "prompt", mic: "prompt" });
  const questionsRaw: string[] = initialData?.questions ?? [];
  const domain: string | undefined = initialData?.domain;
  const durationMinutes: number | undefined = (initialData as any)?.duration_minutes;
  const requestedNum: number | undefined = (initialData as any)?.num_questions;
  const buildQuestions = (base: string[], count?: number): string[] => {
    const target = Math.max(0, count ?? base.length);
    if (base.length === 0) return [];
    if (target <= base.length) return base.slice(0, target);
    const out: string[] = [];
    for (let i = 0; i < target; i++) out.push(base[i % base.length]);
    return out;
  };
  const questions: string[] = buildQuestions(questionsRaw, requestedNum);
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";
  const DOMAIN_LABELS: Record<string, string> = {
    nlp: "Natural Language Processing (NLP)",
    cv: "Computer Vision",
    diffusion: "Diffusion Models",
    ml: "Machine Learning",
    dl: "Deep Learning",
    rl: "Reinforcement Learning",
    "data-science": "Data Science",
    "web-dev": "Web Development",
  };
  const domainLabel = domain ? DOMAIN_LABELS[domain] ?? domain : "";

  // Choose a motivational quote (client-only UI feedback during submission). Keep hooks before early returns.
  const quotes = useMemo(
    () => [
      "Every interview is a step closer—keep going!",
      "Believe in your preparation. You’ve got this!",
      "Growth happens outside the comfort zone—great work today.",
      "Your effort today builds tomorrow’s opportunity.",
      "Stay curious, stay confident. Good luck!",
    ],
    []
  );
  const quote = useMemo(() => quotes[Math.floor(Math.random() * quotes.length)], [quotes]);

  useEffect(() => {
    if (!mounted) return;
    if (!sessionId) {
      window.location.href = "/";
    }
  }, [mounted, sessionId]);

  // Check permissions using Permissions API when available (non-blocking, no prompt)
  useEffect(() => {
    if (!mounted) return;
    let cancelled = false;
    const run = async () => {
      try {
        const hasPermApi = typeof navigator !== "undefined" && (navigator as any).permissions && typeof (navigator as any).permissions.query === "function";
        if (hasPermApi) {
          const statuses: any = {};
          try {
            const mic = await (navigator as any).permissions.query({ name: "microphone" as any });
            statuses.mic = mic.state as "granted" | "denied" | "prompt";
            mic.onchange = () => {
              // Re-check when user toggles
              run();
            };
          } catch {}
          try {
            const cam = await (navigator as any).permissions.query({ name: "camera" as any });
            statuses.camera = cam.state as "granted" | "denied" | "prompt";
            cam.onchange = () => {
              run();
            };
          } catch {}
          const micState = (statuses.mic ?? "prompt") as "granted" | "denied" | "prompt";
          const camState = (statuses.camera ?? "prompt") as "granted" | "denied" | "prompt";
          if (!cancelled) {
            setPermDetail({ mic: micState, camera: camState });
            setPermOk(micState === "granted" && camState === "granted");
            setPermChecked(true);
          }
          return;
        }
      } catch {}
      if (!cancelled) setPermChecked(true);
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [mounted]);

  // Actively request both permissions when user clicks
  const requestPermissions = async () => {
    try {
      // Request both together; if it fails, try individually to inform detail
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      try { stream.getTracks().forEach(t => t.stop()); } catch {}
      setPermDetail({ mic: "granted", camera: "granted" });
      setPermOk(true);
      setPermChecked(true);
    } catch {
      // Probe individually to know which failed
      let mic: "granted" | "denied" | "prompt" = "denied";
      let camera: "granted" | "denied" | "prompt" = "denied";
      try {
        const a = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        try { a.getTracks().forEach(t => t.stop()); } catch {}
        mic = "granted";
      } catch (e) {
        mic = "denied";
      }
      try {
        const v = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
        try { v.getTracks().forEach(t => t.stop()); } catch {}
        camera = "granted";
      } catch (e) {
        camera = "denied";
      }
      setPermDetail({ mic, camera });
      setPermOk(mic === "granted" && camera === "granted");
      setPermChecked(true);
    }
  };

  const setTranscriptForCurrent = (text: string) => {
    setTranscripts((prev) => {
      const next = prev.slice();
      next[idx] = text;
      return next;
    });
  };

  const onFinish = async () => {
    if (!sessionId) return;
    setFinished(true);
    setSubmitting(true);
    setSubmitError(null);
    // Show a short overlay/animation while evaluating
    const MIN_DELAY_MS = 1800;
    const startTs = Date.now();
    try {
      // Pad answers to match questions length to satisfy backend contract
      const answers = questions.map((_, i) => transcripts[i] ?? "");
      const res = await fetch(`${backendUrl}/api/interview/submit-all`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, answers, questions, domain }),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || `HTTP ${res.status}`);
      }
      const data = await res.json();
      const r = data?.result;
      if (typeof window !== "undefined") {
        sessionStorage.setItem(`interview:result:${sessionId}`, JSON.stringify(r));
        sessionStorage.setItem(`interview:answers:${sessionId}`, JSON.stringify(answers));
        try {
          sessionStorage.removeItem(`interview:timer:${sessionId}`);
          sessionStorage.removeItem(`interview:timerMeta:${sessionId}`);
        } catch {}
        // Ensure a small minimum delay so the submit overlay is visible even if backend is fast
        const elapsed = Date.now() - startTs;
        if (elapsed < MIN_DELAY_MS) {
          await new Promise((r) => setTimeout(r, MIN_DELAY_MS - elapsed));
        }
        // Navigate to results landing page
        window.location.href = `/interview/result?session_id=${encodeURIComponent(sessionId)}`;
      }
    } catch (e: any) {
      setSubmitError(e?.message || String(e));
    } finally {
      setSubmitting(false);
    }
  };

  // Global countdown timer across interview
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!mounted || !sessionId) return;
    if (!permOk) return; // Don't start timer until permissions are granted
    // initialize or reset timer based on meta (duration)
    try {
      const key = `interview:timer:${sessionId}`;
      const metaKey = `interview:timerMeta:${sessionId}`;
      const metaRaw = sessionStorage.getItem(metaKey);
      const expectedSecs = Math.max(0, Math.floor((durationMinutes ?? 0) * 60));
      let resetNeeded = false;
      if (!metaRaw) {
        resetNeeded = true;
      } else {
        try {
          const meta = JSON.parse(metaRaw);
          if (meta?.duration_minutes !== durationMinutes) resetNeeded = true;
        } catch {
          resetNeeded = true;
        }
      }
      if (resetNeeded) {
        if (expectedSecs > 0) {
          setSecondsLeft(expectedSecs);
          sessionStorage.setItem(key, String(expectedSecs));
          sessionStorage.setItem(metaKey, JSON.stringify({ duration_minutes: durationMinutes, startedAt: Date.now() }));
        } else {
          setSecondsLeft(null);
          sessionStorage.removeItem(key);
          sessionStorage.removeItem(metaKey);
        }
      } else {
        const stored = sessionStorage.getItem(key);
        setSecondsLeft(stored ? (parseInt(stored) || 0) : (expectedSecs > 0 ? expectedSecs : null));
      }
    } catch {}
  }, [mounted, sessionId, durationMinutes, permOk]);

  const [autoSubmitted, setAutoSubmitted] = useState(false);

  useEffect(() => {
    if (secondsLeft === null) return;
    if (secondsLeft <= 0) {
      // Auto-submit when time is up (only once)
      if (!autoSubmitted && !submitting) {
        setAutoSubmitted(true);
        onFinish();
      }
      return;
    }
    if (!permOk) return; // don't tick if permissions not granted
    const id = setInterval(() => {
      setSecondsLeft((s) => {
        const v = (s ?? 0) - 1;
        try {
          if (sessionId) sessionStorage.setItem(`interview:timer:${sessionId}`, String(Math.max(0, v)));
        } catch {}
        return v;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [secondsLeft, sessionId, autoSubmitted, submitting, permOk]);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
  };

  // Avoid hydration mismatch: don't render until mounted and data loaded
  if (!mounted) return null;
  if (!sessionId) return null;
  if (!initialData) {
    return (
      <div className="min-h-screen bg-gray-900 text-white p-6">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-2xl font-bold mb-4">Loading interview…</h1>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6">
      <div className="w-full max-w-5xl mx-auto">
        <h1 className="text-2xl font-bold mb-4">
          Interview - <span suppressHydrationWarning>{domainLabel}</span>
        </h1>
        {questions.length === 0 ? (
          <p className="text-gray-300">No questions found. Please restart.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Left column: sticky camera container */}
            <aside className="self-start md:sticky md:top-20">
              <CameraPreview inline fill height={220} disabled={!permOk || finished || submitting || (secondsLeft !== null && secondsLeft <= 0)} />
            </aside>

            {/* Right column: interview content */}
            <main className="relative">
              {/* Corner countdown timer */}
              {secondsLeft !== null && (
                <div className="absolute top-0 right-0 m-2 px-3 py-1 rounded bg-black/60 border border-gray-700 text-sm font-mono">
                  {formatTime(Math.max(0, secondsLeft))}
                </div>
              )}

              <div className="space-y-4">
                <div className="p-4 rounded-lg bg-gray-800 border border-gray-700">
                  <div className="text-sm text-gray-400 mb-1">
                    Question {idx + 1} of {questions.length}
                  </div>
                  <div className="text-lg mb-3">{questions[idx]}</div>

                  {/* Audio controls: speak + record/stop */}
                  <AudioControls
                    sessionId={sessionId}
                    question={questions[idx]}
                    backendUrl={backendUrl}
                    onTranscribed={setTranscriptForCurrent}
                    disabled={!permOk || finished || submitting || (secondsLeft !== null && secondsLeft <= 0)}
                  />

                  {/* Read-only transcript box */}
                  {transcripts[idx] && (
                    <div className="mt-4">
                      <label className="block text-sm text-gray-400 mb-1">You said (transcribed)</label>
                      <textarea
                        className="w-full bg-gray-900 border border-gray-700 rounded p-3 text-gray-200"
                        value={transcripts[idx]}
                        readOnly
                        rows={4}
                      />
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    className="px-4 py-2 bg-gray-700 rounded disabled:opacity-50"
                    onClick={() => setIdx((i) => Math.max(0, i - 1))}
                    disabled={!permOk || idx === 0}
                  >
                    Previous
                  </button>
                  <button
                    className="px-4 py-2 bg-blue-600 rounded disabled:opacity-50"
                    onClick={() => setIdx((i) => Math.min(questions.length - 1, i + 1))}
                    disabled={!permOk || idx >= questions.length - 1}
                  >
                    Next
                  </button>
                  <button
                    className="ml-auto px-4 py-2 bg-green-600 rounded disabled:opacity-50"
                    onClick={onFinish}
                    disabled={!permOk || submitting}
                  >
                    {submitting ? "Submitting..." : "Finish Interview"}
                  </button>
                </div>

                {submitError && (
                  <div className="mt-3 text-sm text-red-400">
                    {submitError}
                    {submitError.includes("Session not found") && (
                      <div className="mt-2">
                        <button
                          className="px-3 py-1 bg-gray-700 rounded"
                          onClick={() => {
                            try {
                              if (typeof window !== "undefined" && sessionId) {
                                sessionStorage.removeItem(`interview:${sessionId}`);
                                sessionStorage.removeItem(`interview:result:${sessionId}`);
                                sessionStorage.removeItem(`interview:timer:${sessionId}`);
                                sessionStorage.removeItem(`interview:timerMeta:${sessionId}`);
                              }
                            } catch {}
                            window.location.href = "/";
                          }}
                        >
                          Restart interview
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Removed inline results; results are shown on a dedicated page */}
              </div>
            </main>
          </div>
        )}
      </div>

      {/* Permissions gate overlay (blocks until granted) */}
      {mounted && !permOk && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="w-full max-w-lg rounded-xl border border-gray-700 bg-gray-900 p-6 text-center shadow-xl">
            <h2 className="text-xl font-semibold">Enable camera and microphone</h2>
            <p className="mt-2 text-gray-300">
              To start the interview, please grant access to your camera and microphone.
            </p>
            <ul className="mt-4 text-sm text-gray-400 space-y-1 text-left mx-auto max-w-sm">
              <li>Camera: <span className={permDetail.camera === "granted" ? "text-emerald-400" : permDetail.camera === "denied" ? "text-red-400" : "text-yellow-400"}>{permDetail.camera}</span></li>
              <li>Microphone: <span className={permDetail.mic === "granted" ? "text-emerald-400" : permDetail.mic === "denied" ? "text-red-400" : "text-yellow-400"}>{permDetail.mic}</span></li>
            </ul>
            <div className="mt-5 flex items-center justify-center gap-3">
              <button onClick={requestPermissions} className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-500">Enable now</button>
            </div>
            <div className="mt-3 text-xs text-gray-500">
              If permissions are blocked in your browser, click the lock icon in the address bar to allow access and reload.
            </div>
          </div>
        </div>
      )}

      {/* Submitting overlay with motivational quote */}
      {submitting && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="w-full max-w-md rounded-xl border border-gray-700 bg-gray-900 p-6 text-center shadow-xl">
            <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent" />
            <div className="text-lg font-semibold">Evaluating your interview…</div>
            <div className="mt-2 text-gray-300">This usually takes a few seconds.</div>
            <div className="mt-4 italic text-emerald-300">{quote}</div>
          </div>
        </div>
      )}
    </div>
  );
}
