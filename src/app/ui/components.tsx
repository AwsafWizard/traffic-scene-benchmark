import type { ReactNode } from "react";

const V_STYLE: Record<string, string> = {
  V: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  C: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  I: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
};
const V_NAME: Record<string, string> = { V: "Verifiable", C: "Consensus", I: "Inferential" };

export function VBadge({ v, long = false }: { v: string; long?: boolean }) {
  return (
    <span
      title={V_NAME[v]}
      className={`inline-block rounded border px-1.5 py-0.5 text-xs font-semibold ${V_STYLE[v] ?? ""}`}
    >
      {long ? `${v} · ${V_NAME[v]}` : v}
    </span>
  );
}

const STATUS_STYLE: Record<string, string> = {
  written: "border-line text-muted",
  checking: "border-accent/30 bg-accent/10 text-accent",
  accepted: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  flagged: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
  returned: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  dropped: "border-line text-muted line-through",
  setup: "border-line text-muted",
  writing: "border-accent/30 bg-accent/10 text-accent",
  verifying: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  closed: "border-line text-muted",
};
const STATUS_LABEL: Record<string, string> = {
  written: "Written",
  checking: "Being checked",
  accepted: "Accepted",
  flagged: "Flagged",
  returned: "Sent back",
  dropped: "Dropped",
  setup: "Setting up",
  writing: "Writing",
  verifying: "Verifying",
  closed: "Closed",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-block rounded border px-1.5 py-0.5 text-xs font-medium ${STATUS_STYLE[status] ?? ""}`}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

export function PageHeader({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "good" | "warn" | "bad"; children: ReactNode }) {
  const style = {
    info: "border-accent/30 bg-accent/10 text-accent",
    good: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    warn: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
    bad: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
  }[tone];
  return <div className={`rounded-lg border px-4 py-3 text-sm ${style}`}>{children}</div>;
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function Progress({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-background" aria-label={`${value} of ${max}`}>
      <div className={`h-full ${pct >= 100 ? "bg-emerald-500" : "bg-accent"}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function pct(n: number, d: number): string {
  return d === 0 ? "—" : `${Math.round((n / d) * 100)}%`;
}
