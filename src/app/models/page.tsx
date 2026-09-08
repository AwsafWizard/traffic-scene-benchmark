import { getDb } from "@/lib/db";
import { requireBenchmarkerPage } from "@/lib/session";
import type { ApiProvider, ModelRow } from "@/lib/types";
import { AddModelForm, ModelListRow } from "./ModelControls";

export const dynamic = "force-dynamic";

const ENV_VAR: Record<ApiProvider, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GOOGLE_API_KEY",
};

export default async function ModelsPage() {
  await requireBenchmarkerPage();
  const models = getDb()
    .prepare("SELECT * FROM models ORDER BY provider, label")
    .all() as ModelRow[];

  const keys: Record<ApiProvider, boolean> = {
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
    openai: Boolean(process.env.OPENAI_API_KEY),
    google: Boolean(process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY),
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Models</h1>
        <p className="mt-1 text-sm text-muted">
          Enabled models run on every question. Add as many as you like.
        </p>
      </div>

      <div className="rounded-xl border border-line bg-surface p-4">
        <div className="flex flex-wrap gap-2">
          {(Object.keys(ENV_VAR) as ApiProvider[]).map((p) => (
            <span
              key={p}
              className={`rounded-md border px-3 py-1.5 text-xs ${
                keys[p]
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600"
                  : "border-line text-muted"
              }`}
            >
              {ENV_VAR[p]} {keys[p] ? "set" : "missing"}
            </span>
          ))}
        </div>
        <p className="mt-3 text-xs leading-relaxed text-muted">
          API keys are never entered here — they go in{" "}
          <code className="rounded bg-foreground/5 px-1 py-0.5 font-mono">.env.local</code> at the
          project root, one line per provider (e.g.{" "}
          <code className="rounded bg-foreground/5 px-1 py-0.5 font-mono">GOOGLE_API_KEY=…</code>).
          Restart the dev server after editing it.
        </p>
      </div>

      <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
        {models.map((model) => (
          <ModelListRow key={model.key} model={model} />
        ))}
        {models.length === 0 && <li className="p-4 text-sm text-muted">No models configured yet.</li>}
      </ul>

      <AddModelForm />
    </div>
  );
}
