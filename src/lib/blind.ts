import { getDb } from "./db";
import type { Question } from "./types";

/**
 * Whether this copy still has to answer a question before it may see its
 * answer key. You can still be a naive subject for a question you didn't
 * write, so its key stays hidden until you've had your go; questions written
 * here are exempt, since you already know the answer.
 *
 * Every view that exposes the key — Compare, and the edit form — asks this, so
 * the rule lives in one place.
 */
export function answerKeyHiddenHere(question: Pick<Question, "id" | "imported">): boolean {
  if (!question.imported) return false;
  const answered = getDb()
    .prepare("SELECT 1 FROM human_responses WHERE question_id = ? AND imported = 0 LIMIT 1")
    .get(question.id);
  return !answered;
}
