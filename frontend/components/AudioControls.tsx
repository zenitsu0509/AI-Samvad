"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Props = {
  sessionId: string;
  question: string;
  backendUrl: string;
  onTranscribed: (text: string) => void;
};

export default function AudioControls({ sessionId, question, backendUrl, onTranscribed }: Props) {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const [recording, setRecording] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [voice, setVoice] = useState<string>("");

  const speak = useCallback(async () => {
    try {
      setSpeaking(true);
      const form = new FormData();
      form.append("text", question);
      if (voice) form.append("voice", voice);
      const res = await fetch(`${backendUrl}/api/text-to-speech`, { method: "POST", body: form });
      if (!res.ok) throw new Error(`TTS failed: ${res.status}`);
      const data = await res.json();
      const audio = new Audio(data.audio_data);
      audio.onended = () => setSpeaking(false);
      await audio.play();
    } catch (e) {
      console.error(e);
      setSpeaking(false);
    }
  }, [backendUrl, question, voice]);

  // Removed auto-speak on mount to avoid browser autoplay restrictions.

  const start = async () => {
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
  };

  const stop = () => {
    const mr = mediaRecorderRef.current;
    if (!mr) return;
    mr.stop();
    mr.stream.getTracks().forEach((t) => t.stop());
    setRecording(false);
  };

  return (
    <div className="flex items-center gap-3 mt-4">
      <button
        className={`px-4 py-2 rounded ${speaking ? "bg-gray-600" : "bg-indigo-600 hover:bg-indigo-700"}`}
        disabled={speaking}
        onClick={speak}
      >
        {speaking ? "Speaking..." : "Speak question"}
      </button>
      {!recording ? (
        <button className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-700" onClick={start}>Record answer</button>
      ) : (
        <button className="px-4 py-2 rounded bg-rose-600 hover:bg-rose-700" onClick={stop}>Stop</button>
      )}
    </div>
  );
}
