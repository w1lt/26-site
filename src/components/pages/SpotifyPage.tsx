"use client";

import { useCallback, useEffect, useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { getNowPlaying, type SpotifyTrack } from "@/app/actions/spotify";
import {
  extractColorsFromImageUrl,
  shouldUseDarkTextForBackdrop,
  type AlbumColorResult,
} from "@/lib/extractColors";
import type { TextTheme } from "@/lib/extractColorsServer";
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
  initialTextTheme,
}: {
  initialTrack?: SpotifyTrack | null;
  initialAlbumColors?: AlbumColorResult | null;
  initialTextTheme?: TextTheme | null;
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
  const [tilt, setTilt] = useState({ rotateX: 0, rotateY: 0 });
  const isInitialLoad = useRef(initialTrack === undefined);
  const hasLoadedOnce = useRef(initialTrack !== undefined);
  const progressInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const syncTimeRef = useRef(Date.now());
  const progressAtSyncRef = useRef(initialTrack?.progressMs ?? 0);
  const halfwayFetchedRef = useRef(false);
  const endFetchedRef = useRef(false);
  const [previousTrackUrl, setPreviousTrackUrl] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const [albumColors, setAlbumColors] = useState<AlbumColorResult | null>(
    initialAlbumColors ?? null
  );
  const diskRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<SpotifyTrack | null>(initialTrack ?? null);
  const tiltTargetRef = useRef({ rotateX: 0, rotateY: 0 });

  useEffect(() => {
    trackRef.current = track;
  }, [track]);

  const updateTiltFromPointer = useCallback((clientX: number, clientY: number) => {
    const el = diskRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const radius = Math.min(rect.width, rect.height) / 2;

    const dx = clientX - centerX;
    const dy = clientY - centerY;
    const distFromCenter = Math.sqrt(dx * dx + dy * dy);
    const closeness = Math.max(0, 1 - distFromCenter / radius);
    const strength = Math.pow(closeness, 1.5);

    const dirX = distFromCenter < 1 ? 0 : dx / distFromCenter;
    const dirY = distFromCenter < 1 ? -1 : dy / distFromCenter;

    const maxTilt = 85;
    tiltTargetRef.current = {
      rotateY: dirX * maxTilt * strength,
      rotateX: -dirY * maxTilt * strength,
    };
  }, []);

  useEffect(() => {
    const LERP = 0.12;
    let raf: number;

    const tick = () => {
      setTilt((prev) => {
        const target = tiltTargetRef.current;
        const rotateX = prev.rotateX + (target.rotateX - prev.rotateX) * LERP;
        const rotateY = prev.rotateY + (target.rotateY - prev.rotateY) * LERP;
        return { rotateX, rotateY };
      });
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      updateTiltFromPointer(e.clientX, e.clientY);
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        updateTiltFromPointer(e.touches[0].clientX, e.touches[0].clientY);
      }
    };

    const resetTilt = () => {
      tiltTargetRef.current = { rotateX: 0, rotateY: 0 };
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("touchmove", handleTouchMove, { passive: true });
    window.addEventListener("touchend", resetTilt);
    window.addEventListener("touchcancel", resetTilt);
    document.addEventListener("mouseleave", resetTilt);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", resetTilt);
      window.removeEventListener("touchcancel", resetTilt);
      document.removeEventListener("mouseleave", resetTilt);
    };
  }, [updateTiltFromPointer]);

  useEffect(() => {
    if (!track) return;
    const diskEl = diskRef.current;
    if (!diskEl) return;
    const handleDiskTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        e.preventDefault();
        updateTiltFromPointer(e.touches[0].clientX, e.touches[0].clientY);
      }
    };
    diskEl.addEventListener("touchmove", handleDiskTouchMove, { passive: false });
    return () => {
      diskEl.removeEventListener("touchmove", handleDiskTouchMove);
    };
  }, [track, updateTiltFromPointer]);

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
        hasLoadedOnce.current = true;
      }
    } catch (err) {
      console.error("Error fetching Spotify data:", err);
      setError(true);
      if (isInitialLoad.current) {
        setLoading(false);
        isInitialLoad.current = false;
        hasLoadedOnce.current = true;
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

  useEffect(() => {
    if (displayTrack?.songUrl && !previousTrackUrl && hasLoadedOnce.current) {
      const timer = setTimeout(() => {
        setPreviousTrackUrl(displayTrack.songUrl);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [displayTrack?.songUrl, previousTrackUrl]);

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
  }, [track?.albumArt]);

  const isInitialTrack =
    initialTrack && displayTrack?.songUrl === initialTrack.songUrl;
  const useInitialTheme =
    initialTextTheme != null && (isInitialTrack || !albumColors);
  const isLightBg =
    albumColors !== null &&
    shouldUseDarkTextForBackdrop(
      albumColors.theme,
      albumColors.avgLuminance
    );
  const textClass = useInitialTheme
    ? initialTextTheme.textClass
    : isLightBg
      ? "text-black"
      : "text-white";
  const artistTextClass = useInitialTheme
    ? initialTextTheme.artistTextClass
    : isLightBg
      ? "text-black/80"
      : "text-white/80";
  const artistOnLightBackground =
    useInitialTheme && initialTextTheme
      ? initialTextTheme.artistTextClass.includes("text-black")
      : isLightBg;
  const textMutedClass = useInitialTheme
    ? initialTextTheme.textMutedClass
    : isLightBg
      ? "text-gray-700"
      : "text-white/70";
  /** Timestamps: same hue as muted but more opaque */
  const timeTextClass = useInitialTheme
    ? initialTextTheme.textMutedClass.includes("text-gray")
      ? "text-gray-800"
      : "text-white/88"
    : isLightBg
      ? "text-gray-800"
      : "text-white/88";
  const cardClass = "";
  const skeletonClass = useInitialTheme
    ? initialTextTheme.skeletonClass
    : isLightBg
      ? "bg-gray-400"
      : "bg-gray-700";
  const progressTrackStyle = useInitialTheme
    ? initialTextTheme.progressTrackStyle
    : isLightBg
      ? { backgroundColor: "rgba(127, 131, 136, 0.3)" }
      : { backgroundColor: "rgba(55, 65, 81, 0.25)" };
  const progressFillClass = useInitialTheme
    ? initialTextTheme.progressFillClass
    : isLightBg
      ? "bg-black/80"
      : "bg-white";

  const backdropSurface = albumColors
    ? buildAlbumBackdropSurface(albumColors.strips, albumColors.avgLuminance)
    : null;

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
          layers={backdropSurface.layers}
          strips={albumColors.strips}
          cycleKey={displayTrack?.songUrl ?? initialTrack?.songUrl ?? ""}
        />
      )}
      <div className={`relative z-10 ${cardClass}`}>
        <AnimatePresence>

          {error && (
            <motion.p
              key="error"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4 }}
              className={`text-xl mb-4 ${textClass}`}
            >
              Unable to load Spotify data. Check back later!
            </motion.p>
          )}

          {!loading && !error && displayTrack && (
            <motion.div
              key="content"
              initial={{ opacity: initialTrack != null ? 1 : 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{
                opacity: { duration: initialTrack != null ? 0 : 0.4, delay: initialTrack != null ? 0 : 0.1 },
              }}
              className="flex flex-col items-center max-w-sm"
            >
              <div
                className="w-full overflow-hidden pb-2 md:p-4 flex justify-center mb-6"
                style={{ perspective: "1000px" }}
              >
                <div
                  ref={diskRef}
                  className="relative aspect-square overflow-hidden rounded-full"
                  style={{
                    width: "min(80vw, 40vh)",
                    maxWidth: "100%",
                  }}
                >
                  <AnimatePresence initial={false}>
                    <motion.div
                      key={displayTrack.songUrl}
                      layout={false}
                      initial={
                        previousTrackUrl &&
                        previousTrackUrl !== displayTrack.songUrl
                          ? { opacity: 0, x: "100%" }
                          : initialTrack
                            ? { opacity: 1, x: 0 }
                            : { opacity: 0 }
                      }
                      animate={{
                        opacity: 1,
                        x: 0,
                      }}
                      exit={{
                        opacity: 0,
                        x: "-100%",
                      }}
                      transition={{
                        duration: initialTrack && !previousTrackUrl ? 0 : 0.4,
                        ease: "easeOut",
                      }}
                      className="absolute inset-0 touch-none select-none"
                      onAnimationComplete={() => {
                        if (previousTrackUrl !== displayTrack.songUrl) {
                          setPreviousTrackUrl(displayTrack.songUrl);
                        }
                      }}
                    >
                      <div
                        className="transition-all duration-500 ease-out relative size-full overflow-hidden rounded-full"
                        style={{
                          transform: `rotateX(${tilt.rotateX}deg) rotateY(${tilt.rotateY}deg) scale(1.05)`,
                          transformStyle: "preserve-3d",
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
                            transform: "translateZ(20px)",
                            borderRadius: "50%",
                            clipPath: "circle(50% at 50% 50%)",
                            WebkitClipPath: "circle(50% at 50% 50%)",
                            maskImage:
                              "radial-gradient(circle at 50% 50%, transparent 5%, black 5%)",
                            WebkitMaskImage:
                              "radial-gradient(circle at 50% 50%, transparent 5%, black 5%)",
                            backfaceVisibility: "hidden",
                            WebkitBackfaceVisibility: "hidden",
                          }}
                        />
                      </div>
                    </motion.div>
                  </AnimatePresence>
                </div>
              </div>
              <div className="w-full pl-2 pr-4 md:px-4">
                <AnimatePresence initial={false}>
                  <motion.div
                    key={displayTrack.songUrl}
                    layout={false}
                    initial={{ opacity: initialTrack != null ? 1 : 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{
                      duration: initialTrack != null ? 0 : 0.5,
                      ease: "easeOut",
                    }}
                    className="flex flex-col items-start"
                  >
                    <div className="flex flex-col items-start w-full gap-0">
                      <h2
                        className={`text-lg md:text-2xl font-normal inline-block max-w-full truncate cursor-pointer hover:underline leading-tight ${textClass}`}
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
                            }}
                          >
                            E
                          </span>
                        ) : null}
                        <p
                          className={`text-xs md:text-sm inline-block min-w-0 flex-1 truncate cursor-pointer hover:underline leading-tight ${artistTextClass}`}
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
                            className={`h-1 rounded-full transition-all duration-1000 ${progressFillClass}`}
                            style={{
                              width: `${
                                (displayProgress / displayTrack.durationMs) * 100
                              }%`,
                            }}
                          />
                        </div>
                        <div
                          className={`flex justify-between ${timeTextClass}`}
                          style={{
                            fontSize: "10px",
                            lineHeight: 1,
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          <span style={{ fontSize: "10px", lineHeight: 1 }}>
                            {formatTime(displayProgress)}
                          </span>
                          <span style={{ fontSize: "10px", lineHeight: 1 }}>
                            {formatTime(displayTrack.durationMs)}
                          </span>
                        </div>
                      </div>
                    )}

                    {!displayTrack.isPlaying && displayTrack.playedAt && (
                      <p className={`text-sm mt-2 mb-4 ${textMutedClass}`}>
                        Stopped listening {formatMinsAgo(displayTrack.playedAt)}
                      </p>
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>
            </motion.div>
          )}

          {!loading && !error && !track && (
            <motion.p
              key="no-tracks"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4 }}
              className={`text-xl mb-6 ${textClass}`}
            >
              No recent tracks found. Check back later!
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

export default SpotifyPage;
