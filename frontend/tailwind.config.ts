import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-space-grotesk)", "var(--font-sans)", "system-ui", "sans-serif"],
      },
      colors: {
        // Primary — Deep royal blue (Lake Pichola at dusk)
        brand: {
          50: "#eef4f9",
          100: "#d4e3f0",
          200: "#a8c5dc",
          300: "#6b9cc4",
          400: "#3b6fa3",
          500: "#254f7a",
          600: "#1e3a5f",
          700: "#152f52",
          800: "#0f2540",
          900: "#0a1829",
        },
        // Gold — Rajasthani palace gilding
        gold: {
          50: "#fbf8f1",
          100: "#f5efd9",
          200: "#ead9b0",
          300: "#dfc391",
          400: "#d4b576",
          500: "#c8a45c",
          600: "#b08940",
          700: "#8a6d30",
          800: "#6d5726",
          900: "#4d3e1b",
        },
        // Warm whites — marble/sandstone warmth
        cream: {
          50: "#fffbf7",
          100: "#faf8f5",
          200: "#f5f0e8",
          300: "#ede5d6",
        },
        // Legacy wedding aliases — now map to royal blue & gold
        wedding: {
          gold: "#c8a45c",
          "gold-light": "#dfc391",
          "gold-pale": "#f5efd9",
          rose: "#1e3a5f",
          "rose-pale": "#eef4f9",
          marigold: "#c8a45c",
        },
      },
      keyframes: {
        pulse_soft: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.5" },
        },
        "slide-up": {
          "0%": { transform: "translateY(8px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "success-pop": {
          "0%": { transform: "scale(0.8)", opacity: "0" },
          "60%": { transform: "scale(1.05)" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
      },
      animation: {
        pulse_soft: "pulse_soft 2s ease-in-out infinite",
        "slide-up": "slide-up 0.25s ease-out",
        "fade-in": "fade-in 0.2s ease-out",
        "success-pop": "success-pop 0.4s ease-out",
      },
      boxShadow: {
        card: "0 1px 3px rgba(0,0,0,0.05), 0 4px 12px rgba(0,0,0,0.04)",
        "card-hover": "0 4px 16px rgba(0,0,0,0.09), 0 1px 4px rgba(0,0,0,0.05)",
      },
    },
  },
  plugins: [],
};

export default config;
