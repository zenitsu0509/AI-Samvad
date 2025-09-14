"use client";

import { useEffect, useRef, useState } from "react";

type CameraPreviewProps = {
  disabled?: boolean; // when true, release camera and hide feed
  inline?: boolean; // when true, render inline (no absolute positioning wrapper)
  width?: number; // pixel width for inline box
  height?: number; // pixel height for inline box
  side?: "left" | "right"; // when not inline, which side of the screen
  fill?: boolean; // when true and inline, expand to fill parent width with a fixed height
  // Attention detection (MediaPipe FaceMesh in browser)
  enableAttention?: boolean;
  awayThresholdMs?: number; // default 5000ms
  onAttentionChange?: (looking: boolean) => void;
  onAway?: () => void; // called when away duration exceeds threshold
  highlightWhenAway?: boolean; // toggles red border when not looking
};

/**
 * Lightweight camera preview for interview. Keeps a small live view visible.
 * TODO: In future, tap frames for cheat detection (e.g., face landmarks, gaze).
 */
export default function CameraPreview({ disabled = false, inline = false, width = 150, height = 150, side = "right", fill = false, enableAttention = false, awayThresholdMs = 5000, onAttentionChange, onAway, highlightWhenAway = true }: CameraPreviewProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [looking, setLooking] = useState<boolean>(true);
  const awayStartRef = useRef<number | null>(null);
  const awayTriggeredRef = useRef<boolean>(false);
  const rafDetectRef = useRef<number | null>(null);
  const faceMeshRef = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;
    const start = async () => {
      if (disabled) return;
      try {
        // Prefer user-facing camera where available
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setError(null);

        // Initialize attention detection if enabled
        if (enableAttention && videoRef.current) {
          try {
            // Load MediaPipe FaceMesh via CDN script if not already loaded
            const ensureScript = () => new Promise<void>((resolve, reject) => {
              if (typeof (window as any).faceMesh !== "undefined") return resolve();
              const existing = document.querySelector('script[data-mp="face_mesh"]') as HTMLScriptElement | null;
              if (existing) {
                existing.addEventListener('load', () => resolve(), { once: true });
                existing.addEventListener('error', () => reject(new Error('face_mesh script failed to load')), { once: true });
                return;
              }
              const s = document.createElement('script');
              s.src = 'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/face_mesh.js';
              s.async = true;
              s.defer = true;
              s.dataset.mp = 'face_mesh';
              s.onload = () => resolve();
              s.onerror = () => reject(new Error('face_mesh script failed to load'));
              document.head.appendChild(s);
            });

            await ensureScript();
            const FaceMeshCtor = (window as any).faceMesh?.FaceMesh || (window as any).FaceMesh?.FaceMesh || (window as any).FaceMesh;
            if (!FaceMeshCtor) throw new Error('FaceMesh constructor not found on window');
            const fm = new FaceMeshCtor({ locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}` });
            fm.setOptions({ maxNumFaces: 1, refineLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
            faceMeshRef.current = fm;

            let processing = false;
            const onResults = (results: any) => {
              processing = false;
              const list = results.multiFaceLandmarks?.[0];
              if (!list || !videoRef.current) {
                handleAttention(false);
                return;
              }
              const vw = videoRef.current.videoWidth || 640;
              const vh = videoRef.current.videoHeight || 480;
              const l = list[33];
              const r = list[263];
              const n = list[1];
              if (!l || !r || !n) {
                handleAttention(false);
                return;
              }
              const lx = l.x * vw; const rx = r.x * vw; const nx = n.x * vw;
              const midx = (lx + rx) / 2;
              const eyeDist = Math.max(1, Math.abs(rx - lx));
              const thresh = Math.max(30, eyeDist * 0.6); // threshold scaled by face size
              const isLooking = Math.abs(nx - midx) <= thresh;
              handleAttention(isLooking);
            };
            fm.onResults(onResults);

            const detectLoop = async () => {
              if (!faceMeshRef.current || !videoRef.current) return;
              if (!processing) {
                processing = true;
                try {
                  await faceMeshRef.current.send({ image: videoRef.current });
                } catch {
                  processing = false;
                }
              }
              rafDetectRef.current = requestAnimationFrame(detectLoop);
            };
            rafDetectRef.current = requestAnimationFrame(detectLoop);
          } catch (e) {
            // If module load fails, disable attention features
            console.warn("FaceMesh load failed", e);
          }
        }
      } catch (e: any) {
        setError(e?.message || "Unable to access camera");
      }
    };

    // Start if enabled
    if (!disabled) start();

    return () => {
      cancelled = true;
      try {
        streamRef.current?.getTracks().forEach((t) => t.stop());
      } catch {}
      streamRef.current = null;
      if (rafDetectRef.current) cancelAnimationFrame(rafDetectRef.current);
      rafDetectRef.current = null;
      try { faceMeshRef.current?.close?.(); } catch {}
      faceMeshRef.current = null;
    };
  }, [disabled, enableAttention]);

  const handleAttention = (isLooking: boolean) => {
    setLooking((prev) => (prev !== isLooking ? isLooking : prev));
    onAttentionChange?.(isLooking);
    const now = Date.now();
    if (!isLooking) {
      if (awayStartRef.current == null) awayStartRef.current = now;
      const elapsed = now - (awayStartRef.current || now);
      if (!awayTriggeredRef.current && elapsed >= awayThresholdMs) {
        awayTriggeredRef.current = true;
        onAway?.();
      }
    } else {
      awayStartRef.current = null;
      awayTriggeredRef.current = false;
    }
  };

  const sizeStyles = inline && fill ? undefined : { width, height } as React.CSSProperties;
  const sizeClasses = inline && fill ? "w-full h-64" : "";

  const borderClass = highlightWhenAway && !looking ? "border-red-500" : "border-gray-700";
  const box = (
    <div
      className={`rounded-lg border ${borderClass} bg-black/80 shadow-lg overflow-hidden ${sizeClasses}`}
      style={sizeStyles}
    >
      {disabled ? (
        <div className="w-full h-full flex items-center justify-center text-xs text-gray-400">Camera off</div>
      ) : error ? (
        <div className="w-full h-full flex items-center justify-center text-xs text-red-400">{error}</div>
      ) : (
        <video ref={videoRef} muted playsInline className="w-full h-full object-cover" style={{ transform: "scaleX(-1)" }} />
      )}
    </div>
  );

  if (inline) {
    return box;
  }

  return (
    <div className={`absolute ${side === "left" ? "left-6" : "right-6"} top-24 hidden md:block m-2`}>
      {box}
    </div>
  );
}
