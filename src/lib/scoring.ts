import type { Question, Verdict } from "./types";

export function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * MCQ answers can be auto-graded against the reference. Free-text cannot —
 * it returns null so the setter grades it by hand on the reveal page.
 */
export function autoGrade(question: Question, answer: string | null): Verdict | null {
  if (!answer || !question.reference_answer) return null;
  if (question.answer_type !== "mcq") return null;
  return normalize(answer) === normalize(question.reference_answer) ? "correct" : "incorrect";
}
