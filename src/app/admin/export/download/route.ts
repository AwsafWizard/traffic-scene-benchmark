import { audit } from "@/server/audit";
import { getSessionUser } from "@/server/auth";
import { exportRecords, toCsv } from "@/server/export";

/** Admin-only dataset download. GET only; it changes nothing except the audit log. */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user || user.role !== "admin") return new Response("Not found", { status: 404 });

  const params = new URL(request.url).searchParams;
  const format = params.get("format") === "csv" ? "csv" : "json";
  const sprint = Number(params.get("sprint"));
  const status = params.get("status") ?? "";
  const allowed = ["", "accepted", "flagged", "checking", "written", "returned", "dropped"];
  if (!allowed.includes(status)) return new Response("Bad status", { status: 400 });

  const records = await exportRecords({ sprintId: Number.isInteger(sprint) && sprint > 0 ? sprint : null, status: status || undefined });
  await audit(user.id, "export", null, { format, sprint: sprint || "all", status: status || "all but dropped", count: records.length });

  const stamp = new Date().toISOString().slice(0, 10);
  const name = `dhakavqa-${sprint > 0 ? `sprint${sprint}` : "all"}${status ? `-${status}` : ""}-${stamp}.${format}`;
  const body = format === "csv" ? "﻿" + toCsv(records) : JSON.stringify({ exported_at: new Date().toISOString(), count: records.length, questions: records }, null, 2);
  return new Response(body, {
    headers: {
      "Content-Type": format === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
