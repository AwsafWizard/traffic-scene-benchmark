import Link from "next/link";
import { requireAdmin } from "@/server/auth";
import { FLAG_LABEL, type FlagReason } from "@/server/engine";
import { overview } from "@/server/stats";
import { Notice, PageHeader, pct, Progress, Stat, VBadge } from "../ui/components";
import { card, link, td, th } from "../ui/styles";
import { resolveScope, ScopePicker } from "./scope";

const fmt = (x: number | null, digits = 2) => (x === null ? "—" : x.toFixed(digits));

export default async function AdminOverview({ searchParams }: PageProps<"/admin">) {
  await requireAdmin();
  const { sprints, sprintId, value } = await resolveScope((await searchParams).sprint);

  if (sprints.length === 0) {
    return (
      <>
        <PageHeader title="Overview" />
        <Notice>
          No sprints yet. Start by <Link href="/admin/annotators" className="underline">creating annotator accounts</Link>, then{" "}
          <Link href="/admin/sprints" className="underline">set up a sprint</Link>.
        </Notice>
      </>
    );
  }

  const s = await overview(sprintId);
  const a = s.agreement;
  const decided = s.status.accepted + s.status.flagged;
  const categories = [...new Set(s.bySubtype.map((r) => `${r.category_code}. ${r.category_name}`))];

  return (
    <div className="space-y-8">
      <PageHeader title="Overview" actions={<ScopePicker path="/admin" sprints={sprints} value={value} />} />

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Questions" value={s.status.total} sub={`${s.status.dropped} dropped`} />
        <Stat label="Accepted" value={s.status.accepted} sub={`${pct(s.status.accepted, decided)} of decided`} />
        <Stat
          label="Flagged"
          value={<Link href={`/admin/questions?status=flagged&sprint=${value}`} className="hover:underline">{s.status.flagged}</Link>}
          sub={`${s.status.returned} sent back to setters`}
        />
        <Stat label="Being checked" value={s.status.checking} sub={`${s.status.written} not yet sent`} />
        <Stat label="Checks done" value={`${s.checks.complete}/${s.checks.total}`} sub={pct(s.checks.complete, s.checks.total)} />
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <div className={`${card} space-y-2 p-4`}>
          <div className="flex items-center gap-2 font-medium"><VBadge v="V" long /></div>
          <p className="text-sm">Blind answer matched the setter: <b>{pct(a.V.matched, a.V.checked)}</b> <span className="text-muted">({a.V.matched}/{a.V.checked})</span></p>
          <p className="text-sm text-muted">After a mismatch: {a.V.misread} misread · {a.V.setterMistake} setter mistakes</p>
        </div>
        <div className={`${card} space-y-2 p-4`}>
          <div className="flex items-center gap-2 font-medium"><VBadge v="C" long /></div>
          <p className="text-sm">All three agreed: <b>{pct(a.C.allAgree, a.C.complete)}</b> <span className="text-muted">({a.C.allAgree}/{a.C.complete})</span></p>
          <p className="text-sm text-muted">
            Pairwise agreement {a.C.pairwise === null ? "—" : `${Math.round(a.C.pairwise * 100)}%`} · Fleiss&apos; κ {fmt(a.C.kappa)}
          </p>
        </div>
        <div className={`${card} space-y-2 p-4`}>
          <div className="flex items-center gap-2 font-medium"><VBadge v="I" long /></div>
          <p className="text-sm">Accepted by both checkers: <b>{pct(a.I.accepted, a.I.complete)}</b> <span className="text-muted">({a.I.accepted}/{a.I.complete})</span></p>
          <p className="text-sm text-muted">
            Blind pick matched the setter: second {pct(a.I.blindMatchSecond, a.I.complete)}, third {pct(a.I.blindMatchThird, a.I.complete)} ·
            judged agreement: second {pct(a.I.secondAgreed, a.I.complete)}, third {pct(a.I.thirdAllAgree, a.I.complete)}
          </p>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className={`${card} p-4`}>
          <h2 className="mb-2 font-medium">Why questions were flagged</h2>
          {s.flagReasons.length === 0 ? (
            <p className="text-sm text-muted">Nothing flagged.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {s.flagReasons.map((r) => (
                <li key={r.reason} className="flex justify-between">
                  <span>{FLAG_LABEL[r.reason as FlagReason] ?? (r.reason === "resubmitted" ? "Fixed by setter, awaiting review" : r.reason)}</span>
                  <b>{r.n}</b>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className={`${card} p-4`}>
          <h2 className="mb-2 font-medium">Model check</h2>
          <p className="mb-2 text-sm text-muted">
            {s.sampleSize} questions in the sample. <Link href={`/admin/models/check?sprint=${value}`} className={link}>Open the model check</Link>
          </p>
          {s.models.length === 0 ? (
            <p className="text-sm text-muted">No model answers yet.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {s.models.map((m) => (
                <li key={m.model} className="flex justify-between">
                  <span>{m.model}</span>
                  <span>
                    <b>{pct(m.correct, m.answered)}</b> <span className="text-muted">({m.correct}/{m.answered})</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-medium">By subtype</h2>
        <div className={`${card} overflow-x-auto`}>
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className={th}>Subtype</th>
                <th className={th}></th>
                <th className={`${th} text-right`}>Questions</th>
                <th className={`${th} text-right`}>Accepted</th>
                <th className={`${th} text-right`}>Flagged</th>
                <th className={`${th} text-right`}>Checking</th>
                <th className={th}>Accept rate</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((category) => (
                <SubtypeRows key={category} category={category} rows={s.bySubtype.filter((r) => `${r.category_code}. ${r.category_name}` === category)} value={value} />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {s.byTag.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-medium">By scene tag</h2>
          <div className={`${card} overflow-x-auto`}>
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={th}>Group</th>
                  <th className={th}>Tag</th>
                  <th className={`${th} text-right`}>Questions</th>
                  <th className={`${th} text-right`}>Accepted</th>
                  <th className={`${th} text-right`}>Flagged</th>
                  <th className={`${th} text-right`}>Flag rate</th>
                </tr>
              </thead>
              <tbody>
                {s.byTag.map((t) => (
                  <tr key={`${t.group}/${t.tag}`}>
                    <td className={`${td} text-muted`}>{t.group}</td>
                    <td className={td}>{t.tag}</td>
                    <td className={`${td} text-right`}>{t.total}</td>
                    <td className={`${td} text-right`}>{t.accepted}</td>
                    <td className={`${td} text-right`}>{t.flagged}</td>
                    <td className={`${td} text-right`}>{pct(t.flagged, t.accepted + t.flagged)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function SubtypeRows({ category, rows, value }: { category: string; rows: Awaited<ReturnType<typeof overview>>["bySubtype"]; value: string }) {
  return (
    <>
      <tr>
        <td colSpan={7} className="border-t border-line bg-background px-3 py-1.5 text-xs font-semibold text-muted">{category}</td>
      </tr>
      {rows.map((r) => {
        const decided = r.accepted + r.flagged;
        return (
          <tr key={r.subtype_id}>
            <td className={td}>
              <Link href={`/admin/questions?subtype=${r.subtype_id}&sprint=${value}`} className="hover:underline">
                <span className="text-muted">{r.code}</span> {r.name}
              </Link>
            </td>
            <td className={td}><VBadge v={r.verifiability} /></td>
            <td className={`${td} text-right tabular-nums`}>{r.total}</td>
            <td className={`${td} text-right tabular-nums`}>{r.accepted}</td>
            <td className={`${td} text-right tabular-nums`}>{r.flagged}</td>
            <td className={`${td} text-right tabular-nums`}>{r.checking}</td>
            <td className={`${td} w-40`}>
              {decided > 0 ? (
                <div className="flex items-center gap-2">
                  <Progress value={r.accepted} max={decided} />
                  <span className="w-10 text-right text-xs tabular-nums">{pct(r.accepted, decided)}</span>
                </div>
              ) : (
                <span className="text-xs text-muted">—</span>
              )}
            </td>
          </tr>
        );
      })}
    </>
  );
}
