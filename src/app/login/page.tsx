import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";
import LoginForm from "./LoginForm";

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) redirect(user.role === "admin" ? "/admin" : "/");

  return (
    <div className="mx-auto mt-16 max-w-sm">
      <h1 className="text-center text-xl font-semibold">DhakaDrive-VQA</h1>
      <p className="mt-1 text-center text-sm text-muted">Sign in with the account your admin gave you.</p>
      <LoginForm />
    </div>
  );
}
