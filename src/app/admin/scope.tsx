import Link from "next/link";
import { listSprints } from "@/server/sprints";

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
  sprints: { id: number; name: string }[];
  value: string;
  extra?: Record<string, string>;
}) {
  const href = (sprint: string) => `${path}?${new URLSearchParams({ ...extra, sprint }).toString()}`;
  const pill = (active: boolean) =>
    `rounded-full border px-3 py-1 text-xs transition ${active ? "border-accent bg-accent text-white" : "border-line hover:bg-background"}`;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {sprints.map((s) => (
        <Link key={s.id} href={href(String(s.id))} className={pill(value === String(s.id))}>
          {s.name}
        </Link>
      ))}
      <Link href={href("all")} className={pill(value === "all")}>
        All sprints
      </Link>
    </div>
  );
}
