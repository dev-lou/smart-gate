"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  currentPath: string;
}

// ─── Nav Structure ───────────────────────────────────────────────────────────

const navGroups = [
  {
    section: "PEOPLE",
    items: [
      {
        label: "Students",
        href: "/dashboard/students",
        icon: (
          <svg
            className="w-5 h-5 shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
            />
          </svg>
        ),
      },
      {
        label: "Faculty",
        href: "/dashboard/faculty",
        icon: (
          <svg
            className="w-5 h-5 shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M12 14l9-5-9-5-9 5 9 5z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M12 14l6.16-3.422A12.083 12.083 0 0112 20.055a12.083 12.083 0 01-6.16-9.477L12 14z"
            />
          </svg>
        ),
      },
      {
        label: "Staff",
        href: "/dashboard/staff",
        icon: (
          <svg
            className="w-5 h-5 shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M17 20h5v-2a4 4 0 00-4-4h-1M9 20H4v-2a4 4 0 014-4h1m0-4a4 4 0 118 0 4 4 0 01-8 0z"
            />
          </svg>
        ),
      },
    ],
  },
  {
    section: "VISITORS",
    items: [
      {
        label: "Guest Visits",
        href: "/dashboard/guest-visits",
        icon: (
          <svg
            className="w-5 h-5 shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"
            />
          </svg>
        ),
      },
    ],
  },
  {
    section: "GATE CONTROL",
    items: [
      {
        label: "Manual Override",
        href: "/dashboard/manual-overrides",
        icon: (
          <svg
            className="w-5 h-5 shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4v-3.586l5.257-5.257A6 6 0 1121 9z"
            />
          </svg>
        ),
      },
      {
        label: "Reports",
        href: "/dashboard/reports",
        icon: (
          <svg
            className="w-5 h-5 shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
            />
          </svg>
        ),
      },
      {
        label: "Access Logs",
        href: "/dashboard/logs",
        icon: (
          <svg
            className="w-5 h-5 shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"
            />
          </svg>
        ),
      },
    ],
  },
  {
    section: "MONITORING",
    items: [
      {
        label: "Audit Logs",
        href: "/dashboard/audit-logs",
        icon: (
          <svg
            className="w-5 h-5 shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        ),
      },
      {
        label: "Uniform Policies",
        href: "/dashboard/uniform-policies",
        icon: (
          <svg
            className="w-5 h-5 shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 12h6m-6 4h6M7 8h10M5 4h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V5a1 1 0 011-1z"
            />
          </svg>
        ),
      },
    ],
  },
  {
    section: "CONFIGURATION",
    items: [
      {
        label: "Settings",
        href: "/dashboard/settings",
        icon: (
          <svg
            className="w-5 h-5 shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
        ),
      },
    ],
  },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function Sidebar({
  isOpen,
  onClose,
  currentPath,
}: SidebarProps) {
  const router = useRouter();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/auth/login");
  };

  return (
    <aside
      className={[
        "fixed top-0 left-0 z-50 h-full w-64",
        "bg-white dark:bg-surface-950",
        "border-r border-gray-200 dark:border-surface-800",
        "flex flex-col",
        "transition-transform duration-300 ease-in-out",
        "lg:translate-x-0",
        isOpen ? "translate-x-0" : "-translate-x-full",
      ].join(" ")}
    >
      {/* ── Logo / Brand ───────────────────────────────────────────────── */}
      <div className="h-16 px-5 flex items-center gap-3 border-b border-gray-200 dark:border-surface-800 shrink-0">
        {/* Gate icon badge */}
        <div className="w-9 h-9 rounded-lg bg-primary-700 flex items-center justify-center shrink-0 shadow-sm">
          <svg
            className="w-5 h-5 text-white"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            {/* School gate: two pillars + top/bottom rails + two crossbars */}
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M6 3v18M18 3v18M4 3h16M4 21h16M6 9h12M6 15h12"
            />
          </svg>
        </div>

        {/* Title */}
        <div className="min-w-0 flex-1">
          <p className="font-bold text-gray-900 dark:text-white text-[15px] leading-tight tracking-tight">
            Smart Access
          </p>
          <p className="text-[11px] text-gray-400 dark:text-surface-500 leading-tight">
            Gate Control System
          </p>
        </div>

        {/* Mobile close button */}
        <button
          onClick={onClose}
          className="lg:hidden ml-auto p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:text-surface-500 dark:hover:text-surface-300 dark:hover:bg-surface-800 transition-colors"
          aria-label="Close navigation"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      {/* ── Navigation ─────────────────────────────────────────────────── */}
      <nav
        className="flex-1 overflow-y-auto py-2"
        aria-label="Primary navigation"
      >
        {navGroups.map((group) => (
          <div key={group.section}>
            {/* Section label */}
            <p className="px-5 pt-5 pb-1 text-[10.5px] font-bold uppercase tracking-widest text-gray-400 dark:text-surface-500 select-none">
              {group.section}
            </p>

            {/* Items */}
            {group.items.map((item) => {
              const isActive = currentPath === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onClose}
                  className={[
                    // Layout & spacing
                    "flex items-center gap-3 w-full py-3 pr-5 text-[15px] transition-colors duration-150 select-none",
                    // Left border always occupies space so items never shift;
                    // pl = px-5 (20px) − border-width (3px) = 17px
                    "border-l-[3px] pl-[17px]",
                    isActive
                      ? "bg-[#EEF2FF] text-[#1D4ED8] font-semibold border-[#1D4ED8] dark:bg-primary-950/50 dark:text-primary-300 dark:border-primary-500"
                      : "text-gray-700 hover:bg-slate-50 hover:text-gray-900 font-medium border-transparent dark:text-surface-400 dark:hover:bg-surface-800/60 dark:hover:text-surface-200",
                  ].join(" ")}
                >
                  <span
                    className={
                      isActive
                        ? "text-[#1D4ED8] dark:text-primary-300"
                        : "text-gray-500 dark:text-surface-500"
                    }
                  >
                    {item.icon}
                  </span>
                  <span className="truncate">{item.label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* ── Sign Out ───────────────────────────────────────────────────── */}
      <div className="px-4 py-4 border-t border-gray-200 dark:border-surface-800 shrink-0">
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 w-full px-4 py-3 rounded-lg text-[15px] font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30 dark:hover:text-red-300 transition-colors duration-150"
        >
          <svg
            className="w-5 h-5 shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
            />
          </svg>
          <span>Sign Out</span>
        </button>
      </div>
    </aside>
  );
}