import SpotifyPage from "@/components/pages/SpotifyPage";
import { getNowPlaying } from "@/app/actions/spotify";
import { extractColorsFromImageUrlServer } from "@/lib/extractColorsServer";

export default async function Home() {
  const initialTrack = await getNowPlaying();
  const initialAlbumColors =
    initialTrack?.albumArt != null
      ? await extractColorsFromImageUrlServer(initialTrack.albumArt)
      : null;

  return (
    <main className="flex min-h-dvh items-center justify-center overflow-hidden bg-transparent p-4">
      <SpotifyPage
        initialTrack={initialTrack}
        initialAlbumColors={initialAlbumColors}
      />
    </main>
  );
}
