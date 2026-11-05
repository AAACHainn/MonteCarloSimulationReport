import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        "surface-raised": "hsl(var(--surface-raised) / <alpha-value>)",
        "input-background": "hsl(var(--input-background) / <alpha-value>)",
        "secondary-text": "hsl(var(--secondary-text) / <alpha-value>)",
        "hover": "hsl(var(--hover) / <alpha-value>)",
        "selected": "hsl(var(--selected) / <alpha-value>)",
        "primary-hover": "hsl(var(--primary-hover) / <alpha-value>)",
        "link": "hsl(var(--link) / <alpha-value>)",
        "positive": "hsl(var(--positive) / <alpha-value>)",
        "negative": "hsl(var(--negative) / <alpha-value>)",
        "warning": "hsl(var(--warning) / <alpha-value>)",
        "destructive-hover": "hsl(var(--destructive-hover) / <alpha-value>)",
        "positive-background": "hsl(var(--positive-background) / <alpha-value>)",
        "negative-background": "hsl(var(--negative-background) / <alpha-value>)",
        "warning-background": "hsl(var(--warning-background) / <alpha-value>)",
        "info-background": "hsl(var(--info-background) / <alpha-value>)",
        border: "hsl(var(--border) / <alpha-value>)",
        input: "hsl(var(--input) / <alpha-value>)",
        ring: "hsl(var(--ring) / <alpha-value>)",
        background: "hsl(var(--background) / <alpha-value>)",
        foreground: "hsl(var(--foreground) / <alpha-value>)",
        primary: {
          DEFAULT: "hsl(var(--primary) / <alpha-value>)",
          foreground: "hsl(var(--primary-foreground) / <alpha-value>)",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary) / <alpha-value>)",
          foreground: "hsl(var(--secondary-foreground) / <alpha-value>)",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive) / <alpha-value>)",
          foreground: "hsl(var(--destructive-foreground) / <alpha-value>)",
        },
        muted: {
          DEFAULT: "hsl(var(--muted) / <alpha-value>)",
          foreground: "hsl(var(--muted-foreground) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "hsl(var(--accent) / <alpha-value>)",
          foreground: "hsl(var(--accent-foreground) / <alpha-value>)",
        },
        card: {
          DEFAULT: "hsl(var(--card) / <alpha-value>)",
          foreground: "hsl(var(--card-foreground) / <alpha-value>)",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
  plugins: [],
};

export default config;
