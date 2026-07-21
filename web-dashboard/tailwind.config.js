/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      // ─────────────────────────────────────────────
      //  Institutional Light Palette  (2026)
      //  No dark surfaces, no neon, no glow colours.
      //  Everything reads well on #F4F6FB.
      // ─────────────────────────────────────────────
      colors: {
        // Primary: institutional blue
        primary: {
          50: "#EFF4FF",
          100: "#DBEAFE",
          200: "#BFDBFE",
          300: "#93C5FD",
          400: "#60A5FA",
          500: "#3B82F6",
          600: "#2563EB",
          700: "#1D4ED8", // ← brand anchor
          800: "#1A44C2", // hover state
          900: "#1E40AF",
          950: "#172554",
        },

        // Success: accessible green (WCAG AA on white)
        success: {
          50: "#F0FDF4",
          100: "#DCFCE7",
          200: "#BBF7D0",
          300: "#86EFAC",
          400: "#4ADE80",
          500: "#22C55E",
          600: "#16A34A",
          700: "#15803D", // ← brand anchor
          800: "#166534",
          900: "#14532D",
        },

        // Warning: amber (WCAG AA on white when darkened)
        warning: {
          50: "#FFFBEB",
          100: "#FEF9C3",
          200: "#FEF08A",
          300: "#FDE047",
          400: "#FACC15",
          500: "#EAB308",
          600: "#CA8A04", // ← brand anchor
          700: "#A16207",
          800: "#92400E",
          900: "#78350F",
        },

        // Danger: red
        danger: {
          50: "#FFF1F2",
          100: "#FFE4E6",
          200: "#FECDD3",
          300: "#FCA5A5",
          400: "#F87171",
          500: "#EF4444",
          600: "#DC2626", // ← brand anchor
          700: "#B91C1C",
          800: "#9F1239",
          900: "#7F1D1D",
        },

        // Surface / grey — cool-tinted, not warm
        surface: {
          50: "#F8FAFD",
          100: "#F4F6FB", // ← page background
          200: "#EDF0F7",
          300: "#E2E8F0",
          400: "#D1D9E6", // ← default border
          500: "#9BAEC4",
          600: "#5A6A85", // ← muted text
          700: "#344156",
          800: "#1E293B", // ← body text
          900: "#0F172A", // ← heading text
          950: "#060F1E",
        },

        // Accent teal – for charts, secondary data ink
        teal: {
          50: "#F0FDFA",
          100: "#CCFBF1",
          200: "#99F6E4",
          300: "#5EEAD4",
          400: "#2DD4BF",
          500: "#14B8A6",
          600: "#0D9488",
          700: "#0F766E",
          800: "#115E59",
          900: "#134E4A",
        },

        // Indigo – for secondary highlights / charts
        indigo: {
          50: "#EEF2FF",
          100: "#E0E7FF",
          200: "#C7D2FE",
          300: "#A5B4FC",
          400: "#818CF8",
          500: "#6366F1",
          600: "#4F46E5",
          700: "#4338CA",
          800: "#3730A3",
          900: "#312E81",
        },
      },

      // ─────────────────────────────────────────────
      //  Typography
      // ─────────────────────────────────────────────
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "sans-serif"],
        mono: ["JetBrains Mono", "Fira Code", "monospace"],
      },

      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem" }], // 11 px
        xs: ["0.75rem", { lineHeight: "1.125rem" }], // 12 px
        sm: ["0.8125rem", { lineHeight: "1.25rem" }], // 13 px
        base: ["0.9375rem", { lineHeight: "1.5rem" }], // 15 px — default readable size
        lg: ["1.0625rem", { lineHeight: "1.625rem" }], // 17 px
        xl: ["1.125rem", { lineHeight: "1.75rem" }], // 18 px
        "2xl": ["1.25rem", { lineHeight: "1.875rem" }], // 20 px
        "3xl": ["1.5rem", { lineHeight: "2rem" }], // 24 px
        "4xl": ["1.875rem", { lineHeight: "2.25rem" }], // 30 px
        "5xl": ["2.25rem", { lineHeight: "2.75rem" }], // 36 px
      },

      // ─────────────────────────────────────────────
      //  Spacing — generous targets for touch/guard
      // ─────────────────────────────────────────────
      spacing: {
        4.5: "1.125rem",
        13: "3.25rem",
        15: "3.75rem",
        18: "4.5rem",
        22: "5.5rem",
        26: "6.5rem",
        30: "7.5rem",
      },

      // ─────────────────────────────────────────────
      //  Border radius
      // ─────────────────────────────────────────────
      borderRadius: {
        xs: "4px",
        sm: "6px",
        DEFAULT: "8px",
        md: "10px",
        lg: "12px",
        xl: "14px",
        "2xl": "16px",
        "3xl": "20px",
        full: "9999px",
      },

      // ─────────────────────────────────────────────
      //  Shadows — NO glow, only crisp layer shadows
      // ─────────────────────────────────────────────
      boxShadow: {
        // Semantic cards
        card: "0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)",
        "card-hover":
          "0 4px 12px rgba(15,23,42,0.10), 0 2px 4px rgba(15,23,42,0.06)",
        elevated:
          "0 4px 16px rgba(15,23,42,0.10), 0 1px 4px rgba(15,23,42,0.06)",
        modal:
          "0 20px 60px rgba(15,23,42,0.18), 0 4px 16px rgba(15,23,42,0.10)",

        // Focus rings (override defaults — no glow colour)
        "focus-primary": "0 0 0 3px rgba(29,78,216,0.18)",
        "focus-danger": "0 0 0 3px rgba(220,38,38,0.15)",
        "focus-success": "0 0 0 3px rgba(21,128,61,0.15)",

        // Sidebar / panel separation
        sidebar: "2px 0 8px rgba(15,23,42,0.05)",
        topbar: "0 1px 4px rgba(15,23,42,0.06)",

        // Button hover lifts
        "btn-primary": "0 2px 8px rgba(29,78,216,0.30)",
        "btn-danger": "0 2px 8px rgba(220,38,38,0.30)",
        "btn-success": "0 2px 8px rgba(21,128,61,0.30)",

        // None
        none: "none",
      },

      // ─────────────────────────────────────────────
      //  Animations
      // ─────────────────────────────────────────────
      animation: {
        "fade-in": "fadeIn  0.25s ease-out",
        "slide-up": "slideUp 0.25s ease-out",
        "slide-in": "slideIn 0.25s ease-out",
        shimmer: "shimmer 1.4s ease infinite",
        "sync-pulse": "syncPulse 2s ease-in-out infinite",
        // Keep standard pulse
        pulse: "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },

      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        slideIn: {
          "0%": { opacity: "0", transform: "translateX(-8px)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-600px 0" },
          "100%": { backgroundPosition: "600px 0" },
        },
        syncPulse: {
          "0%, 100%": { boxShadow: "0 0 0 0 rgba(21,128,61,0.35)" },
          "50%": { boxShadow: "0 0 0 8px rgba(21,128,61,0)" },
        },
      },

      // ─────────────────────────────────────────────
      //  Z-index scale
      // ─────────────────────────────────────────────
      zIndex: {
        "-1": "-1",
        0: "0",
        10: "10",
        20: "20",
        30: "30",
        40: "40",
        50: "50",
        sidebar: "100",
        topbar: "110",
        dropdown: "200",
        modal: "300",
        toast: "400",
        tooltip: "500",
      },

      // ─────────────────────────────────────────────
      //  Transitions
      // ─────────────────────────────────────────────
      transitionDuration: {
        fast: "100ms",
        DEFAULT: "150ms",
        moderate: "250ms",
        slow: "400ms",
      },
    },
  },
  plugins: [],
};
