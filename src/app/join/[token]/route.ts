import { NextResponse } from "next/server";
import { ROLE_COOKIE, getShareToken } from "@/lib/session";

/**
 * The link the benchmarker shares. Visiting it marks this browser as the
 * grounder and drops them straight into the queue.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  if (token !== getShareToken()) {
    return new NextResponse(
      "This grounding link is not valid any more. Ask for a fresh one.",
      { status: 403, headers: { "Content-Type": "text/plain" } },
    );
  }

  const response = NextResponse.redirect(new URL("/ground", request.url));
  response.cookies.set(ROLE_COOKIE, "grounder", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return response;
}
