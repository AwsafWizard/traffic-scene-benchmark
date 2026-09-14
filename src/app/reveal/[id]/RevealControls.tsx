"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Verdict } from "@/lib/types";
import { errorMessage } from "@/lib/fetch-error";

const VERDICT_STYLE: Record<Verdict, string> = {
  correct: "border-emerald-500/30 bg-emerald-500/10 text-emerald-500",
  partial: "border-amber-500/30 bg-amber-500/10 text-amber-600",
  incorrect: "border-red-500/30 bg-red-500/10 text-red-500",
};

export function VerdictPicker({
  targetType,
  targetId,
  current,
}: {
  targetType: "human" | "llm";
  targetId: number;
  current: Verdict | null;
}) {
  const router = useRouter();

  async function grade(verdict: Verdict) {
    await fetch("/api/grades", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target_type: targetType, target_id: targetId, verdict }),
    });
    router.refresh();
  }

  return (
    <div className="flex shrink-0 gap-1">
      {(["correct", "partial", "incorrect"] as Verdict[]).map((v) => (
        <button
          key={v}
          onClick={() => grade(v)}
          className={`rounded border px-2 py-0.5 text-xs capitalize transition ${
            current === v ? VERDICT_STYLE[v] : "border-line text-muted hover:bg-background"
          }`}
        >
          {v}
        </button>
      ))}
    </div>
  );
}

export function FollowUpThread({
  runId,
  turns,
}: {
  runId: number;
  turns: { id: number; role: "user" | "assistant"; content: string; error: string | null }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(turns.length > 0);
  const [message, setMessage] = useState("");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask(event: React.FormEvent) {
    event.preventDefault();
    if (!message.trim()) return;
    setBusy(true);
    setError(null);

    const response = await fetch(`/api/runs/${runId}/followup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, answer }),
    });
    setBusy(false);

    if (!response.ok) {
      setError(await errorMessage(response, "Follow-up failed"));
      router.refresh();
      return;
    }
    setMessage("");
    setAnswer("");
    router.refresh();
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-3 text-xs text-muted transition hover:text-accent"
      >
        Ask a follow-up
      </button>
    );
  }

  const input =
    "w-full rounded-md border border-line bg-background px-3 py-2 text-sm outline-none focus:border-accent";

  return (
    <div className="mt-3 space-y-3 border-t border-line pt-3">
      {turns.map((turn) => (
        <div
          key={turn.id}
          className={turn.role === "user" ? "pl-0" : "border-l-2 border-line pl-3"}
        >
          <p className="text-[10px] uppercase tracking-wide text-muted">
            {turn.role === "user" ? "You asked" : "Model"}
          </p>
          {turn.error ? (
            <p className="mt-0.5 text-sm text-red-500">{turn.error}</p>
          ) : (
            <p className="mt-0.5 whitespace-pre-wrap text-sm">{turn.content}</p>
          )}
        </div>
      ))}

      <form onSubmit={ask} className="space-y-2">
        <textarea
          rows={2}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Ask the model something about its answer…"
          className={input}
        />
        <textarea
          rows={2}
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder="Paste the model's reply"
          className={input}
        />
        {error && <p className="text-xs text-red-500">{error}</p>}
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={busy}
            className="rounded-md border border-line px-3 py-1.5 text-xs transition hover:bg-background disabled:opacity-50"
          >
            {busy ? "Asking…" : "Send"}
          </button>
          {turns.length === 0 && (
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-xs text-muted"
            >
              Cancel
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

export function ManualAnswerForm({
  questionId,
  models,
}: {
  questionId: number;
  models: { key: string; label: string; provider: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [modelKey, setModelKey] = useState(models[0]?.key ?? "");
  const [answer, setAnswer] = useState("");
  const [reasoning, setReasoning] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (models.length === 0) {
    return (
      <p className="rounded-xl border border-line bg-surface p-4 text-sm text-muted">
        To paste an answer from a model you can&apos;t call here, first add it on the{" "}
        <Link href="/models" className="text-accent">
          Models page
        </Link>{" "}
        with provider &ldquo;Manual&rdquo;.
      </p>
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full rounded-xl border border-dashed border-line bg-surface p-3 text-sm text-muted transition hover:border-accent hover:text-foreground"
      >
        + Paste an answer by hand
      </button>
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!answer.trim()) {
      setError("Paste the model's answer first");
      return;
    }
    setBusy(true);
    setError(null);
    const response = await fetch("/api/runs/manual", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question_id: questionId,
        model_key: modelKey,
        answer,
        reasoning,
      }),
    });
    setBusy(false);
    if (!response.ok) {
      setError(await errorMessage(response, "Could not save"));
      return;
    }
    setAnswer("");
    setReasoning("");
    setOpen(false);
    router.refresh();
  }

  const input =
    "w-full rounded-md border border-line bg-background px-3 py-2 text-sm outline-none focus:border-accent";

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-line bg-surface p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Paste an answer</h3>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-muted">
          Cancel
        </button>
      </div>

      <label className="block text-sm">
        <span className="mb-1.5 block font-medium">Model</span>
        <select value={modelKey} onChange={(e) => setModelKey(e.target.value)} className={input}>
          {models.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label}
              {m.provider === "manual" ? "" : ` (${m.provider})`}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-sm">
        <span className="mb-1.5 block font-medium">Answer</span>
        <textarea
          rows={2}
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder="What the model answered"
          className={input}
        />
      </label>

      <label className="block text-sm">
        <span className="mb-1.5 block font-medium">
          Reasoning <span className="font-normal text-muted">— optional</span>
        </span>
        <textarea
          rows={2}
          value={reasoning}
          onChange={(e) => setReasoning(e.target.value)}
          className={input}
        />
      </label>

      {error && <p className="text-xs text-red-500">{error}</p>}

      <button
        type="submit"
        disabled={busy}
        className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {busy ? "Saving…" : "Save answer"}
      </button>
    </form>
  );
}

export function DeleteQuestionButton({ questionId }: { questionId: number }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);

  async function remove() {
    await fetch(`/api/questions/${questionId}`, { method: "DELETE" });
    router.push("/");
    router.refresh();
  }

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className="text-xs text-muted transition hover:text-red-500"
      >
        Delete question
      </button>
    );
  }

  return (
    <span className="flex items-center gap-2 text-xs">
      <span className="text-muted">Delete this question and all its answers?</span>
      <button onClick={remove} className="rounded border border-red-500/30 px-2 py-0.5 text-red-500">
        Delete
      </button>
      <button onClick={() => setConfirming(false)} className="text-muted">
        Cancel
      </button>
    </span>
  );
}
