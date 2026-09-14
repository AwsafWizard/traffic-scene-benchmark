import { NextResponse } from "next/server";
import { setInstallRole } from "@/lib/session";
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
  return NextResponse.json({ role: body.role });
}
