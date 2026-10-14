import Link from "next/link";
import { requireAnnotator } from "@/server/auth";
import { listMyQuestions, setterCanEdit } from "@/server/questions";
import { imageSrc } from "@/server/storage";
import { Notice, PageHeader, StatusBadge, VBadge } from "../ui/components";
import { buttonSecondary, card } from "../ui/styles";

export default async function MyQuestionsPage({ searchParams }: PageProps<"/questions">) {
  const user = await requireAnnotator();
  const { status } = await searchParams;
  const all = await listMyQuestions(user.id);
  const questions = status ? all.filter((q) => q.status === status) : all;

  return (
    <>
      <PageHeader
        title="My questions"
        sub={`${all.length} written`}
        actions={
          status ? (
            <Link href="/questions" className={buttonSecondary}>
              Show all
            </Link>
          ) : undefined
        }
      />
      {questions.length === 0 ? (
        <Notice>No questions here yet.</Notice>
      ) : (
        <ul className="space-y-3">
          {questions.map((q) => {
            const editable = setterCanEdit(q.status, q.sprint_status);
            const toFix = q.status === "returned" || q.status === "dropped";
            return (
              <li key={q.id} className={`${card} flex gap-4 p-4`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageSrc(q.image, 300)} alt="" className="h-20 w-28 shrink-0 rounded object-cover" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                    <StatusBadge status={q.status} />
                    <VBadge v={q.verifiability} />
                    <span className="font-mono text-foreground">{q.code}</span>
                    <span>{q.subtype_name}</span>
                    <span>· {q.sprint_name}</span>
                  </div>
                  <p className="text-sm">{q.prompt}</p>
                  {toFix && q.admin_note && (
                    <p className="rounded-md bg-amber-500/10 px-2 py-1 text-sm text-amber-700 dark:text-amber-400">
                      {q.status === "dropped" ? "Dropped: " : "Admin: "}
                      {q.admin_note}
                    </p>
                  )}
                </div>
                {editable && (
                  <Link href={`/questions/${q.id}`} className={`${buttonSecondary} self-start`}>
                    {toFix ? "Fix" : "Edit"}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
