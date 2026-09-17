import { notFound, redirect } from "next/navigation";
import { answerKeyHiddenHere } from "@/lib/blind";
import { getDb } from "@/lib/db";
import { requireBenchmarkerPage } from "@/lib/session";
import {
  LEGACY_CATEGORY_DIMENSION,
  TYPE_BY_CODE,
  type AnswerFormat,
  type Modality,
  type Probe,
  type Verifiability,
} from "@/lib/taxonomy";
import type { Question } from "@/lib/types";
import EditForm from "./EditForm";

export const dynamic = "force-dynamic";

export default async function EditPage({ params }: PageProps<"/edit/[id]">) {
  await requireBenchmarkerPage();

  const { id } = await params;
  const db = getDb();
  const question = db.prepare("SELECT * FROM questions WHERE id = ?").get(id) as
    | Question
    | undefined;
  if (!question) notFound();

  // The form shows the answer key, so it waits for an answer just as Compare does.
  if (answerKeyHiddenHere(question)) redirect(`/ground/${question.id}?blind=1`);

  const count = (sql: string) => (db.prepare(sql).get(question.id) as { n: number }).n;
  const type = question.type_code ? TYPE_BY_CODE.get(question.type_code) : null;

  return (
    <EditForm
      question={{
        id: question.id,
        prompt: question.prompt,
        imagePath: question.image_path,
        options: question.options ? (JSON.parse(question.options) as string[]) : null,
        reference: question.reference_answer,
        notes: question.notes,
        type: type
          ? {
              typeCode: type.code,
              verifiability: (question.verifiability ?? type.verifiability) as Verifiability,
              modality: (question.modality ?? type.modality) as Modality,
              probes: question.probes ? (JSON.parse(question.probes) as Probe[]) : [...type.probes],
              format: (question.answer_format ?? type.format) as AnswerFormat,
            }
          : null,
        initialDimension: LEGACY_CATEGORY_DIMENSION[question.category],
        humanAnswers: count("SELECT COUNT(*) AS n FROM human_responses WHERE question_id = ?"),
        modelAnswers: count(
          "SELECT COUNT(*) AS n FROM llm_runs WHERE question_id = ? AND error IS NULL",
        ),
      }}
    />
  );
}
