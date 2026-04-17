import sharp from "sharp";
import { extractGradientColors, getLuminance } from "./extractColors";

export type TextTheme = {
  textClass: string;
  artistTextClass: string;
  textMutedClass: string;
  progressTrackStyle: { backgroundColor: string };
  progressFillClass: string;
  skeletonClass: string;
};

/**
 * Server-side color extraction. Fetches image and extracts dominant colors using Sharp.
 * Use only in server components or server actions.
 */
export function getTextThemeFromColors(colors: [string, string] | null): TextTheme {
  if (!colors) {
    return {
      textClass: "text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.08)]",
      artistTextClass: "text-white/80 [text-shadow:0_1px_2px_rgba(0,0,0,0.08)]",
      textMutedClass: "text-white opacity-50 [text-shadow:0_1px_2px_rgba(0,0,0,0.08)]",
      progressTrackStyle: { backgroundColor: "rgba(55, 65, 81, 0.25)" },
      progressFillClass: "bg-white",
      skeletonClass: "bg-gray-700",
    };
  }
  const centerLum = getLuminance(colors[0]);
  const edgeLum = getLuminance(colors[1]);
  const isLightBg = centerLum * 0.7 + edgeLum * 0.3 > 0.3;
  const textShadow = isLightBg
    ? "[text-shadow:0_1px_2px_rgba(0,0,0,0.04)]"
    : "[text-shadow:0_1px_2px_rgba(0,0,0,0.08)]";
  return {
    textClass: isLightBg
      ? `text-black ${textShadow}`
      : `text-white ${textShadow}`,
    artistTextClass: isLightBg
      ? `text-black/80 ${textShadow}`
      : `text-white/80 ${textShadow}`,
    textMutedClass: isLightBg
      ? `text-gray-700 ${textShadow}`
      : `text-white opacity-50 ${textShadow}`,
    progressTrackStyle: isLightBg
      ? { backgroundColor: "rgba(127, 131, 136, 0.3)" }
      : { backgroundColor: "rgba(55, 65, 81, 0.25)" },
    progressFillClass: isLightBg ? "bg-black/80" : "bg-white",
    skeletonClass: isLightBg ? "bg-gray-400" : "bg-gray-700",
  };
}

export async function extractColorsFromImageUrlServer(
  imageUrl: string
): Promise<[string, string] | null> {
  try {
    const res = await fetch(imageUrl, { cache: "no-store" });
    if (!res.ok) return null;

    const buffer = await res.arrayBuffer();
    const { data, info } = await sharp(Buffer.from(buffer))
      .resize(100, 100)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const imageData = {
      data: new Uint8ClampedArray(data),
      width: info.width,
      height: info.height,
    };
    return extractGradientColors(imageData);
  } catch {
    return null;
  }
}
