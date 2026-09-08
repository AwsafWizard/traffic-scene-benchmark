"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { errorMessage } from "@/lib/fetch-error";
import type { Comment, Role } from "@/lib/types";

const ROLE_LABEL: Record<Role, string> = {
  benchmarker: "Setter",
  grounder: "Grounder",
};

export default function CommentThread({
  questionId,
  comments,
  role,
  placeholder,
  authorName,
}: {
  questionId: number;
  comments: Comment[];
  role: Role;
  placeholder: string;
  /** Grounders sign their note with the name they answer under. */
  authorName?: string;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    setError(null);

    const response = await fetch("/api/comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question_id: questionId, body, author_name: authorName }),
    });
    setBusy(false);

    if (!response.ok) {
      setError(await errorMessage(response, "Could not save the comment"));
      return;
    }
    setBody("");
    router.refresh();
  }

  async function remove(id: number) {
    await fetch(`/api/comments?id=${id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <div className="space-y-3">
      {comments.map((comment) => (
        <div key={comment.id} className="rounded-lg border border-line bg-background p-3">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[10px] uppercase tracking-wide text-muted">
              {ROLE_LABEL[comment.author_role]}
              {comment.author_name && ` · ${comment.author_name}`}
            </p>
            {(role !== "grounder" || comment.author_role === "grounder") && (
              <button
                onClick={() => remove(comment.id)}
                className="text-[10px] text-muted transition hover:text-red-500"
              >
                Delete
              </button>
            )}
          </div>
          <p className="mt-1 whitespace-pre-wrap text-sm">{comment.body}</p>
        </div>
      ))}

      <form onSubmit={add} className="space-y-2">
        <textarea
          rows={2}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm outline-none focus:border-accent"
        />
        {error && <p className="text-xs text-red-500">{error}</p>}
        <button
          type="submit"
          disabled={busy || !body.trim()}
          className="rounded-md border border-line px-3 py-1.5 text-xs transition hover:bg-background disabled:opacity-50"
        >
          {busy ? "Saving…" : "Add comment"}
        </button>
      </form>
    </div>
  );
}
