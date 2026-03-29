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
        serif: ["var(--font-serif)", "Georgia", "serif"],
      },
      colors: {
        // Luxury Udaipur palette
        ivory: {
          DEFAULT: "#FAF7F2",
          card: "#FFFEFB",
        },
        gold: {
          DEFAULT: "#B8860B",
          50: "#fdf9ee",
          100: "#faf3d6",
          200: "#f5e7ad",
          300: "#EDE8E0",
          400: "#d4a017",
          500: "#B8860B",
          600: "#9a7009",
          700: "#7a5907",
          800: "#5c4205",
          900: "#3d2c03",
          light: "#EDE8E0",
          pale: "#FAF7F0",
        },
        burgundy: "#722F37",
        charcoal: "#2C2C2C",
        warmGray: "#6B6156",
        // Warm whites — sandstone warmth
        cream: {
          50: "#fffbf7",
          100: "#FAF7F2",
          200: "#f5f0e8",
          300: "#ede5d6",
        },
        // Legacy brand — remapped to warm gold tones for compatibility
        brand: {
          50: "#fdf9ee",
          100: "#EDE8E0",
          200: "#ddd4c8",
          300: "#c9b89a",
          400: "#B8860B",
          500: "#B8860B",
          600: "#B8860B",
          700: "#8a6408",
          800: "#6d5006",
          900: "#4d3804",
        },
        // Wedding aliases — updated to palace palette
        wedding: {
          gold: "#B8860B",
          "gold-light": "#EDE8E0",
          "gold-pale": "#FAF7F0",
          rose: "#722F37",
          "rose-pale": "#fdf5f6",
          marigold: "#B8860B",
        },
      },
      keyframes: {
        pulse_soft: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.5" },
        },
        "pulse-gold": {
          "0%, 100%": { opacity: "1", transform: "scale(1)" },
          "50%": { opacity: "0.6", transform: "scale(1.2)" },
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
        "pulse-gold": "pulse-gold 2s ease-in-out infinite",
        "slide-up": "slide-up 0.25s ease-out",
        "fade-in": "fade-in 0.2s ease-out",
        "success-pop": "success-pop 0.4s ease-out",
      },
      boxShadow: {
        card: "0 1px 3px rgba(139, 109, 71, 0.06), 0 4px 12px rgba(139, 109, 71, 0.05)",
        "card-hover":
          "0 4px 20px rgba(139, 109, 71, 0.12), 0 1px 4px rgba(139, 109, 71, 0.06)",
      },
    },
  },
  plugins: [],
};

export default config;
