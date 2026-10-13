"use client";

import { useActionState } from "react";
import { loginAction } from "../actions/auth";
import SubmitButton from "../ui/SubmitButton";
import { button, card, input, label } from "../ui/styles";

export default function LoginForm() {
  const [state, action] = useActionState(loginAction, undefined);
  return (
    <form action={action} className={`${card} mt-6 space-y-4 p-6`}>
      <div>
        <label className={label} htmlFor="username">
          Username
        </label>
        <input id="username" name="username" autoComplete="username" required autoFocus className={input} />
      </div>
      <div>
        <label className={label} htmlFor="password">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className={input}
        />
      </div>
      {state?.error && <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>}
      <SubmitButton pending="Signing in…" className={`${button} w-full`}>
        Sign in
      </SubmitButton>
      <p className="text-center text-xs text-muted">Forgot your password? Ask the admin to reset it.</p>
    </form>
  );
}
