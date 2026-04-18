import sharp from "sharp";
import {
  extractAlbumColors,
  EXTRACT_THUMB_SIZE,
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
      .resize(EXTRACT_THUMB_SIZE, EXTRACT_THUMB_SIZE)
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
