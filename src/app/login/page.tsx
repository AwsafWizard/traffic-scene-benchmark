import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";
import LoginForm from "./LoginForm";
import { Logo } from "../ui/Logo";

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) redirect(user.role === "admin" ? "/admin" : "/");

  return (
    <div className="mx-auto mt-16 max-w-sm">
      <h1 className="flex justify-center">
        <Logo size="lg" />
      </h1>
      <p className="mt-3 text-center text-sm text-muted">Sign in with the account your admin gave you.</p>
      <LoginForm />
    </div>
  );
}
