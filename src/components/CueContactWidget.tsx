'use client';

import { useRef, useState } from 'react';
import { MAX_TIP_OFFSET } from '@/engine/constants';

interface CueContactWidgetProps {
  tipX: number;
  tipY: number;
  disabled?: boolean;
  onChange: (tipX: number, tipY: number) => void;
}

function describeSpin(tipX: number, tipY: number): string {
  const parts: string[] = [];
  if (tipY > 0.16) parts.push('Follow');
  else if (tipY < -0.16) parts.push('Draw');
  if (tipX < -0.16) parts.push('Esq.');
  else if (tipX > 0.16) parts.push('Dir.');
  return parts.length > 0 ? parts.join(' + ') : 'Centro';
}

export function CueContactWidget({
  tipX,
  tipY,
  disabled = false,
  onChange,
}: CueContactWidgetProps) {
  const padRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);

  const updateFromClient = (clientX: number, clientY: number) => {
    const el = padRef.current;
    if (!el || disabled) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width * 0.5;
    const cy = rect.top + rect.height * 0.5;
    const radius = rect.width * 0.5;

    // Normalize to [-1, 1] where +Y up means +tipY (Topspin / Follow)
    let nx = (clientX - cx) / radius;
    let ny = -(clientY - cy) / radius;
    const mag = Math.hypot(nx, ny);
    if (mag > MAX_TIP_OFFSET) {
      const scale = MAX_TIP_OFFSET / mag;
      nx *= scale;
      ny *= scale;
    }
    onChange(Number(nx.toFixed(3)), Number(ny.toFixed(3)));
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    updateFromClient(e.clientX, e.clientY);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging || disabled) return;
    updateFromClient(e.clientX, e.clientY);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setDragging(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const step = 0.12;
    let nx = tipX;
    let ny = tipY;
    if (e.key === 'ArrowLeft') nx -= step;
    else if (e.key === 'ArrowRight') nx += step;
    else if (e.key === 'ArrowUp') ny += step;
    else if (e.key === 'ArrowDown') ny -= step;
    else if (e.key === '0' || e.key === 'Home') {
      onChange(0, 0);
      return;
    } else return;

    e.preventDefault();
    const mag = Math.hypot(nx, ny);
    if (mag > MAX_TIP_OFFSET) {
      nx *= MAX_TIP_OFFSET / mag;
      ny *= MAX_TIP_OFFSET / mag;
    }
    onChange(Number(nx.toFixed(3)), Number(ny.toFixed(3)));
  };

  const dotLeftPct = 50 + tipX * 50;
  const dotTopPct = 50 - tipY * 50;
  const isCentered = Math.abs(tipX) < 0.03 && Math.abs(tipY) < 0.03;

  return (
    <div className="leather-inlay flex items-center gap-3 rounded-xl px-3 py-2">
      <div
        ref={padRef}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label="Ponto de contato do taco na bola branca. Use mouse ou setas para ajustar efeito."
        aria-valuemin={-100}
        aria-valuemax={100}
        aria-valuenow={Math.round(tipY * 100)}
        aria-valuetext={describeSpin(tipX, tipY)}
        data-testid="cue-contact-pad"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onLostPointerCapture={() => setDragging(false)}
        onDoubleClick={() => !disabled && onChange(0, 0)}
        onKeyDown={handleKeyDown}
        style={{
          touchAction: 'none',
          WebkitUserSelect: 'none',
          userSelect: 'none',
        }}
        className={`relative h-16 w-16 shrink-0 rounded-full border-2 border-[#b78939]/80 shadow-inner outline-none focus-visible:ring-2 focus-visible:ring-[#dfb25e] ${
          disabled
            ? 'cursor-not-allowed opacity-60'
            : dragging
              ? 'cursor-grabbing'
              : 'cursor-crosshair'
        }`}
      >
        {/* Aged ivory cue ball surface */}
        <div
          className="pointer-events-none absolute inset-0 rounded-full"
          style={{
            background:
              'radial-gradient(circle at 32% 28%, #fffaf0 0%, #ede1c6 58%, #bfa982 100%)',
          }}
        />
        {/* Valid miscue boundary ring */}
        <div
          className="pointer-events-none absolute rounded-full border border-dashed border-[#5c4328]/45"
          style={{
            inset: `${(1 - MAX_TIP_OFFSET) * 50}%`,
          }}
        />
        {/* Crosshair */}
        <div className="pointer-events-none absolute top-1/2 left-2 right-2 h-px -translate-y-1/2 bg-[#5c4328]/40" />
        <div className="pointer-events-none absolute left-1/2 top-2 bottom-2 w-px -translate-x-1/2 bg-[#5c4328]/40" />

        {/* Contact point dot (Prussian chalk rim + crimson center) */}
        <div
          data-testid="cue-contact-dot"
          className="pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#1e4a73] bg-[#b93829] shadow"
          style={{
            left: `${dotLeftPct}%`,
            top: `${dotTopPct}%`,
          }}
        />
      </div>

      <div className="flex min-w-[94px] flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[#baa482]">
          Ponto do Taco
        </span>
        <span
          data-testid="cue-contact-label"
          className="text-xs font-bold text-[#dfb25e]"
        >
          {describeSpin(tipX, tipY)}
        </span>
        <button
          type="button"
          disabled={disabled || isCentered}
          onClick={() => onChange(0, 0)}
          className="wood-btn mt-0.5 self-start rounded-md px-2 py-0.5 text-[11px] font-medium disabled:cursor-default disabled:opacity-40"
        >
          Centralizar
        </button>
      </div>
    </div>
  );
}
