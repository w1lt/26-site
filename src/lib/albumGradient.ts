import { getLuminance, rgbToHex } from "./extractColors";

function stripAt(strips: readonly string[], t: number): string {
  if (strips.length === 0) return "#4a4658";
  const i = Math.max(
    0,
    Math.min(strips.length - 1, Math.round(t * (strips.length - 1)))
  );
  return strips[i];
}

/** Mix a strip color toward transparent — used for soft radial blooms. */
function mixTransparent(hex: string, colorPct: number): string {
  const p = Math.max(8, Math.min(72, Math.round(colorPct)));
  return `color-mix(in srgb, ${hex} ${p}%, transparent)`;
}

/**
 * Dark / moody covers: dampen blooms vs bright art, but leave enough chroma for hue to read.
 */
function bloomStrength(avgLum: number): number {
  const x = Math.max(0, Math.min(1, avgLum));
  return 0.31 + 0.69 * Math.pow(x, 0.46);
}

function mixBloom(hex: string, rawPct: number, avgLum: number): string {
  const p = Math.round(rawPct * bloomStrength(avgLum));
  return mixTransparent(hex, p);
}

/** Opacity of the stacked gradient layer (fixed 0.42 was too much on near-black covers). */
export function gradientLayerOpacity(avgLum: number): number {
  const L = Math.max(0, Math.min(1, avgLum));
  return Math.min(0.48, Math.max(0.16, 0.14 + 0.38 * Math.pow(L, 0.55)));
}

/**
 * Muted base fill: avoids near-pure black and near-pure white; slight purple-gray bias.
 * Slightly higher gamma on the curve so low-luminance art stays darker before lifting to gray.
 */
export function backdropBaseColor(avgLuminance: number): string {
  const lum = Math.max(0, Math.min(1, avgLuminance));
  const tLinear = (lum - 0.05) / 0.62;
  const t = Math.pow(Math.max(0, Math.min(1, tLinear)), 0.8);
  const r = Math.round(32 + (212 - 32) * t);
  const g = Math.round(30 + (214 - 30) * t);
  const b = Math.round(44 + (218 - 44) * t);
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
  if (avgLum < 0.09 || avgLum > 0.5) return base;
  const t = Math.max(0, Math.min(1, (0.42 - avgLum) / 0.33));
  const pct = Math.round(3 + t * 9);
  const accent = stripAt(strips, 0.5);
  return `color-mix(in srgb, ${base} ${100 - pct}%, ${accent} ${pct}%)`;
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
  return `color-mix(in srgb, ${a} 50%, ${b} 50%)`;
}

export type AlbumBackdropSurface = {
  baseColor: string;
  /** One `background-image` gradient each, bottom → top paint order (for stacked divs) */
  layers: readonly string[];
  /** Dark covers use a dimmer overlay so blooms don’t wash the scene. */
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
  const mixPct = Math.round(56 + avgLum * 38);
  const mkLoop = (hexes: readonly string[]) => {
    const loop = [...hexes];
    if (loop[0] !== loop[loop.length - 1]) loop.push(loop[0]);
    const n = loop.length;
    return loop.map((hex, i) => {
      const t = n <= 1 ? 0 : i / (n - 1);
      const pos = (t * 100).toFixed(1);
      return `color-mix(in srgb, ${hex} ${mixPct}%, transparent) ${pos}%`;
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

  const g1 = `linear-gradient(132deg, ${mkLoop(a).join(", ")})`;
  const g2 = `linear-gradient(48deg, ${mkLoop(bStops).join(", ")})`;
  const backgroundImage = `${g1}, ${g2}`;
  const opacity = Math.min(0.58, 0.26 + avgLum * 0.34);
  return { backgroundImage, opacity };
}

/**
 * Layered radial blooms + a faint vertical wash. Each layer can be animated separately.
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
    return { baseColor, layers: [], gradientOpacity, paletteWash };
  }

  const vignetteMix =
    1 - Math.pow(Math.max(0, Math.min(1, (lum - 0.04) / 0.66)), 0.84);
  const edgeStrength = Math.round(14 + vignetteMix * 40);
  const chromEdge = vignetteEdgeColor(strips);
  const edgeTint = `color-mix(in srgb, ${chromEdge} 40%, rgb(52 50 64) 60%)`;

  // Back layers first in array = painted first = behind; last entries = on top.
  const back: string[] = [];

  // Back: subtle vertical flow (low contrast, ties top→bottom without a hard linear band)
  if (strips.length >= 2) {
    back.push(
      `linear-gradient(184deg, ${mixBloom(stripAt(strips, 0), 20, lum)} 0%, transparent 30%, ${mixBloom(
        stripAt(strips, 0.5),
        16,
        lum
      )} 50%, transparent 70%, ${mixBloom(stripAt(strips, 1), 18, lum)} 100%)`
    );
  }

  // Large soft radial “body”
  back.push(
    `radial-gradient(ellipse 145% 118% at 44% 40%, ${mixBloom(
      stripAt(strips, 0.35),
      26,
      lum
    )} 0%, transparent 58%)`
  );

  // Bottom-heavy glow
  back.push(
    `radial-gradient(ellipse 92% 82% at 52% 96%, ${mixBloom(
      stripAt(strips, 0.9),
      44,
      lum
    )} 0%, transparent 58%)`
  );

  // Top glow
  back.push(
    `radial-gradient(ellipse 96% 76% at 50% 6%, ${mixBloom(
      stripAt(strips, 0.08),
      42,
      lum
    )} 0%, transparent 54%)`
  );

  // Side accents (asymmetric = more organic)
  back.push(
    `radial-gradient(ellipse 74% 60% at 12% 36%, ${mixBloom(
      stripAt(strips, 0.18),
      46,
      lum
    )} 0%, transparent 56%)`
  );
  back.push(
    `radial-gradient(ellipse 70% 56% at 90% 40%, ${mixBloom(
      stripAt(strips, 0.65),
      44,
      lum
    )} 0%, transparent 54%)`
  );

  // Mid-depth radial
  back.push(
    `radial-gradient(ellipse 88% 72% at 55% 52%, ${mixBloom(
      stripAt(strips, 0.5),
      22,
      lum
    )} 0%, transparent 62%)`
  );

  // Extra hue pockets (strip positions we rarely stack) — low raw % so dark covers stay dim
  if (strips.length >= 3) {
    back.push(
      `linear-gradient(128deg, transparent 22%, ${mixBloom(
        stripAt(strips, 0.33),
        15,
        lum
      )} 50%, transparent 78%)`
    );
  }
  back.push(
    `radial-gradient(ellipse 118% 96% at 26% 68%, ${mixBloom(
      stripAt(strips, 0.28),
      23,
      lum
    )} 0%, transparent 56%)`
  );

  // Front: chromatic vignette (replaces pure black edge)
  back.push(
    `radial-gradient(ellipse 108% 102% at 50% 50%, transparent 42%, color-mix(in srgb, ${edgeTint} ${edgeStrength}%, transparent) 100%)`
  );

  return {
    baseColor,
    layers: back,
    gradientOpacity,
    paletteWash,
  };
}
