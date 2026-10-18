import { listSprints } from "@/server/sprints";
import SprintMenu, { type SprintOption } from "./SprintMenu";

/**
 * Most admin views can be scoped to one sprint or all of them, via ?sprint=.
 * Defaults to the live sprint, else the most recent one.
 */
export async function resolveScope(param: string | string[] | undefined) {
  const sprints = await listSprints();
  const value = Array.isArray(param) ? param[0] : param;
  if (value === "all") return { sprints, sprintId: null as number | null, value: "all" };
  const chosen =
    sprints.find((s) => String(s.id) === value) ??
    sprints.find((s) => s.status === "writing" || s.status === "verifying") ??
    sprints[0];
  return { sprints, sprintId: chosen?.id ?? null, value: chosen ? String(chosen.id) : "all" };
}

export function ScopePicker({
  path,
  sprints,
  value,
  extra = {},
}: {
  path: string;
  sprints: SprintOption[];
  value: string;
  extra?: Record<string, string>;
}) {
  const href = (sprint: string) => `${path}?${new URLSearchParams({ ...extra, sprint }).toString()}`;
  const hrefs = Object.fromEntries([...sprints.map((s) => [s.id, href(String(s.id))]), ["all", href("all")]]);
  const options = sprints.map(({ id, name, status, questions }) => ({ id, name, status, questions }));
  return <SprintMenu sprints={options} value={value} hrefs={hrefs} />;
}
