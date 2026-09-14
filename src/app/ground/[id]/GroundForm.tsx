"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Question } from "@/lib/types";

const NAME_KEY = "grounder-name";

export default function GroundForm({
  question,
  isGrounder,
}: {
  question: Question;
  isGrounder: boolean;
}) {
  const router = useRouter();
  const options: string[] = question.options ? JSON.parse(question.options) : [];
  const startedAt = useRef(0);
  const nameInput = useRef<HTMLInputElement>(null);
  const [answer, setAnswer] = useState("");
  const [confidence, setConfidence] = useState(3);
  const [rationale, setRationale] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Clock starts when the grounder actually sees the question, not at module load.
  // The name field is uncontrolled so the remembered value can be filled in without
  // a second render pass.
  useEffect(() => {
    startedAt.current = Date.now();
    const saved = localStorage.getItem(NAME_KEY);
    if (saved && nameInput.current) nameInput.current.value = saved;
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!answer.trim()) {
      setError("Pick or type an answer first");
      return;
    }
    setBusy(true);
    setError(null);
    const name = nameInput.current?.value.trim() ?? "";
    localStorage.setItem(NAME_KEY, name);

    const response = await fetch("/api/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question_id: question.id,
        grounder_name: name,
        answer,
        confidence,
        rationale,
        duration_ms: Date.now() - startedAt.current,
      }),
    });

    const body = (await response.json()) as {
      error?: string;
      next_question_id?: number | null;
      stay_blind?: boolean;
    };

    if (!response.ok) {
      setError(body.error ?? "Could not save");
      setBusy(false);
      return;
    }

    // Anyone answering blind must not pass through Compare — it shows the answer.
    if (isGrounder || body.stay_blind) {
      router.push(body.next_question_id ? `/ground/${body.next_question_id}` : "/ground?done=1");
    } else {
      router.push(`/reveal/${question.id}`);
    }
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="space-y-4 rounded-xl border border-line bg-surface p-5">
        <p className="text-base leading-relaxed">{question.prompt}</p>

        {options.length > 0 ? (
          <div className="space-y-2">
            {options.map((option) => (
              <label
                key={option}
                className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm transition ${
                  answer === option ? "border-accent bg-accent/5" : "border-line hover:bg-background"
                }`}
              >
                <input
                  type="radio"
                  name="answer"
                  checked={answer === option}
                  onChange={() => setAnswer(option)}
                  className="accent-[var(--accent)]"
                />
                {option}
              </label>
            ))}
          </div>
        ) : (
          <textarea
            rows={3}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="Your answer"
            className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm outline-none focus:border-accent"
          />
        )}

        <div>
          <span className="mb-1.5 block text-sm font-medium">
            Confidence <span className="font-normal text-muted">— {confidence} of 5</span>
          </span>
          <input
            type="range"
            min={1}
            max={5}
            value={confidence}
            onChange={(e) => setConfidence(Number(e.target.value))}
            className="w-full accent-[var(--accent)]"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium" htmlFor="rationale">
            Why? <span className="font-normal text-muted">— optional, but useful later</span>
          </label>
          <textarea
            id="rationale"
            rows={2}
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium" htmlFor="name">
            Your name
          </label>
          <input
            id="name"
            ref={nameInput}
            defaultValue=""
            placeholder="anonymous"
            className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </div>
      </div>

      {error && (
        <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-500">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {busy ? "Saving…" : isGrounder ? "Submit answer" : "Submit and reveal"}
      </button>
    </form>
  );
}
