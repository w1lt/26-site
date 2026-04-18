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

type BlobSpawn = {
  id: number;
  x: number;
  y: number;
  size: number;
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
    x: 10 + r() * 78,
    y: 8 + r() * 82,
    size: 32 + r() * 48,
    color,
    blurPx: 36 + Math.floor(r() * 28),
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

  const gradient = useMemo(
    () =>
      `radial-gradient(circle at 50% 50%, color-mix(in srgb, ${spawn.color} 58%, transparent) 0%, color-mix(in srgb, ${spawn.color} 22%, transparent) 42%, transparent 72%)`,
    [spawn.color]
  );

  if (!animate) {
    return (
      <div
        className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full opacity-35 mix-blend-screen"
        style={{
          left: `${spawn.x}%`,
          top: `${spawn.y}%`,
          width: `${spawn.size}vmin`,
          height: `${spawn.size}vmin`,
          backgroundImage: gradient,
          filter: `blur(${spawn.blurPx}px)`,
        }}
        aria-hidden
      />
    );
  }

  return (
    <motion.div
      key={spawn.id}
      className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full mix-blend-screen will-change-transform"
      style={{
        left: `${spawn.x}%`,
        top: `${spawn.y}%`,
        width: `${spawn.size}vmin`,
        height: `${spawn.size}vmin`,
        backgroundImage: gradient,
        filter: `blur(${spawn.blurPx}px)`,
      }}
      initial={{ scale: 0, opacity: 0 }}
      animate={{
        scale: [0, 1.14, 1.02, 0],
        opacity: [0, 0.72, 0.48, 0],
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
