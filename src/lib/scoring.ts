import { FORMAT_BY_CODE, type AnswerFormat } from "./taxonomy";
import type { Question, Verdict } from "./types";

export function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

/** Questions written before the taxonomy fall back to their old answer type. */
function formatOf(question: Question): AnswerFormat {
  const stored = question.answer_format as AnswerFormat | null;
  if (stored && FORMAT_BY_CODE.has(stored)) return stored;
  return question.answer_type === "mcq" ? "MCQ" : "FT";
}

/** The set of things named in a multi-select answer, order-insensitive. */
function asSet(value: string): Set<string> {
  return new Set(
    value
      .split(/[,;\n]| and /i)
      .map((part) => normalize(part))
      .filter(Boolean),
  );
}

/** First number in a string, so "about 12 vehicles" scores as 12. */
function firstNumber(value: string): number | null {
  const match = value.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : null;
}

/**
 * Grades an answer where the format allows a reproducible check. Formats whose
 * scoring needs a rubric, a box, or an ordering comparison return null, so a
 * human grades them on the Compare page rather than the app guessing.
 *
 * `tolerance` lets a numeric answer count as correct within off-by-k.
 */
export function autoGrade(
  question: Question,
  answer: string | null,
  { tolerance = 0 }: { tolerance?: number } = {},
): Verdict | null {
  if (!answer || !question.reference_answer) return null;

  const format = formatOf(question);
  if (!FORMAT_BY_CODE.get(format)?.autoGradable) return null;

  const given = normalize(answer);
  const expected = normalize(question.reference_answer);

  switch (format) {
    case "BIN":
    case "MCQ":
    case "SA":
      return given === expected ? "correct" : "incorrect";

    case "NUM": {
      const a = firstNumber(answer);
      const b = firstNumber(question.reference_answer);
      if (a === null || b === null) return null;
      if (a === b) return "correct";
      return Math.abs(a - b) <= tolerance ? "correct" : "incorrect";
    }

    case "MSEL": {
      // Set overlap: everything right is correct, nothing right is incorrect,
      // and a partial overlap is exactly what "partial" is for.
      const got = asSet(answer);
      const want = asSet(question.reference_answer);
      if (want.size === 0) return null;
      const hits = [...want].filter((item) => got.has(item)).length;
      if (hits === want.size && got.size === want.size) return "correct";
      return hits === 0 ? "incorrect" : "partial";
    }

    default:
      return null;
  }
}
