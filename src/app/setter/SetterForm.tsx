"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { errorMessage } from "@/lib/fetch-error";

const CATEGORIES = [
  { value: "spatial", hint: "Where things are: lanes, distances, relative position, occlusion." },
  { value: "logical", hint: "Rules and inference: right of way, sign/signal logic, legality." },
  { value: "behavioral", hint: "What should happen next: predicted or correct driver action." },
] as const;

const field =
  "w-full rounded-md border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent";
const label = "block text-sm font-medium mb-1.5";

export default function SetterForm() {
  const router = useRouter();
  const [preview, setPreview] = useState<string | null>(null);
  const [category, setCategory] = useState<string>("spatial");
  const [answerType, setAnswerType] = useState("mcq");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/questions", { method: "POST", body: form });
    setBusy(false);
    if (!response.ok) {
      setError(await errorMessage(response, "Could not save the question"));
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Add a question</h1>
        <p className="mt-1 text-sm text-muted">
          The grounder sees only the image and the question — never the reference answer or the
          model responses.
        </p>
      </div>

      <div className="rounded-xl border border-line bg-surface p-5">
        <label className={label} htmlFor="image">
          Traffic scene image
        </label>
        <input
          id="image"
          name="image"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          required
          onChange={(e) => {
            const file = e.target.files?.[0];
            setPreview(file ? URL.createObjectURL(file) : null);
          }}
          className="block w-full text-sm text-muted file:mr-3 file:rounded-md file:border file:border-line file:bg-background file:px-3 file:py-1.5 file:text-sm file:text-foreground"
        />
        {preview && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview}
            alt="Selected scene"
            className="mt-4 max-h-72 w-full rounded-lg object-contain"
          />
        )}
      </div>

      <div className="space-y-5 rounded-xl border border-line bg-surface p-5">
        <div>
          <label className={label} htmlFor="prompt">
            Question
          </label>
          <textarea
            id="prompt"
            name="prompt"
            required
            rows={3}
            placeholder="e.g. The white car is stopped at the intersection. Which vehicle has right of way?"
            className={field}
          />
        </div>

        <div>
          <span className={label}>Category</span>
          <div className="grid gap-2 sm:grid-cols-3">
            {CATEGORIES.map((c) => (
              <label
                key={c.value}
                className={`cursor-pointer rounded-lg border p-3 text-sm transition ${
                  category === c.value
                    ? "border-accent bg-accent/5"
                    : "border-line hover:bg-background"
                }`}
              >
                <input
                  type="radio"
                  name="category"
                  value={c.value}
                  checked={category === c.value}
                  onChange={() => setCategory(c.value)}
                  className="sr-only"
                />
                <span className="font-medium capitalize">{c.value}</span>
                <span className="mt-1 block text-xs leading-snug text-muted">{c.hint}</span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <span className={label}>Answer format</span>
          <div className="flex gap-2">
            {["mcq", "free"].map((t) => (
              <label
                key={t}
                className={`cursor-pointer rounded-md border px-3 py-1.5 text-sm transition ${
                  answerType === t ? "border-accent bg-accent/5" : "border-line hover:bg-background"
                }`}
              >
                <input
                  type="radio"
                  name="answer_type"
                  value={t}
                  checked={answerType === t}
                  onChange={() => setAnswerType(t)}
                  className="sr-only"
                />
                {t === "mcq" ? "Multiple choice" : "Free text"}
              </label>
            ))}
          </div>
        </div>

        {answerType === "mcq" && (
          <div>
            <label className={label} htmlFor="options">
              Options — one per line
            </label>
            <textarea
              id="options"
              name="options"
              rows={4}
              placeholder={"The blue sedan\nThe white van\nThe motorcycle\nNeither — the light governs"}
              className={field}
            />
          </div>
        )}

        <div>
          <label className={label} htmlFor="reference_answer">
            Reference answer{" "}
            <span className="font-normal text-muted">
              {answerType === "mcq"
                ? "— must match one option exactly; enables auto-scoring"
                : "— optional, used as your grading guide"}
            </span>
          </label>
          <input id="reference_answer" name="reference_answer" className={field} />
        </div>

        <div>
          <label className={label} htmlFor="notes">
            Notes <span className="font-normal text-muted">— private to you</span>
          </label>
          <input
            id="notes"
            name="notes"
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

      <button
        type="submit"
        disabled={busy}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {busy ? "Saving…" : "Save question"}
      </button>
    </form>
  );
}
