import { getDb } from "./db";
import {
  DIMENSIONS,
  LEGACY_CATEGORY_DIMENSION,
  TYPES,
  TYPE_BY_CODE,
  type AnswerFormat,
  type Modality,
  type Verifiability,
} from "./taxonomy";
import type { Verdict } from "./types";

export interface Tally {
  correct: number;
  partial: number;
  incorrect: number;
  graded: number;
  /** Answers recorded but not yet graded. */
  ungraded: number;
}

export interface Scored extends Tally {
  /** Partial counts as half. Null when nothing is graded. */
  accuracy: number | null;
}

function blank(): Tally {
  return { correct: 0, partial: 0, incorrect: 0, graded: 0, ungraded: 0 };
}

function add(tally: Tally, verdict: Verdict | null): void {
  if (!verdict) {
    tally.ungraded += 1;
    return;
  }
  tally[verdict] += 1;
  tally.graded += 1;
}

function scored(t: Tally): Scored {
  return {
    ...t,
    accuracy: t.graded === 0 ? null : (t.correct + t.partial * 0.5) / t.graded,
  };
}

/** One answerer — a model, or the human baseline — sliced several ways. */
export interface Performer {
  key: string;
  label: string;
  isHuman: boolean;
  overall: Scored;
  byDimension: Record<number, Scored>;
  byVerifiability: Record<string, Scored>;
  byFormat: Record<string, Scored>;
  byType: Record<string, Scored>;
}

export interface TypeCoverage {
  code: string;
  name: string;
  dimension: number;
  regional: boolean;
  questions: number;
  /** The human baseline on this type. Zeroed when nobody has answered it. */
  human: Scored;
  /** Every model pooled together, so the gap has one number to compare against. */
  models: Scored;
  /** Human minus model. High means the question is doing work. */
  gap: number | null;
}

/** A dimension summarised over the fine-grained types inside it. */
export interface DimensionCoverage {
  id: number;
  name: string;
  questions: number;
  /** Types in this dimension that have at least one question, and how many exist. */
  typesCovered: number;
  typesTotal: number;
  human: Scored;
  models: Scored;
  gap: number | null;
}

export interface Inventory {
  questions: number;
  classified: number;
  byDimension: Record<number, number>;
  /** Questions per fine-grained type code — the finer cut of byDimension. */
  byType: Record<string, number>;
  byVerifiability: Record<string, number>;
  byModality: Record<string, number>;
  byFormat: Record<string, number>;
  regional: number;
  withReference: number;
  typesCovered: number;
  typesTotal: number;
}

/** Why an individual question is, or isn't, earning its place. */
export type Flag = "discriminative" | "too-easy" | "ambiguous" | "hard-for-humans";

export interface QuestionStat {
  id: number;
  prompt: string;
  type_code: string | null;
  humanCount: number;
  modelCount: number;
  humanAccuracy: number | null;
  modelAccuracy: number | null;
  gap: number | null;
  flag: Flag | null;
}

export interface DetailedStats {
  inventory: Inventory;
  performers: Performer[];
  coverage: TypeCoverage[];
  dimensionCoverage: DimensionCoverage[];
  questions: QuestionStat[];
  emptyTypes: { code: string; name: string; dimension: number }[];
  totals: {
    humanAnswers: number;
    modelAnswers: number;
    ungradedModel: number;
    ungradedHuman: number;
    discriminative: number;
  };
}

interface Row {
  question_id: number;
  type_code: string | null;
  category: string;
  verifiability: string | null;
  modality: string | null;
  answer_format: string | null;
  answer_type: string;
  verdict: Verdict | null;
  who: string;
  label: string;
}

/** Everything needed by the statistics page, in one pass over the answers. */
export function computeDetailedStats(): DetailedStats {
  const db = getDb();

  const questions = db
    .prepare(
      `SELECT id, prompt, type_code, category, verifiability, modality, answer_format,
              answer_type, reference_answer
       FROM questions`,
    )
    .all() as {
    id: number;
    prompt: string;
    type_code: string | null;
    category: string;
    verifiability: string | null;
    modality: string | null;
    answer_format: string | null;
    answer_type: string;
    reference_answer: string | null;
  }[];

  // Questions written before the taxonomy still land in a dimension via their
  // old category, so they aren't invisible here.
  const dimensionOfQuestion = (q: { type_code: string | null; category: string }) =>
    (q.type_code ? TYPE_BY_CODE.get(q.type_code)?.dimension : null) ??
    LEGACY_CATEGORY_DIMENSION[q.category] ??
    0;

  const inventory: Inventory = {
    questions: questions.length,
    classified: 0,
    byDimension: {},
    byType: {},
    byVerifiability: {},
    byModality: {},
    byFormat: {},
    regional: 0,
    withReference: 0,
    typesCovered: 0,
    typesTotal: TYPES.length,
  };

  const questionsPerType = new Map<string, number>();

  for (const q of questions) {
    const type = q.type_code ? TYPE_BY_CODE.get(q.type_code) : null;
    if (type) {
      inventory.classified += 1;
      questionsPerType.set(type.code, (questionsPerType.get(type.code) ?? 0) + 1);
      if (type.regional) inventory.regional += 1;
    }
    if (q.reference_answer) inventory.withReference += 1;

    const dim = dimensionOfQuestion(q);
    inventory.byDimension[dim] = (inventory.byDimension[dim] ?? 0) + 1;

    const verifiability = (q.verifiability ?? type?.verifiability) as Verifiability | undefined;
    if (verifiability) {
      inventory.byVerifiability[verifiability] =
        (inventory.byVerifiability[verifiability] ?? 0) + 1;
    }
    const modality = (q.modality ?? type?.modality) as Modality | undefined;
    if (modality) inventory.byModality[modality] = (inventory.byModality[modality] ?? 0) + 1;

    const format = (q.answer_format ??
      type?.format ??
      (q.answer_type === "mcq" ? "MCQ" : "FT")) as AnswerFormat;
    inventory.byFormat[format] = (inventory.byFormat[format] ?? 0) + 1;
  }
  inventory.typesCovered = questionsPerType.size;
  inventory.byType = Object.fromEntries(questionsPerType);

  const modelRows = db
    .prepare(
      `SELECT r.question_id, q.type_code, q.category, q.verifiability, q.modality,
              q.answer_format, q.answer_type, g.verdict,
              r.model_key AS who, COALESCE(m.label, r.model_key) AS label
       FROM llm_runs r
       JOIN questions q ON q.id = r.question_id
       LEFT JOIN models m ON m.key = r.model_key
       LEFT JOIN grades g ON g.target_type = 'llm' AND g.target_id = r.id
       WHERE r.error IS NULL`,
    )
    .all() as Row[];

  const humanRows = db
    .prepare(
      `SELECT h.question_id, q.type_code, q.category, q.verifiability, q.modality,
              q.answer_format, q.answer_type, g.verdict,
              '__human' AS who, 'Human grounding' AS label
       FROM human_responses h
       JOIN questions q ON q.id = h.question_id
       LEFT JOIN grades g ON g.target_type = 'human' AND g.target_id = h.id`,
    )
    .all() as Row[];

  // Two grounders giving different answers is what "ambiguous" means, so the
  // raw answer text is needed alongside the verdicts.
  const humanAnswersById = new Map<number, string[]>();
  for (const row of db
    .prepare("SELECT question_id, answer FROM human_responses")
    .all() as { question_id: number; answer: string }[]) {
    const list = humanAnswersById.get(row.question_id) ?? [];
    list.push(row.answer);
    humanAnswersById.set(row.question_id, list);
  }

  const performers = new Map<
    string,
    {
      label: string;
      isHuman: boolean;
      overall: Tally;
      byDimension: Map<number, Tally>;
      byVerifiability: Map<string, Tally>;
      byFormat: Map<string, Tally>;
      byType: Map<string, Tally>;
    }
  >();

  const bucket = <K>(map: Map<K, Tally>, key: K): Tally => {
    if (!map.has(key)) map.set(key, blank());
    return map.get(key)!;
  };

  for (const row of [...humanRows, ...modelRows]) {
    if (!performers.has(row.who)) {
      performers.set(row.who, {
        label: row.label,
        isHuman: row.who === "__human",
        overall: blank(),
        byDimension: new Map(),
        byVerifiability: new Map(),
        byFormat: new Map(),
        byType: new Map(),
      });
    }
    const entry = performers.get(row.who)!;
    const type = row.type_code ? TYPE_BY_CODE.get(row.type_code) : null;

    add(entry.overall, row.verdict);
    add(bucket(entry.byDimension, dimensionOfQuestion(row)), row.verdict);

    const verifiability = row.verifiability ?? type?.verifiability;
    if (verifiability) add(bucket(entry.byVerifiability, verifiability), row.verdict);

    const format =
      row.answer_format ?? type?.format ?? (row.answer_type === "mcq" ? "MCQ" : "FT");
    add(bucket(entry.byFormat, format), row.verdict);

    if (type) add(bucket(entry.byType, type.code), row.verdict);
  }

  const asRecord = <K extends string | number>(map: Map<K, Tally>) =>
    Object.fromEntries([...map.entries()].map(([k, v]) => [k, scored(v)])) as Record<K, Scored>;

  const performerList: Performer[] = [...performers.entries()]
    .map(([key, v]) => ({
      key,
      label: v.label,
      isHuman: v.isHuman,
      overall: scored(v.overall),
      byDimension: asRecord(v.byDimension),
      byVerifiability: asRecord(v.byVerifiability),
      byFormat: asRecord(v.byFormat),
      byType: asRecord(v.byType),
    }))
    // Human first, then models by accuracy.
    .sort((a, b) => {
      if (a.isHuman !== b.isHuman) return a.isHuman ? -1 : 1;
      return (b.overall.accuracy ?? -1) - (a.overall.accuracy ?? -1);
    });

  const human = performerList.find((p) => p.isHuman);
  const models = performerList.filter((p) => !p.isHuman);

  const accumulate = (into: Tally, from: Tally | undefined): Tally => {
    if (!from) return into;
    into.correct += from.correct;
    into.partial += from.partial;
    into.incorrect += from.incorrect;
    into.graded += from.graded;
    into.ungraded += from.ungraded;
    return into;
  };

  const gapBetween = (h: Scored, m: Scored) =>
    h.accuracy != null && m.accuracy != null ? h.accuracy - m.accuracy : null;

  const coverage: TypeCoverage[] = TYPES.filter((t) => questionsPerType.has(t.code)).map((t) => {
    const humanScore = scored(accumulate(blank(), human?.byType[t.code]));
    const modelScore = scored(models.reduce((acc, m) => accumulate(acc, m.byType[t.code]), blank()));
    return {
      code: t.code,
      name: t.name,
      dimension: t.dimension,
      regional: Boolean(t.regional),
      questions: questionsPerType.get(t.code) ?? 0,
      human: humanScore,
      models: modelScore,
      gap: gapBetween(humanScore, modelScore),
    };
  });

  // The same rollup one level up, so a dimension row can head its types.
  const dimensionCoverage: DimensionCoverage[] = DIMENSIONS.map((d) => {
    const humanScore = scored(accumulate(blank(), human?.byDimension[d.id]));
    const modelScore = scored(
      models.reduce((acc, m) => accumulate(acc, m.byDimension[d.id]), blank()),
    );
    const types = TYPES.filter((t) => t.dimension === d.id);
    return {
      id: d.id,
      name: d.name,
      questions: inventory.byDimension[d.id] ?? 0,
      typesCovered: types.filter((t) => questionsPerType.has(t.code)).length,
      typesTotal: types.length,
      human: humanScore,
      models: modelScore,
      gap: gapBetween(humanScore, modelScore),
    };
  });

  // Per-question signal: the aggregates say which *type* is working, this says
  // which individual question to rewrite.
  const perQuestion: QuestionStat[] = questions
    .map((q): QuestionStat => {
      const qHumans = humanRows.filter((r) => r.question_id === q.id);
      const qModels = modelRows.filter((r) => r.question_id === q.id);
      const gradedHumans = qHumans.filter((r) => r.verdict);
      const gradedModels = qModels.filter((r) => r.verdict);

      const humanAccuracy = gradedHumans.length
        ? gradedHumans.filter((r) => r.verdict === "correct").length / gradedHumans.length
        : null;
      const modelAccuracy = gradedModels.length
        ? gradedModels.filter((r) => r.verdict === "correct").length / gradedModels.length
        : null;

      const distinctHumanAnswers = new Set(
        humanAnswersById.get(q.id)?.map((a) => a.toLowerCase().trim()) ?? [],
      ).size;

      let flag: Flag | null = null;
      if (qHumans.length > 1 && distinctHumanAnswers > 1) flag = "ambiguous";
      else if (modelAccuracy === 1 && gradedModels.length > 1) flag = "too-easy";
      else if (humanAccuracy === 1 && modelAccuracy === 0 && gradedModels.length > 0)
        flag = "discriminative";
      else if (humanAccuracy === 0 && gradedHumans.length > 0) flag = "hard-for-humans";

      return {
        id: q.id,
        prompt: q.prompt,
        type_code: q.type_code,
        humanCount: qHumans.length,
        modelCount: qModels.length,
        humanAccuracy,
        modelAccuracy,
        gap: humanAccuracy != null && modelAccuracy != null ? humanAccuracy - modelAccuracy : null,
        flag,
      };
    })
    .sort((a, b) => (b.gap ?? -2) - (a.gap ?? -2));

  return {
    inventory,
    performers: performerList,
    coverage,
    dimensionCoverage,
    questions: perQuestion,
    emptyTypes: TYPES.filter((t) => !questionsPerType.has(t.code)).map((t) => ({
      code: t.code,
      name: t.name,
      dimension: t.dimension,
    })),
    totals: {
      humanAnswers: humanRows.length,
      modelAnswers: modelRows.length,
      ungradedModel: modelRows.filter((r) => !r.verdict).length,
      ungradedHuman: humanRows.filter((r) => !r.verdict).length,
      discriminative: coverage.filter((c) => (c.gap ?? 0) >= 0.5).length,
    },
  };
}

export { DIMENSIONS };
