"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { errorMessage } from "@/lib/fetch-error";
import { FORMAT_BY_CODE } from "@/lib/taxonomy";
import TypePicker, { type TypeSelection } from "../../setter/TypePicker";

const field =
  "w-full rounded-md border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent";
const label = "block text-sm font-medium mb-1.5";

export interface EditableQuestion {
  id: number;
  prompt: string;
  imagePath: string;
  options: string[] | null;
  reference: string | null;
  notes: string | null;
  type: TypeSelection | null;
  /** Pre-selects a dimension for questions written before the taxonomy. */
  initialDimension?: number;
  humanAnswers: number;
  modelAnswers: number;
}

export default function EditForm({ question }: { question: EditableQuestion }) {
  const router = useRouter();
  const [prompt, setPrompt] = useState(question.prompt);
  const [type, setType] = useState<TypeSelection | null>(question.type);
  const [options, setOptions] = useState((question.options ?? []).join("\n"));
  const [reference, setReference] = useState(question.reference ?? "");
  const [notes, setNotes] = useState(question.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ regraded: number; shared: boolean } | null>(null);

  const spec = type ? FORMAT_BY_CODE.get(type.format) : null;
  const needsOptions = spec?.hasOptions ?? false;
  const autoGradable = spec?.autoGradable ?? false;
  const answers = question.humanAnswers + question.modelAnswers;
  const droppingOptions = !needsOptions && (question.options?.length ?? 0) > 0;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!type) {
      setError("Pick a fine-grained type first — it decides how the answer is scored.");
      return;
    }
    setBusy(true);
    setError(null);
    setSaved(null);

    const response = await fetch(`/api/questions/${question.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        options,
        reference_answer: reference,
        notes,
        type_code: type.typeCode,
        verifiability: type.verifiability,
        modality: type.modality,
        probes: type.probes,
        answer_format: type.format,
      }),
    });
    setBusy(false);

    if (!response.ok) {
      setError(await errorMessage(response, "Could not save the edit"));
      return;
    }
    setSaved((await response.json()) as { regraded: number; shared: boolean });
    router.refresh();
  }

  return (
    <form onSubmit={save} className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Edit question</h1>
        <p className="mt-1 text-sm text-muted">
          Changes sync to the other copy. Your private notes stay on this machine.
        </p>
      </div>

      {answers > 0 && (
        <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-600">
          This question already has {question.humanAnswers} human{" "}
          {question.humanAnswers === 1 ? "answer" : "answers"} and {question.modelAnswers} model{" "}
          {question.modelAnswers === 1 ? "answer" : "answers"}. Rewording it changes what they were
          answering.
          Changing the reference answer, format or options re-scores the automatic grades — grades
          given by hand are left alone.
        </p>
      )}

      <div className="flex gap-4 rounded-xl border border-line bg-surface p-5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/image/${question.imagePath}`}
          alt="Scene"
          className="h-28 w-40 shrink-0 rounded object-cover"
        />
        <p className="text-xs leading-relaxed text-muted">
          The image can&apos;t be swapped here: every answer already given was to this scene. To
          ask about a different image, add a new question.
        </p>
      </div>

      <div className="space-y-5 rounded-xl border border-line bg-surface p-5">
        <div>
          <label className={label} htmlFor="prompt">
            Question
          </label>
          <textarea
            id="prompt"
            required
            rows={3}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className={field}
          />
        </div>

        <div>
          <span className={label}>Type</span>
          <TypePicker
            value={type}
            onChange={setType}
            initialDimension={question.type ? undefined : question.initialDimension}
          />
        </div>

        {needsOptions && (
          <div>
            <label className={label} htmlFor="options">
              Options — one per line
            </label>
            <textarea
              id="options"
              rows={4}
              value={options}
              onChange={(e) => setOptions(e.target.value)}
              className={field}
            />
          </div>
        )}

        {droppingOptions && (
          <p className="rounded-md border border-line bg-background px-3 py-2 text-xs text-muted">
            {type?.format} takes no option list, so saving removes this question&apos;s{" "}
            {question.options!.length} options — on the other copy too.
          </p>
        )}

        <div>
          <label className={label} htmlFor="reference_answer">
            Reference answer{" "}
            <span className="font-normal text-muted">
              {autoGradable
                ? "— checked automatically against this"
                : "— optional, used as your grading guide"}
            </span>
          </label>
          <input
            id="reference_answer"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            className={field}
          />
        </div>

        <div>
          <label className={label} htmlFor="notes">
            Notes <span className="font-normal text-muted">— private to you</span>
          </label>
          <input
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What this question is meant to probe"
            className={field}
          />
        </div>
      </div>

      {error && (
        <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-500">
          {error}
        </p>
      )}

      {saved && (
        <p className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-600">
          Saved.
          {saved.shared ? " Synced to the other copy." : " Only your notes changed, so nothing needed syncing."}
          {saved.regraded > 0 &&
            ` ${saved.regraded} automatic ${saved.regraded === 1 ? "grade was" : "grades were"} re-scored against the new key.`}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save changes"}
        </button>
        <Link href={`/reveal/${question.id}`} className="text-sm text-muted hover:text-foreground">
          Back to Compare
        </Link>
      </div>
    </form>
  );
}
