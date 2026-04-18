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
 * Muted base fill: avoids near-pure black and near-pure white; slight purple-gray bias.
 */
export function backdropBaseColor(avgLuminance: number): string {
  const lum = Math.max(0, Math.min(1, avgLuminance));
  const t = Math.pow(Math.max(0, Math.min(1, (lum - 0.07) / 0.56)), 0.85);
  const r = Math.round(36 + (206 - 36) * t);
  const g = Math.round(34 + (208 - 34) * t);
  const b = Math.round(48 + (214 - 48) * t);
  return rgbToHex(r, g, b);
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
};

/**
 * Layered radial blooms + a faint vertical wash. Each layer can be animated separately.
 */
export function buildAlbumBackdropSurface(
  strips: readonly string[],
  avgLuminance?: number
): AlbumBackdropSurface {
  const lum =
    avgLuminance !== undefined && Number.isFinite(avgLuminance)
      ? Math.max(0, Math.min(1, avgLuminance))
      : averageStripLuminance(strips);

  const baseColor = backdropBaseColor(lum);

  if (strips.length === 0) {
    return { baseColor, layers: [] };
  }

  const vignetteMix =
    1 - Math.pow(Math.max(0, Math.min(1, (lum - 0.05) / 0.62)), 0.92);
  const edgeStrength = Math.round(14 + vignetteMix * 34);
  const chromEdge = vignetteEdgeColor(strips);
  const edgeTint = `color-mix(in srgb, ${chromEdge} 40%, rgb(52 50 64) 60%)`;

  // Back layers first in array = painted first = behind; last entries = on top.
  const back: string[] = [];

  // Back: subtle vertical flow (low contrast, ties top→bottom without a hard linear band)
  if (strips.length >= 2) {
    back.push(
      `linear-gradient(184deg, ${mixTransparent(stripAt(strips, 0), 20)} 0%, transparent 30%, ${mixTransparent(
        stripAt(strips, 0.5),
        16
      )} 50%, transparent 70%, ${mixTransparent(stripAt(strips, 1), 18)} 100%)`
    );
  }

  // Large soft radial “body”
  back.push(
    `radial-gradient(ellipse 145% 118% at 44% 40%, ${mixTransparent(
      stripAt(strips, 0.35),
      26
    )} 0%, transparent 58%)`
  );

  // Bottom-heavy glow
  back.push(
    `radial-gradient(ellipse 92% 82% at 52% 96%, ${mixTransparent(
      stripAt(strips, 0.9),
      44
    )} 0%, transparent 58%)`
  );

  // Top glow
  back.push(
    `radial-gradient(ellipse 96% 76% at 50% 6%, ${mixTransparent(
      stripAt(strips, 0.08),
      42
    )} 0%, transparent 54%)`
  );

  // Side accents (asymmetric = more organic)
  back.push(
    `radial-gradient(ellipse 74% 60% at 12% 36%, ${mixTransparent(
      stripAt(strips, 0.18),
      46
    )} 0%, transparent 56%)`
  );
  back.push(
    `radial-gradient(ellipse 70% 56% at 90% 40%, ${mixTransparent(
      stripAt(strips, 0.65),
      44
    )} 0%, transparent 54%)`
  );

  // Mid-depth radial
  back.push(
    `radial-gradient(ellipse 88% 72% at 55% 52%, ${mixTransparent(
      stripAt(strips, 0.5),
      22
    )} 0%, transparent 62%)`
  );

  // Front: chromatic vignette (replaces pure black edge)
  back.push(
    `radial-gradient(ellipse 108% 102% at 50% 50%, transparent 42%, color-mix(in srgb, ${edgeTint} ${edgeStrength}%, transparent) 100%)`
  );

  return {
    baseColor,
    layers: back,
  };
}
