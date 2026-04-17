import SpotifyPage from "@/components/pages/SpotifyPage";
import { getNowPlaying } from "@/app/actions/spotify";
import {
  extractColorsFromImageUrlServer,
  getTextThemeFromColors,
} from "@/lib/extractColorsServer";
import { buildAlbumBackdropGradient } from "@/lib/albumGradient";

export default async function Home() {
  const initialTrack = await getNowPlaying();
  const initialColors =
    initialTrack?.albumArt != null
      ? await extractColorsFromImageUrlServer(initialTrack.albumArt)
      : null;
  const initialTextTheme = getTextThemeFromColors(initialColors);

  const serverGradientStyle =
    initialColors &&
    ({
      backgroundColor: "#1a1a20",
      backgroundImage: buildAlbumBackdropGradient(initialColors),
    } as const);

  return (
    <main className="flex min-h-dvh items-center justify-center overflow-hidden bg-transparent p-4">
      {serverGradientStyle && (
        <div
          className="fixed inset-0 -z-10 min-h-dvh"
          style={serverGradientStyle}
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
