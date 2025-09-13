"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import AudioControls from "@/components/AudioControls";

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
  const [result, setResult] = useState<{
    total_score: number;
    responses: Array<{ question: string; score: number; feedback?: string }>;
  } | null>(null);
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

  useEffect(() => {
    if (!mounted) return;
    if (!sessionId) {
      window.location.href = "/";
    }
  }, [mounted, sessionId]);

  const setTranscriptForCurrent = (text: string) => {
    setTranscripts((prev) => {
      const next = prev.slice();
      next[idx] = text;
      return next;
    });
  };

  const onFinish = async () => {
    if (!sessionId) return;
    setSubmitting(true);
    setSubmitError(null);
    setResult(null);
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
      setResult({
        total_score: r?.total_score ?? 0,
        responses: (r?.responses || []).map((x: any) => ({
          question: x.question,
          score: x.score,
          feedback: x.feedback,
        })),
      });
      // Optionally persist
      if (typeof window !== "undefined") {
        sessionStorage.setItem(`interview:result:${sessionId}`, JSON.stringify(r));
        try {
          sessionStorage.removeItem(`interview:timer:${sessionId}`);
          sessionStorage.removeItem(`interview:timerMeta:${sessionId}`);
        } catch {}
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
  }, [mounted, sessionId, durationMinutes]);

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
  }, [secondsLeft, sessionId, autoSubmitted, submitting]);

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
      <div className="max-w-3xl mx-auto relative">
        {/* Corner countdown timer */}
        {secondsLeft !== null && (
          <div className="absolute top-0 right-0 m-2 px-3 py-1 rounded bg-black/60 border border-gray-700 text-sm font-mono">
            {formatTime(Math.max(0, secondsLeft))}
          </div>
        )}
        <h1 className="text-2xl font-bold mb-4">
          Interview - <span suppressHydrationWarning>{domainLabel}</span>
        </h1>
        {questions.length === 0 ? (
          <p className="text-gray-300">No questions found. Please restart.</p>
        ) : (
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
                disabled={idx === 0}
              >
                Previous
              </button>
              <button
                className="px-4 py-2 bg-blue-600 rounded disabled:opacity-50"
                onClick={() => setIdx((i) => Math.min(questions.length - 1, i + 1))}
                disabled={idx >= questions.length - 1}
              >
                Next
              </button>
              <button
                className="ml-auto px-4 py-2 bg-green-600 rounded disabled:opacity-50"
                onClick={onFinish}
                disabled={submitting}
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

            {result && (
              <div className="mt-6 p-4 rounded-lg bg-gray-800 border border-gray-700">
                <div className="text-xl font-semibold">Your Score: {result.total_score}</div>
                <div className="mt-3 space-y-3">
                  {result.responses.map((r, i) => (
                    <div key={i} className="text-sm">
                      <div className="text-gray-400">Q{i + 1}: {r.question}</div>
                      <div>Score: <span className="font-medium">{r.score}</span></div>
                      {r.feedback && (
                        <div className="text-gray-300">Feedback: {r.feedback}</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
