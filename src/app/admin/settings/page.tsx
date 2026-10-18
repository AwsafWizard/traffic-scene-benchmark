import { redirect } from "next/navigation";
import { requireAdmin } from "@/server/auth";

export default async function SettingsPage() {
  await requireAdmin();
  redirect("/admin/annotators");
}
