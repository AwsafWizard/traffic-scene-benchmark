import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import { getRole } from "@/lib/session";
import { getSyncConfig } from "@/lib/sync";
import { SyncPoller } from "./transfer/SyncControls";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Traffic Scene Benchmark",
  description: "Benchmark LLMs on traffic scene questions against human grounding",
};

const BENCHMARKER_NAV = [
  { href: "/", label: "Questions" },
  { href: "/setter", label: "Add question" },
  { href: "/ground", label: "Ground" },
  { href: "/results", label: "Results" },
  { href: "/models", label: "Models" },
  { href: "/transfer", label: "Transfer" },
  { href: "/share", label: "Share" },
];

const GROUNDER_NAV = [
  { href: "/ground", label: "Questions to answer" },
  { href: "/transfer", label: "Transfer" },
];

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const role = await getRole();
  const sync = getSyncConfig();
  const nav = role === "grounder" ? GROUNDER_NAV : BENCHMARKER_NAV;

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans">
        <header className="border-b border-line bg-surface">
          <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-1 px-6 py-3">
            <span className="mr-4 text-sm font-semibold tracking-tight">
              Traffic Scene Benchmark
            </span>
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-md px-3 py-1.5 text-sm text-muted transition hover:bg-background hover:text-foreground"
              >
                {item.label}
              </Link>
            ))}
            {role === "grounder" && (
              <span className="ml-auto rounded-md border border-accent/30 bg-accent/10 px-2.5 py-1 text-xs text-accent">
                Grounding mode
              </span>
            )}
          </nav>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</main>
        {sync.enabled && <SyncPoller />}
      </body>
    </html>
  );
}
