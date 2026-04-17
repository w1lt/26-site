/**
 * Layered backdrop from album palette: soft glows + even edge vignette (not bottom-only).
 */
export function buildAlbumBackdropGradient(colors: [string, string]): string {
  const [center, edge] = colors;
  return [
    // Primary — more color held across the frame (lighter overall)
    `radial-gradient(ellipse 135% 110% at 44% 36%, ${center} 0%, color-mix(in srgb, ${center} 55%, transparent) 52%, transparent 78%)`,
    // Secondary — tinted atmosphere, still soft
    `radial-gradient(ellipse 125% 120% at 50% 52%, ${edge} 0%, color-mix(in srgb, ${edge} 45%, transparent) 58%, transparent 85%)`,
    // Light edge darkening only (was heavy; kept subtle so base + art read brighter)
    `radial-gradient(ellipse 95% 95% at 50% 50%, transparent 48%, rgba(18, 18, 22, 0.28) 100%)`,
  ].join(", ");
}
