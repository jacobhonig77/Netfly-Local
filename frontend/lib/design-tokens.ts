export const designTokens = {
  colors: {
    brandPrimary: "#4F46E5",
    brandSecondary: "#6366F1",
    brandAccent: "#818CF8",
    bgSidebar: "#0F1117",
    bgBase: "#F8F9FC",
    bgCard: "#FFFFFF",
    textPrimary: "#111827",
    textSecondary: "#6B7280",
    textMuted: "#9CA3AF",
    success: "#10B981",
    warning: "#F59E0B",
    danger: "#EF4444",
    info: "#3B82F6",
    border: "#E5E7EB",
    borderStrong: "#D1D5DB",
  },
  typography: {
    xs: 11,
    sm: 12,
    base: 14,
    md: 15,
    lg: 18,
    xl: 24,
    x2l: 32,
    x3l: 40,
  },
  layout: {
    sidebarWidth: 240,
    sidebarCollapsedWidth: 64,
    contentMaxWidth: 1440,
    cardRadius: 12,
    cardPadding: 24,
  },
};

export type DesignTokens = typeof designTokens;
