/**
 * The checking rules, as pure functions so they can be tested without a database.
 *
 * Every checker answers blind first. What happens next depends on the question's
 * verifiability:
 *
 *   V  one checker. A match is accepted. A mismatch shows them the setter's answer
 *      and they say either "the setter made a mistake" (flagged) or "I misread it"
 *      (accepted, mismatch still recorded).
 *   C  two checkers, both blind throughout. All three must pick the same option.
 *   I  two checkers in turn. "Second" answers blind, sees the setter's answer and
 *      agrees or disagrees. "Third" answers blind, sees both earlier answers and
 *      says whether all three agree. Accepted only if both say yes.
 */

export type Verifiability = "V" | "C" | "I";
export type CheckRole = "v" | "c" | "second" | "third";
export type Judgment = "setter_mistake" | "misread" | "agree" | "disagree" | "all_agree" | "not_all_agree";

/** Blind choices that aren't an option id. */
export const NONE = "none";
export const CANT_TELL = "cant_tell";

export interface CheckFacts {
  role: CheckRole | null;
  blind_choice: string | null;
  judgment: Judgment | null;
}

export interface QuestionFacts {
  verifiability: Verifiability;
  correct_option: string;
}

export type FlagReason = "setter_mistake" | "disagreed" | "second_disagreed" | "third_disagreed";

export type Outcome =
  | { state: "pending" }
  | { state: "accepted"; resolution: "agreed" | "misread" }
  | { state: "flagged"; reason: FlagReason };

/** How many checkers a question of this verifiability gets. */
export function checkersNeeded(v: Verifiability): 1 | 2 {
  return v === "V" ? 1 : 2;
}

/** The judgments a checker may give at the second step, by their role. */
export function allowedJudgments(role: CheckRole): Judgment[] {
  switch (role) {
    case "v":
      return ["setter_mistake", "misread"];
    case "second":
      return ["agree", "disagree"];
    case "third":
      return ["all_agree", "not_all_agree"];
    case "c":
      return [];
  }
}

/** Whether this check, once its blind answer is in, still has a second step. */
export function needsJudgment(question: QuestionFacts, check: CheckFacts): boolean {
  if (check.blind_choice === null) return false;
  switch (question.verifiability) {
    case "V":
      return check.blind_choice !== question.correct_option;
    case "C":
      return false;
    case "I":
      return true;
  }
}

/** Whether a checker has nothing left to do on this check. */
export function checkComplete(question: QuestionFacts, check: CheckFacts): boolean {
  if (check.blind_choice === null) return false;
  return !needsJudgment(question, check) || check.judgment !== null;
}

export function decide(question: QuestionFacts, checks: CheckFacts[]): Outcome {
  switch (question.verifiability) {
    case "V": {
      const check = checks[0];
      if (!check || !checkComplete(question, check)) return { state: "pending" };
      if (check.blind_choice === question.correct_option) return { state: "accepted", resolution: "agreed" };
      return check.judgment === "misread"
        ? { state: "accepted", resolution: "misread" }
        : { state: "flagged", reason: "setter_mistake" };
    }
    case "C": {
      if (checks.length < 2 || checks.some((c) => c.blind_choice === null)) return { state: "pending" };
      return checks.every((c) => c.blind_choice === question.correct_option)
        ? { state: "accepted", resolution: "agreed" }
        : { state: "flagged", reason: "disagreed" };
    }
    case "I": {
      const second = checks.find((c) => c.role === "second");
      const third = checks.find((c) => c.role === "third");
      if (!second?.judgment || !third?.judgment) return { state: "pending" };
      if (second.judgment !== "agree") return { state: "flagged", reason: "second_disagreed" };
      if (third.judgment !== "all_agree") return { state: "flagged", reason: "third_disagreed" };
      return { state: "accepted", resolution: "agreed" };
    }
  }
}

/** A uniformly random ordering, so option position gives nothing away. */
export function shuffled<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export const FLAG_LABEL: Record<FlagReason, string> = {
  setter_mistake: "Checker says the setter made a mistake",
  disagreed: "Blind answers disagree",
  second_disagreed: "Second checker disagreed with the setter",
  third_disagreed: "Third checker says not all three agree",
};
