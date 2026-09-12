"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { errorMessage } from "@/lib/fetch-error";
import type { SyncConfig, SyncResult } from "@/lib/sync";

const field =
  "w-full rounded-md border border-line bg-background px-3 py-2 text-sm outline-none focus:border-accent";

export function SyncSettings({ config }: { config: SyncConfig }) {
  const router = useRouter();
  const [dir, setDir] = useState(config.dir ?? "");
  const [enabled, setEnabled] = useState(config.enabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SyncResult | null>(null);

  async function save(nextEnabled: boolean) {
    setBusy(true);
    setError(null);
    const response = await fetch("/api/sync", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dir, enabled: nextEnabled }),
    });
    setBusy(false);
    if (!response.ok) {
      setError(await errorMessage(response, "Could not save"));
      return;
    }
    setEnabled(nextEnabled);
    router.refresh();
  }

  async function runSync() {
    setBusy(true);
    setError(null);
    setResult(null);
    const response = await fetch("/api/sync", { method: "POST" });
    setBusy(false);
    if (!response.ok) {
      setError(await errorMessage(response, "Sync failed"));
      return;
    }
    setResult((await response.json()) as SyncResult);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <label className="block text-sm">
        <span className="mb-1.5 block font-medium">Shared folder</span>
        <input
          value={dir}
          onChange={(e) => setDir(e.target.value)}
          placeholder="/home/you/My Drive/traffic-bench"
          className={`${field} font-mono`}
        />
        <span className="mt-1 block text-xs text-muted">
          A folder that Google Drive for Desktop, Dropbox, or Syncthing keeps in step. Both of you
          point at your own local copy of the same shared folder.
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => save(!enabled)}
          disabled={busy}
          className={`rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50 ${
            enabled
              ? "border border-line hover:bg-background"
              : "bg-accent text-white"
          }`}
        >
          {enabled ? "Turn sync off" : "Turn sync on"}
        </button>
        {enabled && (
          <button
            onClick={runSync}
            disabled={busy}
            className="rounded-md border border-line px-4 py-2 text-sm transition hover:bg-background disabled:opacity-50"
          >
            {busy ? "Syncing…" : "Sync now"}
          </button>
        )}
        {enabled && (
          <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-600">
            on · this copy is {config.installId}
          </span>
        )}
      </div>

      {config.lastSync && (
        <p className="text-xs text-muted">
          Last synced {new Date(config.lastSync).toLocaleString()}
        </p>
      )}

      {config.lastError && !error && (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600">
          Last automatic sync failed: {config.lastError}
        </p>
      )}

      {error && (
        <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-500">
          {error}
        </p>
      )}

      {result && (
        <p className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-600">
          Pulled {result.pulled.questions} question
          {result.pulled.questions === 1 ? "" : "s"}, {result.pulled.answers} answer
          {result.pulled.answers === 1 ? "" : "s"}, {result.pulled.comments} comment
          {result.pulled.comments === 1 ? "" : "s"} from {result.filesSeen} file
          {result.filesSeen === 1 ? "" : "s"}.
          {result.pushed.length > 0 && ` Wrote ${result.pushed.join(", ")}.`}
        </p>
      )}
    </div>
  );
}

/**
 * Quietly pulls in the background so the other side's work shows up without
 * anyone pressing a button. Skipped while the tab is hidden.
 */
export function SyncPoller({ intervalMs = 30000 }: { intervalMs?: number }) {
  const router = useRouter();
  const [pulled, setPulled] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      if (document.hidden) return;
      try {
        const response = await fetch("/api/sync", { method: "POST" });
        if (!response.ok || cancelled) return;
        const result = (await response.json()) as SyncResult;
        const total =
          result.pulled.questions + result.pulled.answers + result.pulled.comments;
        if (total > 0) {
          setPulled(total);
          router.refresh();
          setTimeout(() => setPulled(0), 4000);
        }
      } catch {
        // Offline or the folder vanished; the next tick can try again.
      }
    }

    const timer = setInterval(tick, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [intervalMs, router]);

  if (pulled === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-600 shadow-lg backdrop-blur">
      Synced {pulled} new item{pulled === 1 ? "" : "s"}
    </div>
  );
}
