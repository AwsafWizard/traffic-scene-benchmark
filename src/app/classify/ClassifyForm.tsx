"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { errorMessage } from "@/lib/fetch-error";
import { LEGACY_CATEGORY_DIMENSION } from "@/lib/taxonomy";
import TypePicker, { type TypeSelection } from "../setter/TypePicker";

export default function ClassifyForm({
  question,
}: {
  question: { id: number; prompt: string; image_path: string; category: string };
}) {
  const router = useRouter();
  const [type, setType] = useState<TypeSelection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!type) {
      setError("Pick a type first");
      return;
    }
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/questions/${question.id}/classify`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type_code: type.typeCode,
        verifiability: type.verifiability,
        modality: type.modality,
        probes: type.probes,
        answer_format: type.format,
      }),
    });
    setBusy(false);
    if (!response.ok) {
      setError(await errorMessage(response, "Could not save"));
      return;
    }
    setType(null);
    router.refresh();
  }

  return (
    <div className="space-y-4 rounded-xl border border-line bg-surface p-5">
      <div className="flex gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/image/${question.image_path}`}
          alt=""
          className="h-24 w-32 shrink-0 rounded object-cover"
        />
        <div className="min-w-0">
          <p className="text-sm leading-relaxed">{question.prompt}</p>
          <p className="mt-1 text-xs text-muted">
            was tagged <span className="font-mono">{question.category}</span>
          </p>
        </div>
      </div>

      <TypePicker
        value={type}
        onChange={setType}
        initialDimension={LEGACY_CATEGORY_DIMENSION[question.category] ?? 1}
      />

      {error && <p className="text-xs text-red-500">{error}</p>}

      <button
        onClick={save}
        disabled={busy || !type}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {busy ? "Saving…" : "Save classification"}
      </button>
    </div>
  );
}
