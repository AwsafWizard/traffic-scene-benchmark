import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/server/auth";
import { FLAG_LABEL, type FlagReason } from "@/server/engine";
import { annotatorDetail, annotatorTable } from "@/server/stats";
import { getAnnotator } from "@/server/users";
import { renameAnnotatorAction, resetPasswordAction, setActiveAction } from "../../../actions/admin";
import { PageHeader, pct, Stat, VBadge } from "../../../ui/components";
import SubmitButton from "../../../ui/SubmitButton";
import { buttonDanger, buttonSecondary, card, input, td, th } from "../../../ui/styles";
import ActionForm from "../../ActionForm";
import { resolveScope, ScopePicker } from "../../scope";

const JUDGMENT_LABEL: Record<string, string> = {
  setter_mistake: "Said the setter made a mistake",
  misread: "Said they misread",
  agree: "Agreed with the setter",
  disagree: "Disagreed with the setter",
  all_agree: "Said all three agree",
  not_all_agree: "Said not all three agree",
  none: "Picked “None of these”",
  cant_tell: "Picked “Can't tell”",
};

export default async function AnnotatorPage({ params, searchParams }: PageProps<"/admin/annotators/[id]">) {
  await requireAdmin();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const person = await getAnnotator(id);
  if (!person) notFound();
  const { sprints, sprintId, value } = await resolveScope((await searchParams).sprint);
  const [summary] = (await annotatorTable(sprintId)).filter((r) => r.id === id);
  const d = await annotatorDetail(id, sprintId);
  const maxDay = Math.max(1, ...d.activity.map((a) => a.written + a.checked));

  return (
    <div className="space-y-6">
      <PageHeader
        title={person.display_name}
        sub={<>{person.number !== null && <>Setter {String(person.number).padStart(2, "0")} · </>}@{person.username} · {person.active ? "active" : "revoked"} · last sign-in {person.last_login_at ? person.last_login_at.toLocaleString() : "never"}</>}
        actions={<ScopePicker path={`/admin/annotators/${id}`} sprints={sprints} value={value} />}
      />

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Questions written" value={summary?.written ?? 0} sub={`${summary?.accepted ?? 0} accepted · ${summary?.flagged ?? 0} flagged`} />
        <Stat label="Acceptance" value={pct(summary?.accepted ?? 0, (summary?.accepted ?? 0) + (summary?.flagged ?? 0))} sub="of their decided questions" />
        <Stat label="Checks done" value={`${summary?.checks_done ?? 0}/${summary?.checks_total ?? 0}`} />
        <Stat label="Blind match" value={pct(summary?.blind_matches ?? 0, summary?.blind_answers ?? 0)} sub={summary?.avg_seconds ? `${Math.round(summary.avg_seconds)}s per blind answer` : undefined} />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className={`${card} overflow-x-auto`}>
          <h2 className="px-4 pt-4 font-medium">As a setter</h2>
          <table className="mt-2 w-full text-sm">
            <thead>
              <tr>
                <th className={th}>Subtype</th>
                <th className={th}></th>
                <th className={`${th} text-right`}>Written</th>
                <th className={`${th} text-right`}>Accepted</th>
                <th className={`${th} text-right`}>Flagged</th>
              </tr>
            </thead>
            <tbody>
              {d.bySubtype.length === 0 && <tr><td className={`${td} text-muted`} colSpan={5}>Nothing written.</td></tr>}
              {d.bySubtype.map((r) => (
                <tr key={r.code}>
                  <td className={td}><span className="text-muted">{r.code}</span> {r.name}</td>
                  <td className={td}><VBadge v={r.verifiability} /></td>
                  <td className={`${td} text-right`}>{r.written}</td>
                  <td className={`${td} text-right`}>{r.accepted}</td>
                  <td className={`${td} text-right`}>{r.flagged}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {d.flagReasons.length > 0 && (
            <ul className="space-y-1 px-4 py-3 text-xs text-muted">
              {d.flagReasons.map((r) => (
                <li key={r.reason}>{FLAG_LABEL[r.reason as FlagReason] ?? r.reason}: {r.n}</li>
              ))}
            </ul>
          )}
        </div>

        <div className={`${card} space-y-3 p-4`}>
          <h2 className="font-medium">As a checker</h2>
          {d.judgments.length + d.specials.length === 0 ? (
            <p className="text-sm text-muted">No second-step judgments yet.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {[...d.judgments.map((j) => ({ k: j.judgment, n: j.n })), ...d.specials.map((s) => ({ k: s.choice, n: s.n }))].map((j) => (
                <li key={j.k} className="flex justify-between"><span>{JUDGMENT_LABEL[j.k] ?? j.k}</span><b>{j.n}</b></li>
              ))}
            </ul>
          )}
          {d.recentReasons.length > 0 && (
            <div>
              <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">Recent reasons</h3>
              <ul className="max-h-64 space-y-2 overflow-y-auto text-sm">
                {d.recentReasons.map((r, i) => (
                  <li key={i} className="border-l-2 border-line pl-2">
                    <Link href={`/admin/questions/${r.question_id}`} className="text-xs text-muted hover:underline">
                      {r.subtype} · {JUDGMENT_LABEL[r.kind] ?? r.kind}
                    </Link>
                    <p>{r.text}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>

      <section className={`${card} p-4`}>
        <h2 className="mb-3 font-medium">Last 30 days</h2>
        <div className="flex h-24 items-end gap-1" aria-label="Daily activity">
          {d.activity.map((a) => (
            <div key={a.day} className="flex flex-1 flex-col justify-end" title={`${a.day}: ${a.written} written, ${a.checked} checked`}>
              <div className="bg-accent/70" style={{ height: `${(a.checked / maxDay) * 96}px` }} />
              <div className="bg-emerald-500/80" style={{ height: `${(a.written / maxDay) * 96}px` }} />
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted"><span className="text-emerald-600">■</span> written · <span className="text-accent">■</span> checked</p>
      </section>

      <section className={`${card} space-y-4 p-5`}>
        <h2 className="font-medium">Account</h2>
        <ActionForm action={renameAnnotatorAction} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="user_id" value={id} />
          <input name="display_name" defaultValue={person.display_name} className={`${input} max-w-xs`} aria-label="Display name" />
          <SubmitButton className={buttonSecondary}>Rename</SubmitButton>
        </ActionForm>
        <ActionForm action={resetPasswordAction}>
          <input type="hidden" name="user_id" value={id} />
          <input type="hidden" name="username" value={person.username} />
          <SubmitButton className={buttonSecondary} pending="Resetting…" confirm={`Reset ${person.display_name}'s password? Their current password stops working and they're signed out.`}>
            Reset password
          </SubmitButton>
        </ActionForm>
        <form action={setActiveAction}>
          <input type="hidden" name="user_id" value={id} />
          <input type="hidden" name="active" value={person.active ? "false" : "true"} />
          {person.active ? (
            <SubmitButton className={buttonDanger} pending="Revoking…" confirm={`Revoke ${person.display_name}? They're signed out immediately and can't sign in. Their work is kept.`}>
              Revoke access
            </SubmitButton>
          ) : (
            <SubmitButton className={buttonSecondary} pending="Restoring…">Restore access</SubmitButton>
          )}
        </form>
      </section>
    </div>
  );
}
