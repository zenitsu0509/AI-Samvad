"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

export default function InterviewResultPage() {
  const params = useSearchParams();
  const sessionId = params.get("session_id");

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [result, setResult] = useState<any | null>(null);
  const [answers, setAnswers] = useState<string[] | null>(null);
  const [questions, setQuestions] = useState<string[] | null>(null);
  const [skipped, setSkipped] = useState<number[]>([]);

  useEffect(() => {
    if (!mounted || !sessionId) return;
    try {
      const rRaw = sessionStorage.getItem(`interview:result:${sessionId}`);
      const aRaw = sessionStorage.getItem(`interview:answers:${sessionId}`);
      const qRaw = sessionStorage.getItem(`interview:${sessionId}`);
      const sRaw = sessionStorage.getItem(`interview:skipped:${sessionId}`);
      setResult(rRaw ? JSON.parse(rRaw) : null);
      setAnswers(aRaw ? JSON.parse(aRaw) : null);
      const qData = qRaw ? JSON.parse(qRaw) : null;
      setQuestions(Array.isArray(qData?.questions) ? qData.questions : null);
      setSkipped(sRaw ? (JSON.parse(sRaw) as number[]) : []);
    } catch {
      setResult(null);
      setAnswers(null);
      setQuestions(null);
      setSkipped([]);
    }
  }, [mounted, sessionId]);

  const totalScore: number = result?.total_score ?? result?.overall_score ?? 0;

  const rows = useMemo(() => {
    const qs = questions || [];
    const as = answers || [];
    const rs: Array<{ question: string; answer: string; score?: number; feedback?: string; skipped?: boolean }> = [];
    const resp = (result?.responses || []) as Array<any>;
    for (let i = 0; i < Math.max(qs.length, as.length, resp.length); i++) {
      rs.push({
        question: qs[i] ?? "",
        answer: as[i] ?? "",
        score: resp[i]?.score,
        feedback: resp[i]?.feedback,
        skipped: skipped.includes(i),
      });
    }
    return rs;
  }, [questions, answers, result, skipped]);

  if (!mounted) return null;
  if (!sessionId) return <div className="min-h-screen bg-gray-900 text-white p-6">Invalid session.</div>;

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold">Interview Results</h1>
          <div className="flex items-center gap-3">
            <div className="text-xl">Total Score: <span className="font-semibold">{totalScore}</span></div>
            {skipped.length > 0 && (
              <div className="text-sm rounded px-2 py-1 bg-red-900/40 border border-red-600 text-red-200">
                Skipped: {skipped.length}
              </div>
            )}
          </div>
        </div>

        {/* Suggestions / Summary */}
        <div className="rounded-lg bg-gray-800 border border-gray-700 p-4 mb-6">
          <h2 className="text-lg font-semibold mb-2">Suggestions</h2>
          <ul className="list-disc pl-6 text-gray-300 space-y-1">
            <li>
              Focus on clarity and conciseness. Practice summarizing complex ideas in 2–3 sentences.
            </li>
            <li>
              When answering, structure with a brief approach, key steps, and a short example.
            </li>
            <li>
              Review areas with lower scores below and revisit the related concepts.
            </li>
            {skipped.length > 0 && (
              <li className="text-red-300">
                {skipped.length} question{skipped.length > 1 ? "s" : ""} were auto-skipped because you weren’t looking at the screen. For best results, keep your eyes on the screen during the interview.
              </li>
            )}
          </ul>
        </div>

        {/* Per-question breakdown */}
        <div className="space-y-4">
          {rows.length === 0 ? (
            <div className="text-gray-300">No responses found.</div>
          ) : (
            rows.map((r, i) => (
              <div key={i} className="rounded-lg bg-gray-800 border border-gray-700 p-4">
                <div className="text-sm text-gray-400 mb-1">Question {i + 1}</div>
                <div className="font-medium mb-2">{r.question}</div>
                {r.skipped && (
                  <div className="mb-2 inline-block rounded px-2 py-1 text-xs bg-red-900/40 border border-red-600 text-red-200">Skipped (not looking at screen)</div>
                )}
                <div className="text-gray-300">
                  <span className="text-gray-400">Your answer:</span>
                  <div className="mt-1 whitespace-pre-wrap bg-gray-900 border border-gray-700 rounded p-2 text-gray-200">
                    {r.answer || "(No answer)"}
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
                  {typeof r.score === "number" && (
                    <div>Score: <span className="font-semibold">{r.score}</span></div>
                  )}
                  {r.feedback && (
                    <div className="text-gray-300">Feedback: {r.feedback}</div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="mt-6 flex items-center gap-2">
          <button
            className="px-4 py-2 bg-gray-700 rounded"
            onClick={() => {
              try {
                if (sessionId) {
                  sessionStorage.removeItem(`interview:${sessionId}`);
                  sessionStorage.removeItem(`interview:result:${sessionId}`);
                  sessionStorage.removeItem(`interview:answers:${sessionId}`);
                  sessionStorage.removeItem(`interview:timer:${sessionId}`);
                  sessionStorage.removeItem(`interview:timerMeta:${sessionId}`);
                  sessionStorage.removeItem(`interview:skipped:${sessionId}`);
                }
              } catch {}
              window.location.href = "/";
            }}
          >
            Back to Home
          </button>
        </div>
      </div>
    </div>
  );
}
