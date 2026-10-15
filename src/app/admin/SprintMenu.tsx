"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { StatusBadge } from "../ui/components";

export interface SprintOption {
  id: number;
  name: string;
  status: string;
  questions: number;
}

/**
 * Dropdown for scoping an admin view to one sprint or all of them. Live sprints
 * (writing or verifying) are listed first; a filter box appears once the list
 * gets long.
 */
export default function SprintMenu({
  sprints,
  value,
  hrefs,
}: {
  sprints: SprintOption[];
  value: string;
  hrefs: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = sprints.find((s) => String(s.id) === value);
  const live = (s: SprintOption) => s.status === "writing" || s.status === "verifying";
  const ordered = [...sprints.filter(live), ...sprints.filter((s) => !live(s))];
  const shown = filter ? ordered.filter((s) => s.name.toLowerCase().includes(filter.toLowerCase())) : ordered;

  const row = (active: boolean) =>
    `flex items-center gap-3 rounded-md px-2.5 py-2 text-sm transition ${active ? "bg-accent/10" : "hover:bg-background"}`;
  const check = (active: boolean) => (
    <span className={`w-3 text-accent ${active ? "" : "invisible"}`} aria-hidden>
      ✓
    </span>
  );

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-1.5 text-sm transition hover:bg-background"
      >
        <span className="text-muted">Sprint</span>
        <span className="font-medium">{current?.name ?? "All sprints"}</span>
        {current && <StatusBadge status={current.status} />}
        <svg viewBox="0 0 16 16" className={`size-3.5 text-muted transition ${open ? "rotate-180" : ""}`} aria-hidden>
          <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1.5 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-line bg-surface p-1.5 shadow-lg shadow-black/10"
        >
          {sprints.length > 6 && (
            <input
              autoFocus
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Find a sprint…"
              className="mb-1.5 w-full rounded-md border border-line bg-background px-2.5 py-1.5 text-sm outline-none focus:border-accent"
            />
          )}
          <div className="max-h-80 overflow-y-auto">
            {shown.map((s) => {
              const active = String(s.id) === value;
              return (
                <Link key={s.id} href={hrefs[s.id]} role="menuitem" onClick={() => setOpen(false)} className={row(active)}>
                  {check(active)}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{s.name}</span>
                    <span className="block text-xs text-muted">
                      {s.questions} question{s.questions === 1 ? "" : "s"}
                    </span>
                  </span>
                  <StatusBadge status={s.status} />
                </Link>
              );
            })}
            {shown.length === 0 && <p className="px-2.5 py-2 text-sm text-muted">No sprint matches.</p>}
          </div>
          <div className="mt-1.5 border-t border-line pt-1.5">
            <Link href={hrefs.all} role="menuitem" onClick={() => setOpen(false)} className={row(value === "all")}>
              {check(value === "all")}
              <span className="flex-1 font-medium">All sprints</span>
              <span className="text-xs text-muted">{sprints.length} total</span>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
