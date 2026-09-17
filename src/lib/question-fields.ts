import { FORMAT_BY_CODE, TYPE_BY_CODE, type AnswerFormat } from "./taxonomy";

/** What a setter can write about a question, validated and ready to store. */
export interface QuestionFields {
  prompt: string;
  typeCode: string;
  verifiability: string;
  modality: string;
  /** JSON array of probe codes. */
  probes: string;
  format: AnswerFormat;
  /** JSON array of options, or null for formats without a fixed list. */
  options: string | null;
  reference: string | null;
  notes: string | null;
  /** The pre-taxonomy columns, kept in step so older views keep working. */
  category: string;
  answerType: "mcq" | "free";
}

export interface RawQuestionFields {
  prompt?: unknown;
  type_code?: unknown;
  verifiability?: unknown;
  modality?: unknown;
  answer_format?: unknown;
  /** A JSON string from a form, or an array from a JSON body. */
  probes?: unknown;
  /** One option per line from a form, or an array from a JSON body. */
  options?: unknown;
  reference_answer?: unknown;
  notes?: unknown;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function legacyCategory(dimension: number): string {
  if (dimension === 3) return "spatial";
  if (dimension === 4) return "behavioral";
  return "logical";
}

/**
 * The single set of rules for a question's content, shared by creating and
 * editing so an edit can never store something creation would have refused.
 */
export function parseQuestionFields(
  raw: RawQuestionFields,
): { ok: true; fields: QuestionFields } | { ok: false; error: string } {
  const prompt = text(raw.prompt);
  if (!prompt) return { ok: false, error: "A question is required" };

  const type = TYPE_BY_CODE.get(text(raw.type_code));
  if (!type) return { ok: false, error: "Pick a fine-grained type" };

  const format = (text(raw.answer_format) || type.format) as AnswerFormat;
  const spec = FORMAT_BY_CODE.get(format);
  if (!spec) return { ok: false, error: "Unknown answer format" };

  let probes: string[] = [...type.probes];
  const probesValue = typeof raw.probes === "string" ? safeParse(raw.probes) : raw.probes;
  if (Array.isArray(probesValue)) {
    probes = probesValue.filter((p): p is string => typeof p === "string");
  }

  let options: string | null = null;
  if (spec.hasOptions) {
    const list = (
      Array.isArray(raw.options) ? raw.options : text(raw.options).split("\n")
    )
      .map((o) => (typeof o === "string" ? o.trim() : ""))
      .filter(Boolean);
    if (list.length < 2) return { ok: false, error: "Give at least two options" };
    options = JSON.stringify(list);
  }

  return {
    ok: true,
    fields: {
      prompt,
      typeCode: type.code,
      verifiability: text(raw.verifiability) || type.verifiability,
      modality: text(raw.modality) || type.modality,
      probes: JSON.stringify(probes),
      format,
      options,
      reference: text(raw.reference_answer) || null,
      notes: text(raw.notes) || null,
      category: legacyCategory(type.dimension),
      answerType: spec.hasOptions ? "mcq" : "free",
    },
  };
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}
