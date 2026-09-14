import { getDb } from "@/lib/db";
import { getRole } from "@/lib/session";
import { getSyncConfig } from "@/lib/sync";
import ImportForm from "./ImportForm";
import { SyncSettings } from "./SyncControls";
import SupabaseSetup from "./SupabaseSetup";

export const dynamic = "force-dynamic";

export default async function TransferPage() {
  const isGrounder = (await getRole()) === "grounder";
  const db = getDb();
  const sync = getSyncConfig();

  const questionCount = (
    db.prepare("SELECT COUNT(*) AS n FROM questions").get() as { n: number }
  ).n;
  const answerCount = (
    db.prepare("SELECT COUNT(*) AS n FROM human_responses").get() as { n: number }
  ).n;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Transfer</h1>
        <p className="mt-1 text-sm text-muted">
          Move questions and answers between two copies of this tool as a single{" "}
          <code className="rounded bg-foreground/5 px-1 py-0.5 font-mono text-xs">.json</code> file.
          Images travel inside the file, so there is nothing else to send.
        </p>
      </div>

      <section className="space-y-4 rounded-xl border border-line bg-surface p-5">
        <div>
          <h2 className="text-sm font-semibold">Automatic sync</h2>
          <p className="mt-1 text-sm text-muted">
            Both copies trade work through one shared place, so there are no files to pass by
            hand. Cloud sync needs nothing installed and keeps working while the other machine
            is asleep.
          </p>
        </div>
        <SyncSettings config={sync} />
        {!sync.supabaseConfigured && <SupabaseSetup />}
      </section>

      <section className="space-y-4 rounded-xl border border-line bg-surface p-5">
        <div>
          <h2 className="text-sm font-semibold">Export</h2>
          <p className="mt-1 text-sm text-muted">
            {isGrounder
              ? "Send your answers back to the benchmarker."
              : "Send the question set to your grounder, or take your own answers elsewhere."}
            {sync.mode !== "off" && " Sync already handles this — these are for one-off transfers."}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {!isGrounder && (
            <a
              href="/api/export?kind=questions"
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white"
            >
              Export {questionCount} question{questionCount === 1 ? "" : "s"}
            </a>
          )}
          <a
            href="/api/export?kind=responses"
            className="rounded-md border border-line px-4 py-2 text-sm transition hover:bg-background"
          >
            Export {answerCount} answer{answerCount === 1 ? "" : "s"}
          </a>
        </div>

        {!isGrounder && (
          <p className="rounded-md border border-line bg-background px-3 py-2 text-xs leading-relaxed text-muted">
            The question bundle deliberately leaves out your reference answers, notes, and all
            model responses — so handing it over can&apos;t spoil the grounding.
          </p>
        )}
      </section>

      <section className="space-y-4 rounded-xl border border-line bg-surface p-5">
        <div>
          <h2 className="text-sm font-semibold">Import</h2>
          <p className="mt-1 text-sm text-muted">
            {isGrounder
              ? "Load the question bundle you were sent, then answer the questions."
              : "Load a question bundle, or merge answers that came back from a grounder."}
          </p>
        </div>
        <ImportForm />
      </section>

      {!isGrounder && (
        <section className="rounded-xl border border-line bg-surface p-5 text-sm leading-relaxed text-muted">
          <p className="font-medium text-foreground">The round trip</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>You export the questions and send them the file.</li>
            <li>They import it into their own copy and answer everything.</li>
            <li>They export their answers and send that file back.</li>
            <li>You import it here — answers are matched up and scored automatically.</li>
          </ol>
          <p className="mt-3">
            Re-importing the same file changes nothing, so it&apos;s safe to do twice.
          </p>
        </section>
      )}
    </div>
  );
}
