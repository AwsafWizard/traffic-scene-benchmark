import Link from "next/link";
import { requireAdmin } from "@/server/auth";
import { listConnections, PRESETS, type Connection } from "@/server/connections";
import { listModels, modelSpend, type Model } from "@/server/models";
import { encryptionConfigured } from "@/server/secrets";
import { deleteConnectionAction, saveConnectionAction, saveModelAction } from "../../actions/admin";
import { Notice, PageHeader } from "../../ui/components";
import SubmitButton from "../../ui/SubmitButton";
import { buttonDanger, buttonSecondary, card, hint, input, label, select } from "../../ui/styles";
import ActionForm from "../ActionForm";
import { ListRemoteModels, NewConnectionForm } from "./ConnectionTools";

const FAMILIES: { key: Model["family"]; title: string }[] = [
  { key: "proprietary", title: "Proprietary (API) models" },
  { key: "open_weight", title: "Open-weight models" },
  { key: "driving", title: "Driving-specific models" },
  { key: "other", title: "Other" },
];
const KIND_LABEL = { anthropic: "Anthropic", google: "Google Gemini", openai_compatible: "OpenAI-compatible" } as const;

export default async function ModelsPage() {
  await requireAdmin();
  const [models, connections, spend] = await Promise.all([listModels(), listConnections(), modelSpend()]);
  const encryption = encryptionConfigured();
  const ready = models.filter((m) => m.api_ready).length;
  const totalSpend = [...spend.values()].reduce((sum, s) => sum + (s.dollars ?? 0), 0);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Models"
        sub={`${models.length} models · ${models.filter((m) => m.funded).length} funded · ${ready} callable by API · $${totalSpend.toFixed(2)} spent through the app`}
        actions={<Link href="/admin/models/check" className={buttonSecondary}>Open the model check</Link>}
      />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">API connections</h2>
        <p className="text-sm text-muted">
          One per provider account. A model linked to a connection, with its provider model ID filled in, is asked by the app;
          every other model is answered by hand. Open-weight models can be called too once they&apos;re served from a GPU
          with vLLM, SGLang or Ollama (all speak the OpenAI-compatible API).
        </p>
        {!encryption && (
          <Notice tone="warn">
            Set <code>ENCRYPTION_KEY</code> on the server before adding keys. Generate one with{" "}
            <code>node -e &quot;console.log(require(&apos;crypto&apos;).randomBytes(32).toString(&apos;base64&apos;))&quot;</code>
          </Notice>
        )}
        {connections.map((c) => <ConnectionCard key={c.id} c={c} />)}
        <details className={card}>
          <summary className="cursor-pointer p-4 text-sm text-accent">+ Add a connection</summary>
          <div className="border-t border-line">
            <NewConnectionForm presets={PRESETS} />
          </div>
        </details>
      </section>

      {FAMILIES.map(({ key, title }) => {
        const list = models.filter((m) => m.family === key);
        if (list.length === 0) return null;
        return (
          <section key={key} className="space-y-2">
            <h2 className="text-lg font-semibold">
              {title} <span className="text-sm font-normal text-muted">({list.filter((m) => m.funded).length} funded of {list.length})</span>
            </h2>
            <div className={`${card} divide-y divide-line`}>
              {list.map((m) => {
                const s = spend.get(m.id);
                return (
                  <details key={m.id} className={m.active ? "" : "opacity-60"}>
                    <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
                      <span className="min-w-48 font-medium">{m.name}</span>
                      <span className="text-muted">{m.provider}</span>
                      {m.funded && <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 text-xs text-emerald-700 dark:text-emerald-400">funded</span>}
                      {!m.active && <span className="text-xs text-muted">not in use</span>}
                      <span className="ml-auto text-xs">
                        {m.api_ready ? (
                          <span className="text-accent">API · {m.connection_name}</span>
                        ) : m.connection_id ? (
                          <span className="text-amber-600">connection set, needs model ID or key</span>
                        ) : (
                          <span className="text-muted">by hand</span>
                        )}
                        {m.price_in !== null && <span className="ml-3 text-muted">${m.price_in} / ${m.price_out}</span>}
                        {s && <span className="ml-3 text-muted">{s.calls} calls{s.dollars !== null && ` · $${s.dollars.toFixed(2)}`}</span>}
                      </span>
                    </summary>
                    <ModelForm model={m} connections={connections} />
                  </details>
                );
              })}
            </div>
          </section>
        );
      })}

      <details className={card}>
        <summary className="cursor-pointer p-4 text-sm text-accent">+ Add a model</summary>
        <ModelForm connections={connections} />
      </details>
    </div>
  );
}

function ConnectionCard({ c }: { c: Connection }) {
  return (
    <details className={`${card} ${c.active ? "" : "opacity-60"}`}>
      <summary className="flex cursor-pointer flex-wrap items-center gap-3 p-4 text-sm">
        <span className="font-medium">{c.name}</span>
        <span className="text-muted">{KIND_LABEL[c.kind]}</span>
        <span className="text-xs text-muted">{c.has_key ? `key ••••${c.key_hint}` : "no key"}</span>
        <span className="ml-auto text-xs text-muted">{c.models} model{c.models === 1 ? "" : "s"}{!c.active && " · switched off"}</span>
      </summary>
      <div className="space-y-4 border-t border-line p-4">
        <ListRemoteModels connectionId={c.id} />
        <ActionForm action={saveConnectionAction} className="grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="id" value={c.id} />
          <div>
            <label className={label}>Name</label>
            <input name="name" defaultValue={c.name} className={input} />
          </div>
          <div>
            <label className={label}>API type</label>
            <select name="kind" defaultValue={c.kind} className={select}>
              <option value="openai_compatible">OpenAI-compatible</option>
              <option value="anthropic">Anthropic</option>
              <option value="google">Google Gemini</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className={label}>Base URL</label>
            <input name="base_url" defaultValue={c.base_url ?? ""} className={input} />
          </div>
          <div className="sm:col-span-2">
            <label className={label}>Replace API key</label>
            <input name="api_key" type="password" autoComplete="off" className={input} placeholder="Leave empty to keep the current key" />
          </div>
          <div className="flex flex-wrap items-center gap-4 sm:col-span-2">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={c.active} /> In use</label>
            {c.has_key && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="clear_key" /> Remove the stored key</label>}
            <span className="flex-1" />
            <SubmitButton>Save connection</SubmitButton>
          </div>
        </ActionForm>
        <form action={deleteConnectionAction}>
          <input type="hidden" name="id" value={c.id} />
          <SubmitButton className={buttonDanger} confirm={`Delete ${c.name}? Its models go back to being answered by hand.`}>Delete connection</SubmitButton>
        </form>
      </div>
    </details>
  );
}

function ModelForm({ model, connections }: { model?: Model; connections: Connection[] }) {
  return (
    <ActionForm action={saveModelAction} className="grid gap-3 border-t border-line bg-background/50 p-4 sm:grid-cols-3">
      {model && <input type="hidden" name="id" value={model.id} />}
      <div>
        <label className={label}>Display name</label>
        <input name="name" defaultValue={model?.name} required className={input} />
      </div>
      <div>
        <label className={label}>Developer</label>
        <input name="provider" defaultValue={model?.provider} className={input} placeholder="OpenAI" />
      </div>
      <div>
        <label className={label}>Family</label>
        <select name="family" defaultValue={model?.family ?? "proprietary"} className={select}>
          <option value="proprietary">Proprietary (API)</option>
          <option value="open_weight">Open-weight</option>
          <option value="driving">Driving-specific</option>
          <option value="other">Other</option>
        </select>
      </div>
      <div>
        <label className={label}>Connection</label>
        <select name="connection_id" defaultValue={model?.connection_id ?? ""} className={select}>
          <option value="">None — answers recorded by hand</option>
          {connections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div>
        <label className={label}>Provider model ID</label>
        <input name="model_id" defaultValue={model?.model_id ?? ""} className={`${input} font-mono`} placeholder="e.g. claude-opus-5-5" />
        <p className={hint}>Exactly as the provider names it. Use “Test key and list model IDs” on the connection.</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={label}>$ / 1M in</label>
          <input name="price_in" defaultValue={model?.price_in ?? ""} className={input} inputMode="decimal" />
        </div>
        <div>
          <label className={label}>$ / 1M out</label>
          <input name="price_out" defaultValue={model?.price_out ?? ""} className={input} inputMode="decimal" />
        </div>
      </div>
      <div className="sm:col-span-3">
        <label className={label}>Request options (JSON, optional)</label>
        <input
          name="request_options"
          defaultValue={model?.request_options ? JSON.stringify(model.request_options) : ""}
          className={`${input} font-mono`}
          placeholder='e.g. {"reasoning_effort": "high"} or {"output_config": {"effort": "high"}}'
        />
        <p className={hint}>Merged into every request for this model, so settings stay fixed and comparable. It can&apos;t change the model, prompt or image.</p>
      </div>
      <div className="sm:col-span-3">
        <label className={label}>Notes</label>
        <input name="notes" defaultValue={model?.notes ?? ""} className={input} />
      </div>
      <div className="flex flex-wrap items-center gap-4 sm:col-span-3">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="funded" defaultChecked={model?.funded} /> Funded</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={model?.active ?? true} /> In use (shown in the model check)</label>
        <span className="flex-1" />
        <SubmitButton>{model ? "Save" : "Add model"}</SubmitButton>
      </div>
    </ActionForm>
  );
}
