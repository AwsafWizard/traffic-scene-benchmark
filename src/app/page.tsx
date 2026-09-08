import Link from "next/link";
import { getDb } from "@/lib/db";
import { requireBenchmarkerPage } from "@/lib/session";
import type { Question } from "@/lib/types";

export const dynamic = "force-dynamic";

type Row = Question & { human_count: number; run_count: number };

const CATEGORY_STYLE: Record<string, string> = {
  spatial: "bg-blue-500/10 text-blue-500",
  logical: "bg-purple-500/10 text-purple-500",
  behavioral: "bg-amber-500/10 text-amber-600",
};

export default async function Home() {
  await requireBenchmarkerPage();
  const rows = getDb()
    .prepare(
      `SELECT q.*,
        (SELECT COUNT(*) FROM human_responses h WHERE h.question_id = q.id) AS human_count,
        (SELECT COUNT(*) FROM llm_runs r WHERE r.question_id = q.id AND r.error IS NULL) AS run_count
       FROM questions q ORDER BY q.id DESC`,
    )
    .all() as Row[];

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-line bg-surface p-10 text-center">
        <h1 className="text-lg font-semibold">No questions yet</h1>
        <p className="mt-2 text-sm text-muted">
          Start by uploading a traffic scene and writing a question about it.
        </p>
        <Link
          href="/setter"
          className="mt-6 inline-block rounded-md bg-accent px-4 py-2 text-sm font-medium text-white"
        >
          Add the first question
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Questions</h1>
        <span className="text-sm text-muted">{rows.length} total</span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((q) => (
          <div
            key={q.id}
            className="flex flex-col overflow-hidden rounded-xl border border-line bg-surface"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/image/${q.image_path}`}
              alt=""
              className="h-40 w-full object-cover"
            />
            <div className="flex flex-1 flex-col gap-3 p-4">
              <div className="flex flex-wrap gap-2">
                <span
                  className={`rounded px-2 py-0.5 text-xs font-medium ${CATEGORY_STYLE[q.category]}`}
                >
                  {q.category}
                </span>
                <span className="rounded bg-foreground/5 px-2 py-0.5 text-xs text-muted">
                  {q.answer_type === "mcq" ? "multiple choice" : "free text"}
                </span>
              </div>
              <p className="flex-1 text-sm leading-relaxed">{q.prompt}</p>
              <div className="text-xs text-muted">
                {q.human_count} human {q.human_count === 1 ? "answer" : "answers"} ·{" "}
                {q.run_count} model {q.run_count === 1 ? "run" : "runs"}
              </div>
              <div className="flex gap-2 text-sm">
                <Link
                  href={`/ground/${q.id}`}
                  className="rounded-md border border-line px-3 py-1.5 transition hover:bg-background"
                >
                  Answer
                </Link>
                <Link
                  href={`/reveal/${q.id}`}
                  className="rounded-md border border-line px-3 py-1.5 transition hover:bg-background"
                >
                  Compare
                </Link>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
