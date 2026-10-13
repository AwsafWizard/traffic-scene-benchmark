import Link from "next/link";
import { requireAnnotator } from "@/server/auth";
import { myQueue } from "@/server/checks";
import { liveSprint } from "@/server/sprints";
import { Notice, PageHeader, Progress, VBadge } from "../ui/components";
import { button, card } from "../ui/styles";

export default async function CheckQueuePage({ searchParams }: PageProps<"/check">) {
  const user = await requireAnnotator();
  const { done: justFinished } = await searchParams;
  const sprint = await liveSprint();

  if (sprint?.status !== "verifying") {
    return (
      <>
        <PageHeader title="Check" />
        <Notice>There&apos;s nothing to check yet. Checking starts when the admin closes writing.</Notice>
      </>
    );
  }

  const { todo, done } = await myQueue(user.id);
  return (
    <>
      <PageHeader title="Check" sub={`${sprint.name} · ${done} done, ${todo.length} to go`} />
      <div className="space-y-4">
        <Progress value={done} max={done + todo.length} />
        {todo.length === 0 ? (
          <Notice tone="good">{justFinished !== undefined || done > 0 ? "All done — thank you!" : "Nothing assigned to you."}</Notice>
        ) : (
          <>
            <Link href={`/check/${todo[0].check_id}`} className={button}>
              {done === 0 ? "Start" : "Continue"}
            </Link>
            <ul className={`${card} divide-y divide-line`}>
              {todo.map((t) => (
                <li key={t.check_id} className="flex items-center gap-3 px-4 py-3 text-sm">
                  <VBadge v={t.verifiability} />
                  <span className="w-12 shrink-0 text-muted">{t.subtype_code}</span>
                  <span className="min-w-0 flex-1 truncate">{t.prompt}</span>
                  {t.step === "judgment" && <span className="text-xs text-amber-600">second step</span>}
                  <Link href={`/check/${t.check_id}`} className="text-accent">
                    Open
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </>
  );
}
