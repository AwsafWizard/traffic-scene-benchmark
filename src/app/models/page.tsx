import { getDb } from "@/lib/db";
import { requireBenchmarkerPage } from "@/lib/session";
import type { ModelRow } from "@/lib/types";
import { AddModelForm, ModelListRow } from "./ModelControls";

export const dynamic = "force-dynamic";

export default async function ModelsPage() {
  await requireBenchmarkerPage();
  const models = getDb()
    .prepare("SELECT * FROM models ORDER BY provider, label")
    .all() as ModelRow[];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Models</h1>
        <p className="mt-1 text-sm text-muted">
          The models you&apos;re benchmarking. Answers are run wherever you like and pasted in on
          each question&apos;s Compare page, so nothing here needs an API key.
        </p>
      </div>

      <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
        {models.map((model) => (
          <ModelListRow key={model.key} model={model} />
        ))}
        {models.length === 0 && (
          <li className="p-6 text-center text-sm text-muted">No models yet.</li>
        )}
      </ul>

      <AddModelForm />
    </div>
  );
}
