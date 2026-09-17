import { getDb } from "./db";
import { autoGrade } from "./scoring";
import type { Question, Verdict } from "./types";

/**
 * Brings every automatic verdict on a question back in line with its current
 * answer key. Run after anything that changes how the question is scored — an
 * edited reference answer, format or option list, here or arriving from the
 * other copy — since those verdicts were derived from the old key.
 *
 * A verdict a person gave is theirs and is never touched. One adopted from the
 * other copy gives way to one computed here, as it does on import. An automatic
 * verdict the key can no longer support is removed rather than left standing on
 * a basis that is gone.
 *
 * Returns how many grades changed.
 */
export function regradeQuestion(questionId: number): number {
  const db = getDb();
  const question = db.prepare("SELECT * FROM questions WHERE id = ?").get(questionId) as
    | Question
    | undefined;
  if (!question) return 0;

  const targets = [
    ...(
      db
        .prepare("SELECT id, answer FROM human_responses WHERE question_id = ?")
        .all(questionId) as { id: number; answer: string }[]
    ).map((row) => ({ type: "human" as const, ...row })),
    ...(
      db
        .prepare("SELECT id, answer FROM llm_runs WHERE question_id = ? AND error IS NULL")
        .all(questionId) as { id: number; answer: string | null }[]
    ).map((row) => ({ type: "llm" as const, ...row })),
  ];

  const current = db.prepare(
    "SELECT verdict, grader FROM grades WHERE target_type = ? AND target_id = ?",
  );
  const put = db.prepare(
    `INSERT OR REPLACE INTO grades (target_type, target_id, verdict, grader)
     VALUES (?, ?, ?, 'auto')`,
  );
  const drop = db.prepare("DELETE FROM grades WHERE target_type = ? AND target_id = ?");

  let changed = 0;
  db.transaction(() => {
    for (const target of targets) {
      const grade = current.get(target.type, target.id) as
        | { verdict: Verdict; grader: string }
        | undefined;
      if (grade?.grader === "setter") continue;

      const verdict = autoGrade(question, target.answer);
      if (verdict) {
        if (grade?.grader === "auto" && grade.verdict === verdict) continue;
        put.run(target.type, target.id, verdict);
        changed += 1;
      } else if (grade?.grader === "auto") {
        drop.run(target.type, target.id);
        changed += 1;
      }
    }
  })();

  return changed;
}
