"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { addVideosAction, findRepoVideosAction, type RepoListing } from "../../actions/admin";
import { button, buttonSecondary, card, hint, input } from "../../ui/styles";

type Listing = Extract<RepoListing, { ok: true }>;

function size(bytes: number | null): string {
  if (!bytes) return "";
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`;
}

/** Lists the videos in a Hugging Face dataset repo and adds the ones the admin ticks. */
export default function AddVideos({ lastRepo }: { lastRepo: string }) {
  const router = useRouter();
  const [repo, setRepo] = useState(lastRepo);
  const [listing, setListing] = useState<Listing | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function find() {
    setError(null);
    setDone(null);
    setListing(null);
    setBusy(true);
    const result = await findRepoVideosAction(repo);
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setListing(result);
    setPicked(new Set(result.files.filter((f) => !f.inLibrary).map((f) => f.path)));
  }

  async function add() {
    if (!listing) return;
    setBusy(true);
    setError(null);
    const result = await addVideosAction(listing.repo, [...picked]);
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setDone(`Added ${result.added} video${result.added === 1 ? "" : "s"}. Setters can use them now.`);
    setListing(null);
    router.refresh();
  }

  const fresh = listing?.files.filter((f) => !f.inLibrary) ?? [];
  const toggle = (path: string) =>
    setPicked((set) => {
      const next = new Set(set);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  return (
    <section className={`${card} space-y-3 p-5`}>
      <h2 className="font-medium">Add videos</h2>
      <p className="text-sm text-muted">
        Upload the videos to your private Hugging Face dataset repo (folders are kept as groups), then enter the repo here
        and pick which ones setters may use.
      </p>
      <div className="flex gap-2">
        <input
          className={input}
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              find();
            }
          }}
          placeholder="owner/dhakadrive-videos"
          aria-label="Hugging Face dataset repo"
        />
        <button type="button" className={`${buttonSecondary} shrink-0 whitespace-nowrap`} disabled={busy || !repo.trim()} onClick={find}>
          {busy && !listing ? "Looking…" : "Find videos"}
        </button>
      </div>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {done && <p className="text-sm text-emerald-700 dark:text-emerald-400">{done}</p>}

      {listing && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>
              {listing.files.length} video{listing.files.length === 1 ? "" : "s"} in {listing.repo}
              {listing.files.length > fresh.length && <>, {listing.files.length - fresh.length} already in the library</>}.
            </span>
            {fresh.length > 1 && (
              <span className="flex gap-3 text-xs">
                <button type="button" className="text-accent hover:underline" onClick={() => setPicked(new Set(fresh.map((f) => f.path)))}>
                  Tick all
                </button>
                <button type="button" className="text-accent hover:underline" onClick={() => setPicked(new Set())}>
                  Untick all
                </button>
              </span>
            )}
          </div>
          <ul className="max-h-72 overflow-y-auto rounded-md border border-line text-sm">
            {listing.files.map((f) => (
              <li key={f.path} className="border-b border-line last:border-0">
                <label className={`flex items-center gap-3 px-3 py-1.5 ${f.inLibrary ? "text-muted" : "cursor-pointer"}`}>
                  <input
                    type="checkbox"
                    className="accent-[var(--accent)]"
                    disabled={f.inLibrary}
                    checked={f.inLibrary || picked.has(f.path)}
                    onChange={() => toggle(f.path)}
                  />
                  <span className="min-w-0 flex-1 truncate">{f.path}</span>
                  <span className="shrink-0 text-xs text-muted">{f.inLibrary ? "in library" : size(f.size)}</span>
                </label>
              </li>
            ))}
          </ul>
          <button type="button" className={button} disabled={busy || picked.size === 0} onClick={add}>
            {busy ? "Adding…" : picked.size === 0 ? "Nothing ticked" : `Add ${picked.size} video${picked.size === 1 ? "" : "s"}`}
          </button>
          <p className={hint}>MP4 with H.264 plays in every browser; H.265/HEVC may not.</p>
        </div>
      )}
    </section>
  );
}
