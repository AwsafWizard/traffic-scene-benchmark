/**
 * The fine-grained VQA taxonomy for South Asian traffic scenes.
 *
 * Every question is one fine-grained type. The type carries the defaults the
 * taxonomy assigns it — how checkable its answer is, whether a single frame is
 * enough, which grounding probes to run, and how the answer is scored — so
 * setting a question is picking a type rather than filling in five fields. Any
 * default can still be overridden per question.
 */

/** Can we establish a defensible ground truth? */
export type Verifiability = "V" | "C" | "I";

/** Is a single frame enough, or does the question need a clip? */
export type Modality = "F" | "T" | "F/T";

/** Checks that tell genuine visual reading apart from prior-driven guessing. */
export type Probe = "BLANK" | "NO-IMG" | "SWAP" | "CF" | "LOC" | "OCR";

/** How a response is scored. */
export type AnswerFormat =
  | "BIN"
  | "MCQ"
  | "MSEL"
  | "NUM"
  | "SA"
  | "GND"
  | "RANK"
  | "STR"
  | "FT";

export const VERIFIABILITY: Record<Verifiability, { label: string; hint: string; style: string }> = {
  V: {
    label: "Verifiable",
    hint: "Readable straight from the pixels; independent annotators will agree.",
    style: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600",
  },
  C: {
    label: "Context / consensus",
    hint: "Verifiable, but only once you state a rule or take a majority vote.",
    style: "border-amber-500/30 bg-amber-500/10 text-amber-600",
  },
  I: {
    label: "Inferential",
    hint: "Prediction, intention or counterfactual. No frame-level ground truth — score the reasoning.",
    style: "border-red-500/30 bg-red-500/10 text-red-500",
  },
};

export const MODALITY: Record<Modality, string> = {
  F: "Single frame",
  T: "Needs a clip",
  "F/T": "Frame or clip",
};

export const PROBES: Record<Probe, string> = {
  BLANK: "Same question over a blank/noise image — a specific answer means a language prior.",
  "NO-IMG": "Ask with no image, then measure how far accuracy drops once it's back.",
  SWAP: "Pair with a different or edited frame; the answer has to change.",
  CF: "A real scene that breaks the usual prior, catching memorised answers.",
  LOC: "Ask 'where in the image?' and check the region really contains it.",
  OCR: "Force reading scene-specific text it cannot have memorised.",
};

export interface FormatSpec {
  code: AnswerFormat;
  label: string;
  scoring: string;
  /** Whether this app can grade it without a human. */
  autoGradable: boolean;
  /** Whether the setter supplies a fixed option list. */
  hasOptions: boolean;
}

export const FORMATS: FormatSpec[] = [
  {
    code: "BIN",
    label: "Binary (yes/no, true/false)",
    scoring: "Accuracy and F1, balanced over yes and no.",
    autoGradable: true,
    hasOptions: true,
  },
  {
    code: "MCQ",
    label: "Multiple choice (single, 4–5 options)",
    scoring: "Exact match under shuffled option order.",
    autoGradable: true,
    hasOptions: true,
  },
  {
    code: "MSEL",
    label: "Multiple select (all that apply)",
    scoring: "Set F1 / Jaccard against the labelled set.",
    autoGradable: true,
    hasOptions: true,
  },
  {
    code: "NUM",
    label: "Numeric (exact or bounded range)",
    scoring: "Exact match, or off-by-k / interval hit.",
    autoGradable: true,
    hasOptions: false,
  },
  {
    code: "SA",
    label: "Short answer (constrained text)",
    scoring: "Normalised string match / ANLS.",
    autoGradable: true,
    hasOptions: false,
  },
  {
    code: "GND",
    label: "Grounded (text plus box or point)",
    scoring: "IoU for a box, hit-inside-region for a point.",
    autoGradable: false,
    hasOptions: false,
  },
  {
    code: "RANK",
    label: "Ranking / ordering",
    scoring: "Kendall's τ or exact-order accuracy.",
    autoGradable: false,
    hasOptions: false,
  },
  {
    code: "STR",
    label: "Structured (JSON / small table)",
    scoring: "Per-field accuracy over fields and objects.",
    autoGradable: false,
    hasOptions: false,
  },
  {
    code: "FT",
    label: "Free text with confidence",
    scoring: "LLM-judge on a rubric, plus calibration.",
    autoGradable: false,
    hasOptions: false,
  },
];

export const FORMAT_BY_CODE = new Map(FORMATS.map((f) => [f.code, f]));

export interface Dimension {
  id: number;
  name: string;
  blurb: string;
}

export const DIMENSIONS: Dimension[] = [
  { id: 1, name: "Perception & Attributes", blurb: "The smallest visual details: what is present and its properties." },
  { id: 2, name: "Counting & Density", blurb: "Quantity, the classic fine-grained axis." },
  { id: 3, name: "Spatial Grounding & Relations", blurb: "Where things are and how they relate." },
  { id: 4, name: "Temporal & Behavioural", blurb: "Motion, intent and what happens next, so it usually needs clips." },
  { id: 5, name: "Traffic Law & Compliance", blurb: "Rule-based judgements; some verifiable from a frame, some requiring context." },
  { id: 6, name: "Reasoning & Meta", blurb: "Explanation, comparison and hallucination stress-tests." },
];

export interface QuestionType {
  code: string;
  dimension: number;
  name: string;
  example: string;
  verifiability: Verifiability;
  modality: Modality;
  probes: Probe[];
  format: AnswerFormat;
  /** Types that only appear in South Asian traffic, or that it makes much harder. */
  regional?: boolean;
}

export const TYPES: QuestionType[] = [
  // 1 — Perception & Attributes
  { code: "1.1", dimension: 1, name: "Object existence / verification (hallucination trap)", example: "“Is there a traffic light in this scene?” (when there is none)", verifiability: "V", modality: "F", probes: ["BLANK", "CF"], format: "BIN" },
  { code: "1.2", dimension: 1, name: "Vehicle sub-type discrimination", example: "“Is that a CNG auto-rickshaw, a pedal rickshaw, or an easy-bike?”", verifiability: "V", modality: "F", probes: ["SWAP", "NO-IMG"], format: "MCQ", regional: true },
  { code: "1.3", dimension: 1, name: "Fine attribute recognition", example: "“What colour is the bus? Is it single- or double-decker?”", verifiability: "V", modality: "F", probes: ["SWAP", "LOC"], format: "MCQ" },
  { code: "1.4", dimension: 1, name: "Component-state recognition", example: "“Are the brake lights on? Is the indicator blinking? High-beam on?”", verifiability: "C", modality: "F/T", probes: ["LOC", "SWAP"], format: "STR" },
  { code: "1.5", dimension: 1, name: "Load / condition / roadworthiness", example: "“Is the bus overloaded (passengers on roof)? Is the load overhanging?”", verifiability: "C", modality: "F", probes: ["LOC", "CF"], format: "BIN", regional: true },
  { code: "1.6", dimension: 1, name: "In-scene text / sign reading (OCR)", example: "“What route is on the bus board? Read the number plate.”", verifiability: "V", modality: "F", probes: ["OCR", "BLANK"], format: "SA", regional: true },

  // 2 — Counting & Density
  { code: "2.1", dimension: 2, name: "Exact count (sparse)", example: "“How many pedestrians are crossing?”", verifiability: "V", modality: "F", probes: ["NO-IMG", "LOC"], format: "NUM" },
  { code: "2.2", dimension: 2, name: "Attribute-conditioned count", example: "“How many parked vs. moving vehicles? How many rickshaws only?”", verifiability: "C", modality: "F", probes: ["SWAP", "LOC"], format: "NUM" },
  { code: "2.3", dimension: 2, name: "Bounded density estimation under occlusion", example: "“Roughly how many two-wheelers are in that packed row?”", verifiability: "C", modality: "F", probes: ["NO-IMG", "CF"], format: "NUM", regional: true },

  // 3 — Spatial Grounding & Relations
  { code: "3.1", dimension: 3, name: "Absolute / region grounding", example: "“Which vehicles are in the ego lane?”", verifiability: "V", modality: "F", probes: ["LOC", "SWAP"], format: "GND" },
  { code: "3.2", dimension: 3, name: "Relative position & ordering", example: "“Which vehicle is nearest the ego? Order them front-to-back.”", verifiability: "V", modality: "F", probes: ["SWAP", "LOC"], format: "RANK" },
  { code: "3.3", dimension: 3, name: "Referring-expression resolution", example: "“Describe the rickshaw to the left of the white van.”", verifiability: "V", modality: "F", probes: ["LOC", "SWAP"], format: "GND" },
  { code: "3.4", dimension: 3, name: "Occlusion / amodal reasoning", example: "“Is a vehicle hidden behind the bus?”", verifiability: "C", modality: "F", probes: ["CF", "SWAP"], format: "BIN" },
  { code: "3.5", dimension: 3, name: "Figure-ground / depth separation", example: "“Is the rider raising his arm?” (livery-trap frame)", verifiability: "V", modality: "F", probes: ["CF", "LOC"], format: "BIN", regional: true },
  { code: "3.6", dimension: 3, name: "Inter-vehicle relation", example: "“Identify leader-follower pairs; is anyone overtaking / cutting in?”", verifiability: "C", modality: "F/T", probes: ["LOC", "SWAP"], format: "MCQ" },

  // 4 — Temporal & Behavioural
  { code: "4.1", dimension: 4, name: "Motion / action recognition", example: "“Is that bike weaving? Is the van moving or stopped?”", verifiability: "V", modality: "T", probes: ["SWAP", "NO-IMG"], format: "MCQ" },
  { code: "4.2", dimension: 4, name: "Intention recognition", example: "“Is the pedestrian about to cross? Is that car changing lanes?”", verifiability: "I", modality: "T", probes: ["CF", "LOC"], format: "FT" },
  { code: "4.3", dimension: 4, name: "Short-horizon prediction", example: "“What happens in the next 3 seconds?”", verifiability: "I", modality: "T", probes: ["NO-IMG", "CF"], format: "FT" },
  { code: "4.4", dimension: 4, name: "Evasive-action / risk-of-conflict", example: "“Must the ego take evasive action in the next 5 s?”", verifiability: "I", modality: "T", probes: ["NO-IMG", "CF"], format: "BIN" },

  // 5 — Traffic Law & Compliance
  { code: "5.1", dimension: 5, name: "Frame-verifiable violation", example: "“Is any vehicle on the wrong side / riding the footpath?”", verifiability: "V", modality: "F", probes: ["LOC", "CF"], format: "MSEL" },
  { code: "5.2", dimension: 5, name: "Rule-conditioned violation", example: "“Is the motorcyclist without a helmet violating the law here?”", verifiability: "C", modality: "F", probes: ["LOC", "NO-IMG"], format: "BIN" },
  { code: "5.3", dimension: 5, name: "Context-dependent violation", example: "“Is that car running high beams inappropriately?”", verifiability: "I", modality: "F/T", probes: ["CF", "LOC"], format: "FT" },
  { code: "5.4", dimension: 5, name: "Informal-behaviour reasoning", example: "“Who has right of way at this unmarked, negotiated junction?”", verifiability: "I", modality: "F/T", probes: ["CF", "NO-IMG"], format: "FT", regional: true },

  // 6 — Reasoning & Meta
  { code: "6.1", dimension: 6, name: "Causal / explanatory (“why”)", example: "“Why is that vehicle stopped in the middle of the road?”", verifiability: "C", modality: "F/T", probes: ["CF", "LOC"], format: "MCQ" },
  { code: "6.2", dimension: 6, name: "Comparative", example: "“Which vehicle is closer / larger / more dangerous?”", verifiability: "C", modality: "F", probes: ["SWAP", "LOC"], format: "MCQ" },
  { code: "6.3", dimension: 6, name: "Counterfactual / planning", example: "“If the ego brakes now, what happens?”", verifiability: "I", modality: "T", probes: ["NO-IMG", "CF"], format: "FT" },
  { code: "6.4", dimension: 6, name: "Risk / hazard identification", example: "“What is the single most important hazard right now, and why?”", verifiability: "I", modality: "F/T", probes: ["CF", "LOC"], format: "FT" },
];

export const TYPE_BY_CODE = new Map(TYPES.map((t) => [t.code, t]));

export function typesInDimension(dimension: number): QuestionType[] {
  return TYPES.filter((t) => t.dimension === dimension);
}

export function dimensionOf(code: string | null): number | null {
  return code ? (TYPE_BY_CODE.get(code)?.dimension ?? null) : null;
}

/**
 * Where the old three-way category landed. Used only to pre-select a dimension
 * for questions written before the taxonomy existed — the fine-grained type
 * still has to be chosen by a human, since the old labels can't imply one.
 */
export const LEGACY_CATEGORY_DIMENSION: Record<string, number> = {
  spatial: 3,
  logical: 5,
  behavioral: 4,
};
