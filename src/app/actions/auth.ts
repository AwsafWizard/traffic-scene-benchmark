"use server";

import { redirect } from "next/navigation";
import { login, logout } from "@/server/auth";

export type FormState = { error?: string; ok?: string } | undefined;

export async function loginAction(_prev: FormState, form: FormData): Promise<FormState> {
  const username = String(form.get("username") ?? "");
  const password = String(form.get("password") ?? "");
  if (!username || !password) return { error: "Enter your username and password." };
  const result = await login(username, password);
  if (!result.ok) return { error: result.error };
  redirect(result.role === "admin" ? "/admin" : "/");
}

export async function logoutAction(): Promise<void> {
  await logout();
  redirect("/login");
}
