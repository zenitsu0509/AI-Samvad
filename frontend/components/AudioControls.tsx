"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Props = {
  sessionId: string;
  question: string;
  backendUrl: string;
  onTranscribed: (text: string) => void;
  disabled?: boolean; // when true, disallow speaking/recording and stop any active media
  autoSpeakKey?: string | number; // when changed, triggers auto TTS of the question
  lockRecord?: boolean; // when true, disallow starting a new recording (used after transcription)
  context?: { name?: string; index: number; total: number; domain?: string };
};

export default function AudioControls({ sessionId, question, backendUrl, onTranscribed, disabled = false, autoSpeakKey, lockRecord = false, context }: Props) {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const [recording, setRecording] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [voice, setVoice] = useState<string>("");
  const audioElRef = useRef<HTMLAudioElement | null>(null);

  // Mic visualization refs/state
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const dataArrayRef = useRef<Float32Array | null>(null);
  const rafRef = useRef<number | null>(null);
  const [level, setLevel] = useState(0); // 0..1 (RMS amplitude)
  const [pitchHz, setPitchHz] = useState<number | null>(null);

  const speak = useCallback(async () => {
    if (disabled) return;
    try {
      setSpeaking(true);
      // Try to fetch a short human-like preamble
      let preamble = "";
      try {
        const q = new URLSearchParams();
        if (sessionId) q.set("session_id", sessionId);
        if (context?.name) q.set("name", context.name);
        q.set("question_index", String(context?.index ?? 0));
        q.set("total_questions", String(context?.total ?? 1));
        if (context?.domain) q.set("domain", context.domain);
        const pre = await fetch(`${backendUrl}/api/interview/generate-preamble?${q.toString()}`);
        if (pre.ok) {
          const data = await pre.json();
          if (data?.preamble) preamble = String(data.preamble);
        }
      } catch {}

      const toSpeak = preamble ? `${preamble} ${question}` : `Hello${context?.name ? ' ' + context.name : ''}. ${question}`;

      const form = new FormData();
      form.append("text", toSpeak);
      if (voice) form.append("voice", voice);
      const res = await fetch(`${backendUrl}/api/text-to-speech`, { method: "POST", body: form });
      if (!res.ok) throw new Error(`TTS failed: ${res.status}`);
      const data = await res.json();
      const audio = new Audio(data.audio_data);
      audioElRef.current = audio;
      audio.onended = () => setSpeaking(false);
      await audio.play();
    } catch (e) {
      console.error(e);
      setSpeaking(false);
    }
  }, [backendUrl, question, voice, disabled, context, sessionId]);

  // Auto-speak when the parent signals (typically after a user gesture like Next or enabling permissions)
  useEffect(() => {
    if (autoSpeakKey === undefined) return;
    if (disabled) return;
    // Don't interrupt if already speaking or recording
    if (speaking || recording) return;
    speak();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSpeakKey]);

  const start = async () => {
    if (disabled) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
    const mr = new MediaRecorder(stream, { mimeType: mime });
    chunksRef.current = [];
    mr.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
    mr.onstop = async () => {
      const blob = new Blob(chunksRef.current, { type: mr.mimeType });
      const file = new File([blob], `rec.webm`, { type: mr.mimeType });
      const form = new FormData();
      form.append("audio_file", file);
      const res = await fetch(`${backendUrl}/api/speech-to-text`, { method: "POST", body: form });
      const data = await res.json();
      if (data?.transcription) onTranscribed(data.transcription);
    };
    mr.start();
    mediaRecorderRef.current = mr;
    setRecording(true);

    // Setup WebAudio analysis for live visualization (volume + pitch)
    const AC: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
    const ctx = new AC();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    const bufLen = analyser.fftSize;
  // Use explicit ArrayBuffer so the typed array is backed by ArrayBuffer (not SharedArrayBuffer)
  const buf = new Float32Array(new ArrayBuffer(bufLen * 4));

    audioCtxRef.current = ctx;
    analyserRef.current = analyser;
    micSourceRef.current = source;
    dataArrayRef.current = buf;

    const autoCorrelate = (timeDomain: Float32Array, sampleRate: number): number | null => {
      // A basic auto-correlation pitch detection. Returns Hz or null if no clear pitch.
      const SIZE = timeDomain.length;
      // Compute RMS to detect silence
      let rms = 0;
      for (let i = 0; i < SIZE; i++) rms += timeDomain[i] * timeDomain[i];
      rms = Math.sqrt(rms / SIZE);
      if (rms < 0.01) return null;

      // Trim leading/trailing silence
      let r1 = 0, r2 = SIZE - 1, thres = 0.2;
      for (let i = 0; i < SIZE / 2; i++) if (Math.abs(timeDomain[i]) < thres) { r1 = i; break; }
      for (let i = 1; i < SIZE / 2; i++) if (Math.abs(timeDomain[SIZE - i]) < thres) { r2 = SIZE - i; break; }
      const trimmed = timeDomain.slice(r1, r2);
      const newSize = trimmed.length;
      if (newSize < 2) return null;

      // Auto-correlation
      const c = new Array<number>(newSize).fill(0);
      for (let lag = 0; lag < newSize; lag++) {
        for (let i = 0; i < newSize - lag; i++) c[lag] += trimmed[i] * trimmed[i + lag];
      }
      let d = 0; while (c[d] > c[d + 1]) d++;
      let maxPos = d, maxVal = -1;
      for (let i = d; i < newSize; i++) {
        if (c[i] > maxVal) { maxVal = c[i]; maxPos = i; }
      }
      let T0 = maxPos;
      if (!T0) return null;
      // Parabolic interpolation for better precision
      const x1 = c[T0 - 1] || 0, x2 = c[T0], x3 = c[T0 + 1] || 0;
      const a = (x1 + x3 - 2 * x2) / 2;
      const b = (x3 - x1) / 2;
      if (a) T0 = T0 - b / (2 * a);
      const freq = sampleRate / T0;
      if (freq < 50 || freq > 1000) return null; // human voice typical range
      return freq;
    };

    const loop = () => {
      if (!analyserRef.current || !dataArrayRef.current || !audioCtxRef.current) return;
      const a = analyserRef.current;
      const arr = dataArrayRef.current;
  // TS DOM lib sometimes expects Float32Array<ArrayBuffer>; cast to satisfy signature
  a.getFloatTimeDomainData(arr as any);
      // RMS amplitude level 0..1
      let rms = 0;
      for (let i = 0; i < arr.length; i++) rms += arr[i] * arr[i];
      rms = Math.sqrt(rms / arr.length);
      // Smooth a bit
      setLevel((prev) => prev * 0.7 + rms * 0.3);
      // Pitch
      const hz = autoCorrelate(arr, audioCtxRef.current.sampleRate);
      setPitchHz(hz);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  };

  const stop = () => {
    const mr = mediaRecorderRef.current;
    if (!mr) return;
    mr.stop();
    mr.stream.getTracks().forEach((t) => t.stop());
    setRecording(false);

    // Cleanup visualization
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    try {
      micSourceRef.current?.disconnect();
    } catch {}
    try {
      analyserRef.current?.disconnect();
    } catch {}
    if (audioCtxRef.current) {
      // Close context to release mic processing
      audioCtxRef.current.close().catch(() => {});
    }
    audioCtxRef.current = null;
    analyserRef.current = null;
    micSourceRef.current = null;
    dataArrayRef.current = null;
    setLevel(0);
    setPitchHz(null);
  };

  // If disabled toggles on, immediately stop any active speaking/recording
  useEffect(() => {
    if (!disabled) return;
    // Stop recording if active
    if (recording) {
      try { stop(); } catch {}
    }
    // Stop speaking audio if playing
    try {
      if (speaking && audioElRef.current) {
        audioElRef.current.pause();
        audioElRef.current.currentTime = 0;
      }
    } catch {}
    setSpeaking(false);
  }, [disabled]);

  // Safety: cleanup on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      try { micSourceRef.current?.disconnect(); } catch {}
      try { analyserRef.current?.disconnect(); } catch {}
      if (audioCtxRef.current) audioCtxRef.current.close().catch(() => {});
      // stop any audio element
      try { audioElRef.current?.pause(); } catch {}
    };
  }, []);

  return (
    <div className="flex items-start gap-6 mt-4">
      <button
        className={`px-4 py-2 rounded ${speaking || disabled ? "bg-gray-600" : "bg-indigo-600 hover:bg-indigo-700"}`}
        disabled={speaking || disabled}
        onClick={speak}
      >
        {speaking ? "Speaking..." : "Speak question"}
      </button>
      <div className="flex flex-col items-start gap-2">
        {!recording ? (
          <button
            className={`px-4 py-2 rounded ${(disabled || lockRecord) ? "bg-gray-600" : "bg-emerald-600 hover:bg-emerald-700"}`}
            onClick={start}
            disabled={disabled || lockRecord}
          >
            Record answer
          </button>
        ) : (
          <button className="px-4 py-2 rounded bg-rose-600 hover:bg-rose-700" onClick={stop}>Stop</button>
        )}
        {recording && (
          <div className="w-64 select-none">
            <div className="text-xs text-gray-400 mb-1">Listening… {pitchHz ? `${Math.round(pitchHz)} Hz` : ""}</div>
            <div className="h-3 w-full bg-gray-800 rounded">
              <div
                className="h-3 rounded bg-emerald-500 transition-[width] duration-75"
                style={{ width: `${Math.min(100, Math.max(5, level * 160))}%` }}
              />
            </div>
            <div className="mt-2 flex items-end gap-1 h-6">
              {Array.from({ length: 12 }).map((_, i) => {
                const scale = Math.max(0.1, Math.min(1, level * 2 - i * 0.08));
                return (
                  <div
                    key={i}
                    className="w-2 bg-emerald-400/80"
                    style={{ height: `${scale * 24}px` }}
                  />
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
