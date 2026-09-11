"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { getSupabase } from "@/lib/supabase";
import { ToastProvider } from "@/components/ToastProvider";
import {
  LayoutDashboard,
  Users,
  ClipboardList,
  Activity,
  Settings,
  LogOut,
  ShieldCheck,
  MonitorSmartphone,
  UserRoundCog,
} from "lucide-react";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/students", label: "Students", icon: Users },
  { href: "/dashboard/logs", label: "Access Logs", icon: ClipboardList },
  { href: "/dashboard/health", label: "Kiosk Health", icon: Activity },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<{ email?: string } | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [schoolName, setSchoolName] = useState(
    "Iloilo State University of Fisheries Science and Technology",
  );
  const [schoolInitials, setSchoolInitials] = useState("ISUFST");

  // Branding from system_settings — same source the kiosk syncs
  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) return;
    (async () => {
      try {
        const { data } = await supabase.from("system_settings").select("key, value");
        if (!data) return;
        const map: Record<string, string> = {};
        for (const row of data) map[row.key] = row.value;
        if (map.school_name && map.school_name !== "Smart Academy") setSchoolName(map.school_name);
        if (map.school_initials) setSchoolInitials(map.school_initials);
      } catch {
        /* keep fallback */
      }
    })();
  }, []);

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) {
      router.push("/login");
      return;
    }

    let mounted = true;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return;
      if (!session) {
        router.push("/login");
        return;
      }
      setUser(session.user);
      setAuthLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      if (!session) {
        router.push("/login");
        return;
      }
      setUser(session.user);
      setAuthLoading(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [router]);

  const handleLogout = async () => {
    const supabase = getSupabase();
    if (supabase) await supabase.auth.signOut();
    router.push("/login");
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-surface-50 flex items-center justify-center p-4">
        <div className="glass-card p-8 text-center">
          <div className="w-10 h-10 mx-auto mb-4 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
          <p className="text-surface-700 font-bold">Checking session...</p>
        </div>
      </div>
    );
  }

  return (
    <ToastProvider>
      <div className="min-h-screen bg-surface-100/60 flex">
        {/* ─── Sidebar ─── */}
        <aside className="w-64 shrink-0 bg-surface-900 text-surface-100 flex flex-col sticky top-0 h-screen">
          {/* Brand */}
          <div className="p-5 border-b border-white/10 flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-primary-600 flex items-center justify-center text-white font-black text-[10px] sm:text-xs shadow-sm shrink-0">
              {schoolInitials}
            </div>
            <div className="min-w-0">
              <h1 className="text-base font-black tracking-tight text-white leading-tight">
                Smart Gate
              </h1>
              <p className="text-[11px] font-semibold text-surface-400 truncate" title={schoolName}>
                {schoolName}
              </p>
            </div>
          </div>

          {/* Nav */}
          <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
            <p className="px-3 pt-2 pb-2 text-[10px] font-black uppercase tracking-widest text-surface-500">
              Main Menu
            </p>
            {NAV_ITEMS.map((item) => {
              const active =
                item.href === "/dashboard"
                  ? pathname === "/dashboard"
                  : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold transition-all cursor-pointer ${
                    active
                      ? "bg-primary-600 text-white shadow-lg shadow-primary-900/40"
                      : "text-surface-400 hover:text-white hover:bg-white/5"
                  }`}
                >
                  <item.icon className="w-4 h-4 shrink-0" />
                  {item.label}
                </Link>
              );
            })}

            <p className="px-3 pt-5 pb-2 text-[10px] font-black uppercase tracking-widest text-surface-500">
              Stations
            </p>
            <a
              href="http://localhost:3001"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold transition-all text-surface-400 hover:text-white hover:bg-white/5 cursor-pointer"
            >
              <UserRoundCog className="w-4 h-4 shrink-0" />
              Guard Station
              <span className="ml-auto text-[10px] font-black bg-white/10 px-1.5 py-0.5 rounded-md">
                3001
              </span>
            </a>
            <a
              href="http://localhost:3002"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold transition-all text-surface-400 hover:text-white hover:bg-white/5 cursor-pointer"
            >
              <MonitorSmartphone className="w-4 h-4 shrink-0" />
              Kiosk
              <span className="ml-auto text-[10px] font-black bg-white/10 px-1.5 py-0.5 rounded-md">
                3002
              </span>
            </a>
          </nav>

          {/* User */}
          <div className="p-4 border-t border-white/10">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-primary-100 flex items-center justify-center text-primary-700 font-black text-sm shrink-0">
                {(user?.email || "A")[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-white truncate">{user?.email}</p>
                <p className="text-[10px] font-semibold text-emerald-400 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Authenticated
                </p>
              </div>
              <button
                onClick={handleLogout}
                title="Sign out"
                className="p-2 rounded-lg text-surface-400 hover:text-red-400 hover:bg-white/5 transition-colors cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </aside>

        {/* ─── Main ─── */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Topbar */}
          <header className="h-16 bg-white/70 backdrop-blur-xl border-b border-surface-200/60 flex items-center justify-between px-6 lg:px-8 sticky top-0 z-30">
            <div className="flex items-center gap-2 text-surface-500 min-w-0">
              <ShieldCheck className="w-4 h-4 text-primary-500 shrink-0" />
              <span
                className="text-xs font-bold uppercase tracking-widest truncate"
                title={schoolName}
              >
                {schoolName} — Smart Gate Management
              </span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-bold text-emerald-700">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              System Online
            </div>
          </header>

          <main className="flex-1 p-6 lg:p-8 overflow-x-hidden">{children}</main>
        </div>
      </div>
    </ToastProvider>
  );
}
