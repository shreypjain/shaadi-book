/**
 * Admin layout — Task 4.3
 *
 * Clean sidebar navigation for all admin sections.
 * Not "use client" — the shell is a server component; individual pages
 * opt in to client rendering as needed.
 */

import type { ReactNode } from "react";
import Link from "next/link";

const NAV_LINKS = [
  { href: "/admin",             label: "Dashboard" },
  { href: "/admin/markets",     label: "Markets" },
  { href: "/admin/withdrawals", label: "Withdrawals" },
  { href: "/admin/users",       label: "Users" },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-cream-100">
      {/* Sidebar */}
      <aside className="w-52 shrink-0 border-r border-[#e8e4df] bg-white flex flex-col">
        {/* Brand */}
        <div className="px-5 py-4 border-b border-[#f0ece7]">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#8a8a9a]">
            Shaadi Book
          </p>
          <p className="text-base font-bold text-[#1e3a5f] mt-0.5">Admin</p>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="flex items-center rounded-lg px-3 py-2 text-sm text-[#4a4a5a] hover:bg-cream-100 hover:text-[#1a1a2e] transition-colors"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-[#f0ece7]">
          <Link
            href="/"
            className="text-xs text-[#8a8a9a] hover:text-[#4a4a5a]"
          >
            ← Back to app
          </Link>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto p-8">
        {children}
      </main>
    </div>
  );
}
