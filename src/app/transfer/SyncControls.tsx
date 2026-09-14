"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { errorMessage } from "@/lib/fetch-error";
import type { SyncConfig, SyncMode, SyncResult } from "@/lib/sync";

const field =
  "w-full rounded-md border border-line bg-background px-3 py-2 text-sm outline-none focus:border-accent";

export function SyncSettings({ config }: { config: SyncConfig }) {
  const router = useRouter();
  const [mode, setMode] = useState<SyncMode>(config.mode);
  const [dir, setDir] = useState(config.dir ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SyncResult | null>(null);

  async function save(nextMode: SyncMode) {
    setBusy(true);
    setError(null);
    const response = await fetch("/api/sync", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: nextMode, dir }),
    });
    setBusy(false);
    if (!response.ok) {
      setError(await errorMessage(response, "Could not save"));
      return;
    }
    setMode(nextMode);
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

  const options: { value: SyncMode; label: string; hint: string }[] = [
    { value: "off", label: "Off", hint: "Pass bundle files by hand." },
    {
      value: "supabase",
      label: "Cloud (Supabase)",
      hint: config.supabaseConfigured
        ? `Bucket "${config.supabaseBucket}". Works even when the other machine is asleep.`
        : "Needs SUPABASE_URL and SUPABASE_ANON_KEY in .env.local.",
    },
    {
      value: "folder",
      label: "Shared folder",
      hint: "A folder Drive for Desktop, Dropbox or Syncthing keeps in step.",
    },
  ];

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {options.map((option) => (
          <label
            key={option.value}
            className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition ${
              mode === option.value ? "border-accent bg-accent/5" : "border-line hover:bg-background"
            }`}
          >
            <input
              type="radio"
              name="sync-mode"
              checked={mode === option.value}
              onChange={() => save(option.value)}
              disabled={busy || (option.value === "supabase" && !config.supabaseConfigured)}
              className="mt-0.5 size-4 accent-[var(--accent)]"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium">{option.label}</span>
              <span className="block text-xs text-muted">{option.hint}</span>
            </span>
          </label>
        ))}
      </div>

      {mode === "folder" && (
        <label className="block text-sm">
          <span className="mb-1.5 block font-medium">Folder path</span>
          <input
            value={dir}
            onChange={(e) => setDir(e.target.value)}
            onBlur={() => save("folder")}
            placeholder="/home/you/My Drive/traffic-bench"
            className={`${field} font-mono`}
          />
        </label>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {mode !== "off" && (
          <button
            onClick={runSync}
            disabled={busy}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? "Syncing…" : "Sync now"}
          </button>
        )}
        <span className="text-xs text-muted">this copy is {config.installId}</span>
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
          {result.pulled.comments === 1 ? "" : "s"}, {result.pulled.runs} model answer
          {result.pulled.runs === 1 ? "" : "s"} from {result.filesSeen} file
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
          result.pulled.questions +
          result.pulled.answers +
          result.pulled.comments +
          result.pulled.runs;
        if (total > 0) {
          setPulled(total);
          router.refresh();
          setTimeout(() => setPulled(0), 4000);
        }
      } catch {
        // Offline or the remote is unreachable; the next tick can try again.
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
