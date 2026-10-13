import Link from "next/link";
import { requireAnnotator } from "@/server/auth";
import { myQueue } from "@/server/checks";
import { sql } from "@/server/db";
import { myTopics } from "@/server/questions";
import { Notice, PageHeader, Progress, StatusBadge } from "./ui/components";
import { button, buttonSecondary, card } from "./ui/styles";

export default async function Home() {
  const user = await requireAnnotator();
  const { sprint, topics } = await myTopics(user.id);
  const queue = sprint?.status === "verifying" ? await myQueue(user.id) : null;
  const [{ returned }] = await sql<{ returned: number }[]>`
    select count(*)::int as returned from questions where author_id = ${user.id} and status = 'returned'`;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Hello, ${user.display_name}`}
        sub={sprint ? <>Current sprint: <b>{sprint.name}</b> <StatusBadge status={sprint.status} /></> : undefined}
      />

      {returned > 0 && (
        <Notice tone="warn">
          The admin sent back {returned} of your questions to fix.{" "}
          <Link href="/questions?status=returned" className="underline">
            See what to change
          </Link>
        </Notice>
      )}

      {!sprint && <Notice>No sprint is running right now. Your admin will start one.</Notice>}

      {sprint?.status === "writing" && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Your topics</h2>
          {topics.length === 0 ? (
            <Notice>You don&apos;t have a topic in this sprint yet.</Notice>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {topics.map((t) => (
                <div key={t.id} className={`${card} space-y-3 p-4`}>
                  <div>
                    <div className="text-xs text-muted">Type {t.category_code}</div>
                    <div className="font-medium">
                      {t.subtype_id ? `${t.subtype_code} ${t.subtype_name}` : `${t.category_code}. ${t.category_name} (whole type)`}
                    </div>
                  </div>
                  <Progress value={t.written} max={t.target} />
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted">
                      {t.written} of {t.target} written
                    </span>
                    <Link href={`/write?topic=${t.id}`} className={button}>
                      Write
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {sprint?.status === "verifying" && queue && (
        <section className={`${card} space-y-3 p-5`}>
          <h2 className="font-medium">Checking</h2>
          {queue.todo.length === 0 ? (
            <p className="text-sm text-muted">
              {queue.done > 0 ? `All done — you've checked ${queue.done} questions. Thanks!` : "Nothing to check right now."}
            </p>
          ) : (
            <>
              <p className="text-sm text-muted">
                {queue.todo.length} to go · {queue.done} done
              </p>
              <Progress value={queue.done} max={queue.done + queue.todo.length} />
              <Link href={`/check/${queue.todo[0].check_id}`} className={button}>
                {queue.done === 0 ? "Start checking" : "Continue"}
              </Link>
            </>
          )}
        </section>
      )}

      <div className="flex gap-2">
        <Link href="/questions" className={buttonSecondary}>
          My questions
        </Link>
      </div>
    </div>
  );
}
