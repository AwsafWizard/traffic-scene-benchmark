import { NextResponse } from "next/server";
import { ROLE_COOKIE, isGrounder, rotateShareToken } from "@/lib/session";

export async function POST() {
  if (await isGrounder()) {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }
  return NextResponse.json({ token: rotateShareToken() });
}

/** Clears grounder mode on this browser. */
export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(ROLE_COOKIE);
  return response;
}
