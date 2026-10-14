import Link from "next/link";
import { requireAdmin } from "@/server/auth";
import { listSprints } from "@/server/sprints";
import { createSprintAction } from "../../actions/admin";
import { PageHeader, StatusBadge } from "../../ui/components";
import SubmitButton from "../../ui/SubmitButton";
import { card, hint, input, label, td, th } from "../../ui/styles";
import ActionForm from "../ActionForm";

export default async function SprintsPage() {
  await requireAdmin();
  const sprints = await listSprints();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sprints"
        sub="A sprint runs set up → writing → verifying → closed. Only one sprint can be writing or verifying at a time."
      />

      <ActionForm action={createSprintAction} className={`${card} grid gap-3 p-5 sm:grid-cols-[1fr_10rem_auto] sm:items-end`}>
        <div>
          <label className={label} htmlFor="name">New sprint</label>
          <input id="name" name="name" required className={input} placeholder="Sprint 1 — pilot" />
        </div>
        <div>
          <label className={label} htmlFor="sample_pct">Model-check sample</label>
          <div className="flex items-center gap-1">
            <input id="sample_pct" name="sample_pct" type="number" min={1} max={100} defaultValue={10} className={input} />%
          </div>
        </div>
        <SubmitButton pending="Creating…">Create</SubmitButton>
        <p className={`${hint} sm:col-span-3`}>You&apos;ll assign topics and targets on the next page.</p>
      </ActionForm>

      <div className={`${card} overflow-x-auto`}>
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className={th}>Sprint</th>
              <th className={th}>Stage</th>
              <th className={`${th} text-right`}>Topics</th>
              <th className={`${th} text-right`}>Questions</th>
              <th className={th}>Created</th>
            </tr>
          </thead>
          <tbody>
            {sprints.length === 0 && <tr><td className={`${td} text-muted`} colSpan={5}>No sprints yet.</td></tr>}
            {sprints.map((s) => (
              <tr key={s.id}>
                <td className={td}><Link href={`/admin/sprints/${s.id}`} className="font-medium hover:underline">{s.name}</Link></td>
                <td className={td}><StatusBadge status={s.status} /></td>
                <td className={`${td} text-right`}>{s.assignments}</td>
                <td className={`${td} text-right`}>{s.questions}</td>
                <td className={`${td} text-muted`}>{s.created_at.toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
