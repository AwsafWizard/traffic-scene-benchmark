"use client";

import { useActionState, useState, type ReactNode } from "react";
import type { AdminState } from "../actions/admin";

/**
 * A form wired to an admin action that reports back inline. When the action
 * returns a password, it's shown once with a copy button — it is never stored
 * in readable form and can't be shown again.
 */
export default function ActionForm({
  action,
  children,
  className,
}: {
  action: (state: AdminState, form: FormData) => Promise<AdminState>;
  children: ReactNode;
  className?: string;
}) {
  const [state, formAction] = useActionState(action, undefined);
  const [copied, setCopied] = useState(false);

  return (
    <form action={formAction} className={className}>
      {children}
      {state?.error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{state.error}</p>}
      {state?.ok && !state.secret && <p className="mt-2 text-sm text-emerald-700 dark:text-emerald-400">{state.ok}</p>}
      {state?.secret && (
        <div className="mt-3 space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <p className="font-medium">{state.ok} Copy the password now — it won&apos;t be shown again.</p>
          <div className="flex flex-wrap items-center gap-2 font-mono">
            <span>
              {state.secret.username} / <b>{state.secret.password}</b>
            </span>
            <button
              type="button"
              className="rounded border border-line bg-surface px-2 py-0.5 font-sans text-xs"
              onClick={async () => {
                await navigator.clipboard.writeText(`Username: ${state.secret!.username}\nPassword: ${state.secret!.password}`);
                setCopied(true);
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="text-xs text-muted">Hand it over privately, not in a group chat.</p>
        </div>
      )}
    </form>
  );
}
