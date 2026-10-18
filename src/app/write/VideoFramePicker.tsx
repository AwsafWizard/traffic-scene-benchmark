"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { videoLinkAction } from "../actions/annotator";
import { button, buttonSecondary, card, hint, select } from "../ui/styles";

/**
 * Plays a video from the admin's library on the write page so the setter can
 * grab a frame from it.
 *
 * A frame is read off the <video> element through a canvas, which the browser
 * only allows when the video is served with CORS headers. Videos live in a
 * private Hugging Face repo; our server hands out a signed CDN link to one
 * video at a time (valid about an hour), and that CDN sends CORS headers.
 * (YouTube can't be used: its player is a cross-origin iframe no page can read.)
 */

export interface LibraryVideo {
  id: number;
  repo: string;
  path: string;
  name: string;
  folder: string | null;
  /** Frames this setter has captured from it. */
  frames: number;
}

export interface VideoFrame {
  file: File;
  source: { repo: string; video: string; time: number };
}

const FRAME = 1 / 30;
const VIDEO_KEY = "dhakavqa.video";
const OPEN_KEY = "dhakavqa.videoOpen";
const timeKey = (id: number) => `dhakavqa.videoTime.${id}`;

/** localStorage, where the browser allows it. Only for conveniences. */
const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {}
  },
};

function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(1).padStart(4, "0");
  return `${m}:${s}`;
}

export default function VideoFramePicker({
  enabled,
  videos,
  busy,
  onCapture,
}: {
  /** False when the server has no Hugging Face token. */
  enabled: boolean;
  videos: LibraryVideo[];
  busy: boolean;
  /** Uploads the frame; resolves true once it's saved. */
  onCapture: (frame: VideoFrame) => Promise<boolean>;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  // Rendered only in the browser (see QuestionForm), so storage is readable here.
  const [open, setOpen] = useState(() => store.get(OPEN_KEY) !== "0");
  const [videoId, setVideoId] = useState<number | null>(() => {
    const last = Number(store.get(VIDEO_KEY));
    return videos.some((v) => v.id === last) ? last : null;
  });
  const [link, setLink] = useState<{ url: string; expiresAt: number } | null>(null);
  const [loading, setLoading] = useState(() => videoId !== null);
  const [frames, setFrames] = useState(() => new Map(videos.map((v) => [v.id, v.frames])));
  const [error, setError] = useState<string | null>(null);
  const [time, setTime] = useState(0);
  const [rate, setRate] = useState(1);
  // Where to pick up after a link is swapped for a fresh one, and whether this link was already retried.
  const resumeAt = useRef<number | null>(null);
  const retried = useRef(false);

  const video = videos.find((v) => v.id === videoId) ?? null;
  const src = video && link ? link.url : null;

  const folders = new Map<string | null, LibraryVideo[]>();
  for (const v of videos) folders.set(v.folder, [...(folders.get(v.folder) ?? []), v]);
  const optionLabel = (v: LibraryVideo) => {
    const n = frames.get(v.id) ?? 0;
    return n ? `${v.name} — ${n} frame${n === 1 ? "" : "s"} by you` : v.name;
  };

  /** Asks our server for a playable link. Only sets state once the answer arrives. */
  function fetchLink(id: number) {
    videoLinkAction(id).then((result) => {
      setLoading(false);
      if ("error" in result) {
        setLink(null);
        setError(result.error);
        return;
      }
      retried.current = false;
      setLink(result);
    });
  }

  function choose(id: number) {
    setVideoId(id);
    setLink(null);
    setError(null);
    setTime(0);
    setLoading(true);
    resumeAt.current = null;
    store.set(VIDEO_KEY, String(id));
    fetchLink(id);
  }

  // Reopen the video the setter last had.
  const restore = useEffectEvent(() => {
    if (enabled && videoId !== null) fetchLink(videoId);
  });
  useEffect(() => restore(), []);

  function seek(by: number) {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    v.currentTime = Math.min(Math.max(0, v.currentTime + by), v.duration || Infinity);
  }

  /**
   * The likeliest failure is the hour-long link running out while the setter
   * was paused: get a fresh one and carry on from the same spot. If a fresh
   * link fails too, the browser can't decode the file.
   */
  function onVideoError() {
    if (!video) return;
    if (!retried.current) {
      retried.current = true;
      resumeAt.current = videoRef.current?.currentTime || null;
      videoLinkAction(video.id).then((result) => {
        if ("error" in result) return setError(result.error);
        setLink(result);
      });
      return;
    }
    setError("This video won't play here. Its format may not be supported: MP4 with H.264 plays everywhere. Tell the admin.");
  }

  async function capture() {
    const v = videoRef.current;
    if (!v || !video || !v.videoWidth) return;
    setError(null);
    v.pause();
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext("2d")!.drawImage(v, 0, 0);
    let blob: Blob | null;
    try {
      // PNG keeps the frame lossless; the uploader re-encodes it to WebP once.
      blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    } catch {
      blob = null;
    }
    if (!blob) return setError("The browser wouldn't let the page read this video's pixels.");
    const t = Math.round(v.currentTime * 1000) / 1000;
    const saved = await onCapture({
      file: new File([blob], `${video.name.replace(/\.[^.]+$/, "")}-${t}s.png`, { type: "image/png" }),
      source: { repo: video.repo, video: video.path, time: t },
    });
    if (saved) setFrames((m) => new Map(m).set(video.id, (m.get(video.id) ?? 0) + 1));
  }

  // , and . step a frame, the way video editors do, unless the setter is typing.
  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (!src || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable]")) return;
    if (event.key === ",") seek(-FRAME);
    else if (event.key === ".") seek(FRAME);
    else return;
    event.preventDefault();
  });
  useEffect(() => {
    const handler = (event: KeyboardEvent) => onKey(event);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  function toggle() {
    setOpen((o) => {
      store.set(OPEN_KEY, o ? "0" : "1");
      return !o;
    });
  }

  return (
    <section className={`${card} space-y-3 p-5`}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Capture from a video</span>
        <button type="button" className="text-xs text-muted hover:text-foreground" onClick={toggle} aria-expanded={open}>
          {open ? "Hide" : "Show"}
        </button>
      </div>

      {open &&
        (!enabled ? (
          <p className={hint}>Video playback isn&apos;t set up yet. Upload or paste images below for now.</p>
        ) : videos.length === 0 ? (
          <p className={hint}>The admin hasn&apos;t added any videos yet. Upload or paste images below for now.</p>
        ) : (
          <>
            <select className={select} aria-label="Video" value={videoId ?? ""} onChange={(e) => choose(Number(e.target.value))}>
              <option value="" disabled>
                Choose a video ({videos.length})
              </option>
              {[...folders.entries()].map(([folder, list]) =>
                folder ? (
                  <optgroup key={folder} label={folder}>
                    {list.map((v) => (
                      <option key={v.id} value={v.id}>{optionLabel(v)}</option>
                    ))}
                  </optgroup>
                ) : (
                  list.map((v) => (
                    <option key={v.id} value={v.id}>{optionLabel(v)}</option>
                  ))
                ),
              )}
            </select>

            {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
            {loading && <p className={hint}>Opening the video…</p>}

            {video && src && (
              <div className="space-y-2">
                <video
                  key={video.id}
                  ref={videoRef}
                  src={src}
                  crossOrigin="anonymous"
                  controls
                  playsInline
                  preload="metadata"
                  className="aspect-video w-full rounded-lg bg-black"
                  onLoadedMetadata={(e) => {
                    setError(null);
                    const saved = resumeAt.current ?? Number(store.get(timeKey(video.id)));
                    resumeAt.current = null;
                    if (saved > 0 && saved < e.currentTarget.duration) e.currentTarget.currentTime = saved;
                    e.currentTarget.playbackRate = rate;
                  }}
                  onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
                  onPause={(e) => store.set(timeKey(video.id), String(e.currentTarget.currentTime))}
                  onPlaying={() => {
                    retried.current = false;
                  }}
                  onError={onVideoError}
                />
                <div className="flex flex-wrap items-center gap-1.5">
                  <button type="button" className={buttonSecondary} onClick={() => seek(-5)} title="Back 5 seconds">−5s</button>
                  <button type="button" className={buttonSecondary} onClick={() => seek(-FRAME)} title="Back one frame ( , )">◀ 1f</button>
                  <button type="button" className={buttonSecondary} onClick={() => seek(FRAME)} title="Forward one frame ( . )">1f ▶</button>
                  <button type="button" className={buttonSecondary} onClick={() => seek(5)} title="Forward 5 seconds">+5s</button>
                  <select
                    className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm"
                    aria-label="Playback speed"
                    value={rate}
                    onChange={(e) => {
                      setRate(Number(e.target.value));
                      if (videoRef.current) videoRef.current.playbackRate = Number(e.target.value);
                    }}
                  >
                    {[0.25, 0.5, 1, 1.5, 2, 4].map((r) => (
                      <option key={r} value={r}>{r}×</option>
                    ))}
                  </select>
                  <span className="ml-auto font-mono text-xs text-muted">{clock(time)}</span>
                </div>
                <button type="button" className={`${button} w-full`} disabled={busy} onClick={capture}>
                  {busy ? "Uploading…" : "Capture this frame"}
                </button>
                <p className={hint}>
                  Pause on the moment you want, fine-tune with , and . (one frame each), then capture. The frame is saved at
                  the video&apos;s full resolution and selected below.
                </p>
              </div>
            )}
          </>
        ))}
    </section>
  );
}
