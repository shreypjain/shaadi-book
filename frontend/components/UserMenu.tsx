"use client";

/**
 * UserMenu — floating user chip + logout button.
 *
 * Renders a small user avatar with first name in the top-right corner
 * on all authenticated pages. Tapping it reveals a logout option.
 * Hidden on /login.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { getStoredUser, logout } from "@/lib/auth";
import type { StoredUser } from "@/lib/auth";

export function UserMenu() {
  const pathname = usePathname();
  const router = useRouter();

  const [user, setUser] = useState<StoredUser | null>(null);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Read stored user on mount (localStorage is browser-only)
  useEffect(() => {
    setUser(getStoredUser());
  }, []);

  // Close popover when clicking outside
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const handleLogout = useCallback(() => {
    logout();
    setOpen(false);
    router.push("/login");
  }, [router]);

  // Don't render on /login or when no user is found
  if (pathname === "/login" || !user) return null;

  const initials = user.name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  const firstName = user.name.split(" ")[0] ?? user.name;

  return (
    <div
      ref={menuRef}
      className="fixed top-3 right-3 z-50"
    >
      {/* Avatar button */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="User menu"
        aria-expanded={open}
        className="flex items-center gap-2 bg-white/90 backdrop-blur border border-brand-100
                   rounded-full pl-1.5 pr-3 py-1.5 shadow-sm shadow-brand-100/30
                   hover:bg-brand-50 active:scale-95 transition-all"
      >
        {/* Avatar circle */}
        <div
          className="w-7 h-7 rounded-full bg-brand-600 flex items-center justify-center
                     text-white text-[11px] font-bold flex-shrink-0"
          aria-hidden
        >
          {initials}
        </div>
        <span className="text-xs font-semibold text-gray-700 max-w-[80px] truncate">
          {firstName}
        </span>
        {/* Chevron */}
        <svg
          className={`w-3 h-3 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2.5}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {/* Popover */}
      {open && (
        <div
          className="absolute right-0 top-full mt-2 w-52 bg-white rounded-2xl
                     border border-gray-100 shadow-xl shadow-gray-200/60
                     animate-slide-up overflow-hidden"
          role="menu"
        >
          {/* User info */}
          <div className="px-4 py-3 border-b border-gray-50">
            <p className="text-sm font-semibold text-gray-800 truncate">
              {user.name}
            </p>
            <p className="text-xs text-gray-400 truncate mt-0.5">{user.phone}</p>
            {user.role === "admin" && (
              <span
                className="inline-block mt-1 text-[10px] font-bold uppercase tracking-wider
                           bg-amber-100 text-amber-700 rounded-full px-2 py-0.5"
              >
                Admin
              </span>
            )}
          </div>

          {/* Logout */}
          <button
            onClick={handleLogout}
            role="menuitem"
            className="w-full flex items-center gap-2.5 px-4 py-3.5 text-sm font-medium
                       text-red-600 hover:bg-red-50 transition-colors"
          >
            <svg
              className="w-4 h-4 flex-shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
              />
            </svg>
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
