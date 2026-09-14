"use client";

import { useState } from "react";
import {
  DIMENSIONS,
  FORMATS,
  FORMAT_BY_CODE,
  MODALITY,
  PROBES,
  TYPE_BY_CODE,
  VERIFIABILITY,
  typesInDimension,
  type AnswerFormat,
  type Modality,
  type Probe,
  type Verifiability,
} from "@/lib/taxonomy";

export interface TypeSelection {
  typeCode: string;
  verifiability: Verifiability;
  modality: Modality;
  probes: Probe[];
  format: AnswerFormat;
}

const ALL_PROBES = Object.keys(PROBES) as Probe[];

/**
 * Choosing a fine-grained type fills in the verifiability, modality, probes and
 * answer format the taxonomy assigns it. Each stays editable, because a
 * particular question sometimes departs from its type's defaults.
 */
export default function TypePicker({
  value,
  onChange,
  initialDimension,
}: {
  value: TypeSelection | null;
  onChange: (next: TypeSelection | null) => void;
  initialDimension?: number;
}) {
  const [dimension, setDimension] = useState<number>(
    initialDimension ?? TYPE_BY_CODE.get(value?.typeCode ?? "")?.dimension ?? 1,
  );
  const [showDefaults, setShowDefaults] = useState(false);

  function selectType(code: string) {
    const type = TYPE_BY_CODE.get(code);
    if (!type) return;
    onChange({
      typeCode: type.code,
      verifiability: type.verifiability,
      modality: type.modality,
      probes: [...type.probes],
      format: type.format,
    });
  }

  const selected = value ? TYPE_BY_CODE.get(value.typeCode) : null;
  const formatSpec = value ? FORMAT_BY_CODE.get(value.format) : null;

  return (
    <div className="space-y-4">
      <div>
        <span className="mb-1.5 block text-sm font-medium">Dimension</span>
        <div className="grid gap-2 sm:grid-cols-2">
          {DIMENSIONS.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => setDimension(d.id)}
              className={`rounded-lg border p-2.5 text-left text-sm transition ${
                dimension === d.id
                  ? "border-accent bg-accent/5"
                  : "border-line hover:bg-background"
              }`}
            >
              <span className="font-medium">
                {d.id}. {d.name}
              </span>
              <span className="mt-0.5 block text-xs leading-snug text-muted">{d.blurb}</span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <span className="mb-1.5 block text-sm font-medium">Fine-grained type</span>
        <div className="space-y-1.5">
          {typesInDimension(dimension).map((t) => {
            const active = value?.typeCode === t.code;
            return (
              <button
                key={t.code}
                type="button"
                onClick={() => selectType(t.code)}
                className={`block w-full rounded-lg border p-3 text-left transition ${
                  active ? "border-accent bg-accent/5" : "border-line hover:bg-background"
                }`}
              >
                <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="font-mono text-xs text-muted">{t.code}</span>
                  <span className="text-sm font-medium">{t.name}</span>
                  {t.regional && (
                    <span
                      title="Specific to South Asian traffic, or much harder in it"
                      className="rounded border border-accent/30 bg-accent/10 px-1.5 text-[10px] text-accent"
                    >
                      ★ regional
                    </span>
                  )}
                </span>
                <span className="mt-1 block text-xs italic leading-snug text-muted">
                  {t.example}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {value && selected && (
        <div className="rounded-lg border border-line bg-background p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded border px-2 py-0.5 text-xs ${VERIFIABILITY[value.verifiability].style}`}
            >
              {value.verifiability} · {VERIFIABILITY[value.verifiability].label}
            </span>
            <span className="rounded border border-line px-2 py-0.5 text-xs text-muted">
              {MODALITY[value.modality]}
            </span>
            <span className="rounded border border-line px-2 py-0.5 font-mono text-xs text-muted">
              {value.format}
            </span>
            {value.probes.map((p) => (
              <span
                key={p}
                title={PROBES[p]}
                className="rounded border border-line px-2 py-0.5 font-mono text-[10px] text-muted"
              >
                {p}
              </span>
            ))}
            <button
              type="button"
              onClick={() => setShowDefaults((open) => !open)}
              className="ml-auto text-xs text-accent"
            >
              {showDefaults ? "Done" : "Adjust"}
            </button>
          </div>

          <p className="mt-2 text-xs leading-relaxed text-muted">
            {VERIFIABILITY[value.verifiability].hint}
            {formatSpec && ` Scored by: ${formatSpec.scoring.toLowerCase()}`}
          </p>

          {showDefaults && (
            <div className="mt-4 space-y-4 border-t border-line pt-4">
              <div>
                <span className="mb-1.5 block text-xs font-medium">Verifiability</span>
                <div className="flex flex-wrap gap-1.5">
                  {(Object.keys(VERIFIABILITY) as Verifiability[]).map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => onChange({ ...value, verifiability: v })}
                      className={`rounded border px-2 py-1 text-xs transition ${
                        value.verifiability === v
                          ? VERIFIABILITY[v].style
                          : "border-line text-muted hover:bg-surface"
                      }`}
                    >
                      {VERIFIABILITY[v].label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <span className="mb-1.5 block text-xs font-medium">Modality</span>
                <div className="flex flex-wrap gap-1.5">
                  {(Object.keys(MODALITY) as Modality[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => onChange({ ...value, modality: m })}
                      className={`rounded border px-2 py-1 text-xs transition ${
                        value.modality === m
                          ? "border-accent bg-accent/10 text-accent"
                          : "border-line text-muted hover:bg-surface"
                      }`}
                    >
                      {MODALITY[m]}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <span className="mb-1.5 block text-xs font-medium">Answer format</span>
                <select
                  value={value.format}
                  onChange={(e) => onChange({ ...value, format: e.target.value as AnswerFormat })}
                  className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
                >
                  {FORMATS.map((f) => (
                    <option key={f.code} value={f.code}>
                      {f.code} — {f.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <span className="mb-1.5 block text-xs font-medium">Grounding probes</span>
                <div className="flex flex-wrap gap-1.5">
                  {ALL_PROBES.map((p) => {
                    const on = value.probes.includes(p);
                    return (
                      <button
                        key={p}
                        type="button"
                        title={PROBES[p]}
                        onClick={() =>
                          onChange({
                            ...value,
                            probes: on
                              ? value.probes.filter((x) => x !== p)
                              : [...value.probes, p],
                          })
                        }
                        className={`rounded border px-2 py-1 font-mono text-[10px] transition ${
                          on
                            ? "border-accent bg-accent/10 text-accent"
                            : "border-line text-muted hover:bg-surface"
                        }`}
                      >
                        {p}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Submitted with the form. */}
      <input type="hidden" name="type_code" value={value?.typeCode ?? ""} />
      <input type="hidden" name="verifiability" value={value?.verifiability ?? ""} />
      <input type="hidden" name="modality" value={value?.modality ?? ""} />
      <input type="hidden" name="answer_format" value={value?.format ?? ""} />
      <input type="hidden" name="probes" value={JSON.stringify(value?.probes ?? [])} />
    </div>
  );
}
