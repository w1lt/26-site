import { getLuminance, isGrayscaleArtwork, rgbToHex } from "./extractColors";

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
  const p = Math.max(8, Math.min(82, Math.round(colorPct)));
  return `color-mix(in oklab, ${hex} ${p}%, transparent)`;
}

/**
 * Dark / moody covers: dampen blooms vs bright art, but leave enough chroma for hue to read.
 * Under `screen` compositing, each blob needs enough alpha to actually lift the dark base.
 */
function bloomStrength(avgLum: number): number {
  const x = Math.max(0, Math.min(1, avgLum));
  return 0.56 + 0.54 * Math.pow(x, 0.44);
}

function mixBloom(hex: string, rawPct: number, avgLum: number): string {
  const p = Math.round(rawPct * bloomStrength(avgLum));
  return mixTransparent(hex, p);
}

/** Opacity of the stacked color-blob layer. Dark base means we can run this higher without washout. */
export function gradientLayerOpacity(avgLum: number): number {
  const L = Math.max(0, Math.min(1, avgLum));
  return Math.min(0.95, Math.max(0.62, 0.58 + 0.36 * Math.pow(L, 0.55)));
}

/**
 * Scalar applied to grayscale covers only. Synthetic accents are still present
 * (so the page doesn't read as dead gray) but significantly less saturated than
 * on colorful art — closer to a tinted dark base than a color wash.
 */
const GRAYSCALE_COLOR_DAMP = 0.45;

/**
 * Base fill is now **always dark** — a narrow range from near-black to deep ink.
 * Previously this lifted toward light gray for bright covers, which made the
 * `screen`-blended blobs on top ceiling out at white (= washout). Keeping the
 * base dark gives the blobs somewhere to brighten toward.
 */
export function backdropBaseColor(avgLuminance: number): string {
  const lum = Math.max(0, Math.min(1, avgLuminance));
  const t = Math.pow(lum, 1.05);
  const r = Math.round(12 + (32 - 12) * t);
  const g = Math.round(11 + (30 - 11) * t);
  const b = Math.round(18 + (40 - 18) * t);
  return rgbToHex(r, g, b);
}

/**
 * Tiny hue nudge on the base so the "seams" between blobs don't read as pure black
 * on colorful covers. Capped to avoid overpowering the blob hues.
 */
function tintedBackdropBase(
  avgLum: number,
  strips: readonly string[],
  grayscale: boolean
): string {
  const base = backdropBaseColor(avgLum);
  if (strips.length === 0) return base;
  const accent = stripAt(strips, 0.5);
  // Grayscale: pull almost all the way toward the neutral base so the
  // synthetic accent doesn't visibly tint the floor of the backdrop.
  const accentPct = grayscale ? 5 : 12;
  const basePct = 100 - accentPct;
  return `color-mix(in oklab, ${base} ${basePct}%, ${accent} ${accentPct}%)`;
}

function averageStripLuminance(strips: readonly string[]): number {
  if (strips.length === 0) return 0.18;
  return strips.reduce((s, h) => s + getLuminance(h), 0) / strips.length;
}

/** FNV-1a hash of a string, used as a PRNG seed so same album → same layout. */
function hashStringToSeed(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Mulberry32 — tiny, fast, deterministic PRNG. Returns 0–1. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type BlobSpec = {
  /** center x/y as viewport % */
  x: number;
  y: number;
  /** ellipse width/height as viewport % */
  w: number;
  h: number;
  /** bloom alpha (0–100) before `bloomStrength` scaling */
  alpha: number;
  /** transparent stop (52–66) — lower = tighter blob */
  falloff: number;
  /** index into the blob palette */
  paletteIndex: number;
};

/**
 * Layout strategy: one blob per "region" (4 corners + 1 center) so the composition
 * stays balanced and covers the viewport, but each blob's exact position/size/palette
 * assignment is randomized from the seed. Same track → same layout across renders.
 */
function generateBlobSpecs(
  rand: () => number,
  paletteSize: number
): BlobSpec[] {
  const regions = [
    { xMin: 8, xMax: 32, yMin: 10, yMax: 32 }, // top-left
    { xMin: 68, xMax: 92, yMin: 10, yMax: 32 }, // top-right
    { xMin: 8, xMax: 32, yMin: 68, yMax: 92 }, // bottom-left
    { xMin: 68, xMax: 92, yMin: 68, yMax: 92 }, // bottom-right
    { xMin: 36, xMax: 64, yMin: 38, yMax: 62 }, // center (smaller range → stays central)
  ];

  // Shuffle palette indices so blob ↔ color assignment varies per seed.
  const paletteIndices = Array.from({ length: paletteSize }, (_, i) => i);
  for (let i = paletteIndices.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [paletteIndices[i], paletteIndices[j]] = [
      paletteIndices[j],
      paletteIndices[i],
    ];
  }

  // Randomize region order so "top-left" blob isn't always first/biggest/etc.
  const regionOrder = [0, 1, 2, 3, 4];
  for (let i = regionOrder.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [regionOrder[i], regionOrder[j]] = [regionOrder[j], regionOrder[i]];
  }

  return regionOrder.map((ri, slot) => {
    const r = regions[ri];
    const isCenter = ri === 4;
    return {
      x: r.xMin + rand() * (r.xMax - r.xMin),
      y: r.yMin + rand() * (r.yMax - r.yMin),
      // Corner blobs: large (cover past viewport edge). Center: smaller ambient.
      w: isCenter ? 80 + rand() * 28 : 100 + rand() * 44,
      h: isCenter ? 70 + rand() * 22 : 84 + rand() * 30,
      // Alpha: corner blobs hit harder than center blob.
      alpha: isCenter ? 38 + rand() * 12 : 54 + rand() * 14,
      // Falloff varies blob "edge softness".
      falloff: 54 + rand() * 12,
      paletteIndex:
        paletteSize > 0 ? paletteIndices[slot % paletteSize] : slot,
    };
  });
}

/**
 * B&W / monochrome covers have no chroma to screen-blend with. Substitute synthetic
 * accents that don't exist in the cover but *read* as cinematic:
 *   - Dark monochrome → cool steel-blue / ink-purple family
 *   - Bright monochrome → warm taupe / amber family
 * This mirrors iOS Now Playing behavior on black-and-white artwork.
 */
function grayscaleAccentPalette(avgLum: number): string[] {
  // Low-chroma variants: hint of hue rather than a distinct blue/amber wash.
  if (avgLum < 0.42) {
    // Cool steel — closer to neutral slate than saturated blue.
    return ["#3e4656", "#353a48", "#464f60", "#2d3340", "#3a3648"];
  }
  // Warm taupe — closer to mushroom/neutral than amber.
  return ["#706560", "#5f554f", "#7a6e66", "#5a4f48", "#524743"];
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
  avgLum: number,
  colorDamp: number = 1
): { backgroundImage: string; opacity: number } | null {
  if (palette.length < 3) return null;
  const mixPct = Math.round((58 + avgLum * 36) * colorDamp);
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

  const g1 = `linear-gradient(in oklab, 132deg, ${mkLoop(a).join(", ")})`;
  const g2 = `linear-gradient(in oklab, 48deg, ${mkLoop(bStops).join(", ")})`;
  const backgroundImage = `${g1}, ${g2}`;
  const opacity = Math.min(0.48, (0.2 + avgLum * 0.3) * colorDamp);
  return { backgroundImage, opacity };
}

/**
 * Large soft color blobs meant to be composited with `screen`. Each blob goes
 * `color → transparent` in `oklab` so the falloff keeps chroma at the edges.
 */
export function buildAlbumBackdropSurface(
  strips: readonly string[],
  avgLuminance?: number,
  palette?: readonly string[] | null,
  /** Stable seed per track (e.g. album art URL). Same seed → same layout on SSR + client. */
  seed?: string | number | null
): AlbumBackdropSurface {
  const lum =
    avgLuminance !== undefined && Number.isFinite(avgLuminance)
      ? Math.max(0, Math.min(1, avgLuminance))
      : averageStripLuminance(strips);

  const isGrayscale = isGrayscaleArtwork(strips, palette);
  const colorDamp = isGrayscale ? GRAYSCALE_COLOR_DAMP : 1;

  // Blob palette: real palette on colorful covers, synthetic cinematic accents on
  // grayscale covers so they don't read as flat gray.
  const blobPalette: readonly string[] = isGrayscale
    ? grayscaleAccentPalette(lum)
    : palette && palette.length > 0
      ? palette
      : strips;

  const baseColor = tintedBackdropBase(
    lum,
    isGrayscale ? blobPalette : strips,
    isGrayscale
  );
  const gradientOpacity = gradientLayerOpacity(lum) * colorDamp;
  const paletteWash =
    blobPalette.length >= 3
      ? buildPaletteWash(blobPalette, lum, colorDamp)
      : null;

  // Seeded PRNG so each album gets a unique but stable blob arrangement.
  const seedNum =
    typeof seed === "number"
      ? seed >>> 0
      : typeof seed === "string" && seed.length > 0
        ? hashStringToSeed(seed)
        : hashStringToSeed(strips.join("|") || "fallback");
  const rand = mulberry32(seedNum || 0xcafebabe);

  const specs = generateBlobSpecs(rand, blobPalette.length);

  const blobAt = (idx: number): string =>
    blobPalette[idx % blobPalette.length] ?? stripAt(strips, 0.5);

  const blobs: string[] = specs.map((s) => {
    const x = s.x.toFixed(1);
    const y = s.y.toFixed(1);
    const w = Math.round(s.w);
    const h = Math.round(s.h);
    const falloff = Math.round(s.falloff);
    return `radial-gradient(ellipse ${w}% ${h}% at ${x}% ${y}%, ${mixBloom(
      blobAt(s.paletteIndex),
      s.alpha * colorDamp,
      lum
    )} 0%, transparent ${falloff}%)`;
  });

  // Chromatic edge vignette — painted as a separate layer on top, NOT screened,
  // so it actually tucks the edges darker.
  const vignetteMix =
    1 - Math.pow(Math.max(0, Math.min(1, (lum - 0.04) / 0.66)), 0.84);
  const edgeStrength = Math.round(20 + vignetteMix * 48);
  const chromEdge = vignetteEdgeColor(isGrayscale ? blobPalette : strips);
  // Grayscale: pull the vignette tint almost all the way to neutral ink so edges
  // don't add an unwanted cool/warm cast.
  const chromPct = isGrayscale ? 14 : 36;
  const inkPct = 100 - chromPct;
  const edgeTint = `color-mix(in oklab, ${chromEdge} ${chromPct}%, rgb(10 8 18) ${inkPct}%)`;
  const vignette = `radial-gradient(ellipse 108% 102% at 50% 50%, transparent 44%, color-mix(in oklab, ${edgeTint} ${edgeStrength}%, transparent) 100%)`;

  return {
    baseColor,
    blobs,
    vignette,
    gradientOpacity,
    paletteWash,
  };
}
