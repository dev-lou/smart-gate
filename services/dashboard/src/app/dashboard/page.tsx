"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getSupabase } from "@/lib/supabase";

interface DashboardStats {
  students: number;
  logsToday: number;
  successRate: string;
  activeGates: number;
}

export default function DashboardPage() {
  const router = useRouter();
  const [stats, setStats] = useState<DashboardStats>({
    students: 0,
    logsToday: 0,
    successRate: "0%",
    activeGates: 1,
  });
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) {
      router.push("/login");
      return;
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        router.push("/login");
        return;
      }
      setUser(session.user);
    });
  }, [router]);

  useEffect(() => {
    if (!user) return;

    const supabase = getSupabase();
    if (!supabase) return;

    Promise.all([
      supabase.from("students").select("id", { count: "exact", head: true }),
      supabase
        .from("access_logs")
        .select("success", { count: "exact", head: true })
        .gte("created_at", new Date().toISOString().split("T")[0]),
      supabase
        .from("access_logs")
        .select("success")
        .gte("created_at", new Date().toISOString().split("T")[0]),
    ]).then(([students, logsToday, todaySuccesses]) => {
      const totalLogs = logsToday.count || 0;
      const successLogs = todaySuccesses.data?.filter((l) => l.success).length || 0;
      setStats({
        students: students.count || 0,
        logsToday: totalLogs,
        successRate: totalLogs > 0 ? `${((successLogs / totalLogs) * 100).toFixed(0)}%` : "—",
        activeGates: 1,
      });
    });
  }, [user]);

  const handleLogout = async () => {
    const supabase = getSupabase();
    if (supabase) await supabase.auth.signOut();
    router.push("/login");
  };

  if (!user) return null;

  return (
    <div className="min-h-screen bg-surface-950 p-6">
      {/* Header */}
      <header className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">📊 Dashboard</h1>
          <p className="text-surface-400 text-sm mt-1">System overview & management</p>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-surface-400">{user.email}</span>
          <button
            onClick={handleLogout}
            className="text-sm text-red-400 hover:text-red-300 transition-colors"
          >
            Logout
          </button>
        </div>
      </header>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
        <div className="stat-card">
          <p className="stat-value">{stats.students}</p>
          <p className="stat-label">Enrolled Students</p>
        </div>
        <div className="stat-card">
          <p className="stat-value">{stats.logsToday}</p>
          <p className="stat-label">Access Logs Today</p>
        </div>
        <div className="stat-card">
          <p className="stat-value">{stats.successRate}</p>
          <p className="stat-label">Success Rate</p>
        </div>
        <div className="stat-card">
          <p className="stat-value">{stats.activeGates}</p>
          <p className="stat-label">Active Gates</p>
        </div>
      </div>

      {/* Quick Links */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <Link
          href="/dashboard/students"
          className="glass-card p-6 hover:bg-surface-800/80 transition-colors group"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="w-12 h-12 rounded-xl bg-primary-600/20 flex items-center justify-center">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="text-primary-400"
              >
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </div>
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="text-surface-500 group-hover:text-white transition-colors"
            >
              <path d="M9 18l6-6-6-6" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-white mb-1">Students</h3>
          <p className="text-surface-400 text-sm">
            Manage enrolled students, view profiles, and add new enrollments
          </p>
        </Link>

        <Link
          href="/dashboard/logs"
          className="glass-card p-6 hover:bg-surface-800/80 transition-colors group"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="w-12 h-12 rounded-xl bg-green-600/20 flex items-center justify-center">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="text-green-400"
              >
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
              </svg>
            </div>
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="text-surface-500 group-hover:text-white transition-colors"
            >
              <path d="M9 18l6-6-6-6" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-white mb-1">Access Logs</h3>
          <p className="text-surface-400 text-sm">
            View all access attempts, grants, denials, and manual overrides
          </p>
        </Link>

        <Link
          href="/dashboard/settings"
          className="glass-card p-6 hover:bg-surface-800/80 transition-colors group"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="w-12 h-12 rounded-xl bg-surface-700 flex items-center justify-center">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="text-surface-300"
              >
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </div>
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="text-surface-500 group-hover:text-white transition-colors"
            >
              <path d="M9 18l6-6-6-6" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-white mb-1">Settings</h3>
          <p className="text-surface-400 text-sm">
            Configure system settings, uniform policies, and recognition thresholds
          </p>
        </Link>
      </div>
    </div>
  );
}
