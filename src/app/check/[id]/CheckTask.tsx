"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { goToNextTaskAction, submitBlindAction, submitJudgmentAction } from "../../actions/annotator";
import type { TaskView } from "@/server/checks";
import { button, buttonSecondary, card, input, label } from "../../ui/styles";

type View = TaskView extends infer T ? (T extends unknown ? Omit<T, "image"> : never) : never;

function describe(task: View, choice: string, note: string | null): string {
  if (choice === "none") return `None of these — "${note}"`;
  if (choice === "cant_tell") return `Can't tell from the image — "${note}"`;
  return task.options.find((o) => o.id === choice)?.text ?? "?";
}

function Answer({ who, text, highlight }: { who: string; text: string; highlight?: boolean }) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${highlight ? "border-accent bg-accent/5" : "border-line"}`}>
      <div className="text-xs text-muted">{who}</div>
      <div className="text-sm font-medium">{text}</div>
    </div>
  );
}

export default function CheckTask({ task }: { task: View }) {
  const router = useRouter();
  const [choice, setChoice] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [judgment, setJudgment] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [oddOne, setOddOne] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true);
    setError(null);
    const result = await action();
    setBusy(false);
    if (!result.ok) return setError(result.error ?? "Couldn't save.");
    setChoice(null);
    setNote("");
    setJudgment(null);
    setReason("");
    setOddOne(null);
    router.refresh();
  }

  const question = (
    <div className={`${card} p-5`}>
      <p className="text-base leading-relaxed">{task.prompt}</p>
    </div>
  );
  const errorBox = error && (
    <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">{error}</p>
  );

  if (task.step === "blind") {
    const special = choice === "none" || choice === "cant_tell";
    return (
      <div className="space-y-4">
        {question}
        <p className="text-sm text-muted">Answer from the image alone. You&apos;ll see other answers only after you commit yours.</p>
        <div className="space-y-2">
          {task.options.map((o) => (
            <label
              key={o.id}
              className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm transition ${
                choice === o.id ? "border-accent bg-accent/5" : "border-line bg-surface hover:bg-background"
              }`}
            >
              <input type="radio" name="choice" checked={choice === o.id} onChange={() => setChoice(o.id)} className="accent-[var(--accent)]" />
              {o.text}
            </label>
          ))}
          <div className="grid gap-2 pt-1 sm:grid-cols-2">
            {[
              { id: "none", text: "None of these is correct" },
              { id: "cant_tell", text: "Can't tell from the image" },
            ].map((o) => (
              <label
                key={o.id}
                className={`flex cursor-pointer items-center gap-2 rounded-lg border border-dashed p-2.5 text-sm transition ${
                  choice === o.id ? "border-amber-500 bg-amber-500/10" : "border-line hover:bg-background"
                }`}
              >
                <input type="radio" name="choice" checked={choice === o.id} onChange={() => setChoice(o.id)} />
                {o.text}
              </label>
            ))}
          </div>
          {special && (
            <div>
              <label className={label} htmlFor="note">
                {choice === "none" ? "What is the correct answer?" : "Why can't it be told?"}
              </label>
              <textarea id="note" rows={2} className={input} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          )}
        </div>
        {errorBox}
        <button
          type="button"
          className={button}
          disabled={busy || !choice || (special && !note.trim())}
          onClick={() => run(() => submitBlindAction(task.check_id, choice!, note))}
        >
          {busy ? "Saving…" : "Submit answer"}
        </button>
      </div>
    );
  }

  if (task.step === "judgment") {
    const mine = describe(task, task.mine.choice, task.mine.note);
    const setter = describe(task, task.setter, null);
    const needsReason = judgment === "setter_mistake" || judgment === "disagree" || judgment === "not_all_agree";
    const choices =
      task.role === "v"
        ? [
            { id: "setter_mistake", text: "The setter made a mistake" },
            { id: "misread", text: "I misread it — the setter is right" },
          ]
        : task.role === "second"
          ? [
              { id: "agree", text: "I agree with the setter's answer" },
              { id: "disagree", text: "I disagree" },
            ]
          : [
              { id: "all_agree", text: "Yes, all three agree" },
              { id: "not_all_agree", text: "No, they don't all agree" },
            ];
    const prompt =
      task.role === "v"
        ? "Your answer differs from the setter's. Look again: who is right?"
        : task.role === "second"
          ? "Is the setter's answer reasonable? It doesn't have to be the option you picked."
          : "Do all three answers agree? Judge whether they're reasonable, not just whether the options match.";

    return (
      <div className="space-y-4">
        {question}
        <div className="space-y-2">
          <Answer who="Your answer" text={mine} highlight />
          <Answer who="The setter's answer" text={setter} />
          {task.second && <Answer who="The other checker's answer" text={describe(task, task.second.choice, task.second.note)} />}
        </div>
        <p className="text-sm font-medium">{prompt}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {choices.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setJudgment(c.id)}
              className={`rounded-lg border p-3 text-left text-sm transition ${
                judgment === c.id ? "border-accent bg-accent/5" : "border-line bg-surface hover:bg-background"
              }`}
            >
              {c.text}
            </button>
          ))}
        </div>
        {judgment === "not_all_agree" && (
          <div>
            <span className={label}>Which answer is the odd one out?</span>
            <div className="flex flex-wrap gap-2">
              {[
                { id: "setter", text: "The setter's" },
                { id: "second", text: "The other checker's" },
                { id: "mine", text: "Mine" },
              ].map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => setOddOne(o.id)}
                  className={`${buttonSecondary} ${oddOne === o.id ? "border-accent bg-accent/5" : ""}`}
                >
                  {o.text}
                </button>
              ))}
            </div>
          </div>
        )}
        {needsReason && (
          <div>
            <label className={label} htmlFor="reason">
              Why?
            </label>
            <textarea id="reason" rows={2} className={input} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        )}
        {errorBox}
        <button
          type="button"
          className={button}
          disabled={busy || !judgment || (needsReason && !reason.trim()) || (judgment === "not_all_agree" && !oddOne)}
          onClick={() => run(() => submitJudgmentAction(task.check_id, judgment!, reason, oddOne))}
        >
          {busy ? "Saving…" : "Submit"}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {question}
      <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-400">
        {task.summary}
      </p>
      <form action={goToNextTaskAction}>
        <button type="submit" className={button}>
          Next question
        </button>
      </form>
    </div>
  );
}
