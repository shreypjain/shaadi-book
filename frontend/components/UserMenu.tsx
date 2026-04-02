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

  useEffect(() => {
    setUser(getStoredUser());
  }, []);

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

  if (pathname === "/login" || !user) return null;

  const initials = user.name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  const firstName = user.name.split(" ")[0] ?? user.name;

  return (
    <div ref={menuRef} className="fixed top-3 right-3 z-50">
      {/* Avatar button */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="User menu"
        aria-expanded={open}
        className="flex items-center gap-2 bg-white/90 backdrop-blur border border-[rgba(184,134,11,0.12)]
                   rounded-full pl-1.5 pr-3 py-1.5 shadow-card
                   hover:bg-cream-100 active:scale-95 transition-all"
      >
        {/* Avatar circle */}
        <div
          className="w-7 h-7 rounded-full bg-[#1e3a5f] flex items-center justify-center
                     text-white text-[11px] font-bold flex-shrink-0"
          aria-hidden
        >
          {initials}
        </div>
        <span className="text-xs font-semibold text-charcoal max-w-[80px] truncate">
          {firstName}
        </span>
        {/* Chevron */}
        <svg
          className={`w-3 h-3 text-warmGray transition-transform ${open ? "rotate-180" : ""}`}
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
          className="absolute right-0 top-full mt-2 w-52 bg-white rounded-xl
                     border border-[rgba(184,134,11,0.12)] shadow-xl shadow-black/5
                     animate-slide-up overflow-hidden"
          role="menu"
        >
          {/* User info */}
          <div className="px-4 py-3 border-b border-[#f0ece7]">
            <p className="text-sm font-semibold text-charcoal truncate">
              {user.name}
            </p>
            <p className="text-xs text-warmGray truncate mt-0.5">{user.phone}</p>
            {user.role === "admin" && (
              <span
                className="inline-block mt-1 text-[10px] font-bold uppercase tracking-wider
                           bg-[#f5efd9] text-[#8a6d30] rounded-full px-2 py-0.5"
              >
                Admin
              </span>
            )}
          </div>

          {/* Admin toggle */}
          {user.role === "admin" && (
            <button
              onClick={() => {
                setOpen(false);
                const isAdmin = pathname.startsWith("/admin");
                router.push(isAdmin ? "/" : "/admin");
              }}
              role="menuitem"
              className="w-full flex items-center gap-2.5 px-4 py-3.5 text-sm font-medium
                         text-[#1e3a5f] hover:bg-blue-50 transition-colors border-b border-[#f0ece7]"
            >
              <svg
                className="w-4 h-4 flex-shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden
              >
                {pathname.startsWith("/admin") ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                )}
              </svg>
              {pathname.startsWith("/admin") ? "Guest View" : "Admin Panel"}
            </button>
          )}

          {/* Notifications settings */}
          <button
            onClick={() => {
              setOpen(false);
              router.push("/notifications");
            }}
            role="menuitem"
            className="w-full flex items-center gap-2.5 px-4 py-3.5 text-sm font-medium
                       text-charcoal hover:bg-cream-100 transition-colors border-b border-[#f0ece7]"
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
                d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
              />
            </svg>
            Notifications
          </button>

          {/* Logout */}
          <button
            onClick={handleLogout}
            role="menuitem"
            className="w-full flex items-center gap-2.5 px-4 py-3.5 text-sm font-medium
                       text-[#dc2626] hover:bg-red-50 transition-colors"
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
