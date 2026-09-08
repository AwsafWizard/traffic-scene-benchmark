import { getDb } from "./db";
import { normalize } from "./scoring";
import type { Category, Verdict } from "./types";

interface Tally {
  correct: number;
  partial: number;
  incorrect: number;
  graded: number;
  attempted: number;
  errors: number;
  latency: number[];
}

export interface Scored extends Omit<Tally, "latency"> {
  accuracy: number | null;
  latency_p50: number | null;
  by_category: Partial<Record<Category, Scored>>;
}

export interface QuestionStat {
  id: number;
  prompt: string;
  category: Category;
  human_count: number;
  run_count: number;
  human_accuracy: number | null;
  model_accuracy: number | null;
  gap: number | null;
  flag: Flag | null;
}

export type Flag = "ambiguous" | "too-easy" | "discriminative" | "hard-for-humans";

export interface Stats {
  models: (Scored & { key: string; label: string })[];
  human: Scored;
  questions: QuestionStat[];
}

function blank(): Tally {
  return { correct: 0, partial: 0, incorrect: 0, graded: 0, attempted: 0, errors: 0, latency: [] };
}

function add(t: Tally, verdict: Verdict | null) {
  t.attempted += 1;
  if (!verdict) return;
  t.graded += 1;
  t[verdict] += 1;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function score(t: Tally, byCategory?: Map<Category, Tally>): Scored {
  const { latency, ...rest } = t;
  return {
    ...rest,
    latency_p50: median(latency),
    // A partial answer counts as half credit.
    accuracy: t.graded ? (t.correct + t.partial * 0.5) / t.graded : null,
    by_category: byCategory
      ? Object.fromEntries([...byCategory.entries()].map(([c, v]) => [c, score(v)]))
      : {},
  };
}

export function computeStats(): Stats {
  const db = getDb();

  const runs = db
    .prepare(
      `SELECT r.id, r.question_id, r.model_key, r.latency_ms, r.error,
              q.category, m.label AS model_label, g.verdict
       FROM llm_runs r
       JOIN questions q ON q.id = r.question_id
       LEFT JOIN models m ON m.key = r.model_key
       LEFT JOIN grades g ON g.target_type = 'llm' AND g.target_id = r.id`,
    )
    .all() as {
    id: number;
    question_id: number;
    model_key: string;
    model_label: string | null;
    latency_ms: number | null;
    error: string | null;
    category: Category;
    verdict: Verdict | null;
  }[];

  const humans = db
    .prepare(
      `SELECT h.id, h.question_id, h.answer, q.category, g.verdict
       FROM human_responses h
       JOIN questions q ON q.id = h.question_id
       LEFT JOIN grades g ON g.target_type = 'human' AND g.target_id = h.id`,
    )
    .all() as {
    id: number;
    question_id: number;
    answer: string;
    category: Category;
    verdict: Verdict | null;
  }[];

  const byModel = new Map<
    string,
    { label: string; overall: Tally; byCategory: Map<Category, Tally> }
  >();
  for (const run of runs) {
    if (!byModel.has(run.model_key)) {
      byModel.set(run.model_key, {
        label: run.model_label ?? run.model_key,
        overall: blank(),
        byCategory: new Map(),
      });
    }
    const entry = byModel.get(run.model_key)!;
    if (!entry.byCategory.has(run.category)) entry.byCategory.set(run.category, blank());
    const cat = entry.byCategory.get(run.category)!;

    if (run.error) {
      entry.overall.errors += 1;
      cat.errors += 1;
      continue;
    }
    add(entry.overall, run.verdict);
    add(cat, run.verdict);
    if (run.latency_ms != null) entry.overall.latency.push(run.latency_ms);
  }

  const humanOverall = blank();
  const humanByCategory = new Map<Category, Tally>();
  for (const h of humans) {
    if (!humanByCategory.has(h.category)) humanByCategory.set(h.category, blank());
    add(humanOverall, h.verdict);
    add(humanByCategory.get(h.category)!, h.verdict);
  }

  const questions = db
    .prepare("SELECT id, prompt, category FROM questions ORDER BY id DESC")
    .all() as { id: number; prompt: string; category: Category }[];

  const perQuestion = questions.map((q): QuestionStat => {
    const qHumans = humans.filter((h) => h.question_id === q.id);
    const qRuns = runs.filter((r) => r.question_id === q.id && !r.error);
    const gradedHumans = qHumans.filter((h) => h.verdict);
    const gradedRuns = qRuns.filter((r) => r.verdict);

    const distinctHuman = new Set(qHumans.map((h) => normalize(h.answer))).size;
    const humanAcc = gradedHumans.length
      ? gradedHumans.filter((h) => h.verdict === "correct").length / gradedHumans.length
      : null;
    const modelAcc = gradedRuns.length
      ? gradedRuns.filter((r) => r.verdict === "correct").length / gradedRuns.length
      : null;

    let flag: Flag | null = null;
    if (qHumans.length > 1 && distinctHuman > 1) flag = "ambiguous";
    else if (modelAcc === 1 && gradedRuns.length > 1) flag = "too-easy";
    else if (humanAcc === 1 && modelAcc === 0 && gradedRuns.length > 0) flag = "discriminative";
    else if (humanAcc === 0 && gradedHumans.length > 0) flag = "hard-for-humans";

    return {
      ...q,
      human_count: qHumans.length,
      run_count: qRuns.length,
      human_accuracy: humanAcc,
      model_accuracy: modelAcc,
      gap: humanAcc != null && modelAcc != null ? humanAcc - modelAcc : null,
      flag,
    };
  });

  return {
    models: [...byModel.entries()].map(([key, v]) => ({
      key,
      label: v.label,
      ...score(v.overall, v.byCategory),
    })),
    human: score(humanOverall, humanByCategory),
    questions: perQuestion,
  };
}
