import { notFound } from "next/navigation";
import { requireAnnotator } from "@/server/auth";
import { sql } from "@/server/db";
import { getQuestion, listMyImages } from "@/server/questions";
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
  const editable = (question.status === "written" && meta.sprint_status === "writing") || question.status === "returned";
  if (!editable) {
    return (
      <>
        <PageHeader title="Question" />
        <Notice>This question has gone for checking, so it can&apos;t be edited any more.</Notice>
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
      <PageHeader title={question.status === "returned" ? "Fix this question" : "Edit question"} />
      {question.status === "returned" && question.admin_note && (
        <Notice tone="warn">
          <b>The admin says:</b> {question.admin_note}
        </Notice>
      )}
      <QuestionForm
        mode="edit"
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
        {question.status === "returned" && (
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
