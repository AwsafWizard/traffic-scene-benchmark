import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { getRole } from "@/lib/session";
import type { Comment, Question } from "@/lib/types";
import CommentThread from "../../CommentThread";
import GroundForm from "./GroundForm";

export const dynamic = "force-dynamic";

export default async function GroundPage({ params, searchParams }: PageProps<"/ground/[id]">) {
  const { id } = await params;
  const role = await getRole();
  const blind = "blind" in (await searchParams);
  const question = getDb().prepare("SELECT * FROM questions WHERE id = ?").get(id) as
    | Question
    | undefined;
  if (!question) notFound();

  // The grounder sees only their own notes — a setter comment could give away
  // the intended answer and defeat the point of answering blind.
  const comments = (
    role === "grounder"
      ? getDb()
          .prepare(
            "SELECT * FROM comments WHERE question_id = ? AND author_role = 'grounder' ORDER BY id",
          )
          .all(question.id)
      : getDb().prepare("SELECT * FROM comments WHERE question_id = ? ORDER BY id").all(question.id)
  ) as Comment[];

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {blind && (
        <p className="lg:col-span-2 rounded-xl border border-accent/30 bg-accent/10 p-4 text-sm text-accent">
          Your partner wrote this one, so you can still answer it cold. The answers stay hidden
          until you&apos;ve had your go.
        </p>
      )}
      <div className="lg:sticky lg:top-8 lg:self-start">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/image/${question.image_path}`}
          alt="Traffic scene"
          className="w-full rounded-xl border border-line bg-surface object-contain"
        />
      </div>
      <div className="space-y-6">
        <GroundForm question={question} isGrounder={role === "grounder"} />

        <section className="rounded-xl border border-line bg-surface p-5">
          <h2 className="text-sm font-medium">Something off about this question?</h2>
          <p className="mb-3 mt-1 text-xs text-muted">
            Blurry image, ambiguous wording, no right option — say so here. A question humans
            can&apos;t answer is a finding, not a failure.
          </p>
          <CommentThread
            questionId={question.id}
            comments={comments}
            role={role}
            placeholder="e.g. Can't tell from this angle whether the van is indicating."
          />
        </section>
      </div>
    </div>
  );
}
