import {
  MODALITY,
  PROBES,
  TYPE_BY_CODE,
  VERIFIABILITY,
  type Modality,
  type Probe,
  type Verifiability,
} from "@/lib/taxonomy";
import type { Question } from "@/lib/types";

/** Compact taxonomy summary, shown wherever a question is listed. */
export default function TypeBadges({
  question,
  showProbes = false,
}: {
  question: Question;
  showProbes?: boolean;
}) {
  const type = question.type_code ? TYPE_BY_CODE.get(question.type_code) : null;

  if (!type) {
    return (
      <span className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-600">
        unclassified
      </span>
    );
  }

  const verifiability = (question.verifiability ?? type.verifiability) as Verifiability;
  const modality = (question.modality ?? type.modality) as Modality;
  const format = question.answer_format ?? type.format;
  let probes: Probe[] = type.probes;
  if (question.probes) {
    try {
      probes = JSON.parse(question.probes) as Probe[];
    } catch {
      // Fall back to the type's defaults.
    }
  }

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span
        title={type.name}
        className="rounded border border-line px-1.5 py-0.5 font-mono text-[10px] text-muted"
      >
        {type.code}
      </span>
      <span
        title={VERIFIABILITY[verifiability]?.hint}
        className={`rounded border px-1.5 py-0.5 text-[10px] ${VERIFIABILITY[verifiability]?.style ?? ""}`}
      >
        {verifiability}
      </span>
      <span
        title={MODALITY[modality]}
        className="rounded border border-line px-1.5 py-0.5 text-[10px] text-muted"
      >
        {modality}
      </span>
      <span className="rounded border border-line px-1.5 py-0.5 font-mono text-[10px] text-muted">
        {format}
      </span>
      {type.regional && (
        <span
          title="Specific to South Asian traffic, or much harder in it"
          className="rounded border border-accent/30 bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent"
        >
          ★
        </span>
      )}
      {showProbes &&
        probes.map((p) => (
          <span
            key={p}
            title={PROBES[p]}
            className="rounded border border-line px-1.5 py-0.5 font-mono text-[10px] text-muted"
          >
            {p}
          </span>
        ))}
    </span>
  );
}
