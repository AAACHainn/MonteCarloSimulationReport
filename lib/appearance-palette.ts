// Shared explicit colors for DOM tokens and canvas rendering. No DOM reads.
export const appearancePalette = {
  "light": {
    "background": "#F9FAFB",
    "chartBackground": "#FFFFFF",
    "inputBackground": "#FFFFFF",
    "card": "#FFFFFF",
    "toolbar": "#FFFFFF",
    "surfaceRaised": "#FFFFFF",
    "hover": "#F1F5F9",
    "selectedBackground": "#EFF6FF",
    "border": "#E2E8F0",
    "inputBorder": "#E2E8F0",
    "foreground": "#151B28",
    "secondaryText": "#475569",
    "mutedForeground": "#64748B",
    "primary": "#2563EB",
    "primaryHover": "#1D4ED8",
    "primaryForeground": "#FFFFFF",
    "link": "#1D4ED8",
    "ring": "#2563EB",
    "positive": "#047857",
    "negative": "#DC2626",
    "warning": "#92400E",
    "destructive": "#DC2626",
    "destructiveHover": "#B91C1C",
    "destructiveForeground": "#FFFFFF",
    "positiveBackground": "#ECFDF5",
    "negativeBackground": "#FEF2F2",
    "warningBackground": "#FFFBEB",
    "infoBackground": "#EFF6FF",
    "overlay": "rgba(15,23,42,.35)"
  },
  "dark": {
    "background": "#0F141B",
    "chartBackground": "#111820",
    "inputBackground": "#111820",
    "card": "#151C26",
    "toolbar": "#151C26",
    "surfaceRaised": "#1B2533",
    "hover": "#243244",
    "selectedBackground": "#243244",
    "border": "#2B384A",
    "inputBorder": "#64748B",
    "foreground": "#E6EDF5",
    "secondaryText": "#A8B4C5",
    "mutedForeground": "#8796AA",
    "primary": "#2563EB",
    "primaryHover": "#1D4ED8",
    "primaryForeground": "#FFFFFF",
    "link": "#7AB0FF",
    "ring": "#7AB0FF",
    "positive": "#2DD4BF",
    "negative": "#F87171",
    "warning": "#FBBF24",
    "destructive": "#B91C1C",
    "destructiveHover": "#991B1B",
    "destructiveForeground": "#FFFFFF",
    "positiveBackground": "#113128",
    "negativeBackground": "#351F29",
    "warningBackground": "#332A16",
    "infoBackground": "#162B46",
    "overlay": "rgba(0,0,0,0.60)"
  }
} as const;

// Keep the existing HSL-channel contract, generated from the same HEX palette used by Canvas.
function hslChannels(hex: string) {
  const [r, g, b] = [1, 3, 5].map(i => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
  const high = Math.max(r, g, b), low = Math.min(r, g, b), delta = high - low, lightness = (high + low) / 2;
  const saturation = delta ? delta / (1 - Math.abs(2 * lightness - 1)) : 0;
  const hue = !delta ? 0 : ((high === r ? (g - b) / delta : high === g ? (b - r) / delta + 2 : (r - g) / delta + 4) * 60 + 360) % 360;
  return [hue.toFixed(3), (saturation * 100).toFixed(3) + "%", (lightness * 100).toFixed(3) + "%"].join(" ");
}
const extraRoles = {
  "surface-raised": "surfaceRaised", "input-background": "inputBackground", input: "inputBorder",
  "secondary-text": "secondaryText", hover: "hover", selected: "selectedBackground", "primary-hover": "primaryHover",
  link: "link", positive: "positive", negative: "negative", warning: "warning", "destructive-hover": "destructiveHover",
  "positive-background": "positiveBackground", "negative-background": "negativeBackground",
  "warning-background": "warningBackground", "info-background": "infoBackground",
} as const;
const darkRoles = { ...extraRoles, background: "background", foreground: "foreground", card: "card", "card-foreground": "foreground",
  primary: "primary", "primary-foreground": "primaryForeground", secondary: "hover", "secondary-foreground": "foreground",
  muted: "toolbar", "muted-foreground": "mutedForeground", accent: "positive", "accent-foreground": "background",
  destructive: "destructive", "destructive-foreground": "destructiveForeground", border: "border", ring: "ring" } as const;
function declarations(mode: "light" | "dark", roles: Record<string, keyof typeof appearancePalette.light>) {
  return Object.entries(roles).map(([key, role]) => "--" + key + ":" + hslChannels(appearancePalette[mode][role]) + ";").join("")
    + "--overlay:" + appearancePalette[mode].overlay + ";color-scheme:" + mode + ";";
}
// Higher specificity than globals.css :root, regardless of Next's stylesheet hoisting order.
export const APPEARANCE_THEME_CSS = ":root{" + declarations("light", extraRoles) + "}:root.dark{" + declarations("dark", darkRoles) + "}";
