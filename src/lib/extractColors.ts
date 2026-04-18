export function getLuminance(hex: string): number {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return 0;
  const r = parseInt(result[1], 16) / 255;
  const g = parseInt(result[2], 16) / 255;
  const b = parseInt(result[3], 16) / 255;
  const [rs, gs, bs] = [r, g, b].map((c) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  );
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

export function rgbToHex(r: number, g: number, b: number): string {
  return (
    "#" +
    [r, g, b]
      .map((x) => {
        const hex = Math.round(Math.max(0, Math.min(255, x))).toString(16);
        return hex.length === 1 ? "0" + hex : hex;
      })
      .join("")
  );
}

function saturateRgb(
  r: number,
  g: number,
  b: number,
  factor: number
): [number, number, number] {
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  const o = (c: number) => lum + (c - lum) * factor;
  return [
    Math.min(255, Math.max(0, o(r))),
    Math.min(255, Math.max(0, o(g))),
    Math.min(255, Math.max(0, o(b))),
  ];
}

type PixelBuffer = {
  data: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
};

/** Top / middle / bottom of vertical strip stack — for text contrast */
export type GradientPalette = readonly [string, string, string];

export type AlbumColorResult = {
  /** Strong colors per horizontal band, top → bottom of album art (maps to viewport height) */
  strips: string[];
  theme: GradientPalette;
  /** Mean relative luminance (0–1) over opaque pixels — how bright the cover is overall */
  avgLuminance: number;
  /** Distinct high-scoring chromatic swatches (not band-averaged) — for animated palette wash */
  palette: string[];
};

/** Must match `albumGradient` — low chroma ⇒ B&W-style cover with synthetic accent UI. */
export const GRAYSCALE_CHROMA_THRESHOLD = 0.14;

/** 0–1 channel spread (max−min)/max — same notion as `albumGradient` grayscale detection. */
export function rgbChromaFromHex(hex: string): number {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return 0;
  const r = parseInt(m[1], 16);
  const g = parseInt(m[2], 16);
  const b = parseInt(m[3], 16);
  const max = Math.max(r, g, b);
  if (max === 0) return 0;
  return (max - Math.min(r, g, b)) / max;
}

export function maxChromaAcrossSwatches(colors: readonly string[]): number {
  if (!colors.length) return 0;
  let max = 0;
  for (const c of colors) max = Math.max(max, rgbChromaFromHex(c));
  return max;
}

/**
 * Monochrome / near-monochrome artwork: the backdrop still uses a **dark** base with
 * screened blobs (often synthetic hues). Photo luminance must not imply a “light page”.
 */
export function isGrayscaleArtwork(
  strips: readonly string[],
  palette?: readonly string[] | null
): boolean {
  const chromaPalette = palette?.length
    ? maxChromaAcrossSwatches(palette)
    : 0;
  const chromaStrips = strips.length ? maxChromaAcrossSwatches(strips) : 0;
  return Math.max(chromaPalette, chromaStrips) < GRAYSCALE_CHROMA_THRESHOLD;
}

export type TextTheme = {
  textClass: string;
  /** Song title — slightly more opaque than body text */
  titleTextClass: string;
  artistTextClass: string;
  textMutedClass: string;
  progressTrackStyle: { backgroundColor: string };
  progressFillClass: string;
  skeletonClass: string;
};

/**
 * UI always uses light-on-dark copy; the album backdrop stays in a dark register.
 * Extra parameters are ignored but kept so older call sites stay valid.
 */
export function getTextThemeFromColors(
  _colors?: GradientPalette | null,
  _avgLuminance?: number | null,
  _grayscaleCover?: boolean
): TextTheme {
  return {
    textClass: "text-white",
    titleTextClass: "text-white",
    artistTextClass: "text-white",
    textMutedClass: "text-white",
    progressTrackStyle: { backgroundColor: "rgba(255, 255, 255, 0.2)" },
    progressFillClass: "bg-white",
    skeletonClass: "bg-gray-700",
  };
}

export const STRIP_COUNT = 8;

/**
 * Downscaled size used for palette/strip analysis (not device screen pixels).
 * Larger ⇒ more sample points vs. cover detail so picks stay **distinct** rather than smeared.
 */
export const EXTRACT_THUMB_SIZE = 128;

function themeFromStrips(strips: string[]): GradientPalette {
  if (strips.length === 0) return ["#2e2c38", "#2e2c38", "#2e2c38"];
  const mid = Math.floor(strips.length / 2);
  return [strips[0], strips[mid], strips[strips.length - 1]] as const;
}

function themeFromPalette(palette: string[]): GradientPalette {
  if (palette.length === 0) return ["#2e2c38", "#2e2c38", "#2e2c38"];
  if (palette.length === 1) return [palette[0], palette[0], palette[0]];
  if (palette.length === 2) return [palette[0], palette[1], palette[1]];
  const mid = Math.floor(palette.length / 2);
  return [palette[0], palette[mid], palette[palette.length - 1]] as const;
}

/** Reject near-black, near-white, and very low saturation — we only want main chromatic colors. */
function isChromaticPixel(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const saturation = max === 0 ? 0 : (max - min) / max;
  const bright = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
  if (saturation < 0.1) return false;
  /**
   * Old rule `max < 44 && bright < 0.2` dropped **dark saturated reds** (R channel often under ~44 on black posters).
   * Only treat very dark + low-chroma as mud.
   */
  if (max < 44 && bright < 0.2 && saturation < 0.38) return false;
  if (min > 238 && bright > 0.85) return false;
  /** Near-black without chroma — skip; allow dark **saturated** primaries (typography, deep reds). */
  if (bright < 0.085 && saturation < 0.42) return false;
  if (bright > 0.92) return false;
  return true;
}

/** Looser filter for fallback averaging when no saturated samples exist. */
function isAcceptableFallbackPixel(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const bright = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
  if (max < 22 && bright < 0.12) return false;
  if (min > 252) return false;
  if (bright > 0.97) return false;
  return true;
}

/** Keep strip colors out of pure black/white but allow a wider luminance range than before. */
function clampChromaticRgb(r: number, g: number, b: number): [number, number, number] {
  const lo = 16;
  const hi = 248;
  const clamp = (c: number) => Math.min(hi, Math.max(lo, c));
  return [clamp(r), clamp(g), clamp(b)];
}

function pixelScore(
  r: number,
  g: number,
  b: number,
  cx: number,
  cy: number,
  x: number,
  y: number,
  maxRadius: number
): number {
  if (!isChromaticPixel(r, g, b)) return -1;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const brightness = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
  const saturation = max === 0 ? 0 : (max - min) / max;
  if (saturation < 0.08) return -1;
  const dx = x - cx;
  const dy = y - cy;
  const distFromCenter = Math.sqrt(dx * dx + dy * dy);
  const innerBias = Math.max(0, 1 - distFromCenter / (maxRadius * 0.65));
  return (
    Math.pow(saturation, 5) *
    (0.28 + brightness * 0.5) *
    (0.42 + innerBias * 0.58)
  );
}

/**
 * No radial “center wins” bias — use for grid / whole-image picks so edges and corners
 * contribute (closer to full-artwork sampling like system now-playing UIs).
 */
function pixelScoreRegional(r: number, g: number, b: number): number {
  if (!isChromaticPixel(r, g, b)) return -1;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const brightness = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
  const saturation = max === 0 ? 0 : (max - min) / max;
  if (saturation < 0.07) return -1;
  /**
   * Bright mid-tones used to dominate (e.g. center blue title) over **dark saturated** edge reds.
   * Bonus term lifts high-chroma, lower-luminance picks so poster typography still wins cells/bands.
   */
  const deepChroma =
    saturation > 0.62 && brightness > 0.038 && brightness < 0.44
      ? (0.4 - brightness) * saturation * 0.52
      : 0;
  const lum = 0.3 + brightness * 0.58 + deepChroma;
  return Math.pow(saturation, 2.85) * lum * (0.86 + saturation * 0.22);
}

function colorDistanceSq(
  r1: number,
  g1: number,
  b1: number,
  r2: number,
  g2: number,
  b2: number
): number {
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return dr * dr + dg * dg + db * db;
}

const PALETTE_MAX = 12;
/** Finer grid → more spatially distinct swatches (closer to full-image sampling). */
const SPATIAL_GRID = 5;
const PALETTE_MIN_DIST_SQ = 28 * 28;

function hueDistance(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
  const h1 = rgbToHue(r1, g1, b1);
  const h2 = rgbToHue(r2, g2, b2);
  const d = Math.abs(h1 - h2);
  return Math.min(d, 360 - d);
}

function rgbToHue(r: number, g: number, b: number): number {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d < 1e-6) return 0;
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return h * 60;
}

/** ~15° bins — enough to split red vs blue, not so many that sparse accents fragment. */
const HUE_BIN_SIZE = 15;
const HUE_BIN_COUNT = Math.ceil(360 / HUE_BIN_SIZE);

function hueBinIndex(r: number, g: number, b: number): number {
  const h = rgbToHue(r, g, b);
  let bidx = Math.floor(h / HUE_BIN_SIZE);
  if (bidx < 0) bidx = 0;
  if (bidx >= HUE_BIN_COUNT) bidx = HUE_BIN_COUNT - 1;
  return bidx;
}

type ScoredSample = { r: number; g: number; b: number; score: number };

/**
 * Hue bins decide **which family** wins (coverage beats sparse neon).
 * The returned RGB is a **real scored pixel** from that family — not channel medians (those read as muddy “averages”).
 */
function pickRepresentativeByHueCoverage(
  samples: ScoredSample[]
): ScoredSample | null {
  if (samples.length === 0) return null;
  if (samples.length === 1) return samples[0]!;

  const byBin = new Map<number, ScoredSample[]>();
  for (const p of samples) {
    const bi = hueBinIndex(p.r, p.g, p.b);
    const list = byBin.get(bi);
    if (list) list.push(p);
    else byBin.set(bi, [p]);
  }

  let bestBin = -1;
  let bestMass = -1;
  for (const [bi, arr] of byBin) {
    let mass = 0;
    for (const p of arr) {
      mass += 1 + Math.sqrt(Math.max(0, p.score));
    }
    if (mass > bestMass) {
      bestMass = mass;
      bestBin = bi;
    }
  }

  const winners = byBin.get(bestBin);
  if (!winners || winners.length === 0) return samples[0]!;

  /** Strongest chroma sample in the winning bin (ties: stable order). */
  let pick = winners[0]!;
  for (let i = 1; i < winners.length; i++) {
    const p = winners[i]!;
    if (p.score > pick.score) pick = p;
  }
  return { r: pick.r, g: pick.g, b: pick.b, score: pick.score };
}

function collectScoredSamplesInRect(
  data: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  step: number
): ScoredSample[] {
  const out: ScoredSample[] = [];
  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      const i = (y * width + x) * 4;
      if (data[i + 3] < 128) continue;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const sc = pixelScoreRegional(r, g, b);
      if (sc > 0) out.push({ r, g, b, score: sc });
    }
  }
  return out;
}

function bestPixelInRect(
  data: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  step: number
): { r: number; g: number; b: number; score: number } | null {
  const samples = collectScoredSamplesInRect(
    data,
    width,
    height,
    x0,
    y0,
    x1,
    y1,
    step
  );
  return pickRepresentativeByHueCoverage(samples);
}

/**
 * One winner per grid cell (row-major order) so the wash follows the artwork spatially,
 * with deduping that prefers hue separation — not a global average.
 */
export function extractDistinctPalette(
  imageData: ImageData | PixelBuffer,
  maxColors: number = PALETTE_MAX
): string[] {
  const { data, width, height } = imageData;
  /** Finer step on the analysis thumb so cells see real edge/detail, not one blended block */
  const step = Math.max(2, Math.floor(Math.min(width, height) / 32));

  const cellW = width / SPATIAL_GRID;
  const cellH = height / SPATIAL_GRID;
  const ordered: { r: number; g: number; b: number; score: number }[] = [];

  for (let gy = 0; gy < SPATIAL_GRID; gy++) {
    for (let gx = 0; gx < SPATIAL_GRID; gx++) {
      const x0 = Math.floor(gx * cellW);
      const y0 = Math.floor(gy * cellH);
      const x1 = gx === SPATIAL_GRID - 1 ? width : Math.floor((gx + 1) * cellW);
      const y1 = gy === SPATIAL_GRID - 1 ? height : Math.floor((gy + 1) * cellH);
      const best = bestPixelInRect(data, width, height, x0, y0, x1, y1, step);
      if (best) ordered.push(best);
    }
  }

  if (ordered.length === 0) return [];

  const deduped: { r: number; g: number; b: number }[] = [];
  for (const c of ordered) {
    if (deduped.length >= maxColors) break;
    const tooClose = deduped.some((p) => {
      const dsq = colorDistanceSq(p.r, p.g, p.b, c.r, c.g, c.b);
      const dh = hueDistance(p.r, p.g, p.b, c.r, c.g, c.b);
      return dsq < 26 * 26 && dh < 16;
    });
    if (!tooClose) deduped.push({ r: c.r, g: c.g, b: c.b });
  }

  if (deduped.length < 3) {
    for (const c of ordered) {
      if (deduped.length >= maxColors) break;
      const dup = deduped.some(
        (p) => colorDistanceSq(p.r, p.g, p.b, c.r, c.g, c.b) < 20 * 20
      );
      if (!dup) deduped.push({ r: c.r, g: c.g, b: c.b });
    }
  }

  const out: string[] = [];
  for (const p of deduped) {
    const [sr, sg, sb] = saturateRgb(p.r, p.g, p.b, 1.22);
    const [cr, cg, cb] = clampChromaticRgb(sr * 1.06, sg * 1.06, sb * 1.06);
    out.push(rgbToHex(cr, cg, cb));
  }
  return out;
}

function globalBrightnessBoost(
  data: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  step: number
): number {
  let total = 0;
  let count = 0;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      if (data[i + 3] < 128) continue;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      total += (r * 0.299 + g * 0.587 + b * 0.114) / 255;
      count++;
    }
  }
  const avg = count > 0 ? total / count : 0.5;
  // Wide range: dark covers stay darker, bright covers lift more (old curve floored ~0.75 for all).
  const raw = 0.36 + avg * 1.86;
  return Math.max(0.34, Math.min(1.44, raw));
}

/** Per-band spread so strips aren’t all pulled to the same mid luminance. */
function stripBrightnessSpread(r: number, g: number, b: number): number {
  const bright = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
  return Math.max(0.64, Math.min(1.46, 1 + 0.92 * (bright - 0.46)));
}

/**
 * Sample `stripCount` horizontal bands (top → bottom of cover art).
 * Each band: best regional chroma sample (no center bias); fallbacks average loose pixels if needed.
 */
export function extractVerticalStripColors(
  imageData: ImageData | PixelBuffer,
  stripCount: number = STRIP_COUNT
): string[] {
  const { data, width, height } = imageData;
  const step = Math.max(2, Math.floor(Math.min(width, height) / 16));
  const boost = globalBrightnessBoost(data, width, height, step);

  const strips: string[] = [];
  const bandH = height / stripCount;

  for (let s = 0; s < stripCount; s++) {
    const y0 = Math.floor(s * bandH);
    const y1 = s === stripCount - 1 ? height : Math.floor((s + 1) * bandH);
    const scored: { r: number; g: number; b: number; score: number }[] = [];
    const fallbackChroma: { r: number; g: number; b: number }[] = [];
    const fallbackLoose: { r: number; g: number; b: number }[] = [];

    for (let y = y0; y < y1; y += step) {
      for (let x = 0; x < width; x += step) {
        const i = (y * width + x) * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const a = data[i + 3];
        if (a < 128) continue;
        if (isChromaticPixel(r, g, b)) fallbackChroma.push({ r, g, b });
        if (isAcceptableFallbackPixel(r, g, b)) fallbackLoose.push({ r, g, b });
        const sc = pixelScoreRegional(r, g, b);
        if (sc >= 0) scored.push({ r, g, b, score: sc });
      }
    }

    let r: number;
    let g: number;
    let b: number;

    if (scored.length >= 1) {
      /** Hue-coverage winner: dominant family in the band, not one neon outlier pixel */
      const top = pickRepresentativeByHueCoverage(scored);
      if (!top) {
        strips.push(s > 0 ? strips[s - 1] : "#3a3848");
        continue;
      }
      r = top.r;
      g = top.g;
      b = top.b;
    } else if (fallbackChroma.length > 0) {
      r = fallbackChroma.reduce((acc, p) => acc + p.r, 0) / fallbackChroma.length;
      g = fallbackChroma.reduce((acc, p) => acc + p.g, 0) / fallbackChroma.length;
      b = fallbackChroma.reduce((acc, p) => acc + p.b, 0) / fallbackChroma.length;
    } else if (fallbackLoose.length > 0) {
      r = fallbackLoose.reduce((acc, p) => acc + p.r, 0) / fallbackLoose.length;
      g = fallbackLoose.reduce((acc, p) => acc + p.g, 0) / fallbackLoose.length;
      b = fallbackLoose.reduce((acc, p) => acc + p.b, 0) / fallbackLoose.length;
    } else {
      strips.push(s > 0 ? strips[s - 1] : "#3a3848");
      continue;
    }

    const [sr, sg, sb] = saturateRgb(r, g, b, 1.1);
    const stripSpread = stripBrightnessSpread(r, g, b);
    const combined = Math.min(1.4, boost * stripSpread) * 1.04;
    const [cr, cg, cb] = clampChromaticRgb(
      sr * combined,
      sg * combined,
      sb * combined
    );
    strips.push(rgbToHex(cr, cg, cb));
  }

  return strips;
}

function relativeLuminanceFromBytes(r: number, g: number, b: number): number {
  const lin = (c: number) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  const rs = lin(r);
  const gs = lin(g);
  const bs = lin(b);
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

/** Average WCAG relative luminance of opaque pixels (same metric as `getLuminance` on hex). */
export function sampleMeanLuminance(imageData: ImageData | PixelBuffer): number {
  const { data, width, height } = imageData;
  const step = Math.max(2, Math.floor(Math.min(width, height) / 14));
  let sum = 0;
  let count = 0;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      if (data[i + 3] < 128) continue;
      sum += relativeLuminanceFromBytes(data[i], data[i + 1], data[i + 2]);
      count++;
    }
  }
  return count > 0 ? sum / count : 0.18;
}

export function extractAlbumColors(
  imageData: ImageData | PixelBuffer
): AlbumColorResult {
  const strips = extractVerticalStripColors(imageData, STRIP_COUNT);
  const palette = extractDistinctPalette(imageData, PALETTE_MAX);
  const avgLuminance = sampleMeanLuminance(imageData);
  const theme =
    palette.length >= 3 ? themeFromPalette(palette) : themeFromStrips(strips);
  return { strips, theme, avgLuminance, palette };
}

export function extractColorsFromImageUrl(
  imageUrl: string
): Promise<AlbumColorResult | null> {
  return new Promise((resolve) => {
    const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(imageUrl)}`;
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const size = EXTRACT_THUMB_SIZE;
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(null);
        return;
      }
      ctx.drawImage(img, 0, 0, size, size);
      let imageData: ImageData;
      try {
        imageData = ctx.getImageData(0, 0, size, size);
      } catch {
        resolve(null);
        return;
      }
      const runExtraction = () => {
        try {
          resolve(extractAlbumColors(imageData));
        } catch {
          resolve(null);
        }
      };
      if (typeof requestIdleCallback !== "undefined") {
        requestIdleCallback(runExtraction, { timeout: 100 });
      } else {
        setTimeout(runExtraction, 0);
      }
    };
    img.onerror = () => resolve(null);
    img.src = proxyUrl;
  });
}
