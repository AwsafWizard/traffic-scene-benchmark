import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import type { Comment, Grade, HumanResponse, LlmRun, Question, RunTurn } from "@/lib/types";
import CommentThread from "../../CommentThread";
import { requireBenchmarkerPage } from "@/lib/session";
import {
  DeleteQuestionButton,
  FollowUpThread,
  ManualAnswerForm,
  RunModelsButton,
  VerdictPicker,
} from "./RevealControls";

export const dynamic = "force-dynamic";

type Run = LlmRun & { model_label: string | null; provider: string | null };

export default async function RevealPage({ params }: PageProps<"/reveal/[id]">) {
  await requireBenchmarkerPage();

  const { id } = await params;
  const db = getDb();

  const question = db.prepare("SELECT * FROM questions WHERE id = ?").get(id) as
    | Question
    | undefined;
  if (!question) notFound();

  const humans = db
    .prepare("SELECT * FROM human_responses WHERE question_id = ? ORDER BY id")
    .all(id) as HumanResponse[];

  const runs = db
    .prepare(
      `SELECT r.*, m.label AS model_label, m.provider
       FROM llm_runs r LEFT JOIN models m ON m.key = r.model_key
       WHERE r.question_id = ? ORDER BY r.id`,
    )
    .all(id) as Run[];

  const grades = db
    .prepare(
      `SELECT * FROM grades WHERE (target_type = 'llm' AND target_id IN
         (SELECT id FROM llm_runs WHERE question_id = ?))
        OR (target_type = 'human' AND target_id IN
         (SELECT id FROM human_responses WHERE question_id = ?))`,
    )
    .all(id, id) as Grade[];

  const comments = db
    .prepare("SELECT * FROM comments WHERE question_id = ? ORDER BY id")
    .all(id) as Comment[];

  const models = db
    .prepare("SELECT key, label, provider FROM models ORDER BY provider = 'manual' DESC, label")
    .all() as { key: string; label: string; provider: string }[];

  const verdictOf = (type: "human" | "llm", targetId: number) =>
    grades.find((g) => g.target_type === type && g.target_id === targetId)?.verdict ?? null;

  // Re-running a question appends rows; show only each model's most recent answer.
  const latest = new Map<string, Run>();
  for (const run of runs) latest.set(run.model_key, run);
  const latestRuns = [...latest.values()];

  const turnsByRun = new Map<number, RunTurn[]>();
  if (latestRuns.length) {
    const rows = db
      .prepare(
        `SELECT * FROM run_turns
         WHERE run_id IN (${latestRuns.map(() => "?").join(",")})
         ORDER BY id`,
      )
      .all(...latestRuns.map((r) => r.id)) as RunTurn[];
    for (const turn of rows) {
      const list = turnsByRun.get(turn.run_id) ?? [];
      list.push(turn);
      turnsByRun.set(turn.run_id, list);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <div className="space-y-4 lg:sticky lg:top-8 lg:self-start">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/image/${question.image_path}`}
          alt="Traffic scene"
          className="w-full rounded-xl border border-line bg-surface object-contain"
        />
        <div className="rounded-xl border border-line bg-surface p-4">
          <p className="text-sm leading-relaxed">{question.prompt}</p>
          <p className="mt-3 text-xs text-muted">
            {question.category} ·{" "}
            {question.answer_type === "mcq" ? "multiple choice" : "free text"}
          </p>
          {question.reference_answer && (
            <p className="mt-3 rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-600 dark:text-emerald-400">
              <span className="font-medium">Reference:</span> {question.reference_answer}
            </p>
          )}
          {question.notes && <p className="mt-3 text-xs text-muted">{question.notes}</p>}
          <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
            <Link href={`/ground/${question.id}`} className="text-xs text-accent">
              Add another grounder
            </Link>
            <DeleteQuestionButton questionId={question.id} />
          </div>
        </div>
      </div>

      <div className="space-y-6">
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
            Human grounding
          </h2>
          {humans.length === 0 ? (
            <p className="rounded-xl border border-line bg-surface p-4 text-sm text-muted">
              No human answer yet.{" "}
              <Link href={`/ground/${question.id}`} className="text-accent">
                Answer it first
              </Link>{" "}
              — that&apos;s the baseline everything else is measured against.
            </p>
          ) : (
            humans.map((h) => (
              <div
                key={h.id}
                className="flex items-start justify-between gap-3 rounded-xl border border-line bg-surface p-4"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">{h.answer}</p>
                  {h.rationale && <p className="mt-1 text-sm text-muted">{h.rationale}</p>}
                  <p className="mt-2 text-xs text-muted">
                    {h.grounder_name}
                    {h.confidence != null && ` · confidence ${h.confidence}/5`}
                    {h.duration_ms != null && ` · ${(h.duration_ms / 1000).toFixed(1)}s`}
                  </p>
                </div>
                <VerdictPicker
                  targetType="human"
                  targetId={h.id}
                  current={verdictOf("human", h.id)}
                />
              </div>
            ))
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
            Comments
            {comments.some((c) => c.author_role === "grounder") && (
              <span className="ml-2 rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] normal-case tracking-normal text-amber-600">
                grounder flagged this
              </span>
            )}
          </h2>
          <div className="rounded-xl border border-line bg-surface p-4">
            <CommentThread
              questionId={question.id}
              comments={comments}
              role="benchmarker"
              placeholder="Notes on this question — is it worth keeping, does it need rewriting?"
            />
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
              Model answers
            </h2>
            <RunModelsButton questionId={question.id} hasRuns={latestRuns.length > 0} />
          </div>

          {latestRuns.length === 0 && (
            <p className="rounded-xl border border-line bg-surface p-4 text-sm text-muted">
              No model runs yet.
            </p>
          )}

          {latestRuns.map((run) => (
            <div
              key={run.id}
              className="flex items-start justify-between gap-3 rounded-xl border border-line bg-surface p-4"
            >
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-muted">
                  {run.model_label ?? run.model_key}
                  {run.latency_ms != null && ` · ${(run.latency_ms / 1000).toFixed(1)}s`}
                  {run.source === "manual" && (
                    <span className="ml-2 rounded border border-line px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
                      pasted
                    </span>
                  )}
                </p>
                {run.error ? (
                  <p className="mt-1 text-sm text-red-500">{run.error}</p>
                ) : (
                  <>
                    <p className="mt-1 text-sm font-medium">{run.answer}</p>
                    {run.reasoning && <p className="mt-1 text-sm text-muted">{run.reasoning}</p>}
                    <FollowUpThread
                      runId={run.id}
                      isManual={run.provider === "manual"}
                      turns={turnsByRun.get(run.id) ?? []}
                    />
                  </>
                )}
              </div>
              {!run.error && (
                <VerdictPicker targetType="llm" targetId={run.id} current={verdictOf("llm", run.id)} />
              )}
            </div>
          ))}

          <ManualAnswerForm questionId={question.id} models={models} />
        </section>
      </div>
    </div>
  );
}
