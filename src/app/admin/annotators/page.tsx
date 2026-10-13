import Link from "next/link";
import { requireAdmin } from "@/server/auth";
import { annotatorTable } from "@/server/stats";
import { createAnnotatorAction } from "../../actions/admin";
import { PageHeader, pct } from "../../ui/components";
import SubmitButton from "../../ui/SubmitButton";
import { card, input, label, td, th } from "../../ui/styles";
import ActionForm from "../ActionForm";
import { resolveScope, ScopePicker } from "../scope";

export default async function AnnotatorsPage({ searchParams }: PageProps<"/admin/annotators">) {
  await requireAdmin();
  const { sprints, sprintId, value } = await resolveScope((await searchParams).sprint);
  const rows = await annotatorTable(sprintId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Annotators"
        sub="Create accounts, hand out passwords, and see how each person's work is going."
        actions={sprints.length > 0 ? <ScopePicker path="/admin/annotators" sprints={sprints} value={value} /> : undefined}
      />

      <ActionForm action={createAnnotatorAction} className={`${card} p-5`}>
        <h2 className="mb-3 font-medium">New annotator</h2>
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div>
            <label className={label} htmlFor="display_name">Name</label>
            <input id="display_name" name="display_name" required className={input} placeholder="Muttakin Morshed" />
          </div>
          <div>
            <label className={label} htmlFor="username">Username</label>
            <input id="username" name="username" required className={input} placeholder="muttakin" pattern="[A-Za-z0-9._\-]{3,32}" />
          </div>
          <SubmitButton pending="Creating…">Create account</SubmitButton>
        </div>
        <p className="mt-2 text-xs text-muted">The app generates the password and shows it to you once.</p>
      </ActionForm>

      <div className={`${card} overflow-x-auto`}>
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className={th}>Annotator</th>
              <th className={`${th} text-right`}>Written</th>
              <th className={`${th} text-right`}>Accepted</th>
              <th className={`${th} text-right`}>Flagged</th>
              <th className={`${th} text-right`}>Checks done</th>
              <th className={`${th} text-right`}>Blind match</th>
              <th className={`${th} text-right`}>Avg time</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td className={`${td} text-muted`} colSpan={7}>No annotators yet.</td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className={r.active ? "" : "opacity-50"}>
                <td className={td}>
                  <Link href={`/admin/annotators/${r.id}?sprint=${value}`} className="font-medium hover:underline">
                    {r.display_name}
                  </Link>
                  <span className="ml-2 text-xs text-muted">@{r.username}{!r.active && " · revoked"}</span>
                </td>
                <td className={`${td} text-right tabular-nums`}>{r.written}</td>
                <td className={`${td} text-right tabular-nums`}>{r.accepted}</td>
                <td className={`${td} text-right tabular-nums`}>{r.flagged}</td>
                <td className={`${td} text-right tabular-nums`}>{r.checks_done}/{r.checks_total}</td>
                <td className={`${td} text-right tabular-nums`} title="How often their blind answer matched the setter's">
                  {pct(r.blind_matches, r.blind_answers)}
                </td>
                <td className={`${td} text-right tabular-nums`}>{r.avg_seconds === null ? "—" : `${Math.round(r.avg_seconds)}s`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
