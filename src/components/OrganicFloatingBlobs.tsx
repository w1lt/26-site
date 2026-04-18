"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";

/** Fewer, larger instances on big viewports — reads as one field vs many dots. */
function blobCountForViewport(minDim: number): number {
  if (minDim < 520) return 3;
  if (minDim < 900) return 3;
  return 2;
}

function randomUint32(): number {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0]! >>> 0;
  }
  return (Math.random() * 0xffffffff) >>> 0;
}

/** Real layout pixels (avoids vmin/dvh quirks on mobile Safari and matches backdrop to window). */
function useViewportSize() {
  const [size, setSize] = useState(() => ({
    width:
      typeof window !== "undefined"
        ? Math.round(window.visualViewport?.width ?? window.innerWidth)
        : 0,
    height:
      typeof window !== "undefined"
        ? Math.round(window.visualViewport?.height ?? window.innerHeight)
        : 0,
  }));

  useEffect(() => {
    const read = () => {
      const vv = window.visualViewport;
      setSize({
        width: Math.round(vv?.width ?? window.innerWidth),
        height: Math.round(vv?.height ?? window.innerHeight),
      });
    };
    read();
    window.addEventListener("resize", read);
    window.visualViewport?.addEventListener("resize", read);
    window.visualViewport?.addEventListener("scroll", read);
    return () => {
      window.removeEventListener("resize", read);
      window.visualViewport?.removeEventListener("resize", read);
      window.visualViewport?.removeEventListener("scroll", read);
    };
  }, []);

  return size;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t = (t + Math.imul(t ^ (t >>> 7), t | 61)) | 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Irregular “blob” corners (8-value border-radius), not circles. */
function organicBorderRadius(rand: () => number): string {
  const v = () => 22 + rand() * 56;
  return `${v()}% ${v()}% ${v()}% ${v()}% / ${v()}% ${v()}% ${v()}% ${v()}%`;
}

/** Two broad, soft ellipses so each blob reads as a wash, not stacked “dots”. */
function organicLayeredGradient(color: string, rand: () => number): string {
  const a = (x: number) => `color-mix(in srgb, ${color} ${x}%, transparent)`;
  const layers: string[] = [];
  for (let i = 0; i < 2; i++) {
    const w = 72 + rand() * 58;
    const h = 68 + rand() * 62;
    const cx = 12 + rand() * 76;
    const cy = 10 + rand() * 80;
    const stop = 58 + rand() * 28;
    const c = a(38 + rand() * 22);
    layers.push(
      `radial-gradient(ellipse ${w}% ${h}% at ${cx}% ${cy}%, ${c} 0%, transparent ${stop}%)`
    );
  }
  return layers.join(", ");
}

type BlobSpawn = {
  id: number;
  x: number;
  y: number;
  size: number;
  widthMul: number;
  heightMul: number;
  rotation: number;
  borderRadius: string;
  backgroundImage: string;
  color: string;
  blurPx: number;
  duration: number;
};

function nextSpawn(strips: readonly string[], seed: number): BlobSpawn {
  const r = mulberry32(seed ^ 0xdeadbeef);
  const color =
    strips.length > 0
      ? strips[Math.min(strips.length - 1, Math.floor(r() * strips.length))]
      : "#6a6288";
  return {
    id: seed,
    x: 4 + r() * 92,
    y: 3 + r() * 94,
    /** % of layout ref — biased large so fields overlap into one flow */
    size: 52 + r() * 56,
    widthMul: 0.88 + r() * 0.52,
    heightMul: 0.84 + r() * 0.56,
    rotation: -38 + r() * 76,
    borderRadius: organicBorderRadius(r),
    backgroundImage: organicLayeredGradient(color, r),
    color,
    blurPx: 42 + Math.floor(r() * 36),
    duration: 14 + r() * 10,
  };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function FloatingBlob({
  strips,
  blobSlot,
  animate,
  cycleKey,
  minDim,
  layoutSalt,
  subtleMotion,
  layoutRefDim,
}: {
  strips: readonly string[];
  blobSlot: number;
  animate: boolean;
  cycleKey: string;
  minDim: number;
  /** sqrt(vw*vh) capped — scales blob area with screen without tiny splotches on wide layouts */
  layoutRefDim: number;
  /** XOR’d into RNG so each page load / tab gets different placements (not just per track). */
  layoutSalt: number;
  subtleMotion: boolean;
}) {
  const seedFor = useCallback(
    (salt: number, extra: number) =>
      hashString(cycleKey) ^
      blobSlot * 0x9e3779b9 ^
      salt ^
      extra,
    [cycleKey, blobSlot]
  );

  const [spawn, setSpawn] = useState<BlobSpawn>(() =>
    nextSpawn(strips, seedFor(layoutSalt, 0x51ed))
  );

  const onCycleDone = useCallback(() => {
    setSpawn((prev) =>
      nextSpawn(strips, prev.id + 1 + randomUint32())
    );
  }, [strips]);

  const blobStyle = useMemo(() => {
    const m = layoutRefDim > 0 ? layoutRefDim : minDim > 0 ? minDim : 1;
    const widthPx = Math.round(((spawn.size * spawn.widthMul) / 100) * m);
    const heightPx = Math.round(((spawn.size * spawn.heightMul) / 100) * m);
    const ref = 640;
    const blurScaled = Math.max(
      10,
      Math.round(spawn.blurPx * Math.min(1.45, m / ref))
    );
    return {
      left: `${spawn.x}%`,
      top: `${spawn.y}%`,
      width: `${widthPx}px`,
      height: `${heightPx}px`,
      borderRadius: spawn.borderRadius,
      backgroundImage: spawn.backgroundImage,
      filter: `blur(${blurScaled}px)`,
    } as const;
  }, [spawn, minDim, layoutRefDim]);

  if (!animate) {
    return (
      <div
        className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 opacity-[0.35] mix-blend-screen"
        style={{ ...blobStyle, rotate: `${spawn.rotation}deg` }}
        aria-hidden
      />
    );
  }

  const peakOpacity = subtleMotion ? 0.38 : 0.58;
  const midOpacity = subtleMotion ? 0.26 : 0.42;
  const durationMul = subtleMotion ? 1.55 : 1;
  const delayStep = subtleMotion ? 0.72 : 0.38;

  return (
    <motion.div
      key={`${spawn.id}-${cycleKey}`}
      className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 mix-blend-screen will-change-transform"
      style={blobStyle}
      initial={{ scale: 0.02, opacity: 0, rotate: spawn.rotation }}
      animate={{
        scale: [0.02, 1.04, 0.96, 0],
        opacity: [0, peakOpacity, midOpacity, 0],
        rotate: [
          spawn.rotation,
          spawn.rotation + 5 + blobSlot * 2,
          spawn.rotation - 3,
          spawn.rotation + 2,
        ],
      }}
      transition={{
        delay: blobSlot * delayStep,
        duration: spawn.duration * durationMul,
        times: subtleMotion ? [0, 0.28, 0.62, 1] : [0, 0.32, 0.58, 1],
        ease: subtleMotion
          ? [
              [0.22, 1, 0.36, 1],
              [0.4, 0, 0.2, 1],
              [0.35, 0, 0.25, 1],
            ]
          : [
              [0.16, 1, 0.3, 1],
              [0.45, 0, 0.55, 1],
              [0.4, 0, 0.2, 1],
            ],
      }}
      onAnimationComplete={onCycleDone}
      aria-hidden
    />
  );
}

export function OrganicFloatingBlobs({
  strips,
  animate,
  cycleKey,
}: {
  strips: readonly string[];
  animate: boolean;
  cycleKey: string;
}) {
  const { width: vw, height: vh } = useViewportSize();
  const minDim = vw > 0 && vh > 0 ? Math.min(vw, vh) : 0;
  /** Area-aware scale: grows on large / wide screens vs min-side-only (reduces “small blobs”). */
  const layoutRefDim =
    vw > 0 && vh > 0
      ? Math.max(minDim, Math.sqrt(vw * vh))
      : 0;
  /** 0 on SSR / first paint — matches server HTML; real salt set in useLayoutEffect before paint. */
  const [layoutSalt, setLayoutSalt] = useState(0);

  useLayoutEffect(() => {
    let s = randomUint32();
    if (s === 0) s = 0xcafebabe >>> 0;
    setLayoutSalt(s);
  }, []);

  /** Narrow viewports: slower, lower-contrast blob cycle (phones + small tablets / windowed). */
  const subtleMotion = minDim > 0 && minDim < 768;

  if (strips.length === 0) return null;

  const nBlobs = blobCountForViewport(minDim);

  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden
    >
      {minDim > 0 && layoutSalt !== 0 &&
        Array.from({ length: nBlobs }, (_, i) => (
          <FloatingBlob
            key={`${cycleKey}-${i}-${layoutSalt}`}
            strips={strips}
            blobSlot={i}
            animate={animate}
            cycleKey={cycleKey}
            minDim={minDim}
            layoutRefDim={layoutRefDim}
            layoutSalt={layoutSalt}
            subtleMotion={subtleMotion}
          />
        ))}
    </div>
  );
}
