import { notFound } from "next/navigation";
import { requireAnnotator } from "@/server/auth";
import { sql } from "@/server/db";
import { FLAG_LABEL, type FlagReason } from "@/server/engine";
import { editRestartsChecking, getQuestion, listMyImages, setterCanEdit } from "@/server/questions";
import { imageSrc } from "@/server/storage";
import { getTagGroups } from "@/server/taxonomy";
import { deleteQuestionAction, resubmitQuestionAction } from "../../actions/annotator";
import { Notice, PageHeader } from "../../ui/components";
import SubmitButton from "../../ui/SubmitButton";
import { buttonDanger, buttonSecondary } from "../../ui/styles";
import QuestionForm from "../../write/QuestionForm";

export default async function EditQuestionPage({ params }: PageProps<"/questions/[id]">) {
  const user = await requireAnnotator();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const question = await getQuestion(id);
  if (!question || question.author_id !== user.id) notFound();

  const [meta] = await sql<{ sprint_status: string; category_id: number; topic_subtype: number | null; label: string }[]>`
    select s.status as sprint_status, a.category_id, a.subtype_id as topic_subtype,
      coalesce(st.code || ' ' || st.name, c.code || '. ' || c.name || ' (whole type)') as label
    from questions q join sprints s on s.id = q.sprint_id join assignments a on a.id = q.assignment_id
    join categories c on c.id = a.category_id left join subtypes st on st.id = a.subtype_id
    where q.id = ${id}`;
  const toFix = question.status === "returned" || question.status === "dropped";
  const restarts = editRestartsChecking(question.status);
  const verifying = meta.sprint_status === "verifying";
  const flagReason = question.status === "flagged" ? FLAG_LABEL[question.resolution as FlagReason] : undefined;
  if (!setterCanEdit(question.status, meta.sprint_status)) {
    return (
      <>
        <PageHeader title="Question" />
        <Notice>This question has been accepted, so it can&apos;t be edited any more.</Notice>
      </>
    );
  }

  const subtypes = await sql<{ id: number; code: string; name: string; verifiability: string }[]>`
    select id, code, name, verifiability from subtypes
    where category_id = ${meta.category_id} and ${meta.topic_subtype ? sql`id = ${meta.topic_subtype}` : sql`(active or id = ${question.subtype_id})`}
    order by sort, code`;
  const images = (await listMyImages(user.id)).map((i) => ({ id: i.id, src: imageSrc(i, 900), tagIds: i.tag_ids }));
  const tagGroups = (await getTagGroups({ activeOnly: true })).map((g) => ({
    id: g.id,
    name: g.name,
    required: g.required,
    tags: g.tags.map((t) => ({ id: t.id, name: t.name })),
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title={toFix ? "Fix this question" : restarts ? "Edit and resubmit" : "Edit question"}
        sub={<span className="font-mono">{question.code}</span>}
      />
      {toFix && (
        <Notice tone="warn">
          <b>{question.status === "dropped" ? "The admin dropped this question:" : "The admin says:"}</b> {question.admin_note}
          <span className="mt-1 block">Fix it below and save, then send it back to the admin.</span>
        </Notice>
      )}
      {restarts && (
        <Notice tone="warn">
          {question.status === "flagged" ? (
            <>
              <b>Flagged{flagReason ? `: ${flagReason}` : question.resolution === "resubmitted" ? ": waiting for the admin" : ""}.</b>{" "}
            </>
          ) : (
            <b>Being checked. </b>
          )}
          {verifying
            ? "Saving a change resubmits it: the answers given so far are cleared and the same checkers answer it again."
            : "Verification has ended, so saving a change sends it to the admin for review."}
        </Notice>
      )}
      <QuestionForm
        mode="edit"
        resubmit={
          restarts
            ? verifying
              ? "Resubmit this question? The checkers' answers so far are cleared and they answer it again."
              : "Send the edited question to the admin for review?"
            : undefined
        }
        topics={[{ assignmentId: question.assignment_id, label: meta.label, written: 0, target: 0, subtypes }]}
        images={images}
        tagGroups={tagGroups}
        initial={{
          assignmentId: question.assignment_id,
          subtypeId: question.subtype_id,
          imageId: question.image.id,
          prompt: question.prompt,
          options: question.options.map((o) => o.text),
          correctIndex: question.options.findIndex((o) => o.id === question.correct_option),
          questionId: question.id,
        }}
      />
      <div className="flex flex-wrap gap-3 border-t border-line pt-4">
        {toFix && (
          <form action={resubmitQuestionAction.bind(null, question.id)}>
            <SubmitButton className={buttonSecondary} pending="Sending…">
              Send back to the admin
            </SubmitButton>
          </form>
        )}
        {question.status === "written" && (
          <form action={deleteQuestionAction.bind(null, question.id)}>
            <SubmitButton className={buttonDanger} pending="Deleting…" confirm="Delete this question?">
              Delete question
            </SubmitButton>
          </form>
        )}
      </div>
    </div>
  );
}
