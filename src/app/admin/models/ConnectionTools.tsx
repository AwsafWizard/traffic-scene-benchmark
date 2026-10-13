"use client";

import { useState } from "react";
import { listRemoteModelsAction, saveConnectionAction } from "../../actions/admin";
import SubmitButton from "../../ui/SubmitButton";
import { buttonSecondary, hint, input, label, select } from "../../ui/styles";
import ActionForm from "../ActionForm";

type Preset = { label: string; kind: string; base_url: string; note?: string };

/** The "add a connection" form: picking a provider fills in its API type and URL. */
export function NewConnectionForm({ presets }: { presets: Preset[] }) {
  const [preset, setPreset] = useState(presets[0]);
  const [name, setName] = useState(presets[0].label);
  const [baseUrl, setBaseUrl] = useState(presets[0].base_url);
  const [kind, setKind] = useState(presets[0].kind);

  return (
    <ActionForm action={saveConnectionAction} className="grid gap-3 p-5 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label className={label} htmlFor="preset">Provider</label>
        <select
          id="preset"
          className={select}
          value={preset.label}
          onChange={(e) => {
            const next = presets.find((p) => p.label === e.target.value)!;
            setPreset(next);
            setName(next.label);
            setBaseUrl(next.base_url);
            setKind(next.kind);
          }}
        >
          {presets.map((p) => <option key={p.label}>{p.label}</option>)}
        </select>
        {preset.note && <p className={hint}>{preset.note}</p>}
      </div>
      <div>
        <label className={label} htmlFor="c-name">Name</label>
        <input id="c-name" name="name" value={name} onChange={(e) => setName(e.target.value)} className={input} required />
      </div>
      <div>
        <label className={label} htmlFor="c-kind">API type</label>
        <select id="c-kind" name="kind" value={kind} onChange={(e) => setKind(e.target.value)} className={select}>
          <option value="openai_compatible">OpenAI-compatible</option>
          <option value="anthropic">Anthropic</option>
          <option value="google">Google Gemini</option>
        </select>
      </div>
      <div className="sm:col-span-2">
        <label className={label} htmlFor="c-url">Base URL {kind !== "openai_compatible" && <span className="font-normal text-muted">(leave empty for the default)</span>}</label>
        <input id="c-url" name="base_url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} className={input} placeholder="https://…/v1" />
        <p className={hint}>Defaults are the providers&apos; documented URLs; check them against the provider&apos;s docs.</p>
      </div>
      <div className="sm:col-span-2">
        <label className={label} htmlFor="c-key">API key</label>
        <input id="c-key" name="api_key" type="password" autoComplete="off" className={input} placeholder="Stored encrypted; never shown again" />
        <p className={hint}>Self-hosted servers without a key can leave this empty.</p>
      </div>
      <input type="hidden" name="active" value="on" />
      <div className="sm:col-span-2">
        <SubmitButton>Add connection</SubmitButton>
      </div>
    </ActionForm>
  );
}

/** Checks a connection's key and shows the model IDs it can use, so they can be copied exactly. */
export function ListRemoteModels({ connectionId }: { connectionId: number }) {
  const [state, setState] = useState<{ busy: boolean; ids?: string[]; error?: string; filter: string }>({ busy: false, filter: "" });
  const shown = (state.ids ?? []).filter((id) => id.toLowerCase().includes(state.filter.toLowerCase()));
  return (
    <div className="space-y-2">
      <button
        type="button"
        className={buttonSecondary}
        disabled={state.busy}
        onClick={async () => {
          setState((s) => ({ ...s, busy: true, error: undefined }));
          const result = await listRemoteModelsAction(connectionId);
          setState((s) => ({ ...s, busy: false, ...(result.ok ? { ids: result.ids } : { error: result.error }) }));
        }}
      >
        {state.busy ? "Checking…" : "Test key and list model IDs"}
      </button>
      {state.error && <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>}
      {state.ids && (
        <div className="space-y-1.5">
          <p className="text-sm text-emerald-700 dark:text-emerald-400">Key works: {state.ids.length} models available.</p>
          <input className={input} placeholder="Filter, e.g. vision" value={state.filter} onChange={(e) => setState((s) => ({ ...s, filter: e.target.value }))} />
          <div className="flex max-h-40 flex-wrap gap-1 overflow-y-auto">
            {shown.map((id) => (
              <button
                key={id}
                type="button"
                title="Copy"
                className="rounded border border-line px-1.5 py-0.5 font-mono text-xs hover:bg-background"
                onClick={() => navigator.clipboard.writeText(id)}
              >
                {id}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
