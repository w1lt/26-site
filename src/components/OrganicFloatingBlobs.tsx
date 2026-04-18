"use client";

import { useCallback, useMemo, useState } from "react";
import { motion } from "framer-motion";

const BLOB_COUNT = 4;

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

/** Several soft ellipses at different centers = no single circular hotspot. */
function organicLayeredGradient(color: string, rand: () => number): string {
  const a = (x: number) => `color-mix(in srgb, ${color} ${x}%, transparent)`;
  const layers: string[] = [];
  for (let i = 0; i < 3; i++) {
    const w = 38 + rand() * 48;
    const h = 32 + rand() * 55;
    const cx = 18 + rand() * 64;
    const cy = 15 + rand() * 70;
    const stop = 42 + rand() * 22;
    const c = i === 1 ? a(32) : a(48 + rand() * 18);
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
    x: 8 + r() * 84,
    y: 6 + r() * 86,
    size: 36 + r() * 52,
    widthMul: 0.72 + r() * 0.56,
    heightMul: 0.68 + r() * 0.62,
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
}: {
  strips: readonly string[];
  blobSlot: number;
  animate: boolean;
  cycleKey: string;
}) {
  const [spawn, setSpawn] = useState<BlobSpawn>(() =>
    nextSpawn(strips, (blobSlot * 100019 + 4201) ^ hashString(cycleKey))
  );

  const onCycleDone = useCallback(() => {
    setSpawn((prev) =>
      nextSpawn(strips, prev.id + 1 + Math.floor(Math.random() * 1e6))
    );
  }, [strips]);

  const blobStyle = useMemo(
    () =>
      ({
        left: `${spawn.x}%`,
        top: `${spawn.y}%`,
        width: `${spawn.size * spawn.widthMul}vmin`,
        height: `${spawn.size * spawn.heightMul}vmin`,
        borderRadius: spawn.borderRadius,
        backgroundImage: spawn.backgroundImage,
        filter: `blur(${spawn.blurPx}px)`,
      }) as const,
    [spawn]
  );

  if (!animate) {
    return (
      <div
        className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 opacity-[0.35] mix-blend-screen"
        style={{ ...blobStyle, rotate: `${spawn.rotation}deg` }}
        aria-hidden
      />
    );
  }

  return (
    <motion.div
      key={spawn.id}
      className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 mix-blend-screen will-change-transform"
      style={blobStyle}
      initial={{ scale: 0, opacity: 0, rotate: spawn.rotation }}
      animate={{
        scale: [0, 1.08, 0.98, 0],
        opacity: [0, 0.68, 0.42, 0],
        rotate: [
          spawn.rotation,
          spawn.rotation + 7 + blobSlot * 2,
          spawn.rotation - 4,
          spawn.rotation + 2,
        ],
      }}
      transition={{
        delay: blobSlot * 0.35,
        duration: spawn.duration,
        times: [0, 0.32, 0.58, 1],
        ease: [
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
  if (strips.length === 0) return null;

  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden
    >
      {Array.from({ length: BLOB_COUNT }, (_, i) => (
        <FloatingBlob
          key={`${cycleKey}-${i}`}
          strips={strips}
          blobSlot={i}
          animate={animate}
          cycleKey={cycleKey}
        />
      ))}
    </div>
  );
}
