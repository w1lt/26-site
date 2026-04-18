import { getLuminance, rgbToHex } from "./extractColors";

function stripAt(strips: readonly string[], t: number): string {
  if (strips.length === 0) return "#4a4658";
  const i = Math.max(
    0,
    Math.min(strips.length - 1, Math.round(t * (strips.length - 1)))
  );
  return strips[i];
}

/**
 * Mix a strip color toward transparent — used for soft radial blooms.
 * Uses `oklab` interpolation so mid-gradient samples keep chroma instead of desaturating
 * toward neutral (the "mixing two colors goes gray" problem in sRGB).
 */
function mixTransparent(hex: string, colorPct: number): string {
  const p = Math.max(8, Math.min(78, Math.round(colorPct)));
  return `color-mix(in oklab, ${hex} ${p}%, transparent)`;
}

/**
 * Dark / moody covers: dampen blooms vs bright art, but leave enough chroma for hue to read.
 * Slightly higher floor than before because blob layers now composite with `screen`,
 * which darkens individual layers a bit (they add to each other instead of averaging).
 */
function bloomStrength(avgLum: number): number {
  const x = Math.max(0, Math.min(1, avgLum));
  return 0.42 + 0.62 * Math.pow(x, 0.46);
}

function mixBloom(hex: string, rawPct: number, avgLum: number): string {
  const p = Math.round(rawPct * bloomStrength(avgLum));
  return mixTransparent(hex, p);
}

/** Opacity of the stacked color-blob layer. Screen blending tolerates more opacity. */
export function gradientLayerOpacity(avgLum: number): number {
  const L = Math.max(0, Math.min(1, avgLum));
  return Math.min(0.82, Math.max(0.42, 0.38 + 0.46 * Math.pow(L, 0.55)));
}

/**
 * Muted base fill: avoids near-pure black and near-pure white; slight purple-gray bias.
 * Darker than before because blobs will `screen` on top and need a dark substrate to
 * look vibrant (iOS Now Playing uses the same trick — very dark base, saturated blooms).
 */
export function backdropBaseColor(avgLuminance: number): string {
  const lum = Math.max(0, Math.min(1, avgLuminance));
  const tLinear = (lum - 0.05) / 0.68;
  const t = Math.pow(Math.max(0, Math.min(1, tLinear)), 0.9);
  const r = Math.round(18 + (168 - 18) * t);
  const g = Math.round(17 + (170 - 17) * t);
  const b = Math.round(26 + (176 - 26) * t);
  return rgbToHex(r, g, b);
}

/**
 * Nudges the neutral base toward mid-album hue (slight, capped) so dark/mid covers feel
 * less gray without a big luminance jump.
 */
function tintedBackdropBase(
  avgLum: number,
  strips: readonly string[]
): string {
  const base = backdropBaseColor(avgLum);
  if (strips.length === 0) return base;
  if (avgLum < 0.06 || avgLum > 0.55) return base;
  const t = Math.max(0, Math.min(1, (0.42 - avgLum) / 0.33));
  const pct = Math.round(4 + t * 10);
  const accent = stripAt(strips, 0.5);
  return `color-mix(in oklab, ${base} ${100 - pct}%, ${accent} ${pct}%)`;
}

function averageStripLuminance(strips: readonly string[]): number {
  if (strips.length === 0) return 0.18;
  return strips.reduce((s, h) => s + getLuminance(h), 0) / strips.length;
}

/**
 * Chromatic edge for vignettes (not neutral black).
 */
function vignetteEdgeColor(strips: readonly string[]): string {
  const a = stripAt(strips, 0.42);
  const b = stripAt(strips, 0.58);
  return `color-mix(in oklab, ${a} 50%, ${b} 50%)`;
}

export type AlbumBackdropSurface = {
  baseColor: string;
  /**
   * Color-blob gradients, painted with `background-blend-mode: screen` so overlaps
   * brighten chromatically instead of averaging to gray.
   */
  blobs: readonly string[];
  /**
   * Top vignette (painted as a separate layer, `mix-blend-mode: normal`) so it
   * actually darkens the edges instead of being hidden under the blobs.
   */
  vignette: string | null;
  /** Opacity for the whole blob layer (tunes intensity for dark covers). */
  gradientOpacity: number;
  /** Slow-moving wash from distinct palette swatches (optional). */
  paletteWash: { backgroundImage: string; opacity: number } | null;
};

/** Two crossed linear gradients (spatial palette order + split hues) for richer, less “muddy” wash. */
export function buildPaletteWash(
  palette: readonly string[],
  avgLum: number
): { backgroundImage: string; opacity: number } | null {
  if (palette.length < 3) return null;
  const mixPct = Math.round(58 + avgLum * 36);
  const mkLoop = (hexes: readonly string[]) => {
    const loop = [...hexes];
    if (loop[0] !== loop[loop.length - 1]) loop.push(loop[0]);
    const n = loop.length;
    return loop.map((hex, i) => {
      const t = n <= 1 ? 0 : i / (n - 1);
      const pos = (t * 100).toFixed(1);
      return `color-mix(in oklab, ${hex} ${mixPct}%, transparent) ${pos}%`;
    });
  };

  const mid = Math.max(2, Math.ceil(palette.length / 2));
  const a = palette.slice(0, mid);
  const b = palette.slice(mid);
  /** Second layer: different path through the palette so the two meshes don’t reuse the same hue run */
  const bStops =
    b.length >= 2
      ? b
      : palette.length >= 3
        ? [
            palette[palette.length - 1],
            palette[Math.floor(palette.length / 2)],
            palette[0],
          ]
        : [...palette];

  // `in oklab` gradient interpolation keeps the midpoint saturated instead of going gray.
  const g1 = `linear-gradient(in oklab, 132deg, ${mkLoop(a).join(", ")})`;
  const g2 = `linear-gradient(in oklab, 48deg, ${mkLoop(bStops).join(", ")})`;
  const backgroundImage = `${g1}, ${g2}`;
  const opacity = Math.min(0.48, 0.2 + avgLum * 0.3);
  return { backgroundImage, opacity };
}

/**
 * Large soft color blobs meant to be composited with `screen`. Each blob goes
 * `color → transparent` in `oklab` so the falloff keeps chroma at the edges.
 */
export function buildAlbumBackdropSurface(
  strips: readonly string[],
  avgLuminance?: number,
  palette?: readonly string[] | null
): AlbumBackdropSurface {
  const lum =
    avgLuminance !== undefined && Number.isFinite(avgLuminance)
      ? Math.max(0, Math.min(1, avgLuminance))
      : averageStripLuminance(strips);

  const baseColor = tintedBackdropBase(lum, strips);
  const gradientOpacity = gradientLayerOpacity(lum);
  const paletteWash =
    palette && palette.length >= 3 ? buildPaletteWash(palette, lum) : null;

  if (strips.length === 0) {
    return {
      baseColor,
      blobs: [],
      vignette: null,
      gradientOpacity,
      paletteWash,
    };
  }

  const blobs: string[] = [];

  // Pick a blob color biased toward the palette (more distinct hues) with strip fallback.
  const paletteFor = (idx: number, fallbackT: number) => {
    if (palette && palette.length > 0) {
      return palette[idx % palette.length];
    }
    return stripAt(strips, fallbackT);
  };

  // 5 large blobs at asymmetric positions. Under `screen`, overlaps brighten toward
  // combined hue; gaps between blobs stay dark (the iOS "seam" look).
  blobs.push(
    `radial-gradient(ellipse 118% 96% at 18% 22%, ${mixBloom(
      paletteFor(0, 0.12),
      60,
      lum
    )} 0%, transparent 58%)`
  );
  blobs.push(
    `radial-gradient(ellipse 104% 88% at 84% 30%, ${mixBloom(
      paletteFor(1, 0.3),
      58,
      lum
    )} 0%, transparent 56%)`
  );
  blobs.push(
    `radial-gradient(ellipse 124% 96% at 22% 82%, ${mixBloom(
      paletteFor(2, 0.78),
      62,
      lum
    )} 0%, transparent 58%)`
  );
  blobs.push(
    `radial-gradient(ellipse 110% 88% at 82% 78%, ${mixBloom(
      paletteFor(3, 0.92),
      58,
      lum
    )} 0%, transparent 56%)`
  );
  // Center ambient blob so the middle doesn't dip to base color between the 4 corners.
  blobs.push(
    `radial-gradient(ellipse 92% 76% at 50% 50%, ${mixBloom(
      paletteFor(4, 0.5),
      42,
      lum
    )} 0%, transparent 62%)`
  );

  // Chromatic edge vignette — painted as a separate layer on top, NOT screened,
  // so it actually tucks the edges darker. (Previous code had this bundled with
  // the color blobs, which meant it was either a no-op under `normal` or got
  // inverted under `screen`.)
  const vignetteMix =
    1 - Math.pow(Math.max(0, Math.min(1, (lum - 0.04) / 0.66)), 0.84);
  const edgeStrength = Math.round(20 + vignetteMix * 48);
  const chromEdge = vignetteEdgeColor(strips);
  const edgeTint = `color-mix(in oklab, ${chromEdge} 36%, rgb(14 12 22) 64%)`;
  const vignette = `radial-gradient(ellipse 108% 102% at 50% 50%, transparent 44%, color-mix(in oklab, ${edgeTint} ${edgeStrength}%, transparent) 100%)`;

  return {
    baseColor,
    blobs,
    vignette,
    gradientOpacity,
    paletteWash,
  };
}
