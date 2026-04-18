"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { Drawer } from "vaul";
import type { RecentlyPlayedTrack } from "@/app/actions/spotify";

function formatPlayedAt(iso: string): string {
  const played = new Date(iso).getTime();
  const diffMs = Date.now() - played;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return mins === 1 ? "1 min ago" : `${mins} mins ago`;

  const playedDate = new Date(iso);
  const today = new Date();
  const sameDay =
    playedDate.getFullYear() === today.getFullYear() &&
    playedDate.getMonth() === today.getMonth() &&
    playedDate.getDate() === today.getDate();

  const timeOpts: Intl.DateTimeFormatOptions = {
    hour: "numeric",
    minute: "2-digit",
  };

  if (sameDay) {
    return playedDate.toLocaleTimeString(undefined, timeOpts);
  }

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const wasYesterday =
    playedDate.getFullYear() === yesterday.getFullYear() &&
    playedDate.getMonth() === yesterday.getMonth() &&
    playedDate.getDate() === yesterday.getDate();

  if (wasYesterday) {
    return `Yesterday ${playedDate.toLocaleTimeString(undefined, timeOpts)}`;
  }

  return playedDate.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function RecentTracksDrawer({
  open,
  onOpenChange,
  fetchRecent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fetchRecent: () => Promise<RecentlyPlayedTrack[]>;
}) {
  const titleId = useId();
  const [items, setItems] = useState<RecentlyPlayedTrack[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setItems(null);
    setLoading(true);
    setError(false);
    try {
      const data = await fetchRecent();
      setItems(data);
    } catch {
      setError(true);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [fetchRecent]);

  useEffect(() => {
    if (!open) return;
    load();
  }, [open, load]);

  return (
    <Drawer.Root
      open={open}
      onOpenChange={onOpenChange}
      shouldScaleBackground={false}
      setBackgroundColorOnScale={false}
      handleOnly
      dismissible
      modal
      scrollLockTimeout={450}
      closeThreshold={0.22}
    >
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-[100] bg-black/55 backdrop-blur-[2px]" />
        <Drawer.Content
          aria-labelledby={titleId}
          className="fixed bottom-0 left-0 right-0 z-[101] flex max-h-[min(85dvh,680px)] flex-col rounded-t-[20px] bg-[#121218] outline-none md:left-1/2 md:right-auto md:w-full md:max-w-lg md:-translate-x-1/2 md:rounded-3xl"
          style={{
            paddingBottom: "max(12px, env(safe-area-inset-bottom))",
            paddingLeft: "max(16px, env(safe-area-inset-left))",
            paddingRight: "max(16px, env(safe-area-inset-right))",
          }}
        >
          <div className="flex shrink-0 flex-col items-center pt-2 pb-1">
            <Drawer.Handle className="mx-auto mb-3 mt-2 block h-1 w-11 cursor-grab rounded-full bg-white/45 opacity-100 shadow-sm active:cursor-grabbing" />
            <div className="flex w-full items-center justify-between px-1 pb-2">
              <Drawer.Title
                id={titleId}
                className="text-lg font-semibold tracking-tight text-white"
              >
                Listening history
              </Drawer.Title>
              <Drawer.Close
                type="button"
                className="rounded-full p-2 text-white/70 transition hover:bg-white/10 hover:text-white active:bg-white/15"
                aria-label="Close"
              >
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                >
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </Drawer.Close>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain [-webkit-overflow-scrolling:touch]">
            {loading && (
              <ul className="space-y-3 px-1 pb-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <li
                    key={i}
                    className="flex animate-pulse gap-3 rounded-xl bg-white/5 p-2"
                  >
                    <div className="size-12 shrink-0 rounded-md bg-white/10" />
                    <div className="flex min-w-0 flex-1 flex-col justify-center gap-2">
                      <div className="h-4 w-[62%] max-w-[200px] rounded bg-white/10" />
                      <div className="h-3 w-[40%] max-w-[120px] rounded bg-white/10" />
                    </div>
                    <div className="h-3 w-14 shrink-0 self-start rounded bg-white/10 pt-1" />
                  </li>
                ))}
              </ul>
            )}

            {!loading && error && (
              <p className="px-2 py-8 text-center text-sm text-white/70">
                Couldn&apos;t load history. Try again later.
              </p>
            )}

            {!loading && !error && items && items.length === 0 && (
              <p className="px-2 py-8 text-center text-sm text-white/70">
                No plays in your recent history yet.
              </p>
            )}

            {!loading && !error && items && items.length > 0 && (
              <ul className="space-y-1 px-1 pb-4">
                {items.map((row, index) => (
                  <li key={`${row.playedAt}-${row.songUrl}-${index}`}>
                    <a
                      href={row.songUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex min-h-[52px] gap-3 rounded-xl p-2 transition hover:bg-white/10 active:bg-white/15"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={row.albumArt}
                        alt=""
                        width={48}
                        height={48}
                        className="size-12 shrink-0 rounded-md object-cover shadow-md"
                        loading="lazy"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[15px] font-medium leading-tight text-white">
                          {row.name}
                        </p>
                        <p className="mt-0.5 truncate text-sm text-white/65">
                          {row.artist}
                        </p>
                      </div>
                      <span
                        className="shrink-0 pt-0.5 text-right text-xs tabular-nums text-white/45"
                        title={new Date(row.playedAt).toLocaleString()}
                      >
                        {formatPlayedAt(row.playedAt)}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
