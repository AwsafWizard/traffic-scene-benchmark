import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/server/auth";
import { FLAG_LABEL, type FlagReason } from "@/server/engine";
import { buildPrompt, listModels, newOrder } from "@/server/models";
import { imageSrc } from "@/server/storage";
import { questionDetail } from "@/server/stats";
import { getTaxonomy } from "@/server/taxonomy";
import { manualModelAnswerAction, moveQuestionAction, reviewAction, runModelAction } from "../../../actions/admin";
import { PageHeader, StatusBadge, VBadge } from "../../../ui/components";
import SubmitButton from "../../../ui/SubmitButton";
import ZoomImage from "../../../ui/ZoomImage";
import { buttonDanger, buttonSecondary, card, input, label, select, td, th } from "../../../ui/styles";
import ActionForm from "../../ActionForm";

// Server actions started from this page may wait on a slow model.
export const maxDuration = 300;

const ROLE = { v: "Checker", c: "Blind checker", second: "Second", third: "Third" } as Record<string, string>;
const JUDGMENT: Record<string, string> = {
  setter_mistake: "Setter made a mistake",
  misread: "I misread it",
  agree: "Agrees with the setter",
  disagree: "Disagrees",
  all_agree: "All three agree",
  not_all_agree: "Not all three agree",
};
const ODD = { setter: "the setter's", second: "the second checker's", mine: "their own" } as Record<string, string>;
const LETTERS = "ABCDE";

function seconds(from: Date | null, to: Date | null): string {
  if (!from || !to) return "—";
  return `${Math.round((to.getTime() - from.getTime()) / 1000)}s`;
}

export default async function AdminQuestionPage({ params }: PageProps<"/admin/questions/[id]">) {
  await requireAdmin();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const q = await questionDetail(id);
  if (!q) notFound();
  const [models, taxonomy] = await Promise.all([listModels({ activeOnly: true }), getTaxonomy()]);

  const optionText = (choice: string | null, note: string | null) => {
    if (choice === null) return <span className="text-muted">not answered yet</span>;
    if (choice === "none") return <>None of these — <i>&ldquo;{note}&rdquo;</i></>;
    if (choice === "cant_tell") return <>Can&apos;t tell — <i>&ldquo;{note}&rdquo;</i></>;
    const option = q.options.find((o) => o.id === choice);
    return (
      <span className={choice === q.correct_option ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>
        {option?.text ?? choice}
      </span>
    );
  };

  const manualOrder = newOrder(q.options);
  const manualPrompt = buildPrompt(q.prompt, q.options, manualOrder);
  const latest = new Map<string, (typeof q.modelAnswers)[number]>();
  for (const a of q.modelAnswers) if (!latest.has(a.model)) latest.set(a.model, a);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      <div className="space-y-4 lg:sticky lg:top-6 lg:self-start">
        <ZoomImage src={imageSrc(q.image)} alt="Traffic scene" />
        {q.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {q.tags.map((t) => (
              <span key={`${t.group}/${t.tag}`} className="rounded-full border border-line px-2 py-0.5 text-xs" title={t.group}>{t.tag}</span>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-5">
        <PageHeader
          title={`Question ${q.code}`}
          sub={
            <span className="flex flex-wrap items-center gap-2">
              <StatusBadge status={q.status} /> <VBadge v={q.verifiability} long /> {q.subtype} · by{" "}
              <Link href={`/admin/annotators/${q.author_id}`} className="hover:underline">{q.author_name}</Link> ·{" "}
              <Link href={`/admin/sprints/${q.sprint_id}`} className="hover:underline">{q.sprint_name}</Link>
            </span>
          }
        />

        <section className={`${card} space-y-3 p-5`}>
          <p className="text-base">{q.prompt}</p>
          <ol className="space-y-1.5">
            {q.options.map((o, i) => (
              <li key={o.id} className={`rounded-md border px-3 py-1.5 text-sm ${o.id === q.correct_option ? "border-emerald-500/50 bg-emerald-500/10" : "border-line"}`}>
                <span className="mr-2 text-muted">{LETTERS[i]}</span>{o.text}
                {o.id === q.correct_option && <span className="ml-2 text-xs text-emerald-700 dark:text-emerald-400">setter&apos;s answer</span>}
              </li>
            ))}
          </ol>
          {q.status === "flagged" && q.resolution && (
            <p className="text-sm text-red-600 dark:text-red-400">
              {FLAG_LABEL[q.resolution as FlagReason] ?? (q.resolution === "resubmitted" ? "The setter fixed it and sent it back for review." : q.resolution)}
            </p>
          )}
          {q.admin_note && <p className="text-sm text-muted">Admin note: {q.admin_note}</p>}
        </section>

        <details className={card} open={q.uncategorised}>
          <summary className="cursor-pointer p-4 text-sm">
            {q.uncategorised ? (
              <span className="text-amber-700 dark:text-amber-400">
                Uncategorised{q.former_subtype && <> — its subtype {q.former_subtype} was deleted</>}. File it under a subtype.
              </span>
            ) : (
              <span className="text-accent">Move to another subtype</span>
            )}
          </summary>
          <ActionForm action={moveQuestionAction} className="flex flex-wrap items-end gap-2 border-t border-line p-4">
            <input type="hidden" name="question_id" value={q.id} />
            <select name="subtype_id" defaultValue={q.uncategorised ? "" : q.subtype_id} required className={`${select} max-w-md flex-1`} aria-label="Subtype">
              <option value="" disabled>Pick a subtype</option>
              {taxonomy.filter((c) => !c.system).map((c) => (
                <optgroup key={c.id} label={`${c.code}. ${c.name}`}>
                  {c.subtypes.map((s) => <option key={s.id} value={s.id}>{s.code} {s.name} ({s.verifiability})</option>)}
                </optgroup>
              ))}
            </select>
            <SubmitButton className={buttonSecondary}>Move</SubmitButton>
            <p className="w-full text-xs text-muted">
              It gets a new code for that subtype.{" "}
              {q.status === "written"
                ? "It takes the new subtype's verifiability."
                : `It keeps the verifiability it was checked under (${q.verifiability}).`}
            </p>
          </ActionForm>
        </details>

        <section className={`${card} overflow-x-auto`}>
          <h2 className="px-4 pt-4 font-medium">Checks</h2>
          {q.checks.length === 0 ? (
            <p className="p-4 text-sm text-muted">Not sent for checking yet.</p>
          ) : (
            <table className="mt-2 w-full text-sm">
              <thead>
                <tr>
                  <th className={th}>Checker</th>
                  <th className={th}>Blind answer</th>
                  <th className={th}>After seeing the answer</th>
                  <th className={`${th} text-right`}>Time</th>
                </tr>
              </thead>
              <tbody>
                {q.checks.map((c) => (
                  <tr key={c.id}>
                    <td className={td}>
                      {c.checker_name}
                      <div className="text-xs text-muted">{c.role ? ROLE[c.role] : "Waiting"}</div>
                    </td>
                    <td className={td}>{optionText(c.blind_choice, c.blind_note)}</td>
                    <td className={td}>
                      {c.judgment ? (
                        <>
                          {JUDGMENT[c.judgment]}
                          {c.odd_one && <span className="text-muted"> — odd one: {ODD[c.odd_one]}</span>}
                          {c.judgment_reason && <div className="text-xs text-muted">&ldquo;{c.judgment_reason}&rdquo;</div>}
                        </>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className={`${td} text-right text-xs tabular-nums text-muted`}>{seconds(c.opened_at, c.blind_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className={`${card} space-y-4 p-5`}>
          <h2 className="font-medium">Review</h2>
          <div className="flex flex-wrap gap-2">
            {["flagged", "returned", "checking"].includes(q.status) && (
              <ActionForm action={reviewAction}>
                <input type="hidden" name="question_id" value={q.id} />
                <input type="hidden" name="action" value="accept" />
                <SubmitButton className={buttonSecondary} confirm="Accept the setter's answer as it stands?">Accept as is</SubmitButton>
              </ActionForm>
            )}
            {q.status === "dropped" && (
              <ActionForm action={reviewAction}>
                <input type="hidden" name="question_id" value={q.id} />
                <input type="hidden" name="action" value="restore" />
                <SubmitButton className={buttonSecondary}>Restore</SubmitButton>
              </ActionForm>
            )}
          </div>
          {q.status === "dropped" && (
            <p className="text-sm text-muted">
              Dropped. The setter sees the reason on their dashboard and can fix it and send it back for review.
            </p>
          )}

          {q.status !== "dropped" && (
            <details>
              <summary className="cursor-pointer text-sm text-red-600 dark:text-red-400">Drop from the benchmark</summary>
              <ActionForm action={reviewAction} className="mt-2 space-y-2">
                <input type="hidden" name="question_id" value={q.id} />
                <input type="hidden" name="action" value="drop" />
                <textarea name="note" rows={2} className={input} placeholder="Why? The setter sees this and can fix it and resubmit." required />
                <SubmitButton className={buttonDanger}>Drop</SubmitButton>
              </ActionForm>
            </details>
          )}

          {q.status === "flagged" && (
            <details>
              <summary className="cursor-pointer text-sm text-accent">Send back to the setter</summary>
              <ActionForm action={reviewAction} className="mt-2 space-y-2">
                <input type="hidden" name="question_id" value={q.id} />
                <input type="hidden" name="action" value="send_back" />
                <textarea name="note" rows={2} className={input} placeholder="What should they change?" required />
                <SubmitButton className={buttonSecondary}>Send back</SubmitButton>
              </ActionForm>
            </details>
          )}

          {q.status !== "dropped" && (
            <details>
              <summary className="cursor-pointer text-sm text-accent">Fix the question or answer and accept it</summary>
              <ActionForm action={reviewAction} className="mt-2 space-y-2">
                <input type="hidden" name="question_id" value={q.id} />
                <input type="hidden" name="action" value="fix" />
                <label className={label}>Question</label>
                <textarea name="prompt" rows={2} defaultValue={q.prompt} className={input} />
                <span className={label}>Options — mark the correct one</span>
                {q.options.map((o, i) => (
                  <div key={o.id} className="flex items-center gap-2">
                    <input type="radio" name="correct" value={i} defaultChecked={o.id === q.correct_option} aria-label={`Option ${i + 1} is correct`} />
                    <input name="option" defaultValue={o.text} className={input} />
                  </div>
                ))}
                <input name="note" placeholder="Note (optional)" className={input} />
                <SubmitButton>Save fix and accept</SubmitButton>
              </ActionForm>
            </details>
          )}
        </section>

        <section className={`${card} space-y-4 p-5`}>
          <h2 className="font-medium">Model answers {q.in_sample && <span className="ml-1 rounded bg-accent/10 px-1.5 py-0.5 text-xs text-accent">in the model-check sample</span>}</h2>
          {latest.size > 0 && (
            <ul className="space-y-2 text-sm">
              {[...latest.values()].map((a) => (
                <li key={a.id} className="rounded-md border border-line p-2">
                  <div className="flex justify-between">
                    <b>{a.model}</b>
                    <span className="text-xs text-muted">{a.source} · {a.created_at.toLocaleString()}</span>
                  </div>
                  {a.error ? <p className="text-red-600 dark:text-red-400">{a.error}</p> : <p>{optionText(a.chosen_option, null)}</p>}
                  {a.raw_output && (
                    <details>
                      <summary className="cursor-pointer text-xs text-muted">Full reply</summary>
                      <pre className="mt-1 whitespace-pre-wrap text-xs">{a.raw_output}</pre>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          )}
          {models.length === 0 ? (
            <p className="text-sm text-muted">Add models on the <Link href="/admin/models" className="underline">Models</Link> page first.</p>
          ) : (
            <>
              {models.some((m) => m.api_ready) && (
                <ActionForm action={runModelAction} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="question_id" value={q.id} />
                  <select name="model_id" className={`${select} max-w-xs`} aria-label="Model">
                    {models.filter((m) => m.api_ready).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                  <SubmitButton className={buttonSecondary} pending="Asking the model…">Ask by API</SubmitButton>
                </ActionForm>
              )}
              <details>
                <summary className="cursor-pointer text-sm text-accent">Record an answer by hand</summary>
                <ActionForm action={manualModelAnswerAction} className="mt-2 space-y-2">
                  <input type="hidden" name="question_id" value={q.id} />
                  <input type="hidden" name="order" value={manualOrder.join(",")} />
                  <p className="text-xs text-muted">Give the model the image and this text (options in a fresh random order), then record its letter.</p>
                  <pre className="whitespace-pre-wrap rounded-md border border-line bg-background p-2 text-xs">{manualPrompt}</pre>
                  <div className="flex flex-wrap gap-2">
                    <select name="model_id" className={`${select} max-w-xs`} aria-label="Model">
                      {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                    <select name="chosen" className={`${select} max-w-[10rem]`} aria-label="Letter the model chose">
                      {manualOrder.map((oid, i) => <option key={oid} value={oid}>{LETTERS[i]}</option>)}
                    </select>
                  </div>
                  <textarea name="raw" rows={2} className={input} placeholder="Paste the model's reply (optional)" />
                  <SubmitButton className={buttonSecondary}>Record</SubmitButton>
                </ActionForm>
              </details>
            </>
          )}
        </section>

        {q.history.length > 0 && (
          <section className={`${card} p-5`}>
            <h2 className="mb-2 font-medium">History</h2>
            <ul className="space-y-1 text-xs text-muted">
              {q.history.map((h, i) => (
                <li key={i}>{h.created_at.toLocaleString()} · {h.actor ?? "system"} · {h.action}</li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
