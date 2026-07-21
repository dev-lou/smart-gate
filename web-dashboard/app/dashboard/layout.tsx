"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import Sidebar from "@/components/Sidebar";
import { useTheme } from "@/components/ThemeProvider";

/**
 * Dashboard layout with authenticated sidebar navigation.
 */
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const { theme, toggleTheme } = useTheme();

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session) {
          router.replace("/auth/login");
          return;
        }

        setLoading(false);
      } catch (error) {
        console.error("Auth check failed:", error);
        router.replace("/auth/login");
      } finally {
        // Never leave the UI stuck in loading state.
        setLoading(false);
      }
    };

    checkAuth();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        router.replace("/auth/login");
      }
    });

    return () => subscription.unsubscribe();
  }, [router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-100 dark:bg-surface-950">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-primary-200 dark:border-primary-800 border-t-primary-600 dark:border-t-primary-400 rounded-full animate-spin" />
          <p className="text-surface-500 dark:text-surface-400 text-sm">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex">
      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        currentPath={pathname}
      />

      {/* Main Content */}
      <main className="flex-1 lg:ml-64">
        {/* Top Bar */}
        <header className="sticky top-0 z-30 glass-card rounded-none border-l-0 border-r-0 border-t-0 px-6 py-4 flex items-center justify-between">
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden p-2 rounded-lg hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors"
          >
            <svg
              className="w-6 h-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 6h16M4 12h16M4 18h16"
              />
            </svg>
          </button>

          <div className="hidden sm:block">
            <p className="text-xs text-surface-500 dark:text-surface-400 font-semibold tracking-widest uppercase">
              Smart Access Control System
            </p>
          </div>

          <div className="flex items-center gap-3 ml-auto">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-success-100 dark:bg-success-900/30 border border-success-300 dark:border-success-700">
              <span className="w-2 h-2 rounded-full bg-success-500 animate-pulse" />
              <span className="text-success-700 dark:text-success-300 text-xs font-medium">
                System Online
              </span>
            </div>
            <button
              onClick={toggleTheme}
              className="p-2.5 rounded-lg hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors"
              aria-label="Toggle dark mode"
              title="Toggle dark mode"
            >
              {theme === "dark" ? (
                <svg className="w-5 h-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              ) : (
                <svg className="w-5 h-5 text-surface-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
              )}
            </button>
          </div>
        </header>

        {/* Page Content */}
        <div className="p-6 page-enter">{children}</div>
      </main>
    </div>
  );
}
