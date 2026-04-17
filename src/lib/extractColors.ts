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

/** Pixel buffer compatible with ImageData (works for canvas or Sharp output) */
type PixelBuffer = { data: Uint8Array | Uint8ClampedArray; width: number; height: number };

/**
 * Extract colors from an image, biasing toward vibrant/saturated colors
 * and favoring inner/center pixels for clearer edge with the spinning disk.
 * Returns [centerColor, edgeColor] - uses first for solid background.
 */
export function extractGradientColors(imageData: ImageData | PixelBuffer): [string, string] {
  const { data, width, height } = imageData;
  const step = Math.max(4, Math.floor(Math.min(width, height) / 6));
  const cx = width / 2;
  const cy = height / 2;
  const maxRadius = Math.min(width, height) / 2;
  const samples: { r: number; g: number; b: number; score: number }[] = [];
  let totalBrightness = 0;
  let sampleCount = 0;

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      if (a < 128) continue;

      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const brightness = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
      const saturation = max === 0 ? 0 : (max - min) / max;

      totalBrightness += brightness;
      sampleCount++;

      // Strongly favor saturated colors - ignore near-black/white/gray
      if (saturation < 0.1) continue;

      const dx = x - cx;
      const dy = y - cy;
      const distFromCenter = Math.sqrt(dx * dx + dy * dy);
      const innerBias = Math.max(0, 1 - distFromCenter / (maxRadius * 0.6));

      // saturation^6 heavily favors any actual color; lower brightness weight so dim blobs (e.g. dark blue) can win
      const score =
        Math.pow(saturation, 6) * (0.25 + brightness * 0.5) * (0.5 + innerBias * 0.5);
      samples.push({ r, g, b, score });
    }
  }

  if (samples.length === 0) return ["#18181b", "#27272a"];

  const avgBrightness = sampleCount > 0 ? totalBrightness / sampleCount : 0.5;
  const brightnessBoost = Math.max(.75, 0.75 + avgBrightness * 3.0);

  samples.sort((a, b) => b.score - a.score);
  const vibrantCount = Math.max(3, Math.min(40, Math.ceil(samples.length * 0.2)));
  const vibrant = samples.slice(0, vibrantCount);
  const r1 = vibrant.reduce((s, p) => s + p.r, 0) / vibrant.length;
  const g1 = vibrant.reduce((s, p) => s + p.g, 0) / vibrant.length;
  const b1 = vibrant.reduce((s, p) => s + p.b, 0) / vibrant.length;

  const allR = samples.reduce((s, p) => s + p.r, 0) / samples.length;
  const allG = samples.reduce((s, p) => s + p.g, 0) / samples.length;
  const allB = samples.reduce((s, p) => s + p.b, 0) / samples.length;

  const maxChannel = 200;
  const centerColor = rgbToHex(
    Math.min(maxChannel, r1 * 1.12 * brightnessBoost),
    Math.min(maxChannel, g1 * 1.12 * brightnessBoost),
    Math.min(maxChannel, b1 * 1.12 * brightnessBoost)
  );
  const edgeMaxChannel = 60;
  const edgeColor = rgbToHex(
    Math.min(edgeMaxChannel, allR * 0.15),
    Math.min(edgeMaxChannel, allG * 0.15),
    Math.min(edgeMaxChannel, allB * 0.15)
  );
  return [centerColor, edgeColor];
}

export function extractColorsFromImageUrl(
  imageUrl: string
): Promise<[string, string] | null> {
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
          resolve(extractGradientColors(imageData));
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
