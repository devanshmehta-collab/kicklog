import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "rgb(var(--bg) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        raised: "rgb(var(--raised) / <alpha-value>)",
        line: "rgb(var(--line) / <alpha-value>)",
        fg: "rgb(var(--fg) / <alpha-value>)",
        muted: "rgb(var(--muted) / <alpha-value>)",
        gain: "rgb(var(--gain) / <alpha-value>)",
        loss: "rgb(var(--loss) / <alpha-value>)",
        review: "rgb(var(--review) / <alpha-value>)",
        accent: "rgb(var(--accent) / <alpha-value>)",
      },
      borderRadius: { xl: "0.9rem", "2xl": "1.2rem" },
      fontFamily: { sans: ["Inter", "ui-sans-serif", "system-ui", "Segoe UI", "sans-serif"] },
    },
  },
  plugins: [],
} satisfies Config;
