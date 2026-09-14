import Link from "next/link";
import { getDb } from "@/lib/db";
import { requireBenchmarkerPage } from "@/lib/session";
import ClassifyForm from "./ClassifyForm";

export const dynamic = "force-dynamic";

type Row = { id: number; prompt: string; image_path: string; category: string };

export default async function ClassifyPage() {
  await requireBenchmarkerPage();

  const pending = getDb()
    .prepare(
      "SELECT id, prompt, image_path, category FROM questions WHERE type_code IS NULL ORDER BY id",
    )
    .all() as Row[];

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Classify older questions</h1>
        <p className="mt-1 text-sm text-muted">
          These were written before the taxonomy, when the only labels were spatial, logical and
          behavioral. Their answer format carried over exactly; the fine-grained type can&apos;t be
          guessed from the old label, so it needs a human. Nothing is lost in the meantime —
          unclassified questions still ground, run and score as they did.
        </p>
      </div>

      {pending.length === 0 ? (
        <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-600">
          Everything is classified.{" "}
          <Link href="/" className="underline">
            Back to questions
          </Link>
          .
        </p>
      ) : (
        <>
          <p className="text-sm text-muted">
            {pending.length} question{pending.length === 1 ? "" : "s"} left.
          </p>
          {pending.map((q) => (
            <ClassifyForm key={q.id} question={q} />
          ))}
        </>
      )}
    </div>
  );
}
