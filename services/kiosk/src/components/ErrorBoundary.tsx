"use client";

import React, { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  onRetry?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Error Boundary for the Kiosk Page
 * ==================================
 * Prevents a white screen of death when something crashes.
 * Shows a friendly restart screen instead of a blank page.
 * Also stops the animation frame loop to save tablet battery.
 */
export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary] Caught error:", error);
    console.error("[ErrorBoundary] Component stack:", info.componentStack);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
    this.props.onRetry?.();
  };

  handleRestart = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="relative w-screen h-screen bg-surface-950 flex items-center justify-center overflow-hidden">
          {/* Subtle background animation */}
          <div className="absolute inset-0 opacity-5">
            <div className="absolute inset-0 bg-gradient-to-br from-red-500 via-transparent to-surface-950" />
          </div>

          <div className="relative z-10 text-center max-w-md mx-auto px-6">
            {/* Error Icon */}
            <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center">
              <svg
                width="40"
                height="40"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                className="text-red-400"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>

            {/* Title */}
            <h1 className="text-2xl font-bold text-white mb-2">Kiosk Encountered an Issue</h1>

            {/* Error message */}
            <p className="text-white/50 text-sm mb-6 font-mono bg-surface-900/50 rounded-lg p-3 border border-surface-800">
              {this.state.error?.message || "An unexpected error occurred"}
            </p>

            {/* Actions */}
            <div className="flex flex-col gap-3">
              <button
                onClick={this.handleRestart}
                className="w-full px-6 py-3 rounded-xl bg-primary-500 hover:bg-primary-600 text-white font-semibold transition-all duration-200 active:scale-[0.98]"
              >
                Restart Kiosk
              </button>

              <button
                onClick={this.handleRetry}
                className="w-full px-6 py-3 rounded-xl bg-surface-800 hover:bg-surface-700 text-white/70 font-medium transition-all duration-200 border border-surface-700"
              >
                Try Again
              </button>
            </div>

            {/* Hint */}
            <p className="mt-8 text-xs text-white/20">
              If this keeps happening, check the tablet&apos;s internet connection or try restarting
              the device.
            </p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
