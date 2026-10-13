import Link from "next/link";
import { requireAdmin } from "@/server/auth";
import { sql } from "@/server/db";
import { apiAvailable, listModels } from "@/server/models";
import { runModelBatchAction } from "../../../actions/admin";
import { Notice, PageHeader, pct, StatusBadge } from "../../../ui/components";
import SubmitButton from "../../../ui/SubmitButton";
import { buttonSecondary, card, td, th } from "../../../ui/styles";
import ActionForm from "../../ActionForm";
import { resolveScope, ScopePicker } from "../../scope";

interface SampleRow {
  id: string;
  prompt: string;
  status: string;
  subtype: string;
  correct_option: string;
  answers: Record<string, string | null> | null;
}

export default async function ModelCheckPage({ searchParams }: PageProps<"/admin/models/check">) {
  await requireAdmin();
  const { sprints, sprintId, value } = await resolveScope((await searchParams).sprint);
  const models = await listModels({ activeOnly: true });

  if (!sprintId) {
    return (
      <>
        <PageHeader title="Model check" actions={<ScopePicker path="/admin/models/check" sprints={sprints} value={value} />} />
        <Notice>Pick a sprint.</Notice>
      </>
    );
  }

  // Each sample question with the latest answer per model (null = an error was recorded).
  const rows = await sql<SampleRow[]>`
    select q.id, q.prompt, q.status, st.code as subtype, q.correct_option,
      (select jsonb_object_agg(a.model_id::text, a.chosen_option) from (
        select distinct on (model_id) model_id, chosen_option from model_answers
        where question_id = q.id order by model_id, created_at desc) a) as answers
    from model_samples ms join questions q on q.id = ms.question_id join subtypes st on st.id = q.subtype_id
    where ms.sprint_id = ${sprintId}
    order by st.sort, st.code, q.created_at`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Model check"
        sub={`${rows.length} questions in this sprint's sample. The models see the options in a fresh random order every time.`}
        actions={<ScopePicker path="/admin/models/check" sprints={sprints} value={value} />}
      />
      {rows.length === 0 && (
        <Notice>No sample drawn for this sprint yet. Draw it from the <Link href={`/admin/sprints/${sprintId}`} className="underline">sprint page</Link> once verification has started.</Notice>
      )}
      {models.length === 0 && <Notice>Add models on the <Link href="/admin/models" className="underline">Models</Link> page.</Notice>}

      {rows.length > 0 && models.length > 0 && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {models.map((m) => {
              const answered = rows.filter((r) => r.answers?.[m.id] !== undefined);
              const correct = answered.filter((r) => r.answers?.[m.id] === r.correct_option).length;
              const missing = rows.filter((r) => r.answers?.[m.id] === undefined || r.answers?.[m.id] === null).map((r) => r.id);
              return (
                <div key={m.id} className={`${card} space-y-2 p-4`}>
                  <div className="font-medium">{m.name}</div>
                  <div className="text-sm">
                    Matches the setter on <b>{pct(correct, answered.length)}</b> <span className="text-muted">({correct}/{answered.length} answered)</span>
                  </div>
                  {apiAvailable(m.provider) && missing.length > 0 && (
                    <ActionForm action={runModelBatchAction}>
                      <input type="hidden" name="model_id" value={m.id} />
                      <input type="hidden" name="question_ids" value={missing.join(",")} />
                      <SubmitButton className={buttonSecondary} pending="Asking… (up to 10 at a time)">
                        Ask the next {Math.min(10, missing.length)} of {missing.length} by API
                      </SubmitButton>
                    </ActionForm>
                  )}
                </div>
              );
            })}
          </div>

          <div className={`${card} overflow-x-auto`}>
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={th}>Question</th>
                  <th className={th}>Status</th>
                  {models.map((m) => <th key={m.id} className={`${th} text-center`}>{m.name}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className={`${td} max-w-md`}>
                      <Link href={`/admin/questions/${r.id}`} className="hover:underline">
                        <span className="text-muted">{r.subtype}</span> {r.prompt}
                      </Link>
                    </td>
                    <td className={td}><StatusBadge status={r.status} /></td>
                    {models.map((m) => {
                      const answer = r.answers?.[m.id];
                      return (
                        <td key={m.id} className={`${td} text-center`}>
                          {answer === undefined ? <span className="text-muted">·</span> : answer === null ? <span className="text-amber-600" title="Error — see the question">!</span> : answer === r.correct_option ? <span className="text-emerald-600">✓</span> : <span className="text-red-600">✗</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
