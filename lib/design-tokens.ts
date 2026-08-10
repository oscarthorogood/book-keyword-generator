/**
 * Design tokens for Untitled UI inspired design system
 */

export const colors = {
  // Primary
  primary: {
    50: "#f5f3ff",
    100: "#ede9fe",
    200: "#ddd6fe",
    300: "#c4b5fd",
    400: "#a78bfa",
    500: "#8b5cf6",
    600: "#7c3aed",
    700: "#6d28d9",
    800: "#5b21b6",
    900: "#3f0f7d",
  },
  // Secondary
  secondary: {
    50: "#f0f9ff",
    100: "#e0f2fe",
    200: "#bae6fd",
    300: "#7dd3fc",
    400: "#38bdf8",
    500: "#0ea5e9",
    600: "#0284c7",
    700: "#0369a1",
    800: "#075985",
    900: "#0c3d66",
  },
  // Neutral
  neutral: {
    0: "#ffffff",
    50: "#f9fafb",
    100: "#f3f4f6",
    200: "#e5e7eb",
    300: "#d1d5db",
    400: "#9ca3af",
    500: "#6b7280",
    600: "#4b5563",
    700: "#374151",
    800: "#1f2937",
    900: "#111827",
  },
  // Status
  success: "#10b981",
  warning: "#f59e0b",
  error: "#ef4444",
  info: "#3b82f6",
};

export const shadows = {
  xs: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
  sm: "0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)",
  md: "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)",
  lg: "0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)",
  xl: "0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)",
};

export const spacing = {
  xs: "0.5rem",
  sm: "0.75rem",
  md: "1rem",
  lg: "1.5rem",
  xl: "2rem",
  "2xl": "2.5rem",
  "3xl": "3rem",
  "4xl": "4rem",
};

export const borderRadius = {
  none: "0",
  sm: "0.375rem",
  md: "0.5rem",
  lg: "0.75rem",
  xl: "1rem",
  "2xl": "1.5rem",
  "3xl": "2rem",
  full: "9999px",
};

export const typography = {
  heading1: {
    fontSize: "2.25rem",
    fontWeight: 700,
    lineHeight: "2.5rem",
  },
  heading2: {
    fontSize: "1.875rem",
    fontWeight: 700,
    lineHeight: "2.25rem",
  },
  heading3: {
    fontSize: "1.5rem",
    fontWeight: 600,
    lineHeight: "2rem",
  },
  heading4: {
    fontSize: "1.25rem",
    fontWeight: 600,
    lineHeight: "1.75rem",
  },
  bodyLg: {
    fontSize: "1.125rem",
    fontWeight: 400,
    lineHeight: "1.75rem",
  },
  body: {
    fontSize: "1rem",
    fontWeight: 400,
    lineHeight: "1.5rem",
  },
  bodySm: {
    fontSize: "0.875rem",
    fontWeight: 400,
    lineHeight: "1.25rem",
  },
  bodyXs: {
    fontSize: "0.75rem",
    fontWeight: 400,
    lineHeight: "1rem",
  },
};
