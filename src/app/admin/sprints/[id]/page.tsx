import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/server/auth";
import { sql } from "@/server/db";
import { getSprint, sprintAssignments } from "@/server/sprints";
import { getTaxonomy } from "@/server/taxonomy";
import { listAnnotators } from "@/server/users";
import { addAssignmentAction, sprintOpAction, updateSprintAction } from "../../../actions/admin";
import { Notice, PageHeader, Progress, StatusBadge } from "../../../ui/components";
import SubmitButton from "../../../ui/SubmitButton";
import { button, buttonDanger, buttonSecondary, card, input, label, select, td, th } from "../../../ui/styles";
import ActionForm from "../../ActionForm";

export default async function SprintPage({ params }: PageProps<"/admin/sprints/[id]">) {
  await requireAdmin();
  const id = Number((await params).id);
  const sprint = Number.isInteger(id) ? await getSprint(id) : null;
  if (!sprint) notFound();

  const [assignments, annotators, taxonomy] = await Promise.all([
    sprintAssignments(id),
    listAnnotators({ activeOnly: true }),
    getTaxonomy({ activeOnly: true }),
  ]);
  const [counts] = await sql<{ written: number; checks_total: number; checks_done: number; sample: number }[]>`
    select
      (select count(*)::int from questions where sprint_id = ${id} and status = 'written') as written,
      (select count(*)::int from checks c join questions q on q.id = c.question_id where q.sprint_id = ${id}) as checks_total,
      (select count(*)::int from checks c join questions q on q.id = c.question_id where q.sprint_id = ${id}
        and c.blind_choice is not null and (c.judgment is not null or not (q.verifiability = 'I'
        or (q.verifiability = 'V' and c.blind_choice <> q.correct_option)))) as checks_done,
      (select count(*)::int from model_samples where sprint_id = ${id}) as sample`;
  const totalTarget = assignments.reduce((sum, a) => sum + a.target, 0);
  const totalWritten = assignments.reduce((sum, a) => sum + a.written, 0);
  const editableTopics = sprint.status === "setup" || sprint.status === "writing";
  const drawn = assignments.some((a) => a.checkers.length > 0);
  const op = (name: string) => <input type="hidden" name="op" value={name} />;
  const hidden = <input type="hidden" name="sprint_id" value={id} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title={sprint.name}
        sub={<><StatusBadge status={sprint.status} /> · model-check sample {sprint.model_sample_pct}%</>}
        actions={
          <>
            <Link href={`/admin/questions?sprint=${id}`} className={buttonSecondary}>Questions</Link>
            <Link href={`/admin?sprint=${id}`} className={buttonSecondary}>Statistics</Link>
          </>
        }
      />

      {/* What to do next, by stage */}
      <section className={`${card} space-y-3 p-5`}>
        {sprint.status === "setup" && (
          <>
            <h2 className="font-medium">1. Assign topics, then start writing</h2>
            <p className="text-sm text-muted">Annotators see nothing until writing starts.</p>
            <ActionForm action={sprintOpAction}>
              {hidden}{op("start_writing")}
              <SubmitButton className={button} pending="Starting…" confirm="Start writing? Annotators will see their topics.">Start writing</SubmitButton>
            </ActionForm>
          </>
        )}
        {sprint.status === "writing" && (
          <>
            <h2 className="font-medium">2. Writing — {totalWritten} of {totalTarget} questions</h2>
            <Progress value={totalWritten} max={totalTarget} />
            <p className="text-sm text-muted">
              When the targets are met, draw the checkers (you can swap them below), then start verification. Starting verification locks writing.
            </p>
            <div className="flex flex-wrap gap-2">
              <ActionForm action={sprintOpAction}>
                {hidden}{op("draw")}
                <SubmitButton className={buttonSecondary} pending="Drawing…">{drawn ? "Redraw checkers" : "Draw checkers"}</SubmitButton>
              </ActionForm>
              {drawn && (
                <ActionForm action={sprintOpAction}>
                  {hidden}{op("start_verification")}
                  <SubmitButton
                    className={button}
                    pending="Starting…"
                    confirm={`Start verification? Writing locks and ${counts.written} questions go to their checkers.${totalWritten < totalTarget ? " Targets aren't all met yet." : ""}`}
                  >
                    Start verification
                  </SubmitButton>
                </ActionForm>
              )}
            </div>
          </>
        )}
        {sprint.status === "verifying" && (
          <>
            <h2 className="font-medium">3. Verifying — {counts.checks_done} of {counts.checks_total} checks done</h2>
            <Progress value={counts.checks_done} max={counts.checks_total} />
            <div className="flex flex-wrap gap-2">
              <ActionForm action={sprintOpAction}>
                {hidden}{op("sample")}
                <SubmitButton className={buttonSecondary} pending="Drawing…">{counts.sample ? `Redraw model sample (${counts.sample})` : "Draw model-check sample"}</SubmitButton>
              </ActionForm>
              {counts.sample > 0 && <Link href={`/admin/models/check?sprint=${id}`} className={buttonSecondary}>Open model check</Link>}
              <ActionForm action={sprintOpAction}>
                {hidden}{op("close")}
                <SubmitButton className={buttonDanger} pending="Closing…" confirm="Close this sprint? Unfinished checks stay unfinished.">Close sprint</SubmitButton>
              </ActionForm>
            </div>
          </>
        )}
        {sprint.status === "closed" && (
          <>
            <h2 className="font-medium">Closed {sprint.closed_at?.toLocaleDateString()}</h2>
            <div className="flex flex-wrap gap-2">
              <ActionForm action={sprintOpAction}>
                {hidden}{op("sample")}
                <SubmitButton className={buttonSecondary} pending="Drawing…">{counts.sample ? `Redraw model sample (${counts.sample})` : "Draw model-check sample"}</SubmitButton>
              </ActionForm>
              <Link href={`/admin/export?sprint=${id}`} className={buttonSecondary}>Export</Link>
            </div>
          </>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-medium">Topics</h2>
        <div className={`${card} overflow-x-auto`}>
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className={th}>Annotator</th>
                <th className={th}>Topic</th>
                <th className={th}>Progress</th>
                <th className={`${th} text-right`}>Accepted</th>
                <th className={`${th} text-right`}>Flagged</th>
                <th className={th}>Checkers</th>
                <th className={th}></th>
              </tr>
            </thead>
            <tbody>
              {assignments.length === 0 && <tr><td className={`${td} text-muted`} colSpan={7}>No topics assigned yet.</td></tr>}
              {assignments.map((a) => (
                <tr key={a.id}>
                  <td className={td}>{a.annotator_name}</td>
                  <td className={td}>
                    {a.subtype_id ? (
                      <><span className="text-muted">{a.subtype_code}</span> {a.subtype_name}</>
                    ) : (
                      <><span className="text-muted">{a.category_code}.</span> {a.category_name} <span className="text-xs text-muted">(whole type)</span></>
                    )}
                  </td>
                  <td className={`${td} w-48`}>
                    <div className="flex items-center gap-2">
                      <Progress value={a.written} max={a.target} />
                      {editableTopics ? (
                        <ActionForm action={sprintOpAction} className="flex items-center gap-1">
                          {hidden}{op("target")}
                          <input type="hidden" name="assignment_id" value={a.id} />
                          <span className="text-xs tabular-nums">{a.written}/</span>
                          <input name="target" type="number" min={1} defaultValue={a.target} className="w-14 rounded border border-line bg-background px-1 text-xs" aria-label="Target" />
                          <SubmitButton className="text-xs text-accent" pending="…">Set</SubmitButton>
                        </ActionForm>
                      ) : (
                        <span className="text-xs tabular-nums">{a.written}/{a.target}</span>
                      )}
                    </div>
                  </td>
                  <td className={`${td} text-right`}>{a.accepted}</td>
                  <td className={`${td} text-right`}>{a.flagged}</td>
                  <td className={td}>
                    {sprint.status === "writing" && a.checkers.length > 0 ? (
                      <div className="space-y-1">
                        {[1, 2].map((slot) => (
                          <ActionForm key={slot} action={sprintOpAction} className="flex items-center gap-1">
                            {hidden}{op("set_checker")}
                            <input type="hidden" name="assignment_id" value={a.id} />
                            <input type="hidden" name="slot" value={slot} />
                            <select name="checker_id" defaultValue={a.checkers.find((c) => c.slot === slot)?.id} className="rounded border border-line bg-background px-1 py-0.5 text-xs">
                              {annotators.filter((p) => p.id !== a.annotator_id).map((p) => (
                                <option key={p.id} value={p.id}>{p.display_name}</option>
                              ))}
                            </select>
                            <SubmitButton className="text-xs text-accent" pending="…">Swap</SubmitButton>
                          </ActionForm>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs">{a.checkers.map((c) => c.name).join(", ") || <span className="text-muted">—</span>}</span>
                    )}
                  </td>
                  <td className={td}>
                    {editableTopics && a.written === 0 && (
                      <ActionForm action={sprintOpAction}>
                        {hidden}{op("remove")}
                        <input type="hidden" name="assignment_id" value={a.id} />
                        <SubmitButton className="text-xs text-red-600" pending="…">Remove</SubmitButton>
                      </ActionForm>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {editableTopics && (
          annotators.length === 0 ? (
            <Notice>Create annotator accounts first, on the <Link href="/admin/annotators" className="underline">Annotators</Link> page.</Notice>
          ) : (
            <ActionForm action={addAssignmentAction} className={`${card} grid gap-3 p-5 sm:grid-cols-[1fr_2fr_7rem_auto] sm:items-end`}>
              {hidden}
              <div>
                <label className={label} htmlFor="annotator_id">Annotator</label>
                <select id="annotator_id" name="annotator_id" className={select} required>
                  {annotators.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
                </select>
              </div>
              <div>
                <label className={label} htmlFor="topic">Topic</label>
                <select id="topic" name="topic" className={select} required>
                  {taxonomy.map((c) => (
                    <optgroup key={c.id} label={`${c.code}. ${c.name}`}>
                      <option value={`c:${c.id}`}>Whole type {c.code} ({c.subtypes.length} subtypes)</option>
                      {c.subtypes.map((s) => <option key={s.id} value={`s:${s.id}`}>{s.code} {s.name}</option>)}
                    </optgroup>
                  ))}
                </select>
              </div>
              <div>
                <label className={label} htmlFor="target">Target</label>
                <input id="target" name="target" type="number" min={1} defaultValue={20} className={input} required />
              </div>
              <SubmitButton pending="Adding…">Assign</SubmitButton>
            </ActionForm>
          )
        )}
      </section>

      <details className={card}>
        <summary className="cursor-pointer p-4 text-sm font-medium">Sprint settings</summary>
        <ActionForm action={updateSprintAction} className="grid gap-3 border-t border-line p-4 sm:grid-cols-[1fr_10rem_auto] sm:items-end">
          {hidden}
          <div>
            <label className={label}>Name</label>
            <input name="name" defaultValue={sprint.name} className={input} />
          </div>
          <div>
            <label className={label}>Model-check sample %</label>
            <input name="sample_pct" type="number" min={1} max={100} defaultValue={sprint.model_sample_pct} className={input} />
          </div>
          <SubmitButton>Save</SubmitButton>
        </ActionForm>
      </details>
    </div>
  );
}
