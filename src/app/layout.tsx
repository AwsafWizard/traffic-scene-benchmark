import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { getSessionUser } from "@/server/auth";
import NavBar from "./ui/NavBar";
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
          <NavBar
            nav={nav}
            homeHref={user.role === "admin" ? "/admin" : "/"}
            displayName={user.display_name}
            accountHref={user.role === "admin" ? "/admin/account" : undefined}
          />
        )}
        <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
