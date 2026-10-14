"use client";

import Link from "next/link";
import { useState } from "react";
import { logoutAction } from "../actions/auth";
import { Logo } from "./Logo";

type NavItem = { href: string; label: string };

/**
 * The top bar. On wide screens the links sit in a row; on phones they fold
 * into a menu behind a hamburger button.
 */
export default function NavBar({
  nav,
  homeHref,
  displayName,
  accountHref,
}: {
  nav: NavItem[];
  homeHref: string;
  displayName: string;
  accountHref?: string;
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  const name = accountHref ? (
    <Link href={accountHref} onClick={close} className="text-muted hover:text-foreground">
      {displayName}
    </Link>
  ) : (
    <span className="text-muted">{displayName}</span>
  );
  const signOut = (
    <form action={logoutAction}>
      <button type="submit" className="rounded-md border border-line px-2.5 py-1 text-xs hover:bg-background">
        Sign out
      </button>
    </form>
  );

  return (
    <header className="border-b border-line bg-surface">
      <nav className="mx-auto flex max-w-6xl items-center gap-1 px-6 py-3">
        <Link href={homeHref} onClick={close} className="mr-4">
          <Logo />
        </Link>
        <div className="hidden flex-wrap items-center gap-1 md:flex">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-3 py-1.5 text-sm text-muted transition hover:bg-background hover:text-foreground"
            >
              {item.label}
            </Link>
          ))}
        </div>
        <span className="ml-auto hidden items-center gap-3 text-sm md:flex">
          {name}
          {signOut}
        </span>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="mobile-nav"
          aria-label={open ? "Close menu" : "Open menu"}
          className="ml-auto rounded-md p-2 text-muted hover:bg-background hover:text-foreground md:hidden"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
        </button>
      </nav>
      {open && (
        <div id="mobile-nav" className="border-t border-line px-6 py-3 md:hidden">
          <div className="flex flex-col gap-1">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={close}
                className="rounded-md px-3 py-2 text-sm text-muted transition hover:bg-background hover:text-foreground"
              >
                {item.label}
              </Link>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between gap-3 border-t border-line px-3 pt-3 text-sm">
            {name}
            {signOut}
          </div>
        </div>
      )}
    </header>
  );
}
