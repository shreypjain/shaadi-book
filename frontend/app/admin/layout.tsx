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
    <div className="flex min-h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="w-52 shrink-0 border-r border-gray-200 bg-white flex flex-col">
        {/* Brand */}
        <div className="px-5 py-4 border-b border-gray-100">
          <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">
            Shaadi Book
          </p>
          <p className="text-base font-bold text-gray-800 mt-0.5">Admin</p>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="flex items-center rounded-md px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-gray-100">
          <Link
            href="/"
            className="text-xs text-gray-400 hover:text-gray-600"
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
