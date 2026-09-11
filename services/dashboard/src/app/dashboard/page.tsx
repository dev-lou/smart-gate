"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getSupabase } from "@/lib/supabase";
import {
  LayoutDashboard,
  Users,
  Activity,
  ShieldCheck,
  ChevronRight,
  ClipboardList,
  Settings,
  Plus,
  CheckCircle2,
  XCircle,
  Wifi,
  WifiOff,
} from "lucide-react";

interface DashboardStats {
  students: number;
  activeStudents: number;
  logsToday: number;
  successRate: string;
  activeGates: number;
  totalGates: number;
}

interface RecentLog {
  id: string;
  person_name: string | null;
  success: boolean;
  method: string;
  failure_reason: string | null;
  created_at: string;
}

export default function DashboardPage() {
  const router = useRouter();
  const [stats, setStats] = useState<DashboardStats>({
    students: 0,
    activeStudents: 0,
    logsToday: 0,
    successRate: "—",
    activeGates: 0,
    totalGates: 0,
  });
  const [recentLogs, setRecentLogs] = useState<RecentLog[]>([]);

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

      const today = new Date().toISOString().split("T")[0];

      Promise.all([
        supabase.from("students").select("id", { count: "exact", head: true }),
        supabase
          .from("students")
          .select("id", { count: "exact", head: true })
          .eq("is_active", true),
        supabase
          .from("access_logs")
          .select("success", { count: "exact", head: true })
          .gte("created_at", today),
        supabase.from("access_logs").select("success").gte("created_at", today),
        supabase.from("kiosk_heartbeats").select("updated_at"),
        supabase
          .from("access_logs")
          .select("id, person_name, success, method, failure_reason, created_at")
          .order("created_at", { ascending: false })
          .limit(6),
      ]).then(([students, activeStudents, logsToday, todaySuccesses, heartbeats, logs]) => {
        const totalLogs = logsToday.count || 0;
        const successLogs = todaySuccesses.data?.filter((l) => l.success).length || 0;
        const now = Date.now();
        const allGates = heartbeats.data ?? [];
        const activeGates = allGates.filter(
          (hb: { updated_at: string }) => now - new Date(hb.updated_at).getTime() < 90_000,
        ).length;
        setStats({
          students: students.count || 0,
          activeStudents: activeStudents.count || 0,
          logsToday: totalLogs,
          successRate: totalLogs > 0 ? `${((successLogs / totalLogs) * 100).toFixed(0)}%` : "—",
          activeGates,
          totalGates: allGates.length,
        });
        setRecentLogs(logs.data ?? []);
      });
    });
  }, [router]);

  function timeAgo(ts: string) {
    const diff = Date.now() - new Date(ts).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return new Date(ts).toLocaleDateString();
  }

  const statCards = [
    {
      label: "Enrolled Students",
      value: stats.students,
      sub: `${stats.activeStudents} active`,
      icon: Users,
      tint: "bg-primary-50 text-primary-600 border-primary-100",
    },
    {
      label: "Access Logs Today",
      value: stats.logsToday,
      sub: "entries recorded",
      icon: Activity,
      tint: "bg-green-50 text-green-600 border-green-100",
    },
    {
      label: "Success Rate",
      value: stats.successRate,
      sub: "grants vs denials",
      icon: ShieldCheck,
      tint: "bg-violet-50 text-violet-600 border-violet-100",
    },
    {
      label: "Active Gates",
      value: `${stats.activeGates}/${stats.totalGates}`,
      sub: stats.totalGates === 0 ? "no kiosks reporting yet" : "kiosks online now",
      icon: Wifi,
      tint: "bg-amber-50 text-amber-600 border-amber-100",
    },
  ];

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl lg:text-3xl font-black text-surface-900 tracking-tight">
          Overview
        </h1>
        <p className="text-surface-500 font-medium text-sm mt-1">
          Live snapshot of your smart gate system
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5 mb-8">
        {statCards.map((card) => (
          <div key={card.label} className="glass-card p-5 hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-semibold text-surface-500">{card.label}</p>
              <div
                className={`w-10 h-10 rounded-xl border flex items-center justify-center ${card.tint}`}
              >
                <card.icon className="w-5 h-5" />
              </div>
            </div>
            <p className="text-3xl font-black text-surface-900 tracking-tight">{card.value}</p>
            <p className="text-xs font-medium text-surface-400 mt-1">{card.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
        {/* Recent activity */}
        <div className="xl:col-span-3 bg-white rounded-2xl shadow-sm border border-surface-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-surface-100 flex items-center justify-between">
            <h2 className="font-bold text-surface-900 text-sm flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary-600" />
              Recent Access Activity
            </h2>
            <Link
              href="/dashboard/logs"
              className="text-xs font-bold text-primary-600 hover:text-primary-500 flex items-center gap-1 transition-colors"
            >
              View all
              <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          {recentLogs.length === 0 ? (
            <div className="p-12 text-center">
              <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-surface-50 border border-surface-100 flex items-center justify-center">
                <ClipboardList className="w-7 h-7 text-surface-300" />
              </div>
              <p className="font-bold text-surface-900 text-sm">No access activity yet</p>
              <p className="text-surface-500 font-medium text-xs mt-1">
                Grants & denials from kiosks will appear here as they sync.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-surface-50">
              {recentLogs.map((log) => (
                <div
                  key={log.id}
                  className="flex items-center gap-3.5 px-6 py-3.5 hover:bg-surface-50/60 transition-colors"
                >
                  <div
                    className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                      log.success ? "bg-green-50 text-green-600" : "bg-red-50 text-red-500"
                    }`}
                  >
                    {log.success ? (
                      <CheckCircle2 className="w-4 h-4" />
                    ) : (
                      <XCircle className="w-4 h-4" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-surface-900 truncate">
                      {log.person_name || "Unknown person"}
                    </p>
                    <p className="text-[11px] font-semibold text-surface-400 uppercase">
                      {log.method} ·{" "}
                      {log.failure_reason
                        ? log.failure_reason
                        : log.success
                          ? "Access granted"
                          : "Denied"}
                    </p>
                  </div>
                  <span className="text-xs font-semibold text-surface-400 shrink-0">
                    {timeAgo(log.created_at)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Quick links */}
        <div className="xl:col-span-2 space-y-4">
          <Link
            href="/dashboard/students"
            className="glass-card p-5 hover:-translate-y-0.5 hover:shadow-md transition-all duration-200 group block"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="w-11 h-11 rounded-xl bg-primary-50 border border-primary-100 flex items-center justify-center">
                <Users className="w-5 h-5 text-primary-600" />
              </div>
              <ChevronRight className="w-4 h-4 text-surface-300 group-hover:text-primary-500 group-hover:translate-x-0.5 transition-all" />
            </div>
            <p className="font-bold text-surface-900">Students</p>
            <p className="text-xs font-medium text-surface-500 mt-0.5">
              Enroll, edit, or manage access — {stats.students} profiles
            </p>
          </Link>

          <Link
            href="/dashboard/settings"
            className="glass-card p-5 hover:-translate-y-0.5 hover:shadow-md transition-all duration-200 group block"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="w-11 h-11 rounded-xl bg-surface-100 border border-surface-200 flex items-center justify-center">
                <Settings className="w-5 h-5 text-surface-600" />
              </div>
              <ChevronRight className="w-4 h-4 text-surface-300 group-hover:text-primary-500 group-hover:translate-x-0.5 transition-all" />
            </div>
            <p className="font-bold text-surface-900">Settings</p>
            <p className="text-xs font-medium text-surface-500 mt-0.5">
              Recognition threshold, gate timing, uniforms & course assignment
            </p>
          </Link>

          <Link
            href="/dashboard/health"
            className="glass-card p-5 hover:-translate-y-0.5 hover:shadow-md transition-all duration-200 group block"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="w-11 h-11 rounded-xl bg-violet-50 border border-violet-100 flex items-center justify-center">
                {stats.activeGates > 0 ? (
                  <Wifi className="w-5 h-5 text-violet-600" />
                ) : (
                  <WifiOff className="w-5 h-5 text-violet-400" />
                )}
              </div>
              <ChevronRight className="w-4 h-4 text-surface-300 group-hover:text-primary-500 group-hover:translate-x-0.5 transition-all" />
            </div>
            <p className="font-bold text-surface-900">Kiosk Health</p>
            <p className="text-xs font-medium text-surface-500 mt-0.5">
              {stats.activeGates > 0
                ? `${stats.activeGates} kiosk(s) online — camera, gate & sync status`
                : "No kiosk reporting yet — open the kiosk app to register"}
            </p>
          </Link>

          <Link
            href="/dashboard/logs"
            className="glass-card p-5 hover:-translate-y-0.5 hover:shadow-md transition-all duration-200 group block"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="w-11 h-11 rounded-xl bg-green-50 border border-green-100 flex items-center justify-center">
                <ClipboardList className="w-5 h-5 text-green-600" />
              </div>
              <ChevronRight className="w-4 h-4 text-surface-300 group-hover:text-primary-500 group-hover:translate-x-0.5 transition-all" />
            </div>
            <p className="font-bold text-surface-900">Access Logs</p>
            <p className="text-xs font-medium text-surface-500 mt-0.5">
              Grants, denials, uniform failures & manual overrides
            </p>
          </Link>
        </div>
      </div>

      {/* Quick action banner */}
      <div className="mt-8 bg-surface-900 rounded-2xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-primary-600 flex items-center justify-center shrink-0">
            <Plus className="w-6 h-6 text-white" />
          </div>
          <div>
            <p className="font-bold text-white">Need to enroll a student?</p>
            <p className="text-sm font-medium text-surface-400">
              The same 3-step flow as the Guard Station — photos, info, review.
            </p>
          </div>
        </div>
        <Link
          href="/dashboard/students"
          className="px-5 py-2.5 bg-primary-600 hover:bg-primary-500 text-white rounded-xl text-sm font-bold transition-colors text-center shrink-0"
        >
          Go to Students
        </Link>
      </div>
    </div>
  );
}
