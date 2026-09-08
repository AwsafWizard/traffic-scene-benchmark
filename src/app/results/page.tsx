import Link from "next/link";
import { computeStats, type Flag } from "@/lib/stats";
import { requireBenchmarkerPage } from "@/lib/session";
import type { Category } from "@/lib/types";

export const dynamic = "force-dynamic";

const CATEGORIES: Category[] = ["spatial", "logical", "behavioral"];

const FLAGS: Record<Flag, { text: string; style: string }> = {
  discriminative: {
    text: "discriminative",
    style: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600",
  },
  ambiguous: {
    text: "ambiguous",
    style: "border-amber-500/30 bg-amber-500/10 text-amber-600",
  },
  "too-easy": {
    text: "too easy",
    style: "border-slate-500/30 bg-slate-500/10 text-slate-500",
  },
  "hard-for-humans": {
    text: "hard for humans",
    style: "border-red-500/30 bg-red-500/10 text-red-500",
  },
};

function pct(value: number | null): string {
  return value == null ? "—" : `${Math.round(value * 100)}%`;
}

function Bar({ value }: { value: number | null }) {
  if (value == null) return <span className="text-muted">—</span>;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-foreground/10">
        <div className="h-full rounded-full bg-accent" style={{ width: `${value * 100}%` }} />
      </div>
      <span className="tabular-nums">{pct(value)}</span>
    </div>
  );
}

export default async function ResultsPage() {
  await requireBenchmarkerPage();
  const stats = computeStats();
  const rows = [
    { key: "__human", label: "Human grounding", isHuman: true, ...stats.human },
    ...stats.models.map((m) => ({ ...m, isHuman: false })),
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold">Results</h1>
        <p className="mt-1 text-sm text-muted">
          Accuracy counts a partial answer as half credit. Only graded answers are scored.
        </p>
      </div>

      <section className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full min-w-[680px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-4 py-3 font-medium">Answered by</th>
              <th className="px-4 py-3 font-medium">Overall</th>
              {CATEGORIES.map((c) => (
                <th key={c} className="px-4 py-3 font-medium capitalize">
                  {c}
                </th>
              ))}
              <th className="px-4 py-3 font-medium">Graded</th>
              <th className="px-4 py-3 font-medium">Median latency</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row) => (
              <tr key={row.key} className={row.isHuman ? "bg-accent/5" : undefined}>
                <td className="px-4 py-3 font-medium">{row.label}</td>
                <td className="px-4 py-3">
                  <Bar value={row.accuracy} />
                </td>
                {CATEGORIES.map((c) => (
                  <td key={c} className="px-4 py-3 tabular-nums text-muted">
                    {pct(row.by_category[c]?.accuracy ?? null)}
                  </td>
                ))}
                <td className="px-4 py-3 tabular-nums text-muted">
                  {row.graded}/{row.attempted}
                  {row.errors > 0 && <span className="ml-1 text-red-500">+{row.errors} err</span>}
                </td>
                <td className="px-4 py-3 tabular-nums text-muted">
                  {row.latency_p50 == null ? "—" : `${(row.latency_p50 / 1000).toFixed(1)}s`}
                </td>
              </tr>
            ))}
            {rows.length === 1 && stats.human.attempted === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-muted">
                  Nothing answered yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
            Question quality
          </h2>
          <p className="mt-1 text-sm text-muted">
            A good benchmark question is one humans get right and models get wrong. Ambiguous ones
            need rewriting; too-easy ones carry no signal.
          </p>
        </div>
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3 font-medium">Question</th>
                <th className="px-4 py-3 font-medium">Human</th>
                <th className="px-4 py-3 font-medium">Models</th>
                <th className="px-4 py-3 font-medium">Gap</th>
                <th className="px-4 py-3 font-medium">Signal</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {stats.questions.map((q) => (
                <tr key={q.id}>
                  <td className="max-w-md px-4 py-3">
                    <Link href={`/reveal/${q.id}`} className="line-clamp-2 hover:text-accent">
                      {q.prompt}
                    </Link>
                    <span className="text-xs text-muted">
                      {q.category} · {q.human_count} human · {q.run_count} runs
                    </span>
                  </td>
                  <td className="px-4 py-3 tabular-nums">{pct(q.human_accuracy)}</td>
                  <td className="px-4 py-3 tabular-nums">{pct(q.model_accuracy)}</td>
                  <td className="px-4 py-3 tabular-nums">
                    {q.gap == null ? (
                      <span className="text-muted">—</span>
                    ) : (
                      <span className={q.gap > 0 ? "text-emerald-500" : "text-muted"}>
                        {q.gap > 0 ? "+" : ""}
                        {Math.round(q.gap * 100)}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {q.flag ? (
                      <span className={`rounded border px-2 py-0.5 text-xs ${FLAGS[q.flag].style}`}>
                        {FLAGS[q.flag].text}
                      </span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {stats.questions.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-muted">
                    No questions yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
