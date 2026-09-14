export type Category = "spatial" | "logical" | "behavioral";
export type AnswerType = "mcq" | "free";
/** Providers we can call over an API. */
export type ApiProvider = "anthropic" | "openai" | "google";
/** "manual" models are never called — their answers are pasted in by hand. */
export type Provider = ApiProvider | "manual";
export type Role = "benchmarker" | "grounder";
export type Verdict = "correct" | "partial" | "incorrect";

export interface Question {
  id: number;
  /** Stable identifier that survives export to another install. */
  uid: string;
  image_path: string;
  prompt: string;
  category: Category;
  answer_type: AnswerType;
  options: string | null;
  reference_answer: string | null;
  notes: string | null;
  /** 1 when this question arrived from another install. */
  imported: number;
  created_at: string;
}

export interface HumanResponse {
  id: number;
  /** 1 when this answer arrived from another install. */
  imported: number;
  question_id: number;
  grounder_name: string;
  answer: string;
  confidence: number | null;
  rationale: string | null;
  duration_ms: number | null;
  created_at: string;
}

export interface ModelRow {
  id: number;
  key: string;
  label: string;
  provider: Provider;
  model_id: string;
  extra: string | null;
  enabled: number;
  created_at: string;
}

export interface LlmRun {
  id: number;
  /** Stable across installs, so runs can be matched when synced. */
  uid: string;
  /** 1 when this run arrived from another install. */
  imported: number;
  question_id: number;
  model_key: string;
  answer: string | null;
  reasoning: string | null;
  raw: string | null;
  latency_ms: number | null;
  error: string | null;
  /** "api" if we called the model ourselves, "manual" if the answer was pasted in. */
  source: "api" | "manual";
  created_at: string;
}

export interface RunTurn {
  id: number;
  run_id: number;
  role: "user" | "assistant";
  content: string;
  latency_ms: number | null;
  error: string | null;
  created_at: string;
}

export interface Comment {
  id: number;
  uid: string;
  question_id: number;
  author_role: Role;
  author_name: string | null;
  body: string;
  created_at: string;
}

export interface Grade {
  id: number;
  target_type: "human" | "llm";
  target_id: number;
  verdict: Verdict;
  grader: string;
  created_at: string;
}

export interface ProviderResult {
  answer: string | null;
  reasoning: string | null;
  raw: unknown;
}
