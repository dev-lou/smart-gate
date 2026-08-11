"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getSupabase } from "@/lib/supabase";
import { 
  LayoutDashboard, LogOut, Users, Activity, 
  ShieldCheck, Lock, ChevronRight, ClipboardList, Settings 
} from "lucide-react";

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
    <div className="min-h-screen bg-surface-50 p-6 lg:p-10">
      {/* Header */}
      <header className="flex items-center justify-between mb-10">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-white rounded-xl shadow-sm border border-surface-200 flex items-center justify-center">
            <LayoutDashboard className="w-6 h-6 text-primary-600" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-surface-900 tracking-tight">Dashboard</h1>
            <p className="text-surface-500 font-medium mt-1">System overview & management</p>
          </div>
        </div>
        <div className="flex items-center gap-6 glass-card px-6 py-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center text-primary-700 font-bold">
              {user.email[0].toUpperCase()}
            </div>
            <span className="text-sm font-medium text-surface-700">{user.email}</span>
          </div>
          <div className="w-px h-6 bg-surface-200"></div>
          <button
            onClick={handleLogout}
            className="text-sm font-bold text-red-600 hover:text-red-500 transition-colors flex items-center gap-2"
          >
            <LogOut className="w-4 h-4" />
            Logout
          </button>
        </div>
      </header>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
        <div className="stat-card">
          <div className="flex items-center justify-between mb-4">
            <p className="stat-label">Enrolled Students</p>
            <Users className="w-5 h-5 text-surface-400" />
          </div>
          <p className="stat-value">{stats.students}</p>
        </div>
        <div className="stat-card">
          <div className="flex items-center justify-between mb-4">
            <p className="stat-label">Access Logs Today</p>
            <Activity className="w-5 h-5 text-surface-400" />
          </div>
          <p className="stat-value">{stats.logsToday}</p>
        </div>
        <div className="stat-card">
          <div className="flex items-center justify-between mb-4">
            <p className="stat-label">Success Rate</p>
            <ShieldCheck className="w-5 h-5 text-surface-400" />
          </div>
          <p className="stat-value">{stats.successRate}</p>
        </div>
        <div className="stat-card">
          <div className="flex items-center justify-between mb-4">
            <p className="stat-label">Active Gates</p>
            <Lock className="w-5 h-5 text-surface-400" />
          </div>
          <p className="stat-value">{stats.activeGates}</p>
        </div>
      </div>

      {/* Quick Links */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Link
          href="/dashboard/students"
          className="glass-card p-8 hover:-translate-y-1 hover:shadow-md transition-all duration-300 group"
        >
          <div className="flex items-center justify-between mb-6">
            <div className="w-14 h-14 rounded-2xl bg-primary-50 border border-primary-100 flex items-center justify-center">
              <Users className="w-7 h-7 text-primary-600" />
            </div>
            <div className="w-8 h-8 rounded-full bg-surface-100 flex items-center justify-center group-hover:bg-primary-50 group-hover:text-primary-600 transition-colors">
              <ChevronRight className="w-5 h-5 text-surface-400 group-hover:text-primary-600" />
            </div>
          </div>
          <h3 className="text-xl font-bold text-surface-900 mb-2">Students</h3>
          <p className="text-surface-500 font-medium leading-relaxed">
            Manage enrolled students, view profiles, and add new enrollments
          </p>
        </Link>

        <Link
          href="/dashboard/logs"
          className="glass-card p-8 hover:-translate-y-1 hover:shadow-md transition-all duration-300 group"
        >
          <div className="flex items-center justify-between mb-6">
            <div className="w-14 h-14 rounded-2xl bg-green-50 border border-green-100 flex items-center justify-center">
              <ClipboardList className="w-7 h-7 text-green-600" />
            </div>
            <div className="w-8 h-8 rounded-full bg-surface-100 flex items-center justify-center group-hover:bg-green-50 transition-colors">
              <ChevronRight className="w-5 h-5 text-surface-400 group-hover:text-green-600" />
            </div>
          </div>
          <h3 className="text-xl font-bold text-surface-900 mb-2">Access Logs</h3>
          <p className="text-surface-500 font-medium leading-relaxed">
            View all access attempts, grants, denials, and manual overrides
          </p>
        </Link>

        <Link
          href="/dashboard/settings"
          className="glass-card p-8 hover:-translate-y-1 hover:shadow-md transition-all duration-300 group"
        >
          <div className="flex items-center justify-between mb-6">
            <div className="w-14 h-14 rounded-2xl bg-surface-100 border border-surface-200 flex items-center justify-center">
              <Settings className="w-7 h-7 text-surface-600" />
            </div>
            <div className="w-8 h-8 rounded-full bg-surface-100 flex items-center justify-center group-hover:bg-surface-200 transition-colors">
              <ChevronRight className="w-5 h-5 text-surface-400 group-hover:text-surface-700" />
            </div>
          </div>
          <h3 className="text-xl font-bold text-surface-900 mb-2">Settings</h3>
          <p className="text-surface-500 font-medium leading-relaxed">
            Configure system settings, uniform policies, and recognition thresholds
          </p>
        </Link>
      </div>
    </div>
  );
}
