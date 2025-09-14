"use client";

import { useEffect, useRef, useState } from "react";

type CameraPreviewProps = {
  disabled?: boolean; // when true, release camera and hide feed
  inline?: boolean; // when true, render inline (no absolute positioning wrapper)
  width?: number; // pixel width for inline box
  height?: number; // pixel height for inline box
  side?: "left" | "right"; // when not inline, which side of the screen
  fill?: boolean; // when true and inline, expand to fill parent width with a fixed height
};

/**
 * Lightweight camera preview for interview. Keeps a small live view visible.
 * TODO: In future, tap frames for cheat detection (e.g., face landmarks, gaze).
 */
export default function CameraPreview({ disabled = false, inline = false, width = 150, height = 150, side = "right", fill = false }: CameraPreviewProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    };
  }, [disabled]);

  const sizeStyles = inline && fill ? undefined : { width, height } as React.CSSProperties;
  const sizeClasses = inline && fill ? "w-full h-64" : "";

  const box = (
    <div
      className={`rounded-lg border border-gray-700 bg-black/80 shadow-lg overflow-hidden ${sizeClasses}`}
      style={sizeStyles}
    >
      {disabled ? (
        <div className="w-full h-full flex items-center justify-center text-xs text-gray-400">Camera off</div>
      ) : error ? (
        <div className="w-full h-full flex items-center justify-center text-xs text-red-400">{error}</div>
      ) : (
        <video ref={videoRef} muted playsInline className="w-full h-full object-cover" />
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
