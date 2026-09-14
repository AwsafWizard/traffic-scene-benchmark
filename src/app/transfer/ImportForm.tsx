"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { errorMessage } from "@/lib/fetch-error";
import type { ImportResult } from "@/lib/bundle";

export default function ImportForm() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);

    const response = await fetch("/api/import", {
      method: "POST",
      body: new FormData(event.currentTarget),
    });
    setBusy(false);

    if (!response.ok) {
      setError(await errorMessage(response, "Import failed"));
      return;
    }
    setResult((await response.json()) as ImportResult);
    if (input.current) input.current.value = "";
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <input
        ref={input}
        type="file"
        name="bundle"
        accept="application/json,.json"
        required
        className="block w-full text-sm text-muted file:mr-3 file:rounded-md file:border file:border-line file:bg-background file:px-3 file:py-1.5 file:text-sm file:text-foreground"
      />

      <button
        type="submit"
        disabled={busy}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {busy ? "Importing…" : "Import bundle"}
      </button>

      {error && (
        <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-500">
          {error}
        </p>
      )}

      {result && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-600">
          <p className="font-medium">
            Imported {result.added} {result.kind === "questions" ? "question" : "answer"}
            {result.added === 1 ? "" : "s"}.
          </p>
          {result.models != null && result.models > 0 && (
            <p className="mt-1 text-xs">
              Plus {result.models} model{result.models === 1 ? "" : "s"} added to your roster
              (disabled, so nothing runs without your own key).
            </p>
          )}
          {result.runs != null && result.runs > 0 && (
            <p className="mt-1 text-xs">
              Plus {result.runs} model answer{result.runs === 1 ? "" : "s"}.
            </p>
          )}
          {result.comments != null && result.comments > 0 && (
            <p className="mt-1 text-xs">
              Plus {result.comments} comment{result.comments === 1 ? "" : "s"}.
            </p>
          )}
          {result.skipped > 0 && (
            <p className="mt-1 text-xs">
              {result.skipped} skipped — already present or malformed.
            </p>
          )}
          {result.unmatched > 0 && (
            <p className="mt-1 text-xs">
              {result.unmatched} referred to questions this copy doesn&apos;t have. Import the
              question bundle first.
            </p>
          )}
        </div>
      )}
    </form>
  );
}
