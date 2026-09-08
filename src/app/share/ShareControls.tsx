"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded-md border border-line bg-background px-3 py-2 font-mono text-xs">
        {url}
      </code>
      <button
        onClick={copy}
        className="shrink-0 rounded-md bg-accent px-3 py-2 text-sm font-medium text-white"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

export function RotateToken() {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);

  async function rotate() {
    await fetch("/api/share", { method: "POST" });
    setConfirming(false);
    router.refresh();
  }

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className="text-xs text-muted transition hover:text-red-500"
      >
        Generate a new link
      </button>
    );
  }

  return (
    <span className="flex items-center gap-2 text-xs">
      <span className="text-muted">This breaks the old link. Continue?</span>
      <button onClick={rotate} className="rounded border border-red-500/30 px-2 py-0.5 text-red-500">
        Regenerate
      </button>
      <button onClick={() => setConfirming(false)} className="text-muted">
        Cancel
      </button>
    </span>
  );
}

export function LeaveGrounderMode() {
  const router = useRouter();

  async function leave() {
    await fetch("/api/share", { method: "DELETE" });
    router.push("/");
    router.refresh();
  }

  return (
    <button onClick={leave} className="text-xs text-accent">
      Switch this browser back to benchmarker
    </button>
  );
}
