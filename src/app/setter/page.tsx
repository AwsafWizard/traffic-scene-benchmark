import { requireBenchmarkerPage } from "@/lib/session";
import SetterForm from "./SetterForm";

export const dynamic = "force-dynamic";

export default async function SetterPage() {
  await requireBenchmarkerPage();
  return <SetterForm />;
}
