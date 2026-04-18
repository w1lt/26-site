"use client";

import { useEffect, useState } from "react";
import type { AlbumBackdropSurface } from "@/lib/albumGradient";
import { OrganicFloatingBlobs } from "@/components/OrganicFloatingBlobs";

function usePrefersReducedMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduce(mq.matches);
    const fn = () => setReduce(mq.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);
  return reduce;
}

export function AlbumBackdrop({
  baseColor,
  layers,
  strips,
  cycleKey,
}: Pick<AlbumBackdropSurface, "baseColor" | "layers"> & {
  strips: readonly string[];
  cycleKey: string;
}) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const animate = !prefersReducedMotion;

  return (
    <div
      className="album-backdrop-drift pointer-events-none fixed inset-0 -z-10 overflow-hidden"
      style={{ backgroundColor: baseColor }}
      aria-hidden
    >
      {layers.length > 0 && (
        <div
          className="absolute inset-0 opacity-[0.42]"
          style={{ backgroundImage: layers.join(", ") }}
        />
      )}
      <OrganicFloatingBlobs
        strips={strips}
        animate={animate}
        cycleKey={cycleKey}
      />
    </div>
  );
}
