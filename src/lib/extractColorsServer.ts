import sharp from "sharp";
import {
  extractAlbumColors,
  type AlbumColorResult,
} from "./extractColors";

export type {
  TextTheme,
  GradientPalette,
} from "./extractColors";
export { getTextThemeFromColors } from "./extractColors";

/**
 * Server-side color extraction. Fetches image and extracts vertical strip palette using Sharp.
 */
export async function extractColorsFromImageUrlServer(
  imageUrl: string
): Promise<AlbumColorResult | null> {
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
    return extractAlbumColors(imageData);
  } catch {
    return null;
  }
}
