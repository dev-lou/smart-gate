"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

/**
 * Admin login page with Supabase Auth (email/password).
 */
export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authError) {
        setError(authError.message);
      } else {
        router.push("/dashboard/students");
      }
    } catch {
      setError("An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-surface-100 dark:bg-surface-950">
      <div className="glass-card dark:bg-surface-800 dark:border-surface-700 p-8 w-full max-w-md animate-fade-in">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-primary-600 flex items-center justify-center shadow-md">
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-surface-900 dark:text-white">
            Smart Gate Dashboard
          </h1>
          <p className="text-surface-500 dark:text-surface-400 text-sm mt-2">
            Sign in to manage your school gate system
          </p>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm animate-slide-up">
            {error}
          </div>
        )}

        {/* Login Form */}
        <form onSubmit={handleLogin} className="space-y-5">
          <div>
            <label htmlFor="email" className="input-label dark:text-surface-300">
              Email Address
            </label>
            <input
              id="email"
              type="email"
              className="input-field dark:bg-surface-900 dark:border-surface-600 dark:text-white"
              placeholder="admin@school.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div>
            <label htmlFor="password" className="input-label dark:text-surface-300">
              Password
            </label>
            <input
              id="password"
              type="password"
              className="input-field dark:bg-surface-900 dark:border-surface-600 dark:text-white"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full justify-center py-3 text-base disabled:opacity-50"
          >
            {loading ? (
              <>
                <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Signing in...
              </>
            ) : (
              "Sign In"
            )}
          </button>
        </form>

        <p className="text-center text-surface-500 dark:text-surface-400 text-xs mt-6">
          Smart School Gate System v1.0
        </p>
      </div>
    </div>
  );
}
