import { NextResponse, type NextRequest } from "next/server";

/**
 * A quick first pass: no session cookie means straight to the login page. It
 * only looks at the cookie; every page and action still verifies the session
 * against the database itself.
 */
export function proxy(request: NextRequest) {
  const hasSession = Boolean(request.cookies.get("dvqa_session")?.value);
  const isLogin = request.nextUrl.pathname === "/login";
  if (!hasSession && !isLogin) return NextResponse.redirect(new URL("/login", request.url));
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|brand/).*)"],
};
