"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { errorMessage } from "@/lib/fetch-error";
import { FORMAT_BY_CODE } from "@/lib/taxonomy";
import TypePicker, { type TypeSelection } from "./TypePicker";

const field =
  "w-full rounded-md border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent";
const label = "block text-sm font-medium mb-1.5";

export default function SetterForm() {
  const router = useRouter();
  const [preview, setPreview] = useState<string | null>(null);
  const [type, setType] = useState<TypeSelection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!type) {
      setError("Pick a fine-grained type first — it decides how the answer is scored.");
      return;
    }
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

  const spec = type ? FORMAT_BY_CODE.get(type.format) : null;
  const needsOptions = spec?.hasOptions ?? false;
  const autoGradable = spec?.autoGradable ?? false;

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
          <span className={label}>Type</span>
          <p className="mb-3 text-xs text-muted">
            The type sets how the answer is scored and which grounding probes apply. Pick the one
            the question is really testing.
          </p>
          <TypePicker value={type} onChange={setType} />
        </div>

        {needsOptions && (
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
              {autoGradable
                ? "— checked automatically against this"
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
