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
};

export type TextTheme = {
  textClass: string;
  artistTextClass: string;
  textMutedClass: string;
  progressTrackStyle: { backgroundColor: string };
  progressFillClass: string;
  skeletonClass: string;
};

/**
 * Whether to use dark (black) text vs light text. Prefers **whole-cover** `avgLuminance`
 * because theme swatches are chroma-boosted and can read "light" on very dark art.
 */
export function shouldUseDarkTextForBackdrop(
  theme: GradientPalette | null,
  avgLuminance?: number | null
): boolean {
  if (!theme) return false;

  const themeBlend =
    getLuminance(theme[0]) * 0.45 +
    getLuminance(theme[1]) * 0.3 +
    getLuminance(theme[2]) * 0.25;

  if (avgLuminance != null && Number.isFinite(avgLuminance)) {
    const L = Math.max(0, Math.min(1, avgLuminance));
    if (L < 0.26) return false;
    if (L > 0.42) return true;
    const mixed = L * 0.62 + themeBlend * 0.38;
    return mixed > 0.34;
  }

  return themeBlend > 0.34;
}

export function getTextThemeFromColors(
  colors: GradientPalette | null,
  avgLuminance?: number | null
): TextTheme {
  if (!colors) {
    return {
      textClass: "text-white",
      artistTextClass: "text-white/80",
      textMutedClass: "text-white/70",
      progressTrackStyle: { backgroundColor: "rgba(55, 65, 81, 0.25)" },
      progressFillClass: "bg-white",
      skeletonClass: "bg-gray-700",
    };
  }
  const isLightBg = shouldUseDarkTextForBackdrop(colors, avgLuminance);
  return {
    textClass: isLightBg ? "text-black" : "text-white",
    artistTextClass: isLightBg ? "text-black/80" : "text-white/80",
    textMutedClass: isLightBg ? "text-gray-700" : "text-white/70",
    progressTrackStyle: isLightBg
      ? { backgroundColor: "rgba(127, 131, 136, 0.3)" }
      : { backgroundColor: "rgba(55, 65, 81, 0.25)" },
    progressFillClass: isLightBg ? "bg-black/80" : "bg-white",
    skeletonClass: isLightBg ? "bg-gray-400" : "bg-gray-700",
  };
}

export const STRIP_COUNT = 8;

function themeFromStrips(strips: string[]): GradientPalette {
  if (strips.length === 0) return ["#2e2c38", "#2e2c38", "#2e2c38"];
  const mid = Math.floor(strips.length / 2);
  return [strips[0], strips[mid], strips[strips.length - 1]] as const;
}

/** Reject near-black, near-white, and very low saturation — we only want main chromatic colors. */
function isChromaticPixel(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const saturation = max === 0 ? 0 : (max - min) / max;
  const bright = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
  if (saturation < 0.1) return false;
  if (max < 44 && bright < 0.2) return false;
  if (min > 238 && bright > 0.85) return false;
  if (bright < 0.09) return false;
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

/** Keep strip colors out of pure/near black and white so backdrops stay chromatic. */
function clampChromaticRgb(r: number, g: number, b: number): [number, number, number] {
  const lo = 34;
  const hi = 236;
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
  return Math.max(0.75, 0.75 + avg * 3.0);
}

/**
 * Sample `stripCount` horizontal bands (top → bottom of cover art).
 * Each band: average of highest-scoring saturated pixels; falls back to raw average if needed.
 */
export function extractVerticalStripColors(
  imageData: ImageData | PixelBuffer,
  stripCount: number = STRIP_COUNT
): string[] {
  const { data, width, height } = imageData;
  const step = Math.max(2, Math.floor(Math.min(width, height) / 14));
  const cx = width / 2;
  const cy = height / 2;
  const maxRadius = Math.min(width, height) / 2;
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
        const sc = pixelScore(r, g, b, cx, cy, x, y, maxRadius);
        if (sc >= 0) scored.push({ r, g, b, score: sc });
      }
    }

    let r: number;
    let g: number;
    let b: number;

    if (scored.length >= 4) {
      scored.sort((a, b) => b.score - a.score);
      const take = Math.max(3, Math.ceil(scored.length * 0.22));
      const slice = scored.slice(0, take);
      r = slice.reduce((acc, p) => acc + p.r, 0) / slice.length;
      g = slice.reduce((acc, p) => acc + p.g, 0) / slice.length;
      b = slice.reduce((acc, p) => acc + p.b, 0) / slice.length;
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

    const [sr, sg, sb] = saturateRgb(r, g, b, 1.28);
    const boostCapped = Math.min(boost, 1.22);
    const [cr, cg, cb] = clampChromaticRgb(
      sr * 1.08 * boostCapped,
      sg * 1.08 * boostCapped,
      sb * 1.08 * boostCapped
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
  const avgLuminance = sampleMeanLuminance(imageData);
  return { strips, theme: themeFromStrips(strips), avgLuminance };
}

export function extractColorsFromImageUrl(
  imageUrl: string
): Promise<AlbumColorResult | null> {
  return new Promise((resolve) => {
    const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(imageUrl)}`;
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const size = 100;
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
