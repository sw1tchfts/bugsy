"use client";

import { type PointerEvent, useRef, useState } from "react";

/** A finger-or-mouse signature canvas that hands back a PNG data URL. */
export function SignaturePad({ onChange, label }: { onChange: (dataUrl: string | null) => void; label: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(false);

  function point(e: PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) / rect.width) * canvas.width, y: ((e.clientY - rect.top) / rect.height) * canvas.height };
  }

  function start(e: PointerEvent<HTMLCanvasElement>) {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    drawing.current = true;
    const { x, y } = point(e);
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#1c1917";
    ctx.beginPath();
    ctx.moveTo(x, y);
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function move(e: PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = point(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    if (!hasInk) setHasInk(true);
  }

  function end() {
    if (!drawing.current) return;
    drawing.current = false;
    onChange(canvasRef.current?.toDataURL("image/png") ?? null);
  }

  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasInk(false);
    onChange(null);
  }

  return (
    <div className="grid gap-2">
      <canvas
        ref={canvasRef}
        width={600}
        height={200}
        className="h-40 w-full touch-none rounded border border-stone-300 bg-white"
        aria-label={label}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onPointerLeave={end}
      />
      <button type="button" onClick={clear} className="justify-self-start rounded border border-stone-300 px-3 py-1 text-sm" data-testid="signature-clear">
        {hasInk ? "× " : ""}
        {label === "" ? "Clear" : "Clear"}
      </button>
    </div>
  );
}
