import Link from "next/link";
import { getDb } from "@/lib/db";
import { getRole } from "@/lib/session";
import type { Question } from "@/lib/types";

export const dynamic = "force-dynamic";

type Row = Question & { human_count: number };

export default async function GroundQueue({ searchParams }: PageProps<"/ground">) {
  const isGrounder = (await getRole()) === "grounder";
  const done = "done" in (await searchParams);

  const rows = getDb()
    .prepare(
      `SELECT q.*,
        (SELECT COUNT(*) FROM human_responses h WHERE h.question_id = q.id) AS human_count
       FROM questions q ORDER BY human_count ASC, q.id ASC`,
    )
    .all() as Row[];

  const unanswered = rows.filter((r) => r.human_count === 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">
          {isGrounder ? "Questions to answer" : "Grounding queue"}
        </h1>
        <p className="mt-1 text-sm text-muted">
          Answer from the image alone. There&apos;s no penalty for saying what you actually think —
          if a question is unclear or unanswerable, that is itself the finding.
        </p>
      </div>

      {done && unanswered.length === 0 && (
        <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-600">
          That&apos;s everything — thanks. Check back later for more.
        </p>
      )}

      {rows.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface p-6 text-sm text-muted">
          {isGrounder ? (
            "No questions have been added yet."
          ) : (
            <>
              No questions yet.{" "}
              <Link href="/setter" className="text-accent">
                Add one first.
              </Link>
            </>
          )}
        </p>
      ) : (
        <>
          {unanswered.length > 0 && (
            <Link
              href={`/ground/${unanswered[0].id}`}
              className="inline-block rounded-md bg-accent px-4 py-2 text-sm font-medium text-white"
            >
              Start — {unanswered.length} unanswered
            </Link>
          )}
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
            {rows.map((q) => (
              <li key={q.id} className="flex items-center gap-4 p-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/image/${q.image_path}`}
                  alt=""
                  className="h-14 w-20 shrink-0 rounded object-cover"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{q.prompt}</p>
                  <p className="text-xs text-muted">
                    {q.category} ·{" "}
                    {q.human_count === 0 ? "not answered yet" : `${q.human_count} answered`}
                  </p>
                </div>
                <Link
                  href={`/ground/${q.id}`}
                  className="shrink-0 rounded-md border border-line px-3 py-1.5 text-sm transition hover:bg-background"
                >
                  {q.human_count === 0 ? "Answer" : "Answer again"}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
