import SpotifyPage from "@/components/pages/SpotifyPage";
import { getNowPlaying } from "@/app/actions/spotify";
import {
  extractColorsFromImageUrlServer,
  getTextThemeFromColors,
} from "@/lib/extractColorsServer";

export default async function Home() {
  const initialTrack = await getNowPlaying();
  const initialColors =
    initialTrack?.albumArt != null
      ? await extractColorsFromImageUrlServer(initialTrack.albumArt)
      : null;
  const initialTextTheme = getTextThemeFromColors(initialColors);

  const serverGradient =
    initialColors &&
    `radial-gradient(circle 120vmax at 50% 50%, ${initialColors[0]} 0%, ${initialColors[1]} 95%, ${initialColors[1]} 95%)`;

  return (
    <main className="flex min-h-dvh items-center justify-center overflow-hidden bg-transparent p-4">
      {serverGradient && (
        <div
          className="fixed inset-0 -z-10 min-h-dvh"
          style={{ background: serverGradient }}
          aria-hidden
        />
      )}
      <SpotifyPage
        initialTrack={initialTrack}
        initialColors={initialColors}
        initialTextTheme={initialTextTheme}
      />
    </main>
  );
}
