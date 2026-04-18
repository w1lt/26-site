"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useRef,
} from "react";
import { getNowPlaying, type SpotifyTrack } from "@/app/actions/spotify";
import {
  extractColorsFromImageUrl,
  type AlbumColorResult,
} from "@/lib/extractColors";
import { buildAlbumBackdropSurface } from "@/lib/albumGradient";
import { AlbumBackdrop } from "@/components/AlbumBackdrop";

const IDLE_POLL_MS = 60_000;

// Helper function to format milliseconds to MM:SS
const formatTime = (ms: number) => {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

const formatMinsAgo = (playedAt: string) => {
  const mins = Math.floor((Date.now() - new Date(playedAt).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins === 1) return "1 min ago";
  return `${mins} mins ago`;
};

function SpotifyPage({
  initialTrack,
  initialAlbumColors,
}: {
  initialTrack?: SpotifyTrack | null;
  initialAlbumColors?: AlbumColorResult | null;
}) {
  const [track, setTrack] = useState<SpotifyTrack | null>(initialTrack ?? null);
  const [displayTrack, setDisplayTrack] = useState<SpotifyTrack | null>(
    initialTrack ?? null
  );
  const [loading, setLoading] = useState(initialTrack === undefined);
  const [error, setError] = useState(false);
  const [currentProgress, setCurrentProgress] = useState(
    initialTrack?.progressMs ?? 0
  );
  const displayProgress =
    displayTrack?.songUrl === track?.songUrl
      ? currentProgress
      : (displayTrack?.durationMs ?? displayTrack?.progressMs ?? 0);
  const isInitialLoad = useRef(initialTrack === undefined);
  const progressInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const syncTimeRef = useRef(Date.now());
  const progressAtSyncRef = useRef(initialTrack?.progressMs ?? 0);
  const halfwayFetchedRef = useRef(false);
  const endFetchedRef = useRef(false);
  const [, setTick] = useState(0);
  const [albumColors, setAlbumColors] = useState<AlbumColorResult | null>(
    initialAlbumColors ?? null
  );
  const trackRef = useRef<SpotifyTrack | null>(initialTrack ?? null);

  useEffect(() => {
    trackRef.current = track;
  }, [track]);

  const fetchSpotifyData = useCallback(async () => {
    try {
      const data = await getNowPlaying();
      const prevTrack = trackRef.current;
      const isTrackChange =
        data?.songUrl &&
        prevTrack?.songUrl &&
        data.songUrl !== prevTrack.songUrl;

      if (isTrackChange) {
        halfwayFetchedRef.current = false;
        endFetchedRef.current = false;
      }

      setTrack(data);
      if (!data) {
        setAlbumColors(null);
        setDisplayTrack(null);
      } else if (!isTrackChange) {
        setDisplayTrack(data);
      }
      if (data?.progressMs !== undefined) {
        const now = Date.now();
        syncTimeRef.current = now;
        progressAtSyncRef.current = data.progressMs;
        setCurrentProgress(data.progressMs);
        if (data.durationMs) {
          const d = data.durationMs;
          const p = data.progressMs;
          if (p >= d / 2 - 400) halfwayFetchedRef.current = true;
          if (p >= d - 600) endFetchedRef.current = true;
        }
      }

      if (isInitialLoad.current) {
        setLoading(false);
        isInitialLoad.current = false;
      }
    } catch (err) {
      console.error("Error fetching Spotify data:", err);
      setError(true);
      if (isInitialLoad.current) {
        setLoading(false);
        isInitialLoad.current = false;
      }
    }
  }, []);

  useEffect(() => {
    if (initialTrack === undefined) {
      fetchSpotifyData();
    }
  }, [fetchSpotifyData, initialTrack]);

  /** Seed sync + threshold flags from server-rendered track */
  useEffect(() => {
    if (
      initialTrack === undefined ||
      initialTrack === null ||
      !initialTrack.durationMs ||
      initialTrack.progressMs === undefined
    ) {
      return;
    }
    syncTimeRef.current = Date.now();
    progressAtSyncRef.current = initialTrack.progressMs;
    const d = initialTrack.durationMs;
    const p = initialTrack.progressMs;
    if (p >= d / 2 - 400) halfwayFetchedRef.current = true;
    if (p >= d - 600) endFetchedRef.current = true;
  }, [initialTrack?.songUrl]);

  /** One fetch when resuming playback so progress/duration resync */
  const wasPlayingRef = useRef<boolean | undefined>(undefined);
  useEffect(() => {
    const playing = !!track?.isPlaying;
    if (wasPlayingRef.current === false && playing) {
      fetchSpotifyData();
    }
    wasPlayingRef.current = playing;
  }, [track?.isPlaying, fetchSpotifyData]);

  /** Slow poll when idle / paused / no playback */
  useEffect(() => {
    if (track?.isPlaying) return;
    const id = setInterval(fetchSpotifyData, IDLE_POLL_MS);
    return () => clearInterval(id);
  }, [track?.isPlaying, fetchSpotifyData]);

  /** Playing: advance progress from server sync; fetch at ~halfway and ~end only */
  useEffect(() => {
    if (progressInterval.current) {
      clearInterval(progressInterval.current);
      progressInterval.current = null;
    }

    if (!track?.isPlaying || !track?.durationMs) {
      return;
    }

    const durationMs = track.durationMs;

    progressInterval.current = setInterval(() => {
      const est = Math.min(
        progressAtSyncRef.current + (Date.now() - syncTimeRef.current),
        durationMs
      );
      setCurrentProgress(est);

      if (!halfwayFetchedRef.current && est >= durationMs / 2) {
        halfwayFetchedRef.current = true;
        fetchSpotifyData();
      }
      if (!endFetchedRef.current && est >= durationMs - 400) {
        endFetchedRef.current = true;
        fetchSpotifyData();
      }
    }, 1000);

    return () => {
      if (progressInterval.current) {
        clearInterval(progressInterval.current);
        progressInterval.current = null;
      }
    };
  }, [track?.isPlaying, track?.durationMs, track?.songUrl, fetchSpotifyData]);

  useEffect(() => {
    if (!track?.isPlaying && track?.playedAt) {
      const interval = setInterval(() => setTick((t) => t + 1), 60000);
      return () => clearInterval(interval);
    }
  }, [track?.isPlaying, track?.playedAt]);

  useEffect(() => {
    if (!track?.albumArt) {
      setAlbumColors(null);
      return;
    }
    /** Server already extracted for this cover — skip client (canvas) pass to avoid a color flash vs Sharp SSR. */
    const sameCoverAsSsr =
      initialAlbumColors != null &&
      initialTrack != null &&
      track.albumArt === initialTrack.albumArt;
    if (sameCoverAsSsr) {
      return;
    }
    let cancelled = false;
    const albumArt = track.albumArt;
    extractColorsFromImageUrl(albumArt).then((result) => {
      if (cancelled || albumArt !== trackRef.current?.albumArt) return;
      requestAnimationFrame(() => {
        if (cancelled || albumArt !== trackRef.current?.albumArt) return;
        setAlbumColors(result);
        setDisplayTrack(trackRef.current);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [track?.albumArt, initialAlbumColors, initialTrack]);

  /**
   * Backdrop stays dark/cinematic; white text reads consistently. The text column
   * uses `opacity: 0.8` so labels share one alpha against the gradient.
   */
  const titleTextClass = "text-white";
  const textClass = "text-white";
  const artistTextClass = "text-white";
  /** Explicit badge: white pill on dark UI */
  const artistOnLightBackground = false;
  const textMutedClass = "text-white";
  const timeTextClass = "text-white";
  const cardClass = "";
  const progressTrackStyle = {
    backgroundColor: "rgba(255, 255, 255, 0.2)",
  };
  const progressFillClass = "bg-white";

  /** Stable per-track seed so each album gets a unique but repeatable blob layout. */
  const backdropSeed =
    displayTrack?.albumArt ?? initialTrack?.albumArt ?? null;
  const backdropSurface = useMemo(
    () =>
      albumColors
        ? buildAlbumBackdropSurface(
            albumColors.strips,
            albumColors.avgLuminance,
            albumColors.palette ?? [],
            backdropSeed
          )
        : null,
    [albumColors, backdropSeed]
  );

  return (
    <div className="w-full max-w-sm overflow-hidden">
      <div
        className="fixed inset-0 -z-20"
        style={{
          background: backdropSurface?.baseColor ?? "#1a1a20",
        }}
        aria-hidden
      />
      {backdropSurface && albumColors && (
        <AlbumBackdrop
          baseColor={backdropSurface.baseColor}
          blobs={backdropSurface.blobs}
          vignette={backdropSurface.vignette}
          gradientOpacity={backdropSurface.gradientOpacity}
          paletteWash={backdropSurface.paletteWash}
        />
      )}
      <div className={`relative z-10 ${cardClass}`}>
        {error && (
          <p
            className={`text-xl mb-4 ${textClass}`}
            style={{ opacity: 0.8 }}
          >
            Unable to load Spotify data. Check back later!
          </p>
        )}

        {!loading && !error && displayTrack && (
          <div className="flex flex-col items-center max-w-sm pt-4">
            <div className="w-full overflow-hidden pb-2 md:p-4 flex justify-center mb-6">
              <div
                className="relative aspect-square overflow-hidden rounded-full touch-none select-none"
                style={{
                  width: "min(95%, 52vh)",
                  maxWidth: "100%",
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={displayTrack.albumArt}
                  alt={`${displayTrack.name} album art`}
                  className="w-full h-full object-cover shadow-2xl"
                  style={{
                    animation: displayTrack.isPlaying
                      ? "spin 6s linear infinite"
                      : "none",
                    borderRadius: "50%",
                    clipPath: "circle(50% at 50% 50%)",
                    WebkitClipPath: "circle(50% at 50% 50%)",
                    maskImage:
                      "radial-gradient(circle at 50% 50%, transparent 5%, black 5%)",
                    WebkitMaskImage:
                      "radial-gradient(circle at 50% 50%, transparent 5%, black 5%)",
                  }}
                />
              </div>
            </div>
            <div className="w-full pl-2 pr-4 md:px-4">
              <div className="flex flex-col items-start" style={{ opacity: 0.8 }}>
                <div className="flex flex-col items-start w-full gap-0">
                  <h2
                    className={`text-xl md:text-3xl inline-block max-w-full truncate cursor-pointer leading-tight ${titleTextClass}`}
                    style={{ fontWeight: 700 }}
                    onClick={() => window.open(displayTrack.songUrl, "_blank")}
                  >
                    {displayTrack.name}
                  </h2>
                  <div
                    className="flex items-center gap-1.5 w-full min-w-0"
                    style={{ marginTop: "3px" }}
                  >
                    {displayTrack.explicit ? (
                      <span
                        title="Explicit"
                        aria-label="Explicit"
                        style={{
                          boxSizing: "border-box",
                          width: "10px",
                          height: "10px",
                          minWidth: "10px",
                          minHeight: "10px",
                          maxWidth: "10px",
                          maxHeight: "10px",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                          margin: 0,
                          padding: 0,
                          border: "none",
                          borderRadius: "1.5px",
                          overflow: "hidden",
                          fontSize: "6px",
                          fontWeight: 700,
                          lineHeight: 1,
                          letterSpacing: "0.02em",
                          textTransform: "uppercase",
                          backgroundColor: artistOnLightBackground
                            ? "#000000"
                            : "#ffffff",
                          color: artistOnLightBackground ? "#ffffff" : "#000000",
                          opacity: 0.9,
                        }}
                      >
                        E
                      </span>
                    ) : null}
                    <p
                      className={`text-base md:text-lg inline-block min-w-0 flex-1 truncate cursor-pointer leading-tight ${artistTextClass}`}
                      onClick={() => window.open(displayTrack.artistUrl, "_blank")}
                    >
                      {displayTrack.artist}
                    </p>
                  </div>
                </div>

                {displayTrack.durationMs && (
                  <div className="w-full max-w-sm mx-auto mt-4">
                    <div
                      className="w-full rounded-full h-1"
                      style={{
                        ...progressTrackStyle,
                        marginBottom: "6px",
                      }}
                    >
                      <div
                        className={`h-1 rounded-full transition-[width] duration-1000 ${progressFillClass}`}
                        style={{
                          width: `${
                            (displayProgress / displayTrack.durationMs) *
                            100
                          }%`,
                        }}
                      />
                    </div>
                    <div
                      className={`flex justify-between ${timeTextClass}`}
                      style={{
                        fontSize: "11px",
                        lineHeight: 1,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      <span style={{ fontSize: "11px", lineHeight: 1 }}>
                        {formatTime(displayProgress)}
                      </span>
                      <span style={{ fontSize: "11px", lineHeight: 1 }}>
                        -{formatTime(
                          Math.max(0, displayTrack.durationMs - displayProgress)
                        )}
                      </span>
                    </div>
                  </div>
                )}

                {!displayTrack.isPlaying && displayTrack.playedAt && (
                  <p className={`text-sm mt-2 mb-4 ${textMutedClass}`}>
                    Stopped listening {formatMinsAgo(displayTrack.playedAt)}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {!loading && !error && !track && (
          <p
            className={`text-xl mb-6 ${textClass}`}
            style={{ opacity: 0.8 }}
          >
            No recent tracks found. Check back later!
          </p>
        )}
      </div>
    </div>
  );
}

export default SpotifyPage;
