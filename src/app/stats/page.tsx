import Link from "next/link";
import { computeDetailedStats, type Flag, type Scored } from "@/lib/detailed-stats";
import { requireBenchmarkerPage } from "@/lib/session";
import {
  DIMENSIONS,
  FORMATS,
  MODALITY,
  VERIFIABILITY,
  type Modality,
  type Verifiability,
} from "@/lib/taxonomy";

export const dynamic = "force-dynamic";

function pct(value: number | null): string {
  return value == null ? "—" : `${Math.round(value * 100)}%`;
}

/** A cell that shows the rate and how much it rests on. */
function Cell({ score }: { score: Scored | undefined }) {
  if (!score || score.graded === 0) {
    return <span className="text-muted">{score?.ungraded ? `· ${score.ungraded}` : "—"}</span>;
  }
  return (
    <span className="tabular-nums">
      {pct(score.accuracy)}
      <span className="ml-1 text-xs text-muted">/{score.graded}</span>
    </span>
  );
}

function Bar({ value, muted = false }: { value: number | null; muted?: boolean }) {
  if (value == null) return <span className="text-muted">—</span>;
  return (
    <span className="flex items-center gap-2">
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-foreground/10">
        <span
          className={`block h-full rounded-full ${muted ? "bg-foreground/30" : "bg-accent"}`}
          style={{ width: `${value * 100}%` }}
        />
      </span>
      <span className="tabular-nums">{pct(value)}</span>
    </span>
  );
}

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}

const FLAGS: Record<Flag, { text: string; style: string; why: string }> = {
  discriminative: {
    text: "discriminative",
    style: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600",
    why: "Humans got it right and models got it wrong — the question you want more of.",
  },
  ambiguous: {
    text: "ambiguous",
    style: "border-amber-500/30 bg-amber-500/10 text-amber-600",
    why: "Grounders disagreed with each other. Usually the wording needs work, not the model.",
  },
  "too-easy": {
    text: "too easy",
    style: "border-slate-500/30 bg-slate-500/10 text-slate-500",
    why: "Every model got it right, so it carries no signal.",
  },
  "hard-for-humans": {
    text: "hard for humans",
    style: "border-red-500/30 bg-red-500/10 text-red-500",
    why: "Humans got it wrong — suspect the reference answer or the image before the model.",
  },
};

const th = "px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted";
const td = "px-3 py-2 text-sm";

export default async function StatsPage() {
  await requireBenchmarkerPage();
  const stats = computeDetailedStats();
  const { inventory: inv, performers, coverage, questions, emptyTypes, totals } = stats;

  if (inv.questions === 0) {
    return (
      <div className="rounded-xl border border-line bg-surface p-10 text-center">
        <h1 className="text-lg font-semibold">Nothing to measure yet</h1>
        <p className="mt-2 text-sm text-muted">
          Add a question and record some answers, and the numbers show up here.
        </p>
      </div>
    );
  }

  const usedFormats = FORMATS.filter((f) => inv.byFormat[f.code]);
  const models = performers.filter((p) => !p.isHuman);

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-xl font-semibold">Statistics</h1>
        <p className="mt-1 text-sm text-muted">
          What the benchmark covers, and how each model does across it. Rates read as{" "}
          <span className="font-medium">accuracy / answers graded</span>, with a partial counting
          as half.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Questions"
          value={inv.questions}
          hint={`${inv.classified} classified, ${inv.questions - inv.classified} not`}
        />
        <Stat
          label="Taxonomy covered"
          value={`${inv.typesCovered}/${inv.typesTotal}`}
          hint={`${emptyTypes.length} types have no question`}
        />
        <Stat
          label="Answers recorded"
          value={totals.humanAnswers + totals.modelAnswers}
          hint={`${totals.humanAnswers} human · ${totals.modelAnswers} model`}
        />
        <Stat
          label="Awaiting grading"
          value={totals.ungradedModel + totals.ungradedHuman}
          hint={
            totals.ungradedModel + totals.ungradedHuman > 0
              ? "Ungraded answers are left out of every rate below"
              : "Everything is graded"
          }
        />
      </div>

      {/* ---------- what has been asked ---------- */}
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
            What has been asked
          </h2>
          <p className="mt-1 text-sm text-muted">
            The shape of the benchmark itself — before any model comes into it.
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="overflow-hidden rounded-xl border border-line bg-surface">
            <p className="border-b border-line px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted">
              By dimension
            </p>
            <ul className="divide-y divide-line">
              {DIMENSIONS.map((d) => (
                <li key={d.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="w-4 shrink-0 font-mono text-xs text-muted">{d.id}</span>
                  <span className="min-w-0 flex-1 truncate" title={d.name}>
                    {d.name}
                  </span>
                  <span className="tabular-nums text-muted">{inv.byDimension[d.id] ?? 0}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="overflow-hidden rounded-xl border border-line bg-surface">
            <p className="border-b border-line px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted">
              By verifiability
            </p>
            <ul className="divide-y divide-line">
              {(Object.keys(VERIFIABILITY) as Verifiability[]).map((v) => (
                <li key={v} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span
                    className={`rounded border px-1.5 text-[10px] ${VERIFIABILITY[v].style}`}
                  >
                    {v}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{VERIFIABILITY[v].label}</span>
                  <span className="tabular-nums text-muted">{inv.byVerifiability[v] ?? 0}</span>
                </li>
              ))}
            </ul>
            <div className="border-t border-line px-3 py-2 text-xs text-muted">
              {(Object.keys(MODALITY) as Modality[]).map((m) => (
                <span key={m} className="mr-3">
                  {MODALITY[m]}: <span className="tabular-nums">{inv.byModality[m] ?? 0}</span>
                </span>
              ))}
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-line bg-surface">
            <p className="border-b border-line px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted">
              By answer format
            </p>
            <ul className="divide-y divide-line">
              {usedFormats.map((f) => (
                <li key={f.code} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="w-11 shrink-0 font-mono text-xs text-muted">{f.code}</span>
                  <span className="min-w-0 flex-1 truncate" title={f.label}>
                    {f.label}
                  </span>
                  <span
                    title={f.autoGradable ? "Scored automatically" : "Graded by hand"}
                    className="text-xs text-muted"
                  >
                    {f.autoGradable ? "auto" : "manual"}
                  </span>
                  <span className="tabular-nums text-muted">{inv.byFormat[f.code]}</span>
                </li>
              ))}
            </ul>
            <p className="border-t border-line px-3 py-2 text-xs text-muted">
              {inv.regional} regional (★) · {inv.withReference} with a reference answer
            </p>
          </div>
        </div>
      </section>

      {/* ---------- model performance ---------- */}
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
            How the models are doing
          </h2>
          <p className="mt-1 text-sm text-muted">
            The human row is the baseline every model is measured against.
          </p>
        </div>

        {models.length === 0 ? (
          <p className="rounded-xl border border-line bg-surface p-4 text-sm text-muted">
            No model answers yet. Paste some in from a question&apos;s Compare page.
          </p>
        ) : (
          <>
            <div className="overflow-x-auto rounded-xl border border-line bg-surface">
              <table className="w-full min-w-[720px]">
                <thead>
                  <tr className="border-b border-line">
                    <th className={th}>Answered by</th>
                    <th className={th}>Overall</th>
                    {DIMENSIONS.map((d) => (
                      <th key={d.id} className={th} title={d.name}>
                        D{d.id}
                      </th>
                    ))}
                    <th className={th}>Graded</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {performers.map((p) => (
                    <tr key={p.key} className={p.isHuman ? "bg-accent/5" : undefined}>
                      <td className={`${td} font-medium`}>{p.label}</td>
                      <td className={td}>
                        <Bar value={p.overall.accuracy} muted={p.isHuman} />
                      </td>
                      {DIMENSIONS.map((d) => (
                        <td key={d.id} className={td}>
                          <Cell score={p.byDimension[d.id]} />
                        </td>
                      ))}
                      <td className={`${td} tabular-nums text-muted`}>
                        {p.overall.graded}
                        {p.overall.ungraded > 0 && (
                          <span className="ml-1 text-amber-600">+{p.overall.ungraded}?</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="overflow-x-auto rounded-xl border border-line bg-surface">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-line">
                      <th className={th}>By verifiability</th>
                      {(Object.keys(VERIFIABILITY) as Verifiability[]).map((v) => (
                        <th key={v} className={th} title={VERIFIABILITY[v].label}>
                          {v}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {performers.map((p) => (
                      <tr key={p.key} className={p.isHuman ? "bg-accent/5" : undefined}>
                        <td className={`${td} font-medium`}>{p.label}</td>
                        {(Object.keys(VERIFIABILITY) as Verifiability[]).map((v) => (
                          <td key={v} className={td}>
                            <Cell score={p.byVerifiability[v]} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="border-t border-line px-3 py-2 text-xs text-muted">
                  Inferential questions have no single ground truth — a low score there may mean
                  the rubric, not the model.
                </p>
              </div>

              <div className="overflow-x-auto rounded-xl border border-line bg-surface">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-line">
                      <th className={th}>By answer format</th>
                      {usedFormats.map((f) => (
                        <th key={f.code} className={th} title={f.label}>
                          {f.code}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {performers.map((p) => (
                      <tr key={p.key} className={p.isHuman ? "bg-accent/5" : undefined}>
                        <td className={`${td} font-medium`}>{p.label}</td>
                        {usedFormats.map((f) => (
                          <td key={f.code} className={td}>
                            <Cell score={p.byFormat[f.code]} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="border-t border-line px-3 py-2 text-xs text-muted">
                  Counting (NUM) and OCR (SA) are where fine-grained reading usually breaks down.
                </p>
              </div>
            </div>
          </>
        )}
      </section>

      {/* ---------- per type ---------- */}
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
            Per fine-grained type
          </h2>
          <p className="mt-1 text-sm text-muted">
            A type where humans score well and models don&apos;t is one worth building out.{" "}
            {totals.discriminative > 0 &&
              `${totals.discriminative} ${totals.discriminative === 1 ? "type is" : "types are"} discriminating clearly.`}
          </p>
        </div>

        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full min-w-[680px]">
            <thead>
              <tr className="border-b border-line">
                <th className={th}>Type</th>
                <th className={th}>Questions</th>
                <th className={th}>Human</th>
                <th className={th}>Models</th>
                <th className={th}>Gap</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {coverage.map((c) => (
                <tr key={c.code}>
                  <td className={td}>
                    <span className="flex items-baseline gap-2">
                      <span className="font-mono text-xs text-muted">{c.code}</span>
                      <span className="truncate">{c.name}</span>
                      {c.regional && <span className="text-xs text-accent">★</span>}
                    </span>
                  </td>
                  <td className={`${td} tabular-nums text-muted`}>{c.questions}</td>
                  <td className={td}>
                    <Cell
                      score={{
                        accuracy: c.humanAccuracy,
                        graded: c.humanAnswers,
                        correct: 0,
                        partial: 0,
                        incorrect: 0,
                        ungraded: 0,
                      }}
                    />
                  </td>
                  <td className={td}>
                    <Cell
                      score={{
                        accuracy: c.modelAccuracy,
                        graded: c.modelAnswers,
                        correct: 0,
                        partial: 0,
                        incorrect: 0,
                        ungraded: 0,
                      }}
                    />
                  </td>
                  <td className={`${td} tabular-nums`}>
                    {c.gap == null ? (
                      <span className="text-muted">—</span>
                    ) : (
                      <span
                        className={
                          c.gap >= 0.5
                            ? "text-emerald-500"
                            : c.gap > 0
                              ? "text-foreground"
                              : "text-muted"
                        }
                      >
                        {c.gap > 0 ? "+" : ""}
                        {Math.round(c.gap * 100)}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {coverage.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-sm text-muted">
                    No classified questions yet.{" "}
                    <Link href="/classify" className="text-accent underline">
                      Classify them
                    </Link>{" "}
                    to see this broken down.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ---------- per question ---------- */}
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
            Per question
          </h2>
          <p className="mt-1 text-sm text-muted">
            The tables above say which <em>types</em> are working. This says which individual
            question to rewrite. Sorted by gap, widest first.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {(Object.keys(FLAGS) as Flag[]).map((f) => (
            <span
              key={f}
              title={FLAGS[f].why}
              className={`rounded border px-2 py-0.5 text-xs ${FLAGS[f].style}`}
            >
              {FLAGS[f].text}
            </span>
          ))}
        </div>

        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full min-w-[720px]">
            <thead>
              <tr className="border-b border-line">
                <th className={th}>Question</th>
                <th className={th}>Human</th>
                <th className={th}>Models</th>
                <th className={th}>Gap</th>
                <th className={th}>Signal</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {questions.map((q) => (
                <tr key={q.id}>
                  <td className={`${td} max-w-sm`}>
                    <Link href={`/reveal/${q.id}`} className="line-clamp-2 hover:text-accent">
                      {q.prompt}
                    </Link>
                    <span className="text-xs text-muted">
                      {q.type_code ?? "unclassified"} · {q.humanCount} human · {q.modelCount}{" "}
                      model
                    </span>
                  </td>
                  <td className={`${td} tabular-nums`}>{pct(q.humanAccuracy)}</td>
                  <td className={`${td} tabular-nums`}>{pct(q.modelAccuracy)}</td>
                  <td className={`${td} tabular-nums`}>
                    {q.gap == null ? (
                      <span className="text-muted">—</span>
                    ) : (
                      <span className={q.gap > 0 ? "text-emerald-500" : "text-muted"}>
                        {q.gap > 0 ? "+" : ""}
                        {Math.round(q.gap * 100)}
                      </span>
                    )}
                  </td>
                  <td className={td}>
                    {q.flag ? (
                      <span
                        title={FLAGS[q.flag].why}
                        className={`rounded border px-2 py-0.5 text-xs ${FLAGS[q.flag].style}`}
                      >
                        {FLAGS[q.flag].text}
                      </span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ---------- gaps ---------- */}
      {emptyTypes.length > 0 && (
        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
              Types with no questions yet
            </h2>
            <p className="mt-1 text-sm text-muted">
              {emptyTypes.length} of {inv.typesTotal} are untouched — the gaps in coverage.
            </p>
          </div>
          <div className="rounded-xl border border-line bg-surface p-4">
            <div className="flex flex-wrap gap-1.5">
              {emptyTypes.map((t) => (
                <span
                  key={t.code}
                  title={t.name}
                  className="rounded border border-line px-2 py-1 text-xs text-muted"
                >
                  <span className="font-mono">{t.code}</span> {t.name}
                </span>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
