"use client";

import { useEffect, useRef, useState } from "react";

type Detector = { detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]> };
type DetectorCtor = new (options: { formats: string[] }) => Detector;

const detectorCtor = () => (globalThis as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;

/** Camera barcode scanning through the browser's BarcodeDetector; says so plainly where the browser lacks it. */
export function Scanner({ onCode, onClose, unsupportedText, closeText }: { onCode: (code: string) => void; onClose: () => void; unsupportedText: string; closeText: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  // Mounted only after a tap, so the browser's answer is known before the first render.
  const [supported, setSupported] = useState<boolean>(() => Boolean(detectorCtor() && navigator.mediaDevices?.getUserMedia));

  useEffect(() => {
    const ctor = detectorCtor();
    if (!ctor || !navigator.mediaDevices?.getUserMedia) return;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    const detector = new ctor({ formats: ["upc_a", "upc_e", "ean_13", "ean_8", "code_128"] });
    void navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then((s) => {
        stream = s;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = s;
        void video.play();
        timer = setInterval(async () => {
          try {
            const codes = await detector.detect(video);
            if (codes.length) onCode(codes[0].rawValue);
          } catch {
            // Keep trying until the user closes the scanner.
          }
        }, 500);
      })
      .catch(() => setSupported(false));
    return () => {
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onCode]);

  return (
    <div className="grid gap-2 rounded border border-stone-300 bg-stone-50 p-2">
      {!supported ? <p className="text-sm text-stone-600">{unsupportedText}</p> : <video ref={videoRef} className="w-full rounded bg-black" muted playsInline />}
      <button type="button" onClick={onClose} className="justify-self-start rounded border border-stone-300 bg-white px-3 py-1 text-sm">
        {closeText}
      </button>
    </div>
  );
}
