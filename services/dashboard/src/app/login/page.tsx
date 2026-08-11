"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { AlertTriangle, Lock } from "lucide-react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    const supabase = getSupabase();
    if (!supabase) {
      setError("Supabase not configured. Check .env.local");
      setLoading(false);
      return;
    }

    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    router.push("/dashboard");
  };

  if (!isSupabaseConfigured()) {
    return (
      <div className="min-h-screen bg-surface-50 flex items-center justify-center p-4">
        <div className="text-center max-w-sm">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-yellow-50 border border-yellow-200 flex items-center justify-center shadow-sm">
            <AlertTriangle className="w-8 h-8 text-yellow-500" />
          </div>
          <h1 className="text-2xl font-bold text-surface-900">Smart Gate</h1>
          <p className="text-surface-500 text-sm mt-1 mb-6">Admin Dashboard</p>
          <div className="glass-card p-6">
            <p className="text-yellow-600 font-bold mb-2 flex items-center justify-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              Supabase Not Configured
            </p>
            <p className="text-surface-600 text-sm">
              Create a <code className="text-primary-600">.env.local</code> file with:
            </p>
            <pre className="mt-3 p-3 bg-surface-100 border border-surface-200 rounded-lg text-xs text-left text-surface-700 font-mono">
              NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co{`\n`}
              NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
            </pre>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-white border border-surface-200 shadow-sm flex items-center justify-center">
            <Lock className="w-8 h-8 text-primary-500" />
          </div>
          <h1 className="text-2xl font-bold text-surface-900">Smart Gate</h1>
          <p className="text-surface-500 text-sm font-medium mt-1">Admin Dashboard</p>
        </div>

        <form onSubmit={handleLogin} className="glass-card p-6 space-y-4">
          <div>
            <label className="block text-sm text-surface-700 mb-1.5 font-bold">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@school.edu"
              className="w-full px-4 py-3 bg-white border border-surface-200 rounded-xl text-surface-900 placeholder-surface-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 transition-colors"
              required
            />
          </div>
          <div>
            <label className="block text-sm text-surface-700 mb-1.5 font-bold">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-4 py-3 bg-white border border-surface-200 rounded-xl text-surface-900 placeholder-surface-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 transition-colors"
              required
            />
          </div>

          {error && (
            <p className="text-red-700 font-medium text-sm bg-red-50 px-3 py-2 rounded-lg border border-red-100">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-primary-600 hover:bg-primary-700 text-white font-bold rounded-xl transition-all disabled:opacity-50 shadow-md shadow-primary-500/20"
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
}
