"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ModelRow, Provider } from "@/lib/types";
import { errorMessage } from "@/lib/fetch-error";

const field =
  "w-full rounded-md border border-line bg-background px-3 py-2 text-sm outline-none focus:border-accent";

export function ModelListRow({ model }: { model: ModelRow }) {
  const router = useRouter();

  async function toggle() {
    await fetch("/api/models", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: model.key, enabled: !model.enabled }),
    });
    router.refresh();
  }

  async function remove() {
    await fetch(`/api/models?key=${encodeURIComponent(model.key)}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <li className="flex items-center gap-4 p-4">
      <input
        type="checkbox"
        checked={Boolean(model.enabled)}
        onChange={toggle}
        aria-label={`Enable ${model.label}`}
        className="size-4 accent-[var(--accent)]"
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{model.label}</p>
        <p className="truncate text-xs text-muted">
          <span className="font-mono">
            {model.provider} · {model.model_id}
          </span>
          {model.extra && <span className="ml-2">{model.extra}</span>}
        </p>
      </div>
      <button
        onClick={remove}
        className="rounded-md border border-line px-3 py-1.5 text-sm text-muted transition hover:bg-background hover:text-red-500"
      >
        Remove
      </button>
    </li>
  );
}

export function AddModelForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    label: "",
    key: "",
    provider: "anthropic" as Provider,
    model_id: "",
    extra: "",
  });

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const response = await fetch("/api/models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, key: form.key || form.model_id }),
    });
    if (!response.ok) {
      setError(await errorMessage(response, "Could not add model"));
      return;
    }
    setForm({ label: "", key: "", provider: form.provider, model_id: "", extra: "" });
    router.refresh();
  }

  return (
    <form onSubmit={add} className="space-y-4 rounded-xl border border-line bg-surface p-5">
      <h2 className="text-sm font-semibold">Add a model</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1.5 block font-medium">Display name</span>
          <input
            required
            value={form.label}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
            placeholder="GPT-5"
            className={field}
          />
        </label>
        <label className="text-sm">
          <span className="mb-1.5 block font-medium">Provider</span>
          <select
            value={form.provider}
            onChange={(e) => setForm({ ...form, provider: e.target.value as Provider })}
            className={field}
          >
            <option value="anthropic">Anthropic</option>
            <option value="openai">OpenAI</option>
            <option value="google">Google</option>
            <option value="meta">Meta</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1.5 block font-medium">Model ID / version</span>
          <input
            required
            value={form.model_id}
            onChange={(e) => setForm({ ...form, model_id: e.target.value })}
            placeholder="e.g. gemini-3.1-pro"
            className={`${field} font-mono`}
          />
          <span className="mt-1 block text-xs text-muted">
            Which exact version answered, so results stay comparable later.
          </span>
        </label>
        <label className="text-sm">
          <span className="mb-1.5 block font-medium">
            Short name <span className="font-normal text-muted">— optional</span>
          </span>
          <input
            value={form.key}
            onChange={(e) => setForm({ ...form, key: e.target.value })}
            placeholder="defaults to the model ID"
            className={`${field} font-mono`}
          />
          <span className="mt-1 block text-xs text-muted">
            How results are labelled internally. Not an API key.
          </span>
        </label>
      </div>
      <label className="block text-sm">
        <span className="mb-1.5 block font-medium">
          Notes <span className="font-normal text-muted">— optional</span>
        </span>
        <input
          value={form.extra}
          onChange={(e) => setForm({ ...form, extra: e.target.value })}
          placeholder="How you ran it — web UI, temperature, system prompt…"
          className={field}
        />
      </label>

      {error && (
        <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-500">
          {error}
        </p>
      )}

      <button type="submit" className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white">
        Add model
      </button>
    </form>
  );
}
