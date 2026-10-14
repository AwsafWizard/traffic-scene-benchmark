import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import { getSessionUser } from "@/server/auth";
import { logoutAction } from "./actions/auth";
import { Logo } from "./ui/Logo";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "DhakaDrive-VQA",
  description: "Annotation platform for the DhakaDrive-VQA benchmark",
  robots: { index: false, follow: false },
};

const ANNOTATOR_NAV = [
  { href: "/", label: "Home" },
  { href: "/write", label: "Write" },
  { href: "/questions", label: "My questions" },
  { href: "/check", label: "Check" },
];

const ADMIN_NAV = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/sprints", label: "Sprints" },
  { href: "/admin/questions", label: "Questions" },
  { href: "/admin/annotators", label: "Annotators" },
  { href: "/admin/taxonomy", label: "Taxonomy" },
  { href: "/admin/models", label: "Models" },
  { href: "/admin/export", label: "Export" },
];

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const user = await getSessionUser();
  const nav = !user ? [] : user.role === "admin" ? ADMIN_NAV : ANNOTATOR_NAV;

  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        {user && (
          <header className="border-b border-line bg-surface">
            <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-1 px-6 py-3">
              <Link href={user.role === "admin" ? "/admin" : "/"} className="mr-4">
                <Logo />
              </Link>
              {nav.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-md px-3 py-1.5 text-sm text-muted transition hover:bg-background hover:text-foreground"
                >
                  {item.label}
                </Link>
              ))}
              <span className="ml-auto flex items-center gap-3 text-sm">
                {user.role === "admin" ? (
                  <Link href="/admin/account" className="text-muted hover:text-foreground">
                    {user.display_name}
                  </Link>
                ) : (
                  <span className="text-muted">{user.display_name}</span>
                )}
                <form action={logoutAction}>
                  <button type="submit" className="rounded-md border border-line px-2.5 py-1 text-xs hover:bg-background">
                    Sign out
                  </button>
                </form>
              </span>
            </nav>
          </header>
        )}
        <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
