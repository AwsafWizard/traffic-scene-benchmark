/** Shared Tailwind class strings, so forms and buttons look the same everywhere. */

export const input =
  "w-full rounded-md border border-line bg-background px-3 py-2 text-sm outline-none focus:border-accent disabled:opacity-60";
export const select = input;
export const label = "mb-1.5 block text-sm font-medium";
export const hint = "mt-1 text-xs text-muted";
export const card = "rounded-xl border border-line bg-surface";
export const button =
  "inline-flex items-center justify-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50";
export const buttonSecondary =
  "inline-flex items-center justify-center rounded-md border border-line bg-surface px-3 py-1.5 text-sm transition hover:bg-background disabled:opacity-50";
export const buttonDanger =
  "inline-flex items-center justify-center rounded-md border border-red-500/40 px-3 py-1.5 text-sm text-red-600 transition hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400";
export const link = "text-accent hover:underline";
export const th = "px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted";
export const td = "border-t border-line px-3 py-2 align-top";
