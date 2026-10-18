"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/admin/annotators", label: "Annotators" },
  { href: "/admin/videos", label: "Videos" },
  { href: "/admin/models", label: "Models" },
  { href: "/admin/taxonomy", label: "Taxonomy" },
  { href: "/admin/account", label: "Account" },
];

/** The tab row across the top of every settings page. */
export default function SettingsTabs() {
  const path = usePathname();
  return (
    <div className="mb-6">
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Settings</div>
      {/* The baseline is an inset shadow, not a border, so the underlined tab sits on it without overflowing. */}
      <nav className="flex gap-1 overflow-x-auto shadow-[inset_0_-1px_0_var(--color-line)]" aria-label="Settings">
        {TABS.map((tab) => {
          const on = path === tab.href || path.startsWith(`${tab.href}/`);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={on ? "page" : undefined}
              className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm transition ${
                on ? "border-accent font-medium text-foreground" : "border-transparent text-muted hover:text-foreground"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
