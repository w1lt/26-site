"use server";

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.SPOTIFY_REFRESH_TOKEN;

const TOKEN_ENDPOINT = "https://accounts.spotify.com/api/token";
const NOW_PLAYING_ENDPOINT =
  "https://api.spotify.com/v1/me/player/currently-playing";
const RECENTLY_PLAYED_BASE =
  "https://api.spotify.com/v1/me/player/recently-played";

interface SpotifyTokenResponse {
  access_token: string;
}

interface SpotifyArtist {
  name: string;
  external_urls: {
    spotify: string;
  };
}

export interface SpotifyTrack {
  name: string;
  artist: string;
  artistUrl: string;
  albumArt: string;
  songUrl: string;
  isPlaying: boolean;
  /** Present when Spotify marks the track explicit (clean / non-explicit omitted). */
  explicit?: boolean;
  playedAt?: string;
  progressMs?: number;
  durationMs?: number;
}

/** One row from Get Recently Played Tracks (playback timestamp included). */
export interface RecentlyPlayedTrack {
  playedAt: string;
  name: string;
  artist: string;
  artistUrl: string;
  albumArt: string;
  songUrl: string;
  explicit?: boolean;
}

function mapRecentApiTrack(item: {
  played_at: string;
  track: {
    name: string;
    artists: SpotifyArtist[];
    album: { images: { url?: string }[] };
    external_urls: { spotify: string };
    explicit?: boolean;
  };
}): RecentlyPlayedTrack {
  const track = item.track;
  return {
    playedAt: item.played_at,
    name: track.name,
    artist: track.artists.map((a) => a.name).join(", "),
    artistUrl: track.artists[0]?.external_urls?.spotify ?? "",
    albumArt: track.album.images[0]?.url ?? "",
    songUrl: track.external_urls.spotify,
    explicit: Boolean(track.explicit),
  };
}

async function getAccessToken(): Promise<string> {
  if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
    throw new Error(
      "Missing Spotify credentials. Set SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, and SPOTIFY_REFRESH_TOKEN in .env.local"
    );
  }

  const basicAuth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString(
    "base64"
  );

  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: REFRESH_TOKEN,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const msg = body.error_description || body.error || response.statusText;
    throw new Error(`Spotify token error: ${msg} (${response.status})`);
  }

  const data: SpotifyTokenResponse = await response.json();
  return data.access_token;
}

export async function getNowPlaying(): Promise<SpotifyTrack | null> {
  try {
    const accessToken = await getAccessToken();

    // Try to get currently playing first
    const nowPlayingResponse = await fetch(NOW_PLAYING_ENDPOINT, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      cache: "no-store",
    });

    if (
      nowPlayingResponse.status === 204 ||
      nowPlayingResponse.status === 404
    ) {
      // Nothing playing, get recently played
      const recentlyPlayedResponse = await fetch(
        `${RECENTLY_PLAYED_BASE}?limit=1`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
          cache: "no-store",
        }
      );

      if (!recentlyPlayedResponse.ok) {
        return null;
      }

      const recentData = await recentlyPlayedResponse.json();

      if (recentData.items && recentData.items.length > 0) {
        const first = mapRecentApiTrack(recentData.items[0]);
        return {
          name: first.name,
          artist: first.artist,
          artistUrl: first.artistUrl,
          albumArt: first.albumArt,
          songUrl: first.songUrl,
          isPlaying: false,
          explicit: first.explicit,
          playedAt: first.playedAt,
        };
      }

      return null;
    }

    if (!nowPlayingResponse.ok) {
      return null;
    }

    const data = await nowPlayingResponse.json();

    if (!data.item) {
      return null;
    }

    return {
      name: data.item.name,
      artist: data.item.artists
        .map((artist: SpotifyArtist) => artist.name)
        .join(", "),
      artistUrl: data.item.artists[0]?.external_urls?.spotify || "",
      albumArt: data.item.album.images[0]?.url || "",
      songUrl: data.item.external_urls.spotify,
      isPlaying: data.is_playing,
      explicit: Boolean(data.item.explicit),
      progressMs: data.progress_ms,
      durationMs: data.item.duration_ms,
    };
  } catch (error) {
    console.error("Error fetching Spotify data:", error);
    return null;
  }
}

/**
 * Last N play events (max 50 per Spotify). Same API call whether or not something is playing.
 */
export async function getRecentlyPlayed(
  limit = 50
): Promise<RecentlyPlayedTrack[]> {
  try {
    const accessToken = await getAccessToken();
    const capped = Math.min(Math.max(1, limit), 50);
    const response = await fetch(
      `${RECENTLY_PLAYED_BASE}?limit=${capped}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        cache: "no-store",
      }
    );

    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    if (!data.items?.length) {
      return [];
    }

    return (
      data.items as Array<Parameters<typeof mapRecentApiTrack>[0]>
    ).map(mapRecentApiTrack);
  } catch (error) {
    console.error("Error fetching recently played:", error);
    return [];
  }
}
