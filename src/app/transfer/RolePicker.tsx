"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Role } from "@/lib/types";

const OPTIONS: { value: Role; label: string; hint: string }[] = [
  {
    value: "benchmarker",
    label: "Setter",
    hint: "Writes the questions, runs the models, grades the answers.",
  },
  {
    value: "grounder",
    label: "Grounder",
    hint: "Answers questions blind. Reference answers, model answers and results stay hidden.",
  },
];

export default function RolePicker({ role }: { role: Role }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function choose(next: Role) {
    if (next === role) return;
    setBusy(true);
    await fetch("/api/role", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: next }),
    });
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="space-y-2">
      {OPTIONS.map((option) => (
        <label
          key={option.value}
          className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition ${
            role === option.value ? "border-accent bg-accent/5" : "border-line hover:bg-background"
          }`}
        >
          <input
            type="radio"
            name="install-role"
            checked={role === option.value}
            onChange={() => choose(option.value)}
            disabled={busy}
            className="mt-0.5 size-4 accent-[var(--accent)]"
          />
          <span className="min-w-0">
            <span className="block text-sm font-medium">{option.label}</span>
            <span className="block text-xs text-muted">{option.hint}</span>
          </span>
        </label>
      ))}
    </div>
  );
}
