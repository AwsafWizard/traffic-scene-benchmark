import { NextResponse } from "next/server";
import { ROLE_COOKIE, setInstallRole } from "@/lib/session";
import type { Role } from "@/lib/types";

/**
 * Sets what this whole copy of the app is used for. Anyone can change it — the
 * role exists to keep the grounder from stumbling onto answers, not to lock
 * someone out of their own install.
 */
export async function PUT(request: Request) {
  const body = (await request.json()) as { role?: Role };
  if (body.role !== "benchmarker" && body.role !== "grounder") {
    return NextResponse.json({ error: "Unknown role" }, { status: 400 });
  }

  setInstallRole(body.role);

  // A per-browser cookie would otherwise keep overriding the new setting.
  const response = NextResponse.json({ role: body.role });
  response.cookies.delete(ROLE_COOKIE);
  return response;
}
