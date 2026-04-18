"use client";

import type { AlbumBackdropSurface } from "@/lib/albumGradient";

export function AlbumBackdrop({
  baseColor,
  blobs,
  vignette,
  gradientOpacity,
  paletteWash,
}: Pick<
  AlbumBackdropSurface,
  "baseColor" | "blobs" | "vignette" | "gradientOpacity" | "paletteWash"
>) {
  return (
    <div
      className="pointer-events-none fixed inset-0 -z-10 min-h-[100dvh] w-full overflow-hidden"
      style={{
        backgroundColor: baseColor,
        // Needed so `mix-blend-mode` on children composites against this container's
        // backdrop only, not the rest of the page.
        isolation: "isolate",
      }}
      aria-hidden
    >
      {paletteWash && (
        <div
          className="album-palette-wash absolute inset-0"
          style={{
            backgroundImage: paletteWash.backgroundImage,
            opacity: paletteWash.opacity,
            mixBlendMode: "screen",
          }}
        />
      )}
      {blobs.length > 0 && (
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: blobs.join(", "),
            // All blob layers composite additively — overlapping colors brighten
            // toward their combined hue (red + blue → magenta) rather than averaging
            // to neutral gray.
            backgroundBlendMode: blobs.map(() => "screen").join(", "),
            mixBlendMode: "screen",
            opacity: gradientOpacity,
          }}
        />
      )}
      {/* Perlin-like fractal noise → organic brightness variation so large
          color fields don't read as flat plastic. Layered with `overlay` so mid-gray
          is a no-op; darker/brighter specks push the backdrop around ±10%. */}
      <div
        className="album-noise absolute inset-0"
        style={{ mixBlendMode: "overlay", opacity: 0.22 }}
      />
      {vignette && (
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: vignette,
            // `normal` on top: this one is meant to darken the edges, not brighten.
            mixBlendMode: "normal",
          }}
        />
      )}
    </div>
  );
}
