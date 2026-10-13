import Link from "next/link";
import { requireAdmin } from "@/server/auth";
import { apiAvailable, listModels, type Model } from "@/server/models";
import { saveModelAction } from "../../actions/admin";
import { PageHeader } from "../../ui/components";
import SubmitButton from "../../ui/SubmitButton";
import { buttonSecondary, card, hint, input, label, select } from "../../ui/styles";
import ActionForm from "../ActionForm";

export default async function ModelsPage() {
  await requireAdmin();
  const models = await listModels();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Models"
        sub="The models used for the model check. Answers can be pasted by hand for any model, or fetched by API when that provider's key is set."
        actions={<Link href="/admin/models/check" className={buttonSecondary}>Open the model check</Link>}
      />
      {models.map((m) => (
        <details key={m.id} className={`${card} ${m.active ? "" : "opacity-60"}`}>
          <summary className="flex cursor-pointer items-center justify-between p-4 text-sm">
            <span>
              <b>{m.name}</b> <span className="text-muted">· {m.provider}{m.model_id && ` · ${m.model_id}`}{!m.active && " · hidden"}</span>
            </span>
            <span className="text-xs text-muted">{m.provider === "manual" ? "answers pasted by hand" : apiAvailable(m.provider) ? "API ready" : "no API key — paste answers"}</span>
          </summary>
          <ModelForm model={m} />
        </details>
      ))}
      <div className={card}>
        <h2 className="px-5 pt-5 font-medium">Add a model</h2>
        <ModelForm />
      </div>
    </div>
  );
}

function ModelForm({ model }: { model?: Model }) {
  return (
    <ActionForm action={saveModelAction} className="grid gap-3 border-t border-line p-5 sm:grid-cols-3">
      {model && <input type="hidden" name="id" value={model.id} />}
      <div>
        <label className={label}>Display name</label>
        <input name="name" defaultValue={model?.name} required className={input} placeholder="Claude Opus 5.5" />
      </div>
      <div>
        <label className={label}>Provider</label>
        <select name="provider" defaultValue={model?.provider ?? "anthropic"} className={select}>
          <option value="anthropic">Anthropic</option>
          <option value="openai">OpenAI</option>
          <option value="google">Google (Gemini)</option>
          <option value="manual">Other (answers pasted by hand)</option>
        </select>
      </div>
      <div>
        <label className={label}>Model ID</label>
        <input name="model_id" defaultValue={model?.model_id ?? ""} className={input} placeholder="claude-opus-5-5" />
        <p className={hint}>Exactly as the provider names it, so results stay comparable.</p>
      </div>
      <div className="sm:col-span-3">
        <label className={label}>Notes</label>
        <input name="notes" defaultValue={model?.notes ?? ""} className={input} placeholder="How it was run: web UI, temperature, system prompt…" />
      </div>
      <div className="flex items-center justify-between sm:col-span-3">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={model?.active ?? true} /> In use</label>
        <SubmitButton>{model ? "Save" : "Add model"}</SubmitButton>
      </div>
    </ActionForm>
  );
}
