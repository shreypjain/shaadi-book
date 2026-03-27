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
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      colors: {
        // Brand: rose/pink — primary actions, headers
        brand: {
          50: "#fdf2f8",
          100: "#fce7f3",
          200: "#fbb6de",
          300: "#f985c5",
          400: "#f452ab",
          500: "#ec4899",
          600: "#db2777",
          700: "#be185d",
          800: "#9d174d",
          900: "#831843",
        },
        // Cream — page backgrounds, card surfaces
        cream: {
          50: "#fffbf5",
          100: "#fef6e8",
          200: "#fdecd2",
          300: "#fcd9a8",
        },
        // Amber — secondary accents, volume badges
        wedding: {
          gold: "#d97706",
          "gold-light": "#fbbf24",
          "gold-pale": "#fef3c7",
          rose: "#be185d",
          "rose-pale": "#fce7f3",
          marigold: "#f59e0b",
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
    },
  },
  plugins: [],
};

export default config;
