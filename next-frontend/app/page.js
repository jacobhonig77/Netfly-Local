"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  BarChart,
  Bar,
  CartesianGrid,
  Tooltip,
  XAxis,
  YAxis,
  LineChart,
  Line,
  Legend,
} from "recharts";
import { SignIn, useAuth, useClerk, useUser } from "@clerk/nextjs";
import { apiGet, setApiTokenProvider } from "../lib/api";
import { fmtMoney, fmtPct, ymd } from "../lib/format";
import KpiCard from "../components/KpiCard";

const TABS = [
  { id: "sales", label: "Sales Overview", icon: "📊", section: "analytics" },
  { id: "insights", label: "Product Insights", icon: "🔍", section: "analytics" },
  { id: "business", label: "All-Time Overview", icon: "📈", section: "analytics" },
  { id: "goals", label: "Goals & KPIs", icon: "🎯", section: "analytics" },
  { id: "forecast", label: "Forecast", icon: "🔮", section: "planning" },
  { id: "flows", label: "Flows", icon: "🧩", section: "planning" },
  { id: "inventory", label: "Inventory", icon: "📦", section: "planning" },
  { id: "ntb", label: "New-To-Brand", icon: "👥", section: "customers" },
  { id: "data", label: "Data & Import", icon: "📥", section: "workspace" },
];

const INVTABS = [
  ["table", "Table"],
  ["history", "History"],
  ["insights", "Insights"],
];

const NAV_SECTIONS = [
  { key: "analytics", label: "Analytics" },
  { key: "planning", label: "Planning" },
  { key: "customers", label: "Customers" },
  { key: "workspace", label: "Workspace" },
];

const CHANNEL_LOGOS = {
  Amazon:
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
        <rect x="0" y="0" width="64" height="64" rx="14" fill="#FFFFFF"/>
        <path d="M25.8 22.6c2.1-1.6 5-2.5 8.5-2.5 6.3 0 10.1 3.2 10.1 8.5v12.4c0 1.6.1 3.1.6 4.3h-6c-.2-.7-.4-1.6-.5-2.3-1.8 2-4.2 3-7.4 3-4.7 0-8-2.7-8-6.9 0-4.9 3.8-7.5 10.3-7.5 1.7 0 3 .1 4.3.4v-.8c0-2.4-1.4-3.7-4.3-3.7-2.1 0-4.6.8-6.8 2.1l-.8-7zM37.7 36.3c-.9-.2-1.8-.3-2.9-.3-3.1 0-5 1.1-5 3.1 0 1.7 1.2 2.8 3.2 2.8 2.9 0 4.7-1.8 4.7-4.6v-1z" fill="#111111"/>
        <path d="M15 49.2c8.1 5 25.7 7.4 37.3 1.4 1.1-.6 2.2.7 1 1.8-3.2 3-10.8 5.6-18.3 6.2-8.5.7-16.3-1.3-21.2-5.5-.9-.7.1-2 1.2-1.3z" fill="#FF9900"/>
      </svg>`,
    ),
  Shopify:
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
        <rect x="0" y="0" width="64" height="64" rx="14" fill="#95BF47"/>
        <path d="M40.3 17.5c-.4-1.8-1.9-3.1-4.1-3.1-1 0-1.9.3-2.7.8-.8-1.2-2-1.9-3.7-1.9-4.3 0-8.6 3.3-10.8 8.4-.7 1.7-1.2 3.7-1.2 5.6l-3 1 .8 24.7L52 63V26l-11.7-8.5z" fill="#5E8E3E"/>
        <path d="M28.3 30.2c2.2 1.1 3.4 2.5 3.4 4.8 0 3.8-2.9 6.2-7.3 6.2-2.1 0-4.1-.5-5.3-1.2l.9-4.2c1.2.8 3 1.5 4.8 1.5 1.3 0 2-.5 2-1.3 0-.7-.6-1.2-2.2-2-2.2-1.1-3.6-2.6-3.6-4.9 0-3.5 2.7-5.9 7-5.9 2.1 0 3.8.4 4.8 1l-.8 4.1c-1-.6-2.3-1.1-4-1.1-1.4 0-2.1.5-2.1 1.2 0 .8.8 1.3 2.4 2z" fill="#FFFFFF"/>
      </svg>`,
    ),
};

const FORECAST_SCENARIOS = {
  base: {
    recent_weight: 0.6,
    mom_weight: 0.4,
    weekday_strength: 1.0,
    manual_multiplier: 1.0,
    promo_lift_pct: 0.0,
    content_lift_pct: 0.0,
    instock_rate: 1.0,
    growth_floor: 0.5,
    growth_ceiling: 1.8,
    volatility_multiplier: 1.0,
  },
  conservative: {
    recent_weight: 0.7,
    mom_weight: 0.3,
    weekday_strength: 0.8,
    manual_multiplier: 0.95,
    promo_lift_pct: 0.0,
    content_lift_pct: 0.0,
    instock_rate: 0.95,
    growth_floor: 0.4,
    growth_ceiling: 1.4,
    volatility_multiplier: 0.9,
  },
  aggressive: {
    recent_weight: 0.5,
    mom_weight: 0.5,
    weekday_strength: 1.1,
    manual_multiplier: 1.08,
    promo_lift_pct: 0.03,
    content_lift_pct: 0.02,
    instock_rate: 1.0,
    growth_floor: 0.6,
    growth_ceiling: 2.1,
    volatility_multiplier: 1.15,
  },
  promo_push: {
    recent_weight: 0.45,
    mom_weight: 0.55,
    weekday_strength: 1.15,
    manual_multiplier: 1.12,
    promo_lift_pct: 0.08,
    content_lift_pct: 0.03,
    instock_rate: 1.0,
    growth_floor: 0.65,
    growth_ceiling: 2.2,
    volatility_multiplier: 1.2,
  },
  inventory_constrained: {
    recent_weight: 0.7,
    mom_weight: 0.3,
    weekday_strength: 0.85,
    manual_multiplier: 0.9,
    promo_lift_pct: 0.0,
    content_lift_pct: 0.0,
    instock_rate: 0.88,
    growth_floor: 0.35,
    growth_ceiling: 1.3,
    volatility_multiplier: 0.85,
  },
};

function downloadCsv(filename, rows) {
  if (!rows || !rows.length) return;
  const headers = Object.keys(rows[0]);
  const body = rows.map((r) => headers.map((h) => JSON.stringify(r[h] ?? "")).join(",")).join("\n");
  const csv = `${headers.join(",")}\n${body}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function formatDayLabel(iso) {
  try {
    return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}

function formatMonthLabel(ym) {
  if (!ym) return "n/a";
  const d = new Date(`${ym}-01T00:00:00`);
  if (Number.isNaN(d.getTime())) return ym;
  return d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

function statusColor(status) {
  if (status === "OOS") return "#ef4444";
  if (status === "Critical") return "#f97316";
  if (status === "Restock") return "#eab308";
  if (status === "At Risk") return "#a3e635";
  if (status === "Healthy") return "#22c55e";
  if (status === "No Demand") return "#94a3b8";
  return "#94a3b8";
}

function sortRows(rows, key, dir = "asc") {
  const m = dir === "asc" ? 1 : -1;
  return [...(rows || [])].sort((a, b) => {
    let av = a?.[key];
    let bv = b?.[key];

    // Backward-compatible date sorting: if `date` is missing, fall back to display label.
    if (key === "date") {
      av = av ?? a?.date_label;
      bv = bv ?? b?.date_label;
    }

    const keyLooksDate = /date|month|updated|created/i.test(String(key || ""));
    if (keyLooksDate) {
      const at = Date.parse(String(av ?? ""));
      const bt = Date.parse(String(bv ?? ""));
      if (Number.isFinite(at) && Number.isFinite(bt)) return (at - bt) * m;
    }
    if (typeof av === "number" || typeof bv === "number") return ((Number(av || 0) - Number(bv || 0)) * m);
    return String(av ?? "").localeCompare(String(bv ?? "")) * m;
  });
}

function uid(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function shortMoney(v) {
  const n = Number(v || 0);
  if (Math.abs(n) >= 1000000) return `$${(n / 1000000).toFixed(2)}M`;
  if (Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(2)}K`;
  return `$${n.toFixed(0)}`;
}

function pctSigned(v, d = 1) {
  const n = Number(v || 0);
  const sign = n > 0 ? "+" : "";
  return `${sign}${(n * 100).toFixed(d)}%`;
}

function fmtAgo(iso) {
  if (!iso) return "n/a";
  const now = Date.now();
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return iso;
  const sec = Math.max(1, Math.round((now - t) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.round(hr / 24);
  return `${d}d ago`;
}

function fmtRange(start, end) {
  if (!start || !end) return "n/a";
  const s = new Date(`${start}T00:00:00`);
  const e = new Date(`${end}T00:00:00`);
  return `${s.toLocaleDateString(undefined, { month: "short", day: "numeric" })} - ${e.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

function fmtLongDate(d) {
  if (!d) return "n/a";
  const x = new Date(`${d}T00:00:00`);
  if (Number.isNaN(x.getTime())) return d;
  return x.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function calcCompareRangeJs(startDate, endDate, mode) {
  if (!startDate || !endDate) return { start: "", end: "" };
  const s = new Date(`${startDate}T00:00:00`);
  const e = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return { start: "", end: "" };
  const m = (mode || "previous_period").toLowerCase();
  if (m === "previous_year") {
    const cs = new Date(s);
    cs.setFullYear(cs.getFullYear() - 1);
    const ce = new Date(e);
    ce.setFullYear(ce.getFullYear() - 1);
    return { start: ymd(cs), end: ymd(ce) };
  }
  if (m === "mom") {
    const pm = s.getMonth() - 1;
    const py = pm < 0 ? s.getFullYear() - 1 : s.getFullYear();
    const month = pm < 0 ? 11 : pm;
    const cs = new Date(py, month, Math.min(s.getDate(), new Date(py, month + 1, 0).getDate()));
    const ce = new Date(py, month, Math.min(e.getDate(), new Date(py, month + 1, 0).getDate()));
    return { start: ymd(cs), end: ymd(ce) };
  }
  const days = Math.max(1, Math.round((e.getTime() - s.getTime()) / 86400000) + 1);
  const cs = new Date(s.getTime() - days * 86400000);
  const ce = new Date(e.getTime() - days * 86400000);
  return { start: ymd(cs), end: ymd(ce) };
}

export default function Page() {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const { signOut } = useClerk();
  const { user } = useUser();
  const [tokenReady, setTokenReady] = useState(false);
  const [activeTab, setActiveTab] = useState("sales");
  const [workspaceChannel, setWorkspaceChannel] = useState("Amazon");
  const [theme, setTheme] = useState("light");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [invSub, setInvSub] = useState("table");
  const [meta, setMeta] = useState(null);
  const [preset, setPreset] = useState("MTD");
  const [compareMode, setCompareMode] = useState("mom");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [showDateModal, setShowDateModal] = useState(false);
  const [draftPreset, setDraftPreset] = useState("MTD");
  const [draftCompareMode, setDraftCompareMode] = useState("mom");
  const [compareEnabled, setCompareEnabled] = useState(true);
  const [draftCompareEnabled, setDraftCompareEnabled] = useState(true);
  const [draftStartDate, setDraftStartDate] = useState("");
  const [draftEndDate, setDraftEndDate] = useState("");

  const [productTag, setProductTag] = useState("");
  const [granularity, setGranularity] = useState("day");
  const [metric, setMetric] = useState("sales");

  const [salesSummary, setSalesSummary] = useState(null);
  const [daily, setDaily] = useState([]);
  const [pivotRows, setPivotRows] = useState([]);
  const [productSummary, setProductSummary] = useState([]);
  const [productTrend, setProductTrend] = useState([]);
  const [skuSummary, setSkuSummary] = useState([]);
  const [topMovers, setTopMovers] = useState(null);
  const [monthly, setMonthly] = useState({ rows: [], summary: {} });
  const [forecast, setForecast] = useState(null);
  const [inventory, setInventory] = useState({ snapshot: null, rows: [], by_line: {} });
  const [inventoryHistory, setInventoryHistory] = useState([]);
  const [inventoryInsights, setInventoryInsights] = useState(null);
  const [ntbData, setNtbData] = useState({ rows: [], updated_from: null, updated_to: null, imported_at: null });
  const [loading, setLoading] = useState(false);
  const [w7, setW7] = useState(40);
  const [w30, setW30] = useState(30);
  const [w60, setW60] = useState(20);
  const [w90, setW90] = useState(10);
  const [targetWos, setTargetWos] = useState(8);
  const [autoSlack, setAutoSlack] = useState(true);
  const [importHistory, setImportHistory] = useState([]);
  const [coverageRows, setCoverageRows] = useState([]);
  const [coverageSort, setCoverageSort] = useState({ key: "date", dir: "asc" });
  const [showCoverage, setShowCoverage] = useState(false);
  const [showImportHistory, setShowImportHistory] = useState(false);
  const [uploadFiles, setUploadFiles] = useState([]);
  const [inventoryUploadFiles, setInventoryUploadFiles] = useState([]);
  const [ntbUploadFiles, setNtbUploadFiles] = useState([]);
  const [shopifyIqbarFiles, setShopifyIqbarFiles] = useState([]);
  const [shopifyIqmixFiles, setShopifyIqmixFiles] = useState([]);
  const [shopifyIqjoeFiles, setShopifyIqjoeFiles] = useState([]);
  const [historySnapshotId, setHistorySnapshotId] = useState("");
  const [historySnapshot, setHistorySnapshot] = useState({ snapshot: null, rows: [], by_line: {} });
  const [invSort, setInvSort] = useState({ key: "wos", dir: "asc" });
  const [ntbSort, setNtbSort] = useState({ key: "month", dir: "asc" });
  const [salesSort, setSalesSort] = useState({ key: "date", dir: "asc" });
  const [expandedSku, setExpandedSku] = useState("");
  const [skuChart, setSkuChart] = useState({ rows: [], loading: false });
  const [skuMetric, setSkuMetric] = useState("sales");
  const [apiError, setApiError] = useState("");
  const [skuSummaryAll, setSkuSummaryAll] = useState([]);
  const [pnlSummary, setPnlSummary] = useState(null);

  // New premium tabs state (local persistence)
  const [anomalyFilter, setAnomalyFilter] = useState("all");
  const [goals, setGoals] = useState([]);
  const [dbGoals, setDbGoals] = useState([]);
  const [showDbGoalsTable, setShowDbGoalsTable] = useState(false);
  const [dbGoalEdits, setDbGoalEdits] = useState({});
  const [dbGoalMsg, setDbGoalMsg] = useState("");
  const [goalsYearFilter, setGoalsYearFilter] = useState("all");
  const [showGoalEditor, setShowGoalEditor] = useState(false);
  const [goalDraft, setGoalDraft] = useState({
    id: "",
    name: "",
    metric: "total_revenue",
    period: "monthly",
    year: new Date().getFullYear(),
    month: new Date().getMonth() + 1,
    quarter: 1,
    targetValue: 0,
  });
  const [profitSearch, setProfitSearch] = useState("");
  const [cogsMap, setCogsMap] = useState({});
  const [fbaSkuMap, setFbaSkuMap] = useState({});
  const [cogsUploadFile, setCogsUploadFile] = useState(null);
  const [cogsImportMsg, setCogsImportMsg] = useState("");
  const [feeCfg, setFeeCfg] = useState({ fbaFeePercent: 15, referralFeePercent: 8, adSpendPercent: 12 });
  const [promoView, setPromoView] = useState("timeline");
  const [promotions, setPromotions] = useState([]);
  const [showPromoEditor, setShowPromoEditor] = useState(false);
  const [promoDraft, setPromoDraft] = useState({
    id: "",
    name: "",
    type: "sale",
    startDate: "",
    endDate: "",
    productLine: "All",
    discountPct: "",
    notes: "",
  });
  const [reportSchedules, setReportSchedules] = useState([]);
  const [reportHistory, setReportHistory] = useState([]);
  const [showScheduleEditor, setShowScheduleEditor] = useState(false);
  const [scheduleDraft, setScheduleDraft] = useState({
    id: "",
    name: "",
    template: "weekly_performance",
    frequency: "weekly",
    dayOfWeek: 1,
    dayOfMonth: 1,
    deliveryTime: "08:00",
    channels: ["slack"],
    email: "",
    slackChannel: "#amazon-alerts",
    recipientName: "",
    brandingLogo: "",
    isActive: true,
  });
  const [userRole, setUserRole] = useState("Viewer");
  const [flows, setFlows] = useState([]);
  const [selectedFlowId, setSelectedFlowId] = useState("");
  const [selectedFlowNode, setSelectedFlowNode] = useState({ kind: "trigger", index: -1 });
  const [flowRuns, setFlowRuns] = useState([]);
  const [flowAlerts, setFlowAlerts] = useState([]);
  const [showBellMenu, setShowBellMenu] = useState(false);
  const [lastFlowRefreshKey, setLastFlowRefreshKey] = useState("");
  const channelParams = useMemo(() => ({ channel: workspaceChannel }), [workspaceChannel]);
  const visibleTabs = useMemo(
    () => TABS.filter((t) => !(workspaceChannel === "Shopify" && (t.id === "inventory" || t.id === "insights" || t.id === "ntb"))),
    [workspaceChannel],
  );

  // Forecast assumption controls
  const [forecastScenario, setForecastScenario] = useState("base");
  const [appliedForecastScenario, setAppliedForecastScenario] = useState("base");
  const [fRecentWeight, setFRecentWeight] = useState(0.6);
  const [fMomWeight, setFMomWeight] = useState(0.4);
  const [fWeekdayStrength, setFWeekdayStrength] = useState(1.0);
  const [fManualMultiplier, setFManualMultiplier] = useState(1.0);
  const [fPromoLift, setFPromoLift] = useState(0.0);
  const [fContentLift, setFContentLift] = useState(0.0);
  const [fInstockRate, setFInstockRate] = useState(1.0);
  const [fGrowthFloor, setFGrowthFloor] = useState(0.5);
  const [fGrowthCeiling, setFGrowthCeiling] = useState(1.8);
  const [fVolatility, setFVolatility] = useState(1.0);
  const [aRecentWeight, setARecentWeight] = useState(0.6);
  const [aMomWeight, setAMomWeight] = useState(0.4);
  const [aWeekdayStrength, setAWeekdayStrength] = useState(1.0);
  const [aManualMultiplier, setAManualMultiplier] = useState(1.0);
  const [aPromoLift, setAPromoLift] = useState(0.0);
  const [aContentLift, setAContentLift] = useState(0.0);
  const [aInstockRate, setAInstockRate] = useState(1.0);
  const [aGrowthFloor, setAGrowthFloor] = useState(0.5);
  const [aGrowthCeiling, setAGrowthCeiling] = useState(1.8);
  const [aVolatility, setAVolatility] = useState(1.0);

  const insightProductOptions = useMemo(() => {
    const tags = (inventory?.rows || [])
      .map((r) => String(r?.tag || "").trim())
      .filter((t) => t && !t.toLowerCase().includes("manual override"));
    return Array.from(new Set(tags)).sort((a, b) => a.localeCompare(b));
  }, [inventory?.rows]);

  const insightProductLineByTag = useMemo(() => {
    const map = {};
    (inventory?.rows || []).forEach((r) => {
      const tag = String(r?.tag || "").trim();
      const line = String(r?.product_line || "").trim();
      if (tag && line && !map[tag]) map[tag] = line;
    });
    return map;
  }, [inventory?.rows]);
  const selectedInsightProductLine = useMemo(
    () => insightProductLineByTag[productTag] || "IQBAR",
    [insightProductLineByTag, productTag],
  );

  useEffect(() => {
    if (!insightProductOptions.length) return;
    if (!productTag || !insightProductLineByTag[productTag]) {
      setProductTag(insightProductOptions[0]);
    }
  }, [insightProductOptions, insightProductLineByTag, productTag]);

  function applyForecastScenario(name) {
    const s = FORECAST_SCENARIOS[name] || FORECAST_SCENARIOS.base;
    setForecastScenario(name);
    setFRecentWeight(Number(s.recent_weight));
    setFMomWeight(Number(s.mom_weight));
    setFWeekdayStrength(Number(s.weekday_strength));
    setFManualMultiplier(Number(s.manual_multiplier));
    setFPromoLift(Number(s.promo_lift_pct));
    setFContentLift(Number(s.content_lift_pct));
    setFInstockRate(Number(s.instock_rate));
    setFGrowthFloor(Number(s.growth_floor));
    setFGrowthCeiling(Number(s.growth_ceiling));
    setFVolatility(Number(s.volatility_multiplier));
  }

  function applyForecastFactors() {
    setAppliedForecastScenario(forecastScenario);
    setARecentWeight(fRecentWeight);
    setAMomWeight(fMomWeight);
    setAWeekdayStrength(fWeekdayStrength);
    setAManualMultiplier(fManualMultiplier);
    setAPromoLift(fPromoLift);
    setAContentLift(fContentLift);
    setAInstockRate(fInstockRate);
    setAGrowthFloor(fGrowthFloor);
    setAGrowthCeiling(fGrowthCeiling);
    setAVolatility(fVolatility);
  }

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !tokenReady) return;
    apiGet("/dashboard", { ...channelParams, preset, include_data: false })
      .then((payload) => {
        const m = payload?.meta || null;
        setMeta(m);
        if (payload?.resolved_dates?.start_date && payload?.resolved_dates?.end_date) {
          setStartDate(payload.resolved_dates.start_date);
          setEndDate(payload.resolved_dates.end_date);
        } else if (m?.max_date || m?.min_date) {
          const maxD = new Date(`${m.max_date || m.min_date}T00:00:00`);
          const minD = new Date(`${m.min_date || m.max_date}T00:00:00`);
          let s = new Date(minD);
          if (preset === "YTD") s = new Date(maxD.getFullYear(), 0, 1);
          if (preset === "MTD") s = new Date(maxD.getFullYear(), maxD.getMonth(), 1);
          if (preset === "Last 30") s = new Date(maxD.getTime() - 29 * 86400000);
          if (preset === "Last 90") s = new Date(maxD.getTime() - 89 * 86400000);
          setStartDate(ymd(s));
          setEndDate(m.max_date || ymd(maxD));
        }

        const workspace = payload?.workspace || {};
        setAutoSlack(Boolean(workspace?.settings?.auto_slack_on_import));
        setImportHistory(workspace?.import_history?.rows || []);
        setCoverageRows(workspace?.import_date_coverage?.rows || []);
        setNtbData(workspace?.ntb_monthly || { rows: [], updated_from: null, updated_to: null, imported_at: null });
        setDbGoals(workspace?.goals?.rows || []);

        const role = String(payload?.auth?.role || "").trim().toLowerCase();
        if (role === "admin" || role === "viewer") setUserRole(role === "admin" ? "Admin" : "Viewer");
      })
      .catch((err) => {
        const today = new Date();
        const fallbackStart = new Date(today.getTime() - 29 * 86400000);
        setStartDate(ymd(fallbackStart));
        setEndDate(ymd(today));
        setApiError(String(err?.message || err || "Failed to load dashboard bootstrap"));
      });
  }, [channelParams, preset, isLoaded, isSignedIn, tokenReady]);

  useEffect(() => {
    const stored = typeof window !== "undefined" ? window.localStorage.getItem("iq_theme") : null;
    const nextTheme = stored === "dark" ? "dark" : "light";
    setTheme(nextTheme);
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("data-theme", nextTheme);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const storedChannel = window.localStorage.getItem("iq_workspace_channel_v1");
      if (storedChannel === "Shopify" || storedChannel === "Amazon") setWorkspaceChannel(storedChannel);
      setGoals(JSON.parse(window.localStorage.getItem("iq_goals_v1") || "[]"));
      setCogsMap(JSON.parse(window.localStorage.getItem("iq_cogs_v1") || "{}"));
      setFbaSkuMap(JSON.parse(window.localStorage.getItem("iq_fba_sku_v1") || "{}"));
      setFeeCfg({ ...feeCfg, ...(JSON.parse(window.localStorage.getItem("iq_fee_cfg_v1") || "{}")) });
      setPromotions(JSON.parse(window.localStorage.getItem("iq_promotions_v1") || "[]"));
      setReportSchedules(JSON.parse(window.localStorage.getItem("iq_report_schedules_v1") || "[]"));
      setReportHistory(JSON.parse(window.localStorage.getItem("iq_report_history_v1") || "[]"));
      setFlows(JSON.parse(window.localStorage.getItem("iq_flows_v1") || "[]"));
      setFlowRuns(JSON.parse(window.localStorage.getItem("iq_flow_runs_v1") || "[]"));
      setFlowAlerts(JSON.parse(window.localStorage.getItem("iq_flow_alerts_v1") || "[]"));
    } catch {
      // Ignore malformed local state and continue.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("iq_goals_v1", JSON.stringify(goals || []));
  }, [goals]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("iq_cogs_v1", JSON.stringify(cogsMap || {}));
  }, [cogsMap]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("iq_fba_sku_v1", JSON.stringify(fbaSkuMap || {}));
  }, [fbaSkuMap]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("iq_fee_cfg_v1", JSON.stringify(feeCfg || {}));
  }, [feeCfg]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("iq_promotions_v1", JSON.stringify(promotions || []));
  }, [promotions]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("iq_report_schedules_v1", JSON.stringify(reportSchedules || []));
  }, [reportSchedules]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("iq_report_history_v1", JSON.stringify(reportHistory || []));
  }, [reportHistory]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("iq_workspace_channel_v1", workspaceChannel);
  }, [workspaceChannel]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("iq_flows_v1", JSON.stringify(flows || []));
  }, [flows]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("iq_flow_runs_v1", JSON.stringify(flowRuns || []));
  }, [flowRuns]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("iq_flow_alerts_v1", JSON.stringify(flowAlerts || []));
  }, [flowAlerts]);

  useEffect(() => {
    if (!flows.length) {
      setSelectedFlowId("");
      return;
    }
    if (!selectedFlowId || !(flows || []).some((f) => f.id === selectedFlowId)) {
      setSelectedFlowId(flows[0].id);
    }
  }, [flows, selectedFlowId]);

  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && String(e.key).toLowerCase() === "k") {
        e.preventDefault();
        setShowCommandPalette(true);
      }
      if (e.key === "Escape") {
        setShowCommandPalette(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!meta?.max_date || !meta?.min_date) return;
    const maxD = new Date(`${meta.max_date}T00:00:00`);
    let s = new Date(`${meta.min_date}T00:00:00`);
    if (preset === "YTD") s = new Date(maxD.getFullYear(), 0, 1);
    if (preset === "MTD") s = new Date(maxD.getFullYear(), maxD.getMonth(), 1);
    if (preset === "Last 30") s = new Date(maxD.getTime() - 29 * 86400000);
    if (preset === "Last 90") s = new Date(maxD.getTime() - 89 * 86400000);
    if (preset !== "Custom") {
      setStartDate(ymd(s));
      setEndDate(meta.max_date);
    }
  }, [preset, meta]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !tokenReady) return;
    if (!startDate || !endDate) return;
    setLoading(true);
    setApiError("");
    apiGet("/dashboard", {
      ...channelParams,
      start_date: startDate,
      end_date: endDate,
      compare_mode: compareMode,
      granularity,
      product_line: selectedInsightProductLine,
      product_tag: productTag || undefined,
      w7,
      w30,
      w60,
      w90,
      target_wos: targetWos,
      recent_weight: aRecentWeight,
      mom_weight: aMomWeight,
      weekday_strength: aWeekdayStrength,
      manual_multiplier: aManualMultiplier,
      promo_lift_pct: aPromoLift,
      content_lift_pct: aContentLift,
      instock_rate: aInstockRate,
      growth_floor: aGrowthFloor,
      growth_ceiling: aGrowthCeiling,
      volatility_multiplier: aVolatility,
      include_data: true,
    }, { timeout_ms: 35000 })
      .then((payload) => {
        setSalesSummary(payload?.sales?.summary || null);
        setDaily(payload?.sales?.daily?.rows || []);
        setPivotRows(payload?.sales?.pivot?.rows || []);
        setProductSummary(payload?.product?.summary?.rows || []);
        setProductTrend(payload?.product?.trend?.rows || []);
        setSkuSummary(payload?.product?.sku_summary?.rows || []);
        setSkuSummaryAll([
          ...(payload?.product?.sku_summary_all?.iqbar?.rows || []),
          ...(payload?.product?.sku_summary_all?.iqmix?.rows || []),
          ...(payload?.product?.sku_summary_all?.iqjoe?.rows || []),
        ]);
        setTopMovers(payload?.product?.top_movers || null);
        setMonthly(payload?.business?.monthly || { rows: [], summary: {} });
        setForecast(payload?.forecast?.projection || null);
        setInventory(payload?.inventory?.latest || { snapshot: null, rows: [], by_line: {} });
        setInventoryHistory(payload?.inventory?.history?.rows || []);
        setInventoryInsights(payload?.inventory?.insights || null);
        setPnlSummary(payload?.business?.pnl_summary || null);

        const errors = payload?.errors || {};
        const keys = Object.keys(errors);
        if (keys.length) {
          setApiError(`Some data failed to load: ${errors[keys[0]]}`);
        }
      })
      .catch((err) => setApiError(String(err?.message || err || "Unknown API error")))
      .finally(() => setLoading(false));
  }, [startDate, endDate, compareMode, granularity, productTag, selectedInsightProductLine, w7, w30, w60, w90, targetWos, aRecentWeight, aMomWeight, aWeekdayStrength, aManualMultiplier, aPromoLift, aContentLift, aInstockRate, aGrowthFloor, aGrowthCeiling, aVolatility, channelParams, workspaceChannel, isLoaded, isSignedIn, tokenReady]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) {
      setApiTokenProvider(null);
      setTokenReady(false);
      return;
    }
    setApiTokenProvider(() => getToken({ skipCache: true }));
    setTokenReady(true);
    return () => setApiTokenProvider(null);
  }, [isLoaded, isSignedIn, getToken]);

  useEffect(() => {
    if (!historySnapshotId) return;
    apiGet("/api/inventory/snapshot", {
      snapshot_id: historySnapshotId,
      w7,
      w30,
      w60,
      w90,
      target_wos: targetWos,
    }).then((data) => setHistorySnapshot(data || { snapshot: null, rows: [], by_line: {} }));
  }, [historySnapshotId, w7, w30, w60, w90, targetWos]);

  useEffect(() => {
    if (historySnapshotId || !inventoryHistory.length) return;
    setHistorySnapshotId(String(inventoryHistory[inventoryHistory.length - 1].id));
  }, [inventoryHistory, historySnapshotId]);

  useEffect(() => {
    if (workspaceChannel === "Shopify" && activeTab === "inventory") {
      setActiveTab("sales");
    }
  }, [workspaceChannel, activeTab]);

  useEffect(() => {
    if (!visibleTabs.some((t) => t.id === activeTab)) {
      setActiveTab(visibleTabs[0]?.id || "sales");
    }
  }, [visibleTabs, activeTab]);

  useEffect(() => {
    if (!expandedSku || !meta?.max_date) return;
    const end = new Date(`${meta.max_date}T00:00:00`);
    const start = new Date(end.getTime() - 29 * 86400000);
    setSkuChart((s) => ({ ...s, loading: true }));
    apiGet("/api/product/sku-trend", {
      sku: expandedSku,
      start_date: ymd(start),
      end_date: ymd(end),
      metric: skuMetric,
      ...channelParams,
    })
      .then((res) => setSkuChart({ rows: res.rows || [], loading: false }))
      .catch(() => setSkuChart({ rows: [], loading: false }));
  }, [expandedSku, skuMetric, meta, channelParams]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (loading || !salesSummary || !endDate) return;
    const key = `${endDate}|${startDate}|${compareMode}`;
    if (key === lastFlowRefreshKey) return;
    setLastFlowRefreshKey(key);
    runFlowsByTrigger("on_data_refresh", "auto-refresh");
  }, [loading, salesSummary, endDate, startDate, compareMode, lastFlowRefreshKey]);

  const skuChartData = useMemo(() => {
    const rows = skuChart.rows || [];
    if (!rows.length) return [];
    const actual = rows.map((r) => ({ date: r.date, label: formatDayLabel(r.date), actual: Number(r.value || 0), forecast: null }));
    const avg = actual.reduce((s, r) => s + r.actual, 0) / Math.max(1, actual.length);
    const lastDate = new Date(`${actual[actual.length - 1].date}T00:00:00`);
    const future = [];
    for (let i = 1; i <= 30; i += 1) {
      const d = new Date(lastDate.getTime() + i * 86400000);
      const wd = d.getDay();
      const wdMult = wd === 0 || wd === 6 ? 0.92 : 1.04;
      future.push({
        date: ymd(d),
        label: formatDayLabel(ymd(d)),
        actual: null,
        forecast: Math.max(0, avg * wdMult),
      });
    }
    if (actual.length) {
      future.unshift({
        date: actual[actual.length - 1].date,
        label: actual[actual.length - 1].label,
        actual: null,
        forecast: actual[actual.length - 1].actual,
      });
    }
    return [...actual, ...future];
  }, [skuChart.rows]);

  // Build per-product-line trend data for multi-line chart
  const trendByLine = useMemo(() => {
    const periodMap = {};
    for (const r of productTrend || []) {
      if (!periodMap[r.period]) periodMap[r.period] = { period: r.period };
      periodMap[r.period][r.product_line] = Number(r[metric] || 0);
    }
    return Object.values(periodMap).sort((a, b) => (a.period > b.period ? 1 : -1));
  }, [productTrend, metric]);

  const businessBest = useMemo(() => {
    const rows = (monthly?.rows || []).map((r) => {
      const iqbar = Number(r.iqbar || 0);
      const iqmix = Number(r.iqmix || 0);
      const iqjoe = Number(r.iqjoe || 0);
      const total = Number(r.total || r.grand_total || (iqbar + iqmix + iqjoe));
      return { month: r.month, iqbar, iqmix, iqjoe, total };
    });
    if (!rows.length) {
      return {
        bestTotal: { value: 0, note: "n/a" },
        bestIqbar: { value: 0, note: "n/a" },
        bestIqmix: { value: 0, note: "n/a" },
        bestIqjoe: { value: 0, note: "n/a" },
      };
    }
    const maxBy = (key) => rows.reduce((a, b) => (Number(b[key] || 0) > Number(a[key] || 0) ? b : a), rows[0]);
    const bt = maxBy("total");
    const bb = maxBy("iqbar");
    const bm = maxBy("iqmix");
    const bj = maxBy("iqjoe");
    return {
      bestTotal: { value: bt.total, note: formatMonthLabel(bt.month) },
      bestIqbar: { value: bb.iqbar, note: formatMonthLabel(bb.month) },
      bestIqmix: { value: bm.iqmix, note: formatMonthLabel(bm.month) },
      bestIqjoe: { value: bj.iqjoe, note: formatMonthLabel(bj.month) },
    };
  }, [monthly]);

  const monthGoalMap = useMemo(() => {
    const out = {};
    const anchor = endDate || meta?.max_date || "";
    if (!anchor) return out;
    const d = new Date(`${anchor}T00:00:00`);
    if (Number.isNaN(d.getTime())) return out;
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    (dbGoals || []).forEach((r) => {
      if (Number(r.year) !== y || Number(r.month) !== m) return;
      const key = String(r.product_line || "").toUpperCase();
      out[key] = Number(r.goal || 0);
    });
    if (!out.TOTAL) {
      const sumLines = Number(out.IQBAR || 0) + Number(out.IQMIX || 0) + Number(out.IQJOE || 0);
      if (sumLines > 0) out.TOTAL = sumLines;
    }
    return out;
  }, [dbGoals, endDate, meta?.max_date]);

  const isMtdSelected = preset === "MTD" || preset === "This Month";

  const salesKpis = useMemo(() => {
    if (!salesSummary) return [];
    const cards = [
      { label: "Grand Total", value: salesSummary.current.grand_total, delta: salesSummary.deltas.grand_total },
      { label: "IQBAR", value: salesSummary.current.iqbar, delta: salesSummary.deltas.iqbar },
      { label: "IQMIX", value: salesSummary.current.iqmix, delta: salesSummary.deltas.iqmix },
      { label: "IQJOE", value: salesSummary.current.iqjoe, delta: salesSummary.deltas.iqjoe },
    ];
    if (!isMtdSelected) return cards;

    const linearTotal = Number(salesSummary?.mtd?.linear?.projected_total || 0);
    const dynamicTotal = Number(forecast?.projected_total || salesSummary?.mtd?.dynamic?.projected_total || 0);
    const currentTotal = Number(salesSummary?.current?.grand_total || 0);
    const currentIqbar = Number(salesSummary?.current?.iqbar || 0);
    const currentIqmix = Number(salesSummary?.current?.iqmix || 0);
    const currentIqjoe = Number(salesSummary?.current?.iqjoe || 0);
    const linearScale = currentTotal > 0 ? (linearTotal / currentTotal) : 0;
    const dynamicScale = currentTotal > 0 ? (dynamicTotal / currentTotal) : 0;
    const linearByLine = {
      TOTAL: linearTotal,
      IQBAR: currentIqbar * linearScale,
      IQMIX: currentIqmix * linearScale,
      IQJOE: currentIqjoe * linearScale,
    };
    const dynamicByLine = {
      TOTAL: dynamicTotal,
      IQBAR: currentIqbar * dynamicScale,
      IQMIX: currentIqmix * dynamicScale,
      IQJOE: currentIqjoe * dynamicScale,
    };
    const bestByLine = {
      TOTAL: Number(businessBest?.bestTotal?.value || 0),
      IQBAR: Number(businessBest?.bestIqbar?.value || 0),
      IQMIX: Number(businessBest?.bestIqmix?.value || 0),
      IQJOE: Number(businessBest?.bestIqjoe?.value || 0),
    };
    const bestNoteByLine = {
      TOTAL: businessBest?.bestTotal?.note || "n/a",
      IQBAR: businessBest?.bestIqbar?.note || "n/a",
      IQMIX: businessBest?.bestIqmix?.note || "n/a",
      IQJOE: businessBest?.bestIqjoe?.note || "n/a",
    };
    const goalDelta = (projected, key) => {
      const g = Number(monthGoalMap[key] || 0);
      if (g <= 0) return null;
      return (Number(projected || 0) / g) - 1;
    };
    const paceBestNote = (projected, key) => {
      const best = Number(bestByLine[key] || 0);
      if (best <= 0) return "";
      if (Number(projected || 0) >= best) return `Best month pace unlocked (${bestNoteByLine[key]})`;
      return "";
    };

    cards.push(
      { label: "Linear Pace · Grand Total", value: linearByLine.TOTAL, delta: goalDelta(linearByLine.TOTAL, "TOTAL"), deltaLabel: "vs goal", note: paceBestNote(linearByLine.TOTAL, "TOTAL") },
      { label: "Linear Pace · IQBAR", value: linearByLine.IQBAR, delta: goalDelta(linearByLine.IQBAR, "IQBAR"), deltaLabel: "vs goal", note: paceBestNote(linearByLine.IQBAR, "IQBAR") },
      { label: "Linear Pace · IQMIX", value: linearByLine.IQMIX, delta: goalDelta(linearByLine.IQMIX, "IQMIX"), deltaLabel: "vs goal", note: paceBestNote(linearByLine.IQMIX, "IQMIX") },
      { label: "Linear Pace · IQJOE", value: linearByLine.IQJOE, delta: goalDelta(linearByLine.IQJOE, "IQJOE"), deltaLabel: "vs goal", note: paceBestNote(linearByLine.IQJOE, "IQJOE") },
    );
    cards.push(
      { label: "Dynamic Pace · Grand Total", value: dynamicByLine.TOTAL, delta: goalDelta(dynamicByLine.TOTAL, "TOTAL"), deltaLabel: "vs goal", note: paceBestNote(dynamicByLine.TOTAL, "TOTAL") },
      { label: "Dynamic Pace · IQBAR", value: dynamicByLine.IQBAR, delta: goalDelta(dynamicByLine.IQBAR, "IQBAR"), deltaLabel: "vs goal", note: paceBestNote(dynamicByLine.IQBAR, "IQBAR") },
      { label: "Dynamic Pace · IQMIX", value: dynamicByLine.IQMIX, delta: goalDelta(dynamicByLine.IQMIX, "IQMIX"), deltaLabel: "vs goal", note: paceBestNote(dynamicByLine.IQMIX, "IQMIX") },
      { label: "Dynamic Pace · IQJOE", value: dynamicByLine.IQJOE, delta: goalDelta(dynamicByLine.IQJOE, "IQJOE"), deltaLabel: "vs goal", note: paceBestNote(dynamicByLine.IQJOE, "IQJOE") },
    );
    return cards;
  }, [salesSummary, forecast?.projected_total, isMtdSelected, businessBest, monthGoalMap]);

  const weightTotal = Number(w7) + Number(w30) + Number(w60) + Number(w90);

  const sortedCoverageRows = useMemo(
    () => sortRows(coverageRows, coverageSort.key, coverageSort.dir),
    [coverageRows, coverageSort],
  );
  const sortedSalesRows = useMemo(
    () => sortRows(pivotRows, salesSort.key, salesSort.dir),
    [pivotRows, salesSort],
  );

  const invColumns = [
    { key: "tag", label: "PRODUCT" },
    { key: "wos", label: "WOS", num: true },
    { key: "status", label: "STATUS" },
    { key: "pct_avail", label: "% AVAIL", num: true },
    { key: "daily_demand", label: "DAILY DEM", num: true },
    { key: "units_30d", label: "30D SALES", num: true },
    { key: "total_inventory", label: "TOTAL INV", num: true },
    { key: "inbound", label: "INBOUND", num: true },
    { key: "available", label: "AVAILABLE", num: true },
    { key: "reserved", label: "RESERVED", num: true },
    { key: "restock_units", label: "RESTOCK", num: true },
  ];

  function toggleInvSort(key) {
    setInvSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  }

  function sortArrow(key) {
    if (invSort.key !== key) return "↕";
    return invSort.dir === "asc" ? "↑" : "↓";
  }

  function sortCoverageArrow(key) {
    if (coverageSort.key !== key) return "↕";
    return coverageSort.dir === "asc" ? "↑" : "↓";
  }

  function toggleSalesSort(key) {
    setSalesSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  }

  function sortSalesArrow(key) {
    if (salesSort.key !== key) return "↕";
    return salesSort.dir === "asc" ? "↑" : "↓";
  }

  // Forecast chart: merge actual line + dotted forecast connected
  const forecastChartData = useMemo(() => {
    if (!forecast?.chart) return [];
    return forecast.chart.map((r, i, arr) => {
      const actual = Number(r.actual_daily || 0);
      const fc = Number(r.forecast_daily || 0);
      // For the connection point: show actual on last actual day and forecast on first forecast day
      const isLastActual = actual > 0 && (i + 1 >= arr.length || Number(arr[i + 1].actual_daily || 0) === 0);
      return {
        label: formatDayLabel(r.date),
        date: r.date,
        actual: actual > 0 ? actual : null,
        forecast: fc > 0 ? fc : (isLastActual ? actual : null),
      };
    });
  }, [forecast]);

  const forecastAiSummary = useMemo(() => {
    if (!forecast) return [];
    const lines = [];
    const mtdActual = Number(forecast.mtd_actual || 0);
    const proj = Number(forecast.projected_total || 0);
    const pace = Number(forecast.pace_to_goal || 0);
    const goal = Number(forecast.goal || 0);
    const ciLow = Number(forecast.ci_low || 0);
    const ciHigh = Number(forecast.ci_high || 0);
    const mape = Number(forecast.mape || 0);
    const gf = Number(forecast.growth_factor || 0);
    const sig = forecast.stat_sig || null;
    const z = Number(sig?.z || 0);
    const p = Number(sig?.p_value || 1);
    const conf = Number(sig?.confidence || 0);
    const currMean = Number(sig?.mean_current || 0);
    const baseMean = Number(sig?.mean_baseline || 0);

    lines.push(`MTD actual is ${shortMoney(mtdActual)} with a modeled month-end projection of ${shortMoney(proj)}.`);
    if (goal > 0) {
      lines.push(`Pace to goal is ${fmtPct(pace)} against a monthly goal of ${shortMoney(goal)} (${pace >= 1 ? "on/above plan" : "below plan"}).`);
    } else {
      lines.push("No goal is currently set, so pace-to-goal interpretation is directional only.");
    }
    lines.push(`Forecast uncertainty range is ${shortMoney(ciLow)} to ${shortMoney(ciHigh)} (95% confidence interval).`);
    lines.push(`Backtest MAPE is ${fmtPct(mape)}, which indicates ${mape <= 0.08 ? "strong" : mape <= 0.15 ? "moderate" : "high-variance"} model error on historical months.`);
    lines.push(`Growth factor (weekday + trend + assumptions) is ${gf.toFixed(3)}, implying ${gf >= 1 ? "acceleration versus baseline" : "deceleration versus baseline"}.`);

    if (sig) {
      let sigLabel = "not statistically significant";
      if (p < 0.01) sigLabel = "highly statistically significant";
      else if (p < 0.05) sigLabel = "statistically significant";
      else if (p < 0.1) sigLabel = "directionally significant";
      lines.push(
        `Stat sig view: z=${z.toFixed(2)}, p=${p.toFixed(4)}, confidence=${fmtPct(conf)}. Current daily mean ${shortMoney(currMean)} vs baseline ${shortMoney(baseMean)} is ${sigLabel}.`,
      );
      if (p < 0.05) {
        lines.push("Interpretation: the current run-rate likely reflects a real performance shift rather than normal noise.");
      } else {
        lines.push("Interpretation: observed movement can still be explained by normal volatility; avoid over-reacting to short-term swings.");
      }
    } else {
      lines.push("Stat sig view is unavailable for this window due to insufficient baseline sample.");
    }
    return lines;
  }, [forecast]);

  const periodRevenue = useMemo(
    () => (daily || []).reduce((s, r) => s + Number(r.grand_total || r.total || Number(r.iqbar || 0) + Number(r.iqmix || 0) + Number(r.iqjoe || 0)), 0),
    [daily],
  );
  const periodOrders = useMemo(
    () => (productSummary || []).reduce((s, r) => s + Number(r.orders || 0), 0),
    [productSummary],
  );
  const periodUnits = useMemo(
    () => (productSummary || []).reduce((s, r) => s + Number(r.units || 0), 0),
    [productSummary],
  );
  const periodAov = periodOrders > 0 ? periodRevenue / periodOrders : 0;

  const allDailyTotals = useMemo(
    () => (daily || []).map((r) => ({
      date: r.date,
      total: Number(r.grand_total || r.total || Number(r.iqbar || 0) + Number(r.iqmix || 0) + Number(r.iqjoe || 0)),
      iqbar: Number(r.iqbar || 0),
      iqmix: Number(r.iqmix || 0),
      iqjoe: Number(r.iqjoe || 0),
    })),
    [daily],
  );

  const anomalyRows = useMemo(() => {
    const out = [];
    const rows = allDailyTotals;
    for (let i = 7; i < rows.length; i += 1) {
      const window = rows.slice(i - 7, i).map((r) => r.total);
      const avg7 = window.reduce((s, x) => s + x, 0) / Math.max(1, window.length);
      const curr = rows[i].total;
      if (avg7 > 0) {
        const delta = curr / avg7 - 1;
        if (delta < -0.2) {
          out.push({
            id: uid("an"),
            severity: delta < -0.3 ? "critical" : "warning",
            title: `Revenue drop on ${rows[i].date}`,
            detail: `Total fell ${pctSigned(delta)} vs 7-day avg (${shortMoney(curr)} vs ${shortMoney(avg7)}).`,
            timestamp: rows[i].date,
            metric: shortMoney(curr),
            actionLabel: "View chart",
            actionHref: "/",
            date: rows[i].date,
          });
        }
      }
    }
    const lines = ["iqbar", "iqmix", "iqjoe"];
    lines.forEach((line) => {
      let streak = 0;
      for (let i = 1; i < rows.length; i += 1) {
        if (rows[i][line] < rows[i - 1][line]) streak += 1;
        else streak = 0;
        if (streak === 3) {
          out.push({
            id: uid("an"),
            severity: "warning",
            title: `${line.toUpperCase()} declined 3 consecutive days`,
            detail: `${line.toUpperCase()} trend is down for three sessions ending ${rows[i].date}.`,
            timestamp: rows[i].date,
            metric: shortMoney(rows[i][line]),
            actionLabel: "Open Product Insights",
            actionHref: "/",
            date: rows[i].date,
          });
        }
      }
    });
    if (topMovers?.gainers?.length) {
      const g = topMovers.gainers[0];
      out.push({
        id: uid("an"),
        severity: "positive",
        title: `Top gainer: ${g.tag || g.sku}`,
        detail: `Up ${shortMoney(g.change)} vs prior period.`,
        timestamp: endDate,
        metric: shortMoney(g.sales),
        actionLabel: "Review movers",
        actionHref: "/",
        date: endDate,
      });
    }
    const critical = (inventory.rows || []).filter((r) => Number(r.wos || 0) < 4);
    critical.slice(0, 2).forEach((r) => {
      out.push({
        id: uid("an"),
        severity: "critical",
        title: `Critical WOS: ${r.tag || r.sku}`,
        detail: `WOS ${Number(r.wos || 0).toFixed(1)} with ${Number(r.available || 0).toLocaleString()} available.`,
        timestamp: inventory?.snapshot?.imported_at || endDate,
        metric: `${Number(r.wos || 0).toFixed(1)} WOS`,
        actionLabel: "Open inventory",
        actionHref: "/",
        date: endDate,
      });
    });
    const ntbRows = ntbData?.rows || [];
    if (ntbRows.length >= 4) {
      const curr = ntbRows[ntbRows.length - 1];
      const prev3 = ntbRows.slice(-4, -1);
      const avg3 = prev3.reduce((s, r) => s + Number(r.ntb_rate || 0), 0) / Math.max(1, prev3.length);
      const currRate = Number(curr.ntb_rate || 0);
      if (currRate < avg3) {
        out.push({
          id: uid("an"),
          severity: "warning",
          title: "NTB rate below 3-month average",
          detail: `Current ${fmtPct(currRate)} vs 3-mo avg ${fmtPct(avg3)}.`,
          timestamp: curr.month || endDate,
          metric: fmtPct(currRate),
          actionLabel: "Open NTB",
          actionHref: "/",
          date: curr.month || endDate,
        });
      }
    }
    return out.slice(0, 16);
  }, [allDailyTotals, topMovers, inventory.rows, inventory?.snapshot?.imported_at, ntbData?.rows, endDate]);

  const filteredAnomalies = useMemo(() => {
    if (anomalyFilter === "all") return anomalyRows;
    if (anomalyFilter === "critical") return anomalyRows.filter((a) => a.severity === "critical");
    if (anomalyFilter === "warning") return anomalyRows.filter((a) => a.severity === "warning");
    return anomalyRows.filter((a) => a.severity === "positive");
  }, [anomalyRows, anomalyFilter]);

  const criticalCount = useMemo(
    () => anomalyRows.filter((a) => a.severity === "critical").length,
    [anomalyRows],
  );

  const digestLines = useMemo(() => {
    const total = salesSummary?.current?.grand_total || 0;
    const iqbar = salesSummary?.current?.iqbar || 0;
    const iqmixDelta = Number(salesSummary?.deltas?.iqmix || 0);
    const iqbarShare = total > 0 ? iqbar / total : 0;
    const atRiskCount = (inventory.rows || []).filter((r) => ["At Risk", "Restock", "Critical", "OOS"].includes(r.status)).length;
    const ntbRows = ntbData?.rows || [];
    const curr = ntbRows[ntbRows.length - 1];
    const prev3 = ntbRows.slice(-4, -1);
    const avg3 = prev3.length ? prev3.reduce((s, r) => s + Number(r.ntb_rate || 0), 0) / prev3.length : 0;
    const currRate = Number(curr?.ntb_rate || 0);
    const paceDelta = Number(forecast?.pace_delta || 0);
    return [
      `${fmtRange(startDate, endDate)} revenue of ${shortMoney(total)} is ${paceDelta >= 0 ? "ahead of" : "behind"} pace.`,
      `IQBAR accounts for ${(iqbarShare * 100).toFixed(1)}% of period revenue.`,
      `IQMIX is ${iqmixDelta >= 0 ? "up" : "down"} ${pctSigned(iqmixDelta)} vs comparison period.`,
      `Inventory risk is ${atRiskCount > 5 ? "elevated" : "contained"} with ${atRiskCount} SKUs flagged.`,
      `NTB rate ${fmtPct(currRate)} is ${currRate >= avg3 ? "above" : "below"} the 3-month avg ${fmtPct(avg3)}.`,
    ];
  }, [salesSummary, inventory.rows, ntbData?.rows, forecast?.pace_delta, startDate, endDate]);

  const recommendations = useMemo(() => {
    const recs = [];
    const crit = (inventory.rows || []).filter((r) => Number(r.wos || 0) < 5).sort((a, b) => Number(a.wos || 0) - Number(b.wos || 0));
    if (crit.length) {
      const r = crit[0];
      recs.push({
        id: uid("rec"),
        priority: "high",
        title: `Restock ${r.tag || r.sku} immediately`,
        rationale: `WOS is ${Number(r.wos || 0).toFixed(1)} and daily demand is ${Number(r.daily_demand || 0).toFixed(1)} units.`,
        cta: "Open Inventory",
        href: "/",
      });
    }
    if ((forecast?.pace_to_goal || 0) < 0.85) {
      recs.push({
        id: uid("rec"),
        priority: "high",
        title: "Revenue pace below target",
        rationale: `Current pace to goal is ${fmtPct(forecast?.pace_to_goal || 0)}.`,
        cta: "Open Forecast",
        href: "/",
      });
    }
    if (topMovers?.decliners?.length) {
      const d = topMovers.decliners[0];
      recs.push({
        id: uid("rec"),
        priority: "medium",
        title: `Review ${d.tag || d.sku}`,
        rationale: `Largest decline in period at ${shortMoney(d.change)} vs prior period.`,
        cta: "Open Product Insights",
        href: "/",
      });
    }
    if (topMovers?.gainers?.length) {
      const g = topMovers.gainers[0];
      recs.push({
        id: uid("rec"),
        priority: "low",
        title: `Scale ${g.tag || g.sku}`,
        rationale: `Top gainer at ${shortMoney(g.change)} uplift vs prior period.`,
        cta: "Open Product Insights",
        href: "/",
      });
    }
    return recs.slice(0, 6);
  }, [inventory.rows, forecast?.pace_to_goal, topMovers]);

  const goalMetricOptions = [
    { value: "total_revenue", label: "Total Revenue" },
    { value: "iqbar_revenue", label: "IQBAR Revenue" },
    { value: "iqmix_revenue", label: "IQMIX Revenue" },
    { value: "iqjoe_revenue", label: "IQJOE Revenue" },
    { value: "ntb_customers", label: "NTB Customers" },
    { value: "aov", label: "AOV" },
  ];

  const dbMappedGoals = useMemo(() => (
    (dbGoals || []).map((r) => {
      const line = String(r.product_line || "").toUpperCase();
      const metric = line === "IQBAR"
        ? "iqbar_revenue"
        : line === "IQMIX"
          ? "iqmix_revenue"
          : line === "IQJOE"
            ? "iqjoe_revenue"
            : "total_revenue";
      return {
        id: `db-${r.year}-${r.month}-${line}`,
        name: `${formatMonthLabel(`${r.year}-${String(r.month).padStart(2, "0")}`)} - ${line}`,
        metric,
        period: "monthly",
        year: Number(r.year),
        month: Number(r.month),
        quarter: Math.ceil(Number(r.month) / 3),
        targetValue: Number(r.goal || 0),
        createdAt: r.updated_at || "",
      };
    })
  ), [dbGoals]);

  const monthlyGoalMap = useMemo(() => {
    const map = {};
    (monthly?.rows || []).forEach((r) => {
      const key = String(r.month || "");
      if (!key) return;
      map[key] = {
        total: Number(r.total || r.grand_total || (Number(r.iqbar || 0) + Number(r.iqmix || 0) + Number(r.iqjoe || 0))),
        iqbar: Number(r.iqbar || 0),
        iqmix: Number(r.iqmix || 0),
        iqjoe: Number(r.iqjoe || 0),
      };
    });
    return map;
  }, [monthly?.rows]);

  function goalActual(goal) {
    const now = new Date(`${endDate || ymd(new Date())}T00:00:00`);
    const periodYear = Number(goal.year || now.getFullYear());
    const start = goal.period === "quarterly"
      ? new Date(periodYear, (Number(goal.quarter || 1) - 1) * 3, 1)
      : new Date(periodYear, Number(goal.month || 1) - 1, 1);
    const end = goal.period === "quarterly"
      ? new Date(periodYear, (Number(goal.quarter || 1) - 1) * 3 + 3, 0)
      : new Date(periodYear, Number(goal.month || 1), 0);
    const sIso = ymd(start);
    const eIso = ymd(end);
    const rows = allDailyTotals.filter((r) => r.date >= sIso && r.date <= eIso);
    const monthKeys = [];
    if (goal.period === "quarterly") {
      const q = Number(goal.quarter || 1);
      const startMonth = ((q - 1) * 3) + 1;
      for (let i = 0; i < 3; i += 1) {
        monthKeys.push(`${periodYear}-${String(startMonth + i).padStart(2, "0")}`);
      }
    } else {
      monthKeys.push(`${periodYear}-${String(Number(goal.month || 1)).padStart(2, "0")}`);
    }
    const monthlyRollup = monthKeys.reduce((acc, mk) => {
      const row = monthlyGoalMap[mk] || {};
      acc.total += Number(row.total || 0);
      acc.iqbar += Number(row.iqbar || 0);
      acc.iqmix += Number(row.iqmix || 0);
      acc.iqjoe += Number(row.iqjoe || 0);
      return acc;
    }, { total: 0, iqbar: 0, iqmix: 0, iqjoe: 0 });
    const total = monthlyRollup.total;
    if (goal.metric === "total_revenue") return total;
    if (goal.metric === "iqbar_revenue") return monthlyRollup.iqbar;
    if (goal.metric === "iqmix_revenue") return monthlyRollup.iqmix;
    if (goal.metric === "iqjoe_revenue") return monthlyRollup.iqjoe;
    if (goal.metric === "ntb_customers") {
      return (ntbData?.rows || [])
        .filter((r) => String(r.month || "").startsWith(`${periodYear}-`))
        .filter((r) => (goal.period === "quarterly"
          ? [((Number(goal.quarter || 1) - 1) * 3) + 1, ((Number(goal.quarter || 1) - 1) * 3) + 2, ((Number(goal.quarter || 1) - 1) * 3) + 3].includes(Number(String(r.month).slice(5, 7)))
          : Number(String(r.month).slice(5, 7)) === Number(goal.month || 1)))
        .reduce((s, r) => s + Number(r.total_ntb || 0), 0);
    }
    if (goal.metric === "aov") {
      const orders = (productSummary || []).reduce((s, r) => s + Number(r.orders || 0), 0);
      return orders > 0 ? total / orders : 0;
    }
    return 0;
  }

  const effectiveGoals = useMemo(
    () => ((goals || []).length ? goals : dbMappedGoals),
    [goals, dbMappedGoals],
  );

  const goalsWithActuals = useMemo(() => (effectiveGoals || []).map((g) => {
    const actual = goalActual(g);
    const target = Number(g.targetValue || 0);
    const progress = target > 0 ? (actual / target) : 0;
    return { ...g, actual, progress };
  }), [effectiveGoals, allDailyTotals, ntbData?.rows, productSummary, endDate, monthlyGoalMap]);

  const goalsMonthlyCompare = useMemo(() => {
    const goalByMonth = {};
    (dbGoals || []).forEach((r) => {
      const k = `${Number(r.year)}-${String(Number(r.month)).padStart(2, "0")}`;
      goalByMonth[k] = (goalByMonth[k] || 0) + Number(r.goal || 0);
    });
    const actualByMonth = {};
    (monthly?.rows || []).forEach((r) => {
      const k = String(r.month || "");
      if (!k) return;
      actualByMonth[k] = Number(r.total || r.grand_total || (Number(r.iqbar || 0) + Number(r.iqmix || 0) + Number(r.iqjoe || 0)));
    });
    const keys = Array.from(new Set([...Object.keys(goalByMonth), ...Object.keys(actualByMonth)])).sort();
    return keys.map((k) => ({
      month: k,
      label: formatMonthLabel(k),
      goal: Number(goalByMonth[k] || 0),
      actual: Number(actualByMonth[k] || 0),
    }));
  }, [dbGoals, monthly?.rows]);

  const goalsYearOptions = useMemo(() => {
    const years = Array.from(new Set((goalsMonthlyCompare || []).map((r) => Number(String(r.month || "").slice(0, 4))).filter((y) => Number.isFinite(y))))
      .sort((a, b) => a - b);
    return years;
  }, [goalsMonthlyCompare]);

  const goalsMonthlyFiltered = useMemo(() => {
    if (goalsYearFilter === "all") return goalsMonthlyCompare;
    return (goalsMonthlyCompare || []).filter((r) => String(r.month || "").startsWith(`${goalsYearFilter}-`));
  }, [goalsMonthlyCompare, goalsYearFilter]);

  const profitabilityRows = useMemo(() => {
    const fbaPct = Number(feeCfg.fbaFeePercent || 0) / 100;
    const referralPct = Number(feeCfg.referralFeePercent || 0) / 100;
    const adPct = Number(feeCfg.adSpendPercent || 0) / 100;
    return (skuSummaryAll || [])
      .filter((r) => String(r.sku || r.tag || "").toLowerCase().includes(profitSearch.toLowerCase()) || String(r.tag || "").toLowerCase().includes(profitSearch.toLowerCase()))
      .map((r) => {
        const sku = r.sku || r.tag;
        const cogsUnit = Number(cogsMap[sku] || 0);
        const fbaUnit = Number(fbaSkuMap[sku] || 0);
        const revenue = Number(r.sales || 0);
        const units = Number(r.units || 0);
        const totalCogs = cogsUnit * units;
        const estFba = fbaUnit > 0 ? (fbaUnit * units) : (revenue * fbaPct);
        const estReferral = revenue * referralPct;
        const estFees = estFba + estReferral;
        const estAds = revenue * adPct;
        const net = revenue - totalCogs - estFees - estAds;
        const margin = revenue > 0 ? net / revenue : 0;
        return { ...r, sku, cogsUnit, fbaUnit, totalCogs, estFba, estReferral, estFees, estAds, net, margin };
      });
  }, [skuSummaryAll, cogsMap, fbaSkuMap, feeCfg, profitSearch]);

  const profitabilitySummary = useMemo(() => {
    const gross = profitabilityRows.reduce((s, r) => s + Number(r.sales || 0), 0);
    const cogs = profitabilityRows.reduce((s, r) => s + Number(r.totalCogs || 0), 0);
    const fees = profitabilityRows.reduce((s, r) => s + Number(r.estFees || 0), 0);
    const ads = profitabilityRows.reduce((s, r) => s + Number(r.estAds || 0), 0);
    const net = gross - cogs - fees - ads;
    const margin = gross > 0 ? net / gross : 0;
    return { gross, cogs, fees, ads, net, margin };
  }, [profitabilityRows]);

  const promoColors = {
    lightning_deal: "#EF4444",
    coupon: "#F59E0B",
    prime_exclusive: "#8B5CF6",
    sale: "#06B6D4",
    bundle: "#10B981",
    other: "#6B7280",
  };

  async function onToggleAutoSlack(v) {
    setAutoSlack(v);
    await fetch(
      `${process.env.NEXT_PUBLIC_API_BASE_URL || process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000"}/api/settings?auto_slack_on_import=${v ? "true" : "false"}`,
      { method: "POST" },
    );
  }

  async function parseApiError(res, fallbackMessage) {
    const rawText = await res.text().catch(() => "");
    if (rawText) {
      try {
        const payload = JSON.parse(rawText);
        return payload?.error || payload?.detail || `${fallbackMessage} (HTTP ${res.status})`;
      } catch {
        return `${fallbackMessage} (HTTP ${res.status}): ${rawText.slice(0, 300)}`;
      }
    }
    return `${fallbackMessage} (HTTP ${res.status})`;
  }

  async function onUploadPayments() {
    if (!uploadFiles.length) return;
    const form = new FormData();
    for (const f of uploadFiles) form.append("files", f);
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL || process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000"}/api/import/payments?channel=${encodeURIComponent(workspaceChannel)}`, {
      method: "POST",
      body: form,
    });
    let payload = {};
    try {
      payload = await res.json();
    } catch {
      payload = {};
    }
    if (res.ok && payload?.ok !== false) {
      const history = await apiGet("/api/import/history", channelParams);
      setImportHistory(history.rows || []);
      const coverage = await apiGet("/api/import/date-coverage", { start_date: "2024-01-01", end_date: "2026-12-31", ...channelParams });
      setCoverageRows(coverage.rows || []);
      await runFlowsByTrigger("on_import_payments");
      alert("Payments imported.");
    } else {
      const msg = payload?.error || payload?.detail || (await parseApiError(res, "Import failed"));
      alert(msg);
    }
  }

  async function onUploadInventory() {
    if (!inventoryUploadFiles.length) return;
    const form = new FormData();
    for (const f of inventoryUploadFiles) form.append("files", f);
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL || process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000"}/api/import/inventory`, {
      method: "POST",
      body: form,
    });
    let payload = {};
    try {
      payload = await res.json();
    } catch {
      payload = {};
    }
    if (res.ok && payload?.ok !== false) {
      const invHist = await apiGet("/api/inventory/history");
      setInventoryHistory(invHist.rows || []);
      await runFlowsByTrigger("on_import_inventory");
      alert("Inventory imported.");
    } else {
      const msg = payload?.error || payload?.detail || (await parseApiError(res, "Inventory import failed"));
      alert(msg);
    }
  }

  async function onUploadNtb() {
    if (!ntbUploadFiles.length) return;
    const form = new FormData();
    for (const f of ntbUploadFiles) form.append("files", f);
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL || process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000"}/api/import/ntb?channel=${encodeURIComponent(workspaceChannel)}`, {
      method: "POST",
      body: form,
    });
    let payload = {};
    try {
      payload = await res.json();
    } catch {
      payload = {};
    }
    if (res.ok && payload?.ok !== false) {
      const ntb = await apiGet("/api/ntb/monthly", channelParams);
      setNtbData(ntb || { rows: [], updated_from: null, updated_to: null, imported_at: null });
      await runFlowsByTrigger("on_import_ntb");
      alert("NTB imported.");
    } else {
      const msg = payload?.error || payload?.detail || (await parseApiError(res, "NTB import failed"));
      alert(msg);
    }
  }

  async function onUploadShopifyLine(productLine, files) {
    if (!files?.length) return;
    const form = new FormData();
    for (const f of files) form.append("files", f);
    const base = process.env.NEXT_PUBLIC_API_BASE_URL || process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
    const res = await fetch(`${base}/api/import/shopify-line?product_line=${encodeURIComponent(productLine)}`, {
      method: "POST",
      body: form,
    });
    let payload = {};
    try {
      payload = await res.json();
    } catch {
      payload = {};
    }
    if (!res.ok || !payload?.ok) {
      const msg = payload?.error || payload?.detail || (await parseApiError(res, `Shopify ${productLine} import failed`));
      alert(msg);
      return;
    }
    const [history, coverage, m] = await Promise.all([
      apiGet("/api/import/history", channelParams),
      apiGet("/api/import/date-coverage", { start_date: "2024-01-01", end_date: "2026-12-31", ...channelParams }),
      apiGet("/api/meta/date-range", channelParams),
    ]);
    setImportHistory(history.rows || []);
    setCoverageRows(coverage.rows || []);
    setMeta(m || null);
    await runFlowsByTrigger("on_import_payments");
    alert(`Shopify ${productLine} imported.`);
  }

  async function onDeleteImportRow(row) {
    if (!row?.id) return;
    const msg = `Delete import ${row.source_file} (${row.imported_at})? This will remove those transactions from the dashboard.`;
    if (typeof window !== "undefined" && !window.confirm(msg)) return;
    const base = process.env.NEXT_PUBLIC_API_BASE_URL || process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
    const res = await fetch(`${base}/api/import/payments?import_id=${encodeURIComponent(row.id)}&channel=${encodeURIComponent(workspaceChannel)}`, { method: "DELETE" });
    let payload = {};
    try {
      payload = await res.json();
    } catch {
      payload = {};
    }
    if (!res.ok || !payload?.ok) {
      const msg = payload?.error || payload?.detail || (await parseApiError(res, "Delete failed"));
      alert(msg);
      return;
    }
    const [history, coverage, m] = await Promise.all([
      apiGet("/api/import/history", channelParams),
      apiGet("/api/import/date-coverage", { start_date: "2024-01-01", end_date: "2026-12-31", ...channelParams }),
      apiGet("/api/meta/date-range", channelParams),
    ]);
    setImportHistory(history.rows || []);
    setCoverageRows(coverage.rows || []);
    setMeta(m || null);
    alert(`Deleted import. Removed ${Number(payload.deleted_transaction_rows || 0).toLocaleString()} transactions.`);
  }

  async function onUploadCogsFees() {
    if (!cogsUploadFile) return;
    const form = new FormData();
    form.append("file", cogsUploadFile);
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL || process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000"}/api/import/cogs-fees`, {
      method: "POST",
      body: form,
    });
    let payload = {};
    try {
      payload = await res.json();
    } catch {
      payload = {};
    }
    if (!res.ok || !payload?.ok) {
      const msg = payload?.error || payload?.detail || (await parseApiError(res, "COGS import failed"));
      setCogsImportMsg(msg);
      return;
    }
    const nextCogs = {};
    const nextFba = {};
    (payload.rows || []).forEach((r) => {
      const sku = String(r.sku || "").trim();
      if (!sku) return;
      if (r.cogs != null) nextCogs[sku] = Number(r.cogs || 0);
      if (r.fba_fee != null) nextFba[sku] = Number(r.fba_fee || 0);
    });
    setCogsMap((m) => ({ ...m, ...nextCogs }));
    setFbaSkuMap((m) => ({ ...m, ...nextFba }));
    setCogsImportMsg(`Imported ${Number(payload.row_count || 0).toLocaleString()} SKU fee rows.`);
  }

  async function onSendSlack(silent = false) {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_API_BASE_URL || process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000"}/api/slack/send-summary?start_date=${startDate}&end_date=${endDate}&channel=${encodeURIComponent(workspaceChannel)}`,
      { method: "POST" },
    );
    const j = await res.json();
    if (!j.ok && !silent) alert(j.error || "Slack failed");
    else if (!silent) alert("Sent to Slack.");
    return Boolean(j?.ok);
  }

  function openDateModal() {
    setDraftPreset(preset);
    setDraftCompareMode(compareMode);
    setDraftCompareEnabled(compareEnabled);
    setDraftStartDate(startDate);
    setDraftEndDate(endDate);
    setShowDateModal(true);
  }

  function presetRangeForModal(presetKey) {
    if (!meta?.max_date || !meta?.min_date) return { start: draftStartDate, end: draftEndDate };
    const maxD = new Date(`${meta.max_date}T00:00:00`);
    const minD = new Date(`${meta.min_date}T00:00:00`);
    if (Number.isNaN(maxD.getTime()) || Number.isNaN(minD.getTime())) {
      return { start: draftStartDate, end: draftEndDate };
    }
    if (presetKey === "Yesterday") {
      const d = new Date(maxD.getTime() - 86400000);
      return { start: ymd(d), end: ymd(d) };
    }
    if (presetKey === "This Week") return { start: ymd(new Date(maxD.getTime() - 6 * 86400000)), end: meta.max_date };
    if (presetKey === "This Month" || presetKey === "MTD") return { start: ymd(new Date(maxD.getFullYear(), maxD.getMonth(), 1)), end: meta.max_date };
    if (presetKey === "YTD") return { start: ymd(new Date(maxD.getFullYear(), 0, 1)), end: meta.max_date };
    if (presetKey === "All Time") return { start: ymd(minD), end: meta.max_date };
    if (presetKey === "Last 30") return { start: ymd(new Date(maxD.getTime() - 29 * 86400000)), end: meta.max_date };
    if (presetKey === "Last 90") return { start: ymd(new Date(maxD.getTime() - 89 * 86400000)), end: meta.max_date };
    return { start: draftStartDate, end: draftEndDate };
  }

  function onSelectDatePreset(presetKey) {
    const rng = presetRangeForModal(presetKey);
    setDraftStartDate(rng.start || "");
    setDraftEndDate(rng.end || "");
    if (["YTD", "MTD", "Last 30", "Last 90", "Custom"].includes(presetKey)) {
      setDraftPreset(presetKey);
    } else if (presetKey === "This Month") {
      setDraftPreset("MTD");
    } else {
      setDraftPreset("Custom");
    }
  }

  function applyDateModal() {
    let s = draftStartDate;
    let e = draftEndDate;
    if (s && e && s > e) {
      const tmp = s;
      s = e;
      e = tmp;
    }
    setPreset(draftPreset);
    setCompareEnabled(Boolean(draftCompareEnabled));
    if (draftCompareEnabled) setCompareMode(draftCompareMode);
    if (s && e) {
      setStartDate(s);
      setEndDate(e);
    }
    setShowDateModal(false);
  }

  async function onSaveDbGoal(row) {
    const key = `${row.year}-${row.month}-${row.product_line}`;
    const nextGoal = Number(dbGoalEdits[key] ?? row.goal ?? 0);
    const qs = new URLSearchParams({
      year: String(row.year),
      month: String(row.month),
      product_line: String(row.product_line),
      goal: String(nextGoal),
      channel: String(row.channel || "Amazon"),
    });
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL || process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000"}/api/goals/upsert?${qs.toString()}`, {
      method: "POST",
    });
    const payload = await res.json();
    if (!res.ok || !payload?.ok) {
      setDbGoalMsg(payload?.error || "Failed to save goal.");
      return;
    }
    const fresh = await apiGet("/api/goals", channelParams);
    setDbGoals(fresh?.rows || []);
    setDbGoalMsg(`Saved ${row.product_line} ${formatMonthLabel(`${row.year}-${String(row.month).padStart(2, "0")}`)} goal.`);
  }

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("data-theme", next);
    }
    if (typeof window !== "undefined") {
      window.localStorage.setItem("iq_theme", next);
    }
  }

  const activeTabMeta = visibleTabs.find((t) => t.id === activeTab) || visibleTabs[0] || TABS[0];
  const pageTitle = activeTabMeta?.label || "Dashboard";
  const pageSubtitle = activeTab === "data"
    ? "Import center, data freshness, and workspace configuration"
    : activeTab === "inventory"
      ? "Stock health, velocity, and restock planning"
      : activeTab === "flows"
        ? "Build automations with trigger, condition, and action nodes"
      : activeTab === "ntb"
        ? "Customer acquisition and new-to-brand momentum"
        : startDate && endDate
          ? `${startDate} to ${endDate}`
          : "Loading date range...";
  const canEdit = userRole === "Admin";
  const canExport = userRole === "Admin" || userRole === "Analyst";
  const compareRange = useMemo(
    () => calcCompareRangeJs(startDate, endDate, compareMode),
    [startDate, endDate, compareMode],
  );
  const draftCompareRange = useMemo(
    () => calcCompareRangeJs(draftStartDate, draftEndDate, draftCompareMode),
    [draftStartDate, draftEndDate, draftCompareMode],
  );
  const draftDays = useMemo(() => {
    if (!draftStartDate || !draftEndDate) return 0;
    const s = new Date(`${draftStartDate}T00:00:00`).getTime();
    const e = new Date(`${draftEndDate}T00:00:00`).getTime();
    if (!Number.isFinite(s) || !Number.isFinite(e)) return 0;
    return Math.max(1, Math.round((e - s) / 86400000) + 1);
  }, [draftStartDate, draftEndDate]);
  const compareSummary = useMemo(() => (
    compareEnabled
      ? `Comparing: ${fmtLongDate(startDate)} - ${fmtLongDate(endDate)} to ${fmtLongDate(compareRange.start)} - ${fmtLongDate(compareRange.end)}`
      : `Selected: ${fmtLongDate(startDate)} - ${fmtLongDate(endDate)}`
  ), [compareEnabled, startDate, endDate, compareRange.start, compareRange.end]);
  const hasPendingForecastChanges = useMemo(() => (
    forecastScenario !== appliedForecastScenario
    || fRecentWeight !== aRecentWeight
    || fMomWeight !== aMomWeight
    || fWeekdayStrength !== aWeekdayStrength
    || fManualMultiplier !== aManualMultiplier
    || fPromoLift !== aPromoLift
    || fContentLift !== aContentLift
    || fInstockRate !== aInstockRate
    || fGrowthFloor !== aGrowthFloor
    || fGrowthCeiling !== aGrowthCeiling
    || fVolatility !== aVolatility
  ), [
    forecastScenario, appliedForecastScenario,
    fRecentWeight, aRecentWeight,
    fMomWeight, aMomWeight,
    fWeekdayStrength, aWeekdayStrength,
    fManualMultiplier, aManualMultiplier,
    fPromoLift, aPromoLift,
    fContentLift, aContentLift,
    fInstockRate, aInstockRate,
    fGrowthFloor, aGrowthFloor,
    fGrowthCeiling, aGrowthCeiling,
    fVolatility, aVolatility,
  ]);

  function scenarioLabel(name) {
    const n = String(name || "base");
    return n
      .split("_")
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join(" ");
  }

  function scenarioAdjusted(name, vals) {
    const base = FORECAST_SCENARIOS[String(name || "base")] || FORECAST_SCENARIOS.base;
    const eps = 1e-9;
    const diff = (a, b) => Math.abs(Number(a || 0) - Number(b || 0)) > eps;
    return (
      diff(vals.recent_weight, base.recent_weight)
      || diff(vals.mom_weight, base.mom_weight)
      || diff(vals.weekday_strength, base.weekday_strength)
      || diff(vals.manual_multiplier, base.manual_multiplier)
      || diff(vals.promo_lift_pct, base.promo_lift_pct)
      || diff(vals.content_lift_pct, base.content_lift_pct)
      || diff(vals.instock_rate, base.instock_rate)
      || diff(vals.growth_floor, base.growth_floor)
      || diff(vals.growth_ceiling, base.growth_ceiling)
      || diff(vals.volatility_multiplier, base.volatility_multiplier)
    );
  }

  const appliedScenarioDisplay = useMemo(() => {
    const adjusted = scenarioAdjusted(appliedForecastScenario, {
      recent_weight: aRecentWeight,
      mom_weight: aMomWeight,
      weekday_strength: aWeekdayStrength,
      manual_multiplier: aManualMultiplier,
      promo_lift_pct: aPromoLift,
      content_lift_pct: aContentLift,
      instock_rate: aInstockRate,
      growth_floor: aGrowthFloor,
      growth_ceiling: aGrowthCeiling,
      volatility_multiplier: aVolatility,
    });
    return `${scenarioLabel(appliedForecastScenario)}${adjusted ? " (Adjusted)" : ""}`;
  }, [
    appliedForecastScenario,
    aRecentWeight, aMomWeight, aWeekdayStrength, aManualMultiplier, aPromoLift,
    aContentLift, aInstockRate, aGrowthFloor, aGrowthCeiling, aVolatility,
  ]);

  const flowMetricValues = useMemo(() => {
    const ntbRows = ntbData?.rows || [];
    const currNtb = ntbRows.length ? Number(ntbRows[ntbRows.length - 1].ntb_rate || 0) : 0;
    const critCount = (inventory.rows || []).filter((r) => Number(r.wos || 0) < 4).length;
    const minWos = (inventory.rows || []).reduce((m, r) => Math.min(m, Number(r.wos || 0)), Number.POSITIVE_INFINITY);
    return {
      total_revenue: Number(salesSummary?.current?.grand_total || 0),
      iqbar_revenue: Number(salesSummary?.current?.iqbar || 0),
      iqmix_revenue: Number(salesSummary?.current?.iqmix || 0),
      iqjoe_revenue: Number(salesSummary?.current?.iqjoe || 0),
      pace_to_goal_pct: Number((forecast?.pace_to_goal || 0) * 100),
      ntb_rate_pct: Number(currNtb * 100),
      critical_sku_count: Number(critCount || 0),
      min_wos: Number.isFinite(minWos) ? minWos : 0,
    };
  }, [salesSummary, forecast?.pace_to_goal, inventory.rows, ntbData?.rows]);

  const flowUnreadCount = useMemo(
    () => (flowAlerts || []).filter((a) => !a.read).length,
    [flowAlerts],
  );

  const selectedFlow = useMemo(
    () => (flows || []).find((f) => f.id === selectedFlowId) || null,
    [flows, selectedFlowId],
  );

  function ensureSelectedFlow() {
    if (selectedFlowId) return selectedFlowId;
    if (!flows.length) return "";
    setSelectedFlowId(flows[0].id);
    return flows[0].id;
  }

  function makeBlankFlow(name = "Untitled Flow") {
    return {
      id: uid("flow"),
      name,
      active: true,
      trigger: { type: "manual", label: "Manual Run" },
      conditions: [],
      actions: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  function addFlow(flow) {
    setFlows((rows) => [flow, ...(rows || [])]);
    setSelectedFlowId(flow.id);
    setSelectedFlowNode({ kind: "trigger", index: -1 });
  }

  function updateFlow(flowId, updater) {
    setFlows((rows) => (rows || []).map((f) => {
      if (f.id !== flowId) return f;
      const next = typeof updater === "function" ? updater(f) : { ...f, ...updater };
      return { ...next, updated_at: new Date().toISOString() };
    }));
  }

  function deleteFlow(flowId) {
    setFlows((rows) => (rows || []).filter((f) => f.id !== flowId));
    if (selectedFlowId === flowId) {
      const rest = (flows || []).filter((f) => f.id !== flowId);
      setSelectedFlowId(rest[0]?.id || "");
      setSelectedFlowNode({ kind: "trigger", index: -1 });
    }
  }

  function evalFlowCondition(cond, metrics) {
    const metricVal = Number(metrics?.[cond.metric] || 0);
    const targetVal = Number(cond.value || 0);
    const op = String(cond.operator || "lt");
    if (op === "lt") return metricVal < targetVal;
    if (op === "lte") return metricVal <= targetVal;
    if (op === "gt") return metricVal > targetVal;
    if (op === "gte") return metricVal >= targetVal;
    if (op === "eq") return Math.abs(metricVal - targetVal) < 1e-9;
    return false;
  }

  async function runFlow(flow, source = "manual") {
    if (!flow) return;
    const conditions = flow.conditions || [];
    const passed = conditions.every((c) => evalFlowCondition(c, flowMetricValues));
    const runAt = new Date().toISOString();
    const runBase = {
      id: uid("run"),
      flow_id: flow.id,
      flow_name: flow.name,
      source,
      run_at: runAt,
      passed,
      conditions_count: conditions.length,
      actions_count: (flow.actions || []).length,
    };
    if (!passed) {
      setFlowRuns((rows) => [runBase, ...(rows || [])].slice(0, 200));
      return;
    }
    for (const a of (flow.actions || [])) {
      if (a.type === "in_app_alert") {
        setFlowAlerts((rows) => [{
          id: uid("al"),
          flow_id: flow.id,
          title: a.title || `${flow.name} triggered`,
          message: a.message || "Flow conditions were met.",
          severity: a.severity || "info",
          read: false,
          created_at: runAt,
        }, ...(rows || [])].slice(0, 200));
      } else if (a.type === "slack_summary") {
        await onSendSlack(true);
      } else if (a.type === "email_alert") {
        setFlowAlerts((rows) => [{
          id: uid("al"),
          flow_id: flow.id,
          title: `Email sent: ${a.to || "recipient"}`,
          message: a.subject || `${flow.name} email action fired.`,
          severity: "info",
          read: false,
          created_at: runAt,
        }, ...(rows || [])].slice(0, 200));
      }
    }
    setFlowRuns((rows) => [runBase, ...(rows || [])].slice(0, 200));
  }

  async function runFlowsByTrigger(triggerType, source = triggerType) {
    const candidates = (flows || []).filter((f) => f.active && String(f?.trigger?.type || "manual") === triggerType);
    for (const f of candidates) {
      // sequential on purpose to avoid duplicate Slack/API flood bursts
      // eslint-disable-next-line no-await-in-loop
      await runFlow(f, source);
    }
  }

  const commandActions = [
    { id: "cmd-export", label: "Export current view as PDF", run: () => canExport && window.open(`${process.env.NEXT_PUBLIC_API_BASE_URL || process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000"}/api/export/sales-pdf?start_date=${startDate}&end_date=${endDate}`, "_blank") },
    { id: "cmd-slack", label: "Send summary to Slack", run: () => canExport && onSendSlack() },
    { id: "cmd-data", label: "Go to Data & Import", run: () => setActiveTab("data") },
  ];
  const commandNavItems = visibleTabs.map((t) => ({ id: `nav-${t.id}`, label: `Go to ${t.label}`, run: () => setActiveTab(t.id) }));
  const commandItems = [...commandNavItems, ...commandActions].filter((item) =>
    item.label.toLowerCase().includes(commandQuery.toLowerCase()),
  );

  if (!isLoaded) {
    return (
      <main className="app-shell">
        <section className="main-panel" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
          <div className="panel"><h3>Loading...</h3></div>
        </section>
      </main>
    );
  }

  if (!isSignedIn) {
    return (
      <main className="app-shell">
        <section className="main-panel" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
          <div className="panel" style={{ maxWidth: 480, width: "100%" }}>
            <h3 style={{ marginBottom: 12 }}>Sign In Required</h3>
            <p className="muted-note" style={{ marginBottom: 18 }}>This dashboard is invite-only. Sign in with your team account.</p>
            <SignIn routing="hash" />
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className={`shell shell-side ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <aside className="sidebar-shell">
        <div className="menu-rail">
          <div className="logo-wrap">
            {!sidebarCollapsed && (
              <div className="workspace-bubble" role="tablist" aria-label="Workspace channel">
                {["Amazon", "Shopify"].map((ch) => (
                  <button
                    key={ch}
                    className={`workspace-bubble-option ${workspaceChannel === ch ? "active" : ""}`}
                    role="tab"
                    aria-selected={workspaceChannel === ch}
                    onClick={() => setWorkspaceChannel(ch)}
                    type="button"
                  >
                    <span className="workspace-bubble-logo-wrap" aria-hidden>
                      <img className="workspace-bubble-logo" src={CHANNEL_LOGOS[ch]} alt="" />
                    </span>
                    <span>{ch}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {NAV_SECTIONS.map((section) => (
            <Fragment key={section.key}>
              {!sidebarCollapsed && <div className="menu-section-title">{section.label}</div>}
              <div className="left-tabs">
                {visibleTabs.filter((t) => t.section === section.key).map((tab) => (
                  <button key={tab.id} className={`left-tab ${activeTab === tab.id ? "active" : ""}`} onClick={() => setActiveTab(tab.id)}>
                    <span className="tab-icon">{tab.icon}</span>
                    {!sidebarCollapsed && (
                      <>
                        <span>{tab.label}</span>
                      </>
                    )}
                  </button>
                ))}
              </div>
            </Fragment>
          ))}
          <div className="sidebar-bottom">
            <div className="sidebar-user">
              <div className="sidebar-avatar">{String(user?.firstName || user?.primaryEmailAddress?.emailAddress || "U").slice(0, 1).toUpperCase()}</div>
              {!sidebarCollapsed && (
                <div className="sidebar-user-info">
                  <div className="sidebar-user-name">{user?.fullName || user?.primaryEmailAddress?.emailAddress || "User"}</div>
                  <div className="sidebar-user-role">{userRole} · {workspaceChannel}</div>
                </div>
              )}
            </div>
            <button
              className="sidebar-collapse-btn"
              onClick={async () => {
                await signOut();
              }}
            >
              Sign Out
            </button>
            <button className="sidebar-collapse-btn" onClick={() => setSidebarCollapsed((v) => !v)}>
              {sidebarCollapsed ? "» Expand" : "« Collapse"}
            </button>
            <button className="sidebar-collapse-btn" onClick={toggleTheme}>
              {theme === "dark" ? "☀ Light" : "🌙 Dark"}
            </button>
          </div>
        </div>
      </aside>

      <section className="content-area">
        <div className="top-header topbar">
          <div className="top-header-left">
            <h1>{pageTitle}</h1>
            <p>{pageSubtitle}</p>
          </div>
          <div className="top-header-actions">
            <div className="bell-wrap">
              <button className="btn btn-filter bell-btn" onClick={() => setShowBellMenu((v) => !v)}>
                🔔 Alerts
                {flowUnreadCount > 0 ? <span className="alert-count">{flowUnreadCount}</span> : null}
              </button>
              {showBellMenu && (
                <div className="bell-dropdown">
                  <div className="panel-row">
                    <h4>In-App Alerts</h4>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button className="btn btn-xs" onClick={() => setFlowAlerts((rows) => (rows || []).map((a) => ({ ...a, read: true })))}>Mark all read</button>
                      <button className="btn btn-xs" onClick={() => setFlowAlerts([])}>Clear</button>
                    </div>
                  </div>
                  <div className="alerts-list">
                    {(flowAlerts || []).slice(0, 12).map((a) => (
                      <div key={a.id} className={`alert-item ${a.severity || "info"} ${a.read ? "read" : ""}`}>
                        <span className="alert-dot" />
                        <div style={{ flex: 1 }}>
                          <div className="alert-text"><strong>{a.title}</strong> {a.message}</div>
                          <div className="alert-time">{fmtAgo(a.created_at)}</div>
                        </div>
                        {!a.read && (
                          <button className="btn btn-xs" onClick={() => setFlowAlerts((rows) => (rows || []).map((x) => (x.id === a.id ? { ...x, read: true } : x)))}>Read</button>
                        )}
                      </div>
                    ))}
                    {!flowAlerts?.length && <div className="empty-note">No flow alerts yet.</div>}
                  </div>
                </div>
              )}
            </div>
            <button className="btn btn-filter" disabled={!canExport} onClick={() => canExport && window.open(`${process.env.NEXT_PUBLIC_API_BASE_URL || process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000"}/api/export/sales-pdf?start_date=${startDate}&end_date=${endDate}`, "_blank")}>
              Export PDF
            </button>
            <button className="btn btn-coral" disabled={!canExport} onClick={() => canExport && onSendSlack()}>Send to Slack</button>
          </div>
        </div>

        {["sales", "insights", "forecast"].includes(activeTab) && (
          <section className="panel date-selector-pill-wrap">
            <button className="date-selector-pill" onClick={openDateModal}>
              <span className="date-pill-icon">📅</span>
              <span>{compareSummary}</span>
              <span className="date-pill-caret">▾</span>
            </button>
          </section>
        )}

        {activeTab === "data" && (
          <>
            <div className="two-col-grid">
              <section className="panel">
                <div className="panel-row">
                  <h3>Settings</h3>
                </div>
                <label className="toggle-line">
                  <input type="checkbox" disabled={!canEdit} checked={autoSlack} onChange={(e) => onToggleAutoSlack(e.target.checked)} />
                  <span>Auto-send Slack on new date import</span>
                </label>
                {!canEdit && <p className="muted-note" style={{ marginTop: 6 }}>Only Admin can change import settings.</p>}
                <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                  <button className="btn btn-accent" disabled={!canExport} onClick={() => canExport && onSendSlack()}>Send Summary to Slack</button>
                  <button className="btn" disabled={!canExport} onClick={() => canExport && window.open(`${process.env.NEXT_PUBLIC_API_BASE_URL || process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000"}/api/export/sales-pdf?start_date=${startDate}&end_date=${endDate}`, "_blank")}>Export PDF</button>
                </div>
              </section>
              <section className="panel">
                <div className="panel-row">
                  <h3>Quick Actions</h3>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button className="btn" onClick={() => setShowCoverage((v) => !v)}>{showCoverage ? "Hide" : "Show"} Date Coverage</button>
                  <button className="btn" onClick={() => setShowImportHistory((v) => !v)}>{showImportHistory ? "Hide" : "Show"} Import History</button>
                </div>
              </section>
            </div>

            {workspaceChannel === "Shopify" ? (
              <div className="two-col-grid" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
                <section className="panel">
                  <h3>Shopify IQBAR (By Day)</h3>
                  <p className="muted-note" style={{ margin: "4px 0 12px" }}>Upload IQBAR daily sales export.</p>
                  <input type="file" disabled={!canEdit} multiple onChange={(e) => setShopifyIqbarFiles(Array.from(e.target.files || []))} style={{ marginBottom: 10 }} />
                  <button className="btn btn-accent" disabled={!canEdit || !shopifyIqbarFiles.length} onClick={() => canEdit && onUploadShopifyLine("IQBAR", shopifyIqbarFiles)}>Upload IQBAR</button>
                </section>
                <section className="panel">
                  <h3>Shopify IQMIX (By Day)</h3>
                  <p className="muted-note" style={{ margin: "4px 0 12px" }}>Upload IQMIX daily sales export.</p>
                  <input type="file" disabled={!canEdit} multiple onChange={(e) => setShopifyIqmixFiles(Array.from(e.target.files || []))} style={{ marginBottom: 10 }} />
                  <button className="btn btn-accent" disabled={!canEdit || !shopifyIqmixFiles.length} onClick={() => canEdit && onUploadShopifyLine("IQMIX", shopifyIqmixFiles)}>Upload IQMIX</button>
                </section>
                <section className="panel">
                  <h3>Shopify IQJOE (By Day)</h3>
                  <p className="muted-note" style={{ margin: "4px 0 12px" }}>Upload IQJOE daily sales export.</p>
                  <input type="file" disabled={!canEdit} multiple onChange={(e) => setShopifyIqjoeFiles(Array.from(e.target.files || []))} style={{ marginBottom: 10 }} />
                  <button className="btn btn-accent" disabled={!canEdit || !shopifyIqjoeFiles.length} onClick={() => canEdit && onUploadShopifyLine("IQJOE", shopifyIqjoeFiles)}>Upload IQJOE</button>
                </section>
              </div>
            ) : (
              <div className="two-col-grid" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
                <section className="panel">
                  <h3>Payments Data</h3>
                  <p className="muted-note" style={{ margin: "4px 0 12px" }}>Upload Amazon payments CSV files</p>
                  <input type="file" disabled={!canEdit} multiple onChange={(e) => setUploadFiles(Array.from(e.target.files || []))} style={{ marginBottom: 10 }} />
                  <button className="btn btn-accent" disabled={!canEdit} onClick={() => canEdit && onUploadPayments()}>Upload Payments</button>
                </section>
                <section className="panel">
                  <h3>Inventory Data</h3>
                  <p className="muted-note" style={{ margin: "4px 0 12px" }}>Upload FBA inventory snapshots</p>
                  <input type="file" disabled={!canEdit} multiple onChange={(e) => setInventoryUploadFiles(Array.from(e.target.files || []))} style={{ marginBottom: 10 }} />
                  <button className="btn btn-accent" disabled={!canEdit} onClick={() => canEdit && onUploadInventory()}>Upload Inventory</button>
                </section>
                <section className="panel">
                  <h3>New-To-Brand Data</h3>
                  <p className="muted-note" style={{ margin: "4px 0 12px" }}>Upload NTB customer reports</p>
                  <input type="file" disabled={!canEdit} multiple onChange={(e) => setNtbUploadFiles(Array.from(e.target.files || []))} style={{ marginBottom: 10 }} />
                  <button className="btn btn-accent" disabled={!canEdit} onClick={() => canEdit && onUploadNtb()}>Upload NTB</button>
                </section>
              </div>
            )}

            {showCoverage && (
              <section className="panel">
                <h3>Date Coverage</h3>
                <table className="styled-table">
                  <thead>
                    <tr>
                      <th className="sortable" onClick={() => setCoverageSort((s) => (s.key === "date" ? { key: "date", dir: s.dir === "asc" ? "desc" : "asc" } : { key: "date", dir: "asc" }))}>
                        Date {sortCoverageArrow("date")}
                      </th>
                      <th className="sortable" onClick={() => setCoverageSort((s) => (s.key === "uploaded" ? { key: "uploaded", dir: s.dir === "asc" ? "desc" : "asc" } : { key: "uploaded", dir: "asc" }))}>
                        Uploaded {sortCoverageArrow("uploaded")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedCoverageRows.slice(0, 1000).map((r) => (
                      <tr key={r.date}><td>{r.date}</td><td className={r.uploaded ? "status-green" : "status-red"}>{r.uploaded ? "Yes" : "No"}</td></tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}

            {showImportHistory && (
              <section className="panel">
                <h3>Import History</h3>
                <table className="styled-table">
                  <thead><tr><th>Imported At</th><th>Source File</th><th>Rows</th><th>Min Date</th><th>Max Date</th><th>Actions</th></tr></thead>
                  <tbody>
                    {importHistory.map((r, i) => (
                      <tr key={`${r.id || r.imported_at}-${i}`}>
                        <td>{r.imported_at}</td>
                        <td>{r.source_file}</td>
                        <td>{Number(r.row_count || 0).toLocaleString()}</td>
                        <td>{r.min_date}</td>
                        <td>{r.max_date}</td>
                        <td>
                          <button className="btn" disabled={!canEdit} onClick={() => canEdit && onDeleteImportRow(r)}>Delete</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}
          </>
        )}

        {loading && (
          <div className="loading-overlay" role="status" aria-live="polite">
            <div className="loading-overlay-bg" />
            <div className="loading-hero">
              <div className="loading-orb-wrap">
                <div className="loading-orb" />
                <div className="loading-ring" />
              </div>
              <h2 className="loading-title">Syncing IQBAR Analytics</h2>
              <p className="loading-subtitle">Refreshing sales, inventory, and forecast models...</p>
              <div className="loading-track"><span /></div>
              <div className="loading-grid">
                <div className="loading-tile" />
                <div className="loading-tile" />
                <div className="loading-tile" />
                <div className="loading-tile" />
                <div className="loading-tile" />
                <div className="loading-tile" />
              </div>
            </div>
          </div>
        )}
        {apiError && <div className="error-line">API error: {apiError}</div>}

        {activeTab === "goals" && (
          <>
            <section className="panel">
              <div className="panel-row">
                <div>
                  <h3>Goals & KPIs</h3>
                  <p className="muted-note">Monthly and quarterly targets tracked against live performance.</p>
                </div>
                <button className="btn btn-accent" disabled={!canEdit} onClick={() => {
                  if (!canEdit) return;
                  const monthStr = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
                  setGoalDraft({
                    id: "",
                    name: `${formatMonthLabel(monthStr)} - Total Revenue`,
                    metric: "total_revenue",
                    period: "monthly",
                    year: new Date().getFullYear(),
                    month: new Date().getMonth() + 1,
                    quarter: 1,
                    targetValue: 0,
                  });
                  setShowGoalEditor(true);
                }}>Add Goal</button>
              </div>
              <p className="muted-note">These goals drive MTD pace-to-goal in Forecast.</p>
              {dbGoalMsg ? <p className="muted-note" style={{ marginTop: 6 }}>{dbGoalMsg}</p> : null}
            </section>

            <section className="panel">
              <div className="panel-row">
                <h3>{workspaceChannel === "Shopify" ? "Shopify Goals" : "Amazon Goals (Database)"}</h3>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn" onClick={() => setShowDbGoalsTable((v) => !v)}>
                    {showDbGoalsTable ? "Hide" : "Show"} Table
                  </button>
                  <button className="btn" onClick={async () => {
                    const fresh = await apiGet("/api/goals", channelParams);
                    setDbGoals(fresh?.rows || []);
                  }}>Refresh</button>
                </div>
              </div>
              {showDbGoalsTable && (
                <table className="styled-table">
                  <thead>
                    <tr>
                      <th>Year</th>
                      <th>Month</th>
                      <th>Product Line</th>
                      <th>Goal</th>
                      <th>Updated</th>
                      <th>Save</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(dbGoals || []).map((r, i) => {
                      const key = `${r.year}-${r.month}-${r.product_line}`;
                      return (
                        <tr key={`${key}-${i}`}>
                          <td>{r.year}</td>
                          <td>{formatMonthLabel(`${r.year}-${String(r.month).padStart(2, "0")}`)}</td>
                          <td>{r.product_line}</td>
                          <td className="num-cell">
                            <input
                              className="inline-number"
                              type="number"
                              step="1"
                              disabled={!canEdit}
                              value={dbGoalEdits[key] ?? Number(r.goal || 0)}
                              onChange={(e) => setDbGoalEdits((m) => ({ ...m, [key]: Number(e.target.value || 0) }))}
                            />
                          </td>
                          <td>{r.updated_at || "-"}</td>
                          <td>
                            <button className="btn" disabled={!canEdit} onClick={() => canEdit && onSaveDbGoal(r)}>Save</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </section>
            <section className="panel chart-panel">
              <div className="panel-row">
                <h3>Monthly Goal vs Actual</h3>
                <div className="field compact" style={{ marginBottom: 0 }}>
                  <label>Year</label>
                  <select value={goalsYearFilter} onChange={(e) => setGoalsYearFilter(e.target.value)}>
                    <option value="all">All Years</option>
                    {goalsYearOptions.map((y) => <option key={`gy-${y}`} value={String(y)}>{y}</option>)}
                  </select>
                </div>
              </div>
              <div className="chart-wrap">
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart
                    data={goalsMonthlyFiltered}
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e8eaf0" />
                    <XAxis dataKey="label" tick={{ fill: "#8b90a0", fontSize: 11 }} />
                    <YAxis tick={{ fill: "#8b90a0", fontSize: 11 }} tickFormatter={(v) => (v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v)} />
                    <Tooltip formatter={(v) => fmtMoney(v)} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="goal" fill="#c7d2fe" name="Goal" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="actual" fill="#4f46e5" name="Actual" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>
            {!goalsMonthlyFiltered.length && (
              <section className="panel premium-empty">
                <h3>No goal history yet</h3>
                <p className="muted-note">Add or import monthly goals to chart goal vs actual by month.</p>
              </section>
            )}
          </>
        )}

        {activeTab === "flows" && (
          <>
            <section className="panel">
              <div className="panel-row">
                <div>
                  <h3>Flows</h3>
                  <p className="muted-note">Visual trigger → conditions → actions automation with Slack, in-app, and email outputs.</p>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    className="btn btn-accent"
                    disabled={!canEdit}
                    onClick={() => canEdit && addFlow(makeBlankFlow(`Flow ${flows.length + 1}`))}
                  >
                    + New Flow
                  </button>
                  <button className="btn" onClick={() => runFlowsByTrigger("on_data_refresh", "manual-scan")}>Run Trigger Scan</button>
                </div>
              </div>
              {!flows.length ? (
                <div className="premium-empty flow-empty">
                  <h3>Blank slate ready</h3>
                  <p className="muted-note">No flows yet. Start from scratch or use a template.</p>
                  <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", marginTop: 10 }}>
                    <button className="btn btn-accent" disabled={!canEdit} onClick={() => canEdit && addFlow(makeBlankFlow("Untitled Flow"))}>Create Blank Flow</button>
                    <button className="btn" disabled={!canEdit} onClick={() => canEdit && addFlow({
                      ...makeBlankFlow("Revenue Drop Alert"),
                      trigger: { type: "on_data_refresh", label: "On data refresh" },
                      conditions: [{ id: uid("cond"), metric: "total_revenue", operator: "lt", value: 100000 }],
                      actions: [{ id: uid("act"), type: "in_app_alert", severity: "warning", title: "Revenue below threshold", message: "Total revenue dropped under threshold." }],
                    })}>Template: Revenue Alert</button>
                    <button className="btn" disabled={!canEdit} onClick={() => canEdit && addFlow({
                      ...makeBlankFlow("Critical WOS to Slack"),
                      trigger: { type: "on_import_inventory", label: "Inventory import completed" },
                      conditions: [{ id: uid("cond"), metric: "critical_sku_count", operator: "gt", value: 0 }],
                      actions: [{ id: uid("act"), type: "slack_summary", message: "Critical inventory detected after import." }],
                    })}>Template: Inventory to Slack</button>
                  </div>
                </div>
              ) : (
                <div className="flows-layout">
                  <section className="flows-col flows-left">
                    <h4>All Flows</h4>
                    <div className="flows-list">
                      {(flows || []).map((f) => (
                        <button
                          key={f.id}
                          className={`flow-list-item ${selectedFlowId === f.id ? "active" : ""}`}
                          onClick={() => {
                            setSelectedFlowId(f.id);
                            setSelectedFlowNode({ kind: "trigger", index: -1 });
                          }}
                        >
                          <div className="flow-list-head">
                            <strong>{f.name}</strong>
                            <span className={`status-badge ${f.active ? "success" : "neutral"}`}>{f.active ? "On" : "Off"}</span>
                          </div>
                          <div className="muted-note">{(f.trigger?.label || f.trigger?.type || "manual").replaceAll("_", " ")}</div>
                        </button>
                      ))}
                    </div>
                    <div className="flows-library">
                      <h4>Node Library</h4>
                      <button className="btn" disabled={!canEdit || !selectedFlow} onClick={() => {
                        const fid = ensureSelectedFlow();
                        if (!fid) return;
                        updateFlow(fid, (f) => ({ ...f, conditions: [...(f.conditions || []), { id: uid("cond"), metric: "total_revenue", operator: "lt", value: 100000 }] }));
                        setSelectedFlowNode({ kind: "condition", index: (selectedFlow?.conditions || []).length });
                      }}>+ Condition</button>
                      <button className="btn" disabled={!canEdit || !selectedFlow} onClick={() => {
                        const fid = ensureSelectedFlow();
                        if (!fid) return;
                        updateFlow(fid, (f) => ({ ...f, actions: [...(f.actions || []), { id: uid("act"), type: "in_app_alert", severity: "info", title: "Flow triggered", message: `${f.name} executed.` }] }));
                        setSelectedFlowNode({ kind: "action", index: (selectedFlow?.actions || []).length });
                      }}>+ Action</button>
                    </div>
                  </section>

                  <section className="flows-col flows-canvas">
                    <div className="panel-row">
                      <h4>{selectedFlow?.name || "Select a flow"}</h4>
                      <div style={{ display: "flex", gap: 8 }}>
                        {selectedFlow ? (
                          <>
                            <button className="btn" onClick={() => runFlow(selectedFlow, "manual")}>Run Now</button>
                            <button className="btn" disabled={!canEdit} onClick={() => canEdit && updateFlow(selectedFlow.id, (f) => ({ ...f, active: !f.active }))}>{selectedFlow?.active ? "Disable" : "Enable"}</button>
                            <button className="btn" disabled={!canEdit} onClick={() => canEdit && deleteFlow(selectedFlow.id)}>Delete</button>
                          </>
                        ) : null}
                      </div>
                    </div>
                    {selectedFlow ? (
                      <div className="flow-canvas-stack">
                        <button className={`flow-node trigger ${selectedFlowNode.kind === "trigger" ? "selected" : ""}`} onClick={() => setSelectedFlowNode({ kind: "trigger", index: -1 })}>
                          <span className="flow-node-label">Trigger</span>
                          <strong>{(selectedFlow?.trigger?.label || selectedFlow?.trigger?.type || "manual").replaceAll("_", " ")}</strong>
                        </button>
                        {(selectedFlow.conditions || []).map((c, idx) => (
                          <button key={c.id} className={`flow-node condition ${selectedFlowNode.kind === "condition" && selectedFlowNode.index === idx ? "selected" : ""}`} onClick={() => setSelectedFlowNode({ kind: "condition", index: idx })}>
                            <span className="flow-node-label">Condition {idx + 1}</span>
                            <strong>{String(c.metric || "metric").replaceAll("_", " ")} {c.operator} {c.value}</strong>
                          </button>
                        ))}
                        {(selectedFlow.actions || []).map((a, idx) => (
                          <button key={a.id} className={`flow-node action ${selectedFlowNode.kind === "action" && selectedFlowNode.index === idx ? "selected" : ""}`} onClick={() => setSelectedFlowNode({ kind: "action", index: idx })}>
                            <span className="flow-node-label">Action {idx + 1}</span>
                            <strong>{String(a.type || "action").replaceAll("_", " ")}</strong>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="empty-note">Select or create a flow to start building.</div>
                    )}
                    <div className="panel" style={{ marginTop: 14 }}>
                      <div className="panel-row"><h4>Run History</h4></div>
                      <table className="styled-table">
                        <thead>
                          <tr><th>Time</th><th>Flow</th><th>Source</th><th>Conditions</th><th>Actions</th><th>Status</th></tr>
                        </thead>
                        <tbody>
                          {(flowRuns || []).slice(0, 12).map((r) => (
                            <tr key={r.id}>
                              <td>{fmtAgo(r.run_at)}</td>
                              <td>{r.flow_name}</td>
                              <td>{r.source}</td>
                              <td>{r.conditions_count}</td>
                              <td>{r.actions_count}</td>
                              <td><span className={`status-badge ${r.passed ? "success" : "neutral"}`}>{r.passed ? "Passed" : "No-match"}</span></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>

                  <section className="flows-col flows-right">
                    <h4>Node Settings</h4>
                    {!selectedFlow && <div className="empty-note">Select a flow.</div>}
                    {selectedFlow && selectedFlowNode.kind === "trigger" && (
                      <div className="settings-block">
                        <div className="field">
                          <label>Flow Name</label>
                          <input disabled={!canEdit} value={selectedFlow.name} onChange={(e) => canEdit && updateFlow(selectedFlow.id, { name: e.target.value })} />
                        </div>
                        <div className="field">
                          <label>Trigger</label>
                          <select
                            disabled={!canEdit}
                            value={selectedFlow?.trigger?.type || "manual"}
                            onChange={(e) => canEdit && updateFlow(selectedFlow.id, (f) => ({ ...f, trigger: { ...f.trigger, type: e.target.value, label: e.target.options[e.target.selectedIndex].text } }))}
                          >
                            <option value="manual">Manual Run</option>
                            <option value="on_data_refresh">On data refresh</option>
                            <option value="on_import_payments">On payments import</option>
                            <option value="on_import_inventory">On inventory import</option>
                            <option value="on_import_ntb">On NTB import</option>
                          </select>
                        </div>
                      </div>
                    )}
                    {selectedFlow && selectedFlowNode.kind === "condition" && (selectedFlow.conditions || [])[selectedFlowNode.index] && (
                      <div className="settings-block">
                        {(() => {
                          const idx = selectedFlowNode.index;
                          const c = (selectedFlow.conditions || [])[idx];
                          return (
                            <>
                              <div className="field">
                                <label>Metric</label>
                                <select disabled={!canEdit} value={c.metric} onChange={(e) => canEdit && updateFlow(selectedFlow.id, (f) => ({ ...f, conditions: (f.conditions || []).map((x, i) => (i === idx ? { ...x, metric: e.target.value } : x)) }))}>
                                  <option value="total_revenue">Total Revenue</option>
                                  <option value="iqbar_revenue">IQBAR Revenue</option>
                                  <option value="iqmix_revenue">IQMIX Revenue</option>
                                  <option value="iqjoe_revenue">IQJOE Revenue</option>
                                  <option value="pace_to_goal_pct">Pace % to Goal</option>
                                  <option value="ntb_rate_pct">NTB Rate %</option>
                                  <option value="critical_sku_count">Critical SKU Count</option>
                                  <option value="min_wos">Min WOS</option>
                                </select>
                              </div>
                              <div className="field">
                                <label>Operator</label>
                                <select disabled={!canEdit} value={c.operator || "lt"} onChange={(e) => canEdit && updateFlow(selectedFlow.id, (f) => ({ ...f, conditions: (f.conditions || []).map((x, i) => (i === idx ? { ...x, operator: e.target.value } : x)) }))}>
                                  <option value="lt">less than</option>
                                  <option value="lte">less than or equal</option>
                                  <option value="gt">greater than</option>
                                  <option value="gte">greater than or equal</option>
                                  <option value="eq">equal to</option>
                                </select>
                              </div>
                              <div className="field">
                                <label>Value</label>
                                <input disabled={!canEdit} type="number" value={c.value ?? 0} onChange={(e) => canEdit && updateFlow(selectedFlow.id, (f) => ({ ...f, conditions: (f.conditions || []).map((x, i) => (i === idx ? { ...x, value: Number(e.target.value || 0) } : x)) }))} />
                              </div>
                              <div className="field">
                                <label>Current metric value</label>
                                <div className="muted-note">{Number(flowMetricValues[c.metric] || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
                              </div>
                              <button className="btn" disabled={!canEdit} onClick={() => canEdit && updateFlow(selectedFlow.id, (f) => ({ ...f, conditions: (f.conditions || []).filter((_, i) => i !== idx) }))}>Delete Condition</button>
                            </>
                          );
                        })()}
                      </div>
                    )}
                    {selectedFlow && selectedFlowNode.kind === "action" && (selectedFlow.actions || [])[selectedFlowNode.index] && (
                      <div className="settings-block">
                        {(() => {
                          const idx = selectedFlowNode.index;
                          const a = (selectedFlow.actions || [])[idx];
                          return (
                            <>
                              <div className="field">
                                <label>Action Type</label>
                                <select disabled={!canEdit} value={a.type || "in_app_alert"} onChange={(e) => canEdit && updateFlow(selectedFlow.id, (f) => ({ ...f, actions: (f.actions || []).map((x, i) => (i === idx ? { ...x, type: e.target.value } : x)) }))}>
                                  <option value="in_app_alert">In-app alert</option>
                                  <option value="slack_summary">Send Slack summary</option>
                                  <option value="email_alert">Send email alert</option>
                                </select>
                              </div>
                              <div className="field">
                                <label>Title / Subject</label>
                                <input disabled={!canEdit} value={a.title || a.subject || ""} onChange={(e) => canEdit && updateFlow(selectedFlow.id, (f) => ({ ...f, actions: (f.actions || []).map((x, i) => (i === idx ? { ...x, title: e.target.value, subject: e.target.value } : x)) }))} />
                              </div>
                              <div className="field">
                                <label>Message</label>
                                <input disabled={!canEdit} value={a.message || ""} onChange={(e) => canEdit && updateFlow(selectedFlow.id, (f) => ({ ...f, actions: (f.actions || []).map((x, i) => (i === idx ? { ...x, message: e.target.value } : x)) }))} />
                              </div>
                              {a.type === "email_alert" && (
                                <div className="field">
                                  <label>Email To</label>
                                  <input disabled={!canEdit} placeholder="alerts@iqbar.com" value={a.to || ""} onChange={(e) => canEdit && updateFlow(selectedFlow.id, (f) => ({ ...f, actions: (f.actions || []).map((x, i) => (i === idx ? { ...x, to: e.target.value } : x)) }))} />
                                </div>
                              )}
                              <button className="btn" disabled={!canEdit} onClick={() => canEdit && updateFlow(selectedFlow.id, (f) => ({ ...f, actions: (f.actions || []).filter((_, i) => i !== idx) }))}>Delete Action</button>
                            </>
                          );
                        })()}
                      </div>
                    )}
                  </section>
                </div>
              )}
            </section>
          </>
        )}

        {activeTab === "profitability" && (
          <>
            <section className="panel">
              <div className="panel-row">
                <h3>Profitability</h3>
                <input className="table-search" placeholder="Search SKU..." value={profitSearch} onChange={(e) => setProfitSearch(e.target.value)} />
              </div>
              <div className="fee-config">
                <span>Estimated fees:</span>
                <label>FBA % <input disabled={!canEdit} type="number" value={feeCfg.fbaFeePercent} onChange={(e) => setFeeCfg((s) => ({ ...s, fbaFeePercent: Number(e.target.value || 0) }))} /></label>
                <label>Referral % <input disabled={!canEdit} type="number" value={feeCfg.referralFeePercent} onChange={(e) => setFeeCfg((s) => ({ ...s, referralFeePercent: Number(e.target.value || 0) }))} /></label>
                <label>Ad Spend % <input disabled={!canEdit} type="number" value={feeCfg.adSpendPercent} onChange={(e) => setFeeCfg((s) => ({ ...s, adSpendPercent: Number(e.target.value || 0) }))} /></label>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
                <input type="file" disabled={!canEdit} accept=".xlsx,.xls,.csv" onChange={(e) => setCogsUploadFile((e.target.files || [])[0] || null)} />
                <button className="btn btn-accent" disabled={!canEdit || !cogsUploadFile} onClick={() => canEdit && onUploadCogsFees()}>Upload COGS + FBA by SKU</button>
                {cogsImportMsg ? <span className="muted-note">{cogsImportMsg}</span> : null}
              </div>
            </section>
            <section className="kpi-grid six-cols">
              <KpiCard label="Gross Revenue" value={profitabilitySummary.gross} delta={null} />
              <KpiCard label="Est. COGS" value={-Math.abs(profitabilitySummary.cogs)} delta={null} />
              <KpiCard label="Est. Fees" value={-Math.abs(profitabilitySummary.fees)} delta={null} />
              <KpiCard label="Est. Ad Spend" value={-Math.abs(profitabilitySummary.ads)} delta={null} />
              <KpiCard label="Net Profit" value={profitabilitySummary.net} delta={null} />
              <KpiCard label="Net Margin %" value={profitabilitySummary.margin} isPercent delta={null} />
            </section>
            <section className="panel chart-panel">
              <h3>Profit by Brand</h3>
              <div className="chart-wrap">
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart
                    data={["IQBAR", "IQMIX", "IQJOE"].map((line) => {
                      const rows = profitabilityRows.filter((r) => r.product_line === line);
                      const rev = rows.reduce((s, r) => s + Number(r.sales || 0), 0);
                      const cost = rows.reduce((s, r) => s + Number(r.totalCogs || 0) + Number(r.estFees || 0) + Number(r.estAds || 0), 0);
                      const net = rev - cost;
                      return { line, rev, cost, net };
                    })}
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e8eaf0" />
                    <XAxis dataKey="line" />
                    <YAxis tickFormatter={(v) => shortMoney(v)} />
                    <Tooltip formatter={(v) => fmtMoney(v)} />
                    <Legend />
                    <Bar dataKey="rev" fill="#4f46e5" name="Revenue" />
                    <Bar dataKey="cost" fill="#fecaca" name="Costs" />
                    <Bar dataKey="net" fill="#22c55e" name="Net Profit" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>
            <section className="panel">
              <div className="panel-row">
                <h3>SKU Profitability</h3>
                <button className="btn" disabled={!canExport} onClick={() => canExport && downloadCsv("profitability.csv", profitabilityRows.map((r) => ({
                  SKU: r.sku,
                  Brand: r.product_line,
                  Revenue: Number(r.sales || 0),
                  Units: Number(r.units || 0),
                  COGS_per_Unit: Number(r.cogsUnit || 0),
                  FBA_per_Unit: Number(r.fbaUnit || 0),
                  Total_COGS: Number(r.totalCogs || 0),
                  Est_Fees: Number(r.estFees || 0),
                  Est_Ad_Spend: Number(r.estAds || 0),
                  Net_Profit: Number(r.net || 0),
                  Margin_Pct: Number(r.margin || 0),
                })))}>Export CSV</button>
              </div>
              <table className="styled-table">
                <thead><tr><th>SKU</th><th>Brand</th><th>Revenue</th><th>Units</th><th>COGS/Unit</th><th>FBA/Unit</th><th>Total COGS</th><th>Est. Fees</th><th>Est. Ads</th><th>Net Profit</th><th>Margin %</th></tr></thead>
                <tbody>
                  {profitabilityRows.map((r) => (
                    <tr key={`pf-${r.sku}`}>
                      <td>{r.tag || r.sku}</td>
                      <td>{r.product_line}</td>
                      <td className="num-cell">{fmtMoney(r.sales)}</td>
                      <td className="num-cell">{Number(r.units || 0).toLocaleString()}</td>
                      <td className="num-cell">
                        <input
                          className="inline-number"
                          type="number"
                          step="0.01"
                          disabled={!canEdit}
                          value={cogsMap[r.sku] ?? ""}
                          onChange={(e) => setCogsMap((m) => ({ ...m, [r.sku]: Number(e.target.value || 0) }))}
                        />
                      </td>
                      <td className="num-cell">
                        <input
                          className="inline-number"
                          type="number"
                          step="0.01"
                          disabled={!canEdit}
                          value={fbaSkuMap[r.sku] ?? ""}
                          onChange={(e) => setFbaSkuMap((m) => ({ ...m, [r.sku]: Number(e.target.value || 0) }))}
                        />
                      </td>
                      <td className="num-cell">{fmtMoney(r.totalCogs)}</td>
                      <td className="num-cell">{fmtMoney(r.estFees)}</td>
                      <td className="num-cell">{fmtMoney(r.estAds)}</td>
                      <td className={`num-cell ${r.net >= 0 ? "status-green" : "status-red"}`}>{fmtMoney(r.net)}</td>
                      <td className="num-cell">
                        <span className={`delta-badge ${r.margin >= 0.2 ? "up" : r.margin < 0.1 ? "down" : "neutral"}`}>{fmtPct(r.margin)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </>
        )}

        {activeTab === "promotions" && (
          <>
            <section className="panel">
              <div className="panel-row">
                <div>
                  <h3>Promotions</h3>
                  <p className="muted-note">Track promo calendars and quantify lift versus baseline.</p>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className={`chip-btn ${promoView === "timeline" ? "active" : ""}`} onClick={() => setPromoView("timeline")}>Timeline</button>
                  <button className={`chip-btn ${promoView === "calendar" ? "active" : ""}`} onClick={() => setPromoView("calendar")}>Calendar</button>
                  <button className="btn btn-accent" onClick={() => {
                    setPromoDraft({ id: "", name: "", type: "sale", startDate, endDate, productLine: "All", discountPct: "", notes: "" });
                    setShowPromoEditor(true);
                  }}>Log Promotion</button>
                </div>
              </div>
            </section>
            <section className="three-col-grid">
              <KpiCard label="Total Promos Logged" value={promotions.length} isNumber delta={null} />
              <KpiCard label="Avg Lift %" value={promotions.length ? promotions.reduce((s, p) => s + Number(p.liftPct || 0), 0) / promotions.length : 0} isPercent delta={null} />
              <KpiCard label="Best Promo Lift" value={Math.max(0, ...(promotions.map((p) => Number(p.liftPct || 0))))} isPercent delta={null} />
            </section>
            {promoView === "timeline" ? (
              <section className="panel chart-panel">
                <h3>Promotions Timeline</h3>
                <div className="chart-wrap">
                  <ResponsiveContainer width="100%" height={320}>
                    <ComposedChart data={allDailyTotals.map((r) => ({ ...r, label: formatDayLabel(r.date) }))}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e8eaf0" />
                      <XAxis dataKey="label" tick={{ fill: "#8b90a0", fontSize: 11 }} />
                      <YAxis tick={{ fill: "#8b90a0", fontSize: 11 }} />
                      <Tooltip formatter={(v) => fmtMoney(v)} />
                      <Line type="monotone" dataKey="total" stroke="#4f46e5" strokeWidth={2.5} dot={false} name="Revenue" />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <div className="promo-legend">
                  {promotions.map((p) => (
                    <span key={p.id} className="promo-chip" style={{ borderColor: promoColors[p.type], color: promoColors[p.type] }}>
                      {p.name} · {fmtRange(p.startDate, p.endDate)}
                    </span>
                  ))}
                </div>
              </section>
            ) : (
              <section className="panel">
                <h3>Calendar View</h3>
                <div className="calendar-grid">
                  {(daily || []).slice(-42).map((d) => {
                    const items = promotions.filter((p) => d.date >= p.startDate && d.date <= p.endDate);
                    return (
                      <div key={d.date} className="calendar-cell">
                        <div className="calendar-day">{formatDayLabel(d.date)}</div>
                        <div className="calendar-dots">
                          {items.slice(0, 3).map((i) => <span key={i.id} style={{ background: promoColors[i.type] }} />)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
            <section className="panel">
              <h3>Promotions Impact</h3>
              <table className="styled-table">
                <thead><tr><th>Name</th><th>Type</th><th>Date Range</th><th>Product Line</th><th>Discount %</th><th>Lift %</th><th>Actions</th></tr></thead>
                <tbody>
                  {promotions.map((p) => (
                    <tr key={p.id}>
                      <td>{p.name}</td>
                      <td><span className="promo-type" style={{ background: `${promoColors[p.type]}20`, color: promoColors[p.type] }}>{String(p.type || "").replaceAll("_", " ")}</span></td>
                      <td>{fmtRange(p.startDate, p.endDate)}</td>
                      <td>{p.productLine}</td>
                      <td className="num-cell">{p.discountPct ? `${Number(p.discountPct).toFixed(0)}%` : "-"}</td>
                      <td className="num-cell"><span className={`delta-badge ${Number(p.liftPct || 0) >= 0 ? "up" : "down"}`}>{pctSigned(Number(p.liftPct || 0) / 100)}</span></td>
                      <td>
                        <button className="btn" onClick={() => { setPromoDraft({ ...p }); setShowPromoEditor(true); }}>Edit</button>
                        <button className="btn" onClick={() => setPromotions((rows) => rows.filter((x) => x.id !== p.id))}>Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </>
        )}

        {activeTab === "reports" && (
          <>
            <section className="panel">
              <h3>Report Templates</h3>
              <p className="muted-note">Generate on-demand exports or schedule automated delivery.</p>
            </section>
            <div className="three-col-grid">
              {[
                { id: "weekly_performance", title: "Weekly Performance Summary", pages: "2-3 pages" },
                { id: "monthly_executive", title: "Monthly Executive Report", pages: "5-6 pages" },
                { id: "inventory_alert", title: "Inventory Alert Report", pages: "1-2 pages" },
                { id: "ntb_monthly", title: "New-To-Brand Monthly", pages: "2 pages" },
                { id: "custom", title: "Custom Report Builder", pages: "Variable" },
              ].map((t) => (
                <section key={t.id} className="panel">
                  <h4>{t.title}</h4>
                  <p className="muted-note">{t.pages}</p>
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <button
                      className="btn"
                      disabled={!canExport}
                      onClick={() => {
                        if (!canExport) return;
                        window.open(`${process.env.NEXT_PUBLIC_API_BASE_URL || process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000"}/api/export/sales-pdf?start_date=${startDate}&end_date=${endDate}`, "_blank");
                        setReportHistory((rows) => [{
                          id: uid("rep"),
                          generatedAt: new Date().toISOString(),
                          name: t.title,
                          template: t.id,
                          triggeredBy: "Manual",
                          format: "PDF",
                          status: "Success",
                        }, ...rows].slice(0, 20));
                      }}
                    >
                      Generate PDF
                    </button>
                    <button
                      className="btn btn-accent"
                      disabled={!canEdit}
                      onClick={() => {
                        if (!canEdit) return;
                        setScheduleDraft({
                          id: "",
                          name: `${t.title} Schedule`,
                          template: t.id,
                          frequency: "weekly",
                          dayOfWeek: 1,
                          dayOfMonth: 1,
                          deliveryTime: "08:00",
                          channels: ["slack"],
                          email: "",
                          slackChannel: "#amazon-alerts",
                          recipientName: "",
                          brandingLogo: "",
                          isActive: true,
                        });
                        setShowScheduleEditor(true);
                      }}
                    >
                      Schedule
                    </button>
                  </div>
                </section>
              ))}
            </div>
            <section className="panel">
              <h3>Active Schedules</h3>
              <div className="list-stack">
                {reportSchedules.map((s) => (
                  <div key={s.id} className="list-row">
                    <input type="checkbox" disabled={!canEdit} checked={Boolean(s.isActive)} onChange={(e) => setReportSchedules((rows) => rows.map((x) => (x.id === s.id ? { ...x, isActive: e.target.checked } : x)))} />
                    <div className="list-main">
                      <div className="list-title">{s.name}</div>
                      <div className="list-sub">{s.frequency} @ {s.deliveryTime} · {s.channels.join(", ")}</div>
                    </div>
                    <button className="btn" disabled={!canEdit} onClick={() => { if (!canEdit) return; setScheduleDraft({ ...s }); setShowScheduleEditor(true); }}>Edit</button>
                    <button className="btn" disabled={!canEdit} onClick={() => canEdit && setReportSchedules((rows) => rows.filter((x) => x.id !== s.id))}>Delete</button>
                  </div>
                ))}
                {!reportSchedules.length && <p className="muted-note">No scheduled reports yet.</p>}
              </div>
            </section>
            <section className="panel">
              <h3>Recent Reports</h3>
              <table className="styled-table">
                <thead><tr><th>Date Generated</th><th>Report Name</th><th>Template</th><th>Triggered By</th><th>Format</th><th>Status</th></tr></thead>
                <tbody>
                  {reportHistory.map((r) => (
                    <tr key={r.id}>
                      <td>{r.generatedAt}</td>
                      <td>{r.name}</td>
                      <td>{r.template}</td>
                      <td>{r.triggeredBy}</td>
                      <td>{r.format}</td>
                      <td>{r.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </>
        )}

        

        {/* ===================== SALES OVERVIEW ===================== */}
        {activeTab === "sales" && (
          <>
            <section className="kpi-grid four-cols">
              {salesKpis.map((k, idx) => {
                let toneClass = "kpi-tone-top";
                let badge = "";
                let badgeClass = "";
                if (isMtdSelected) {
                  const row = Math.floor(idx / 4);
                  toneClass = row === 1 ? "kpi-tone-mid" : row === 2 ? "kpi-tone-bottom" : "kpi-tone-top";
                  if (row === 0) badge = "MTD";
                  if (row === 2) {
                    badge = appliedScenarioDisplay;
                    badgeClass = "scenario";
                  }
                }
                return (
                  <KpiCard key={k.label} {...k} toneClass={toneClass} badge={badge} badgeClass={badgeClass} />
                );
              })}
            </section>

            <section className="panel chart-panel">
              <div className="chart-panel-header">
                <h3>Revenue Over Time</h3>
              </div>
              <div className="chart-wrap">
                <ResponsiveContainer width="100%" height={360}>
                  <BarChart data={daily.map((r) => ({ ...r, dateLabel: formatDayLabel(r.date) }))}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e8eaf0" />
                    <XAxis dataKey="dateLabel" tick={{ fill: "#8b90a0", fontSize: 11 }} />
                    <YAxis tick={{ fill: "#8b90a0", fontSize: 11 }} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}K` : v} />
                    <Tooltip contentStyle={{ background: "#fff", border: "1px solid #e8eaf0", borderRadius: 10, fontSize: 13 }} formatter={(v) => fmtMoney(v)} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="iqbar" stackId="a" fill="#4f46e5" name="IQBAR" radius={[0,0,0,0]} />
                    <Bar dataKey="iqmix" stackId="a" fill="#0ea5e9" name="IQMIX" />
                    <Bar dataKey="iqjoe" stackId="a" fill="#f59e0b" name="IQJOE" radius={[3,3,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section className="panel">
              <div className="panel-row">
                <h3>Daily Sales</h3>
                <button className="btn" onClick={() => downloadCsv(`sales_pivot_${startDate}_to_${endDate}.csv`, pivotRows)}>Export CSV</button>
              </div>
              <table className="styled-table">
                <thead>
                  <tr>
                    <th className="sortable" onClick={() => toggleSalesSort("date")}>Date {sortSalesArrow("date")}</th>
                    <th className="sortable" onClick={() => toggleSalesSort("grand_total")}>Grand Total {sortSalesArrow("grand_total")}</th>
                    <th className="sortable" onClick={() => toggleSalesSort("iqbar")}>IQBAR {sortSalesArrow("iqbar")}</th>
                    <th className="sortable" onClick={() => toggleSalesSort("iqmix")}>IQMIX {sortSalesArrow("iqmix")}</th>
                    <th className="sortable" onClick={() => toggleSalesSort("iqjoe")}>IQJOE {sortSalesArrow("iqjoe")}</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedSalesRows.map((r, i) => (
                    <tr key={`${r.date || r.date_label}-${i}`}>
                      <td>{r.date_label}</td>
                      <td>{fmtMoney(r.grand_total)}</td>
                      <td>{fmtMoney(r.iqbar)}</td>
                      <td>{fmtMoney(r.iqmix)}</td>
                      <td>{fmtMoney(r.iqjoe)}</td>
                    </tr>
                  ))}
                  {sortedSalesRows.length > 0 && (
                    <tr className="summary-row">
                      <td>Total</td>
                      <td>{fmtMoney(sortedSalesRows.reduce((sum, r) => sum + Number(r.grand_total || 0), 0))}</td>
                      <td>{fmtMoney(sortedSalesRows.reduce((sum, r) => sum + Number(r.iqbar || 0), 0))}</td>
                      <td>{fmtMoney(sortedSalesRows.reduce((sum, r) => sum + Number(r.iqmix || 0), 0))}</td>
                      <td>{fmtMoney(sortedSalesRows.reduce((sum, r) => sum + Number(r.iqjoe || 0), 0))}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </section>
          </>
        )}

        {/* ===================== NEW-TO-BRAND ===================== */}
        {activeTab === "ntb" && (
          <>
            <section className="panel chart-panel">
              <div className="chart-panel-header">
                <h3>New-To-Brand Customers</h3>
                <span className="muted-note">
                  {ntbData?.updated_from || "n/a"} — {ntbData?.updated_to || "n/a"}
                </span>
              </div>
              <div className="chart-wrap">
                <ResponsiveContainer width="100%" height={380}>
                  <ComposedChart data={ntbData?.rows || []}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e8eaf0" />
                    <XAxis dataKey="month_label" tick={{ fill: "#8b90a0", fontSize: 12 }} />
                    <YAxis yAxisId="left" tick={{ fill: "#8b90a0", fontSize: 12 }} />
                    <YAxis yAxisId="right" orientation="right" tickFormatter={(v) => `${(Number(v || 0) * 100).toFixed(0)}%`} tick={{ fill: "#8b90a0", fontSize: 12 }} />
                    <Tooltip
                      contentStyle={{ background: "#fff", border: "1px solid #e8eaf0", borderRadius: 10, fontSize: 13 }}
                      formatter={(value, name) => {
                        if (name === "MoM Growth") return [fmtPct(Number(value || 0)), name];
                        return [Number(value || 0).toLocaleString(), name];
                      }}
                    />
                    <Legend />
                    <Bar yAxisId="left" dataKey="iqbar" stackId="ntb" fill="#4f46e5" name="IQBAR NTB" />
                    <Bar yAxisId="left" dataKey="iqmix" stackId="ntb" fill="#0ea5e9" name="IQMIX NTB" />
                    <Bar yAxisId="left" dataKey="iqjoe" stackId="ntb" fill="#f59e0b" name="IQJOE NTB" />
                    <Line yAxisId="right" type="monotone" dataKey="mom_growth" stroke="#E11D48" strokeWidth={2} name="MoM Growth" dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section className="panel">
              <h3>NTB Monthly Table</h3>
              <table className="styled-table">
                <thead><tr>
                  {[
                    { key: "month", label: "Month" },
                    { key: "iqbar", label: "IQBAR" },
                    { key: "iqmix", label: "IQMIX" },
                    { key: "iqjoe", label: "IQJOE" },
                    { key: "total_ntb", label: "Total NTB" },
                    { key: "mom_growth", label: "MoM Growth" },
                  ].map((c) => (
                    <th key={c.key} className="sortable" onClick={() => setNtbSort((s) => s.key === c.key ? { key: c.key, dir: s.dir === "asc" ? "desc" : "asc" } : { key: c.key, dir: "asc" })}>
                      {c.label} {ntbSort.key === c.key ? (ntbSort.dir === "asc" ? "↑" : "↓") : "↕"}
                    </th>
                  ))}
                </tr></thead>
                <tbody>
                  {sortRows(ntbData?.rows || [], ntbSort.key, ntbSort.dir).map((r, i) => (
                    <tr key={`${r.month}-${i}`}>
                      <td>{r.month_label || r.month}</td>
                      <td className="num-cell">{Number(r.iqbar || 0).toLocaleString()}</td>
                      <td className="num-cell">{Number(r.iqmix || 0).toLocaleString()}</td>
                      <td className="num-cell">{Number(r.iqjoe || 0).toLocaleString()}</td>
                      <td className="num-cell">{Number(r.total_ntb || 0).toLocaleString()}</td>
                      <td className="num-cell">{fmtPct(r.mom_growth)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </>
        )}

        {/* ===================== PRODUCT LEVEL INSIGHTS ===================== */}
        {activeTab === "insights" && (
          <>
            <section className="panel controls-inline">
              <div className="field"><label>Granularity</label><select value={granularity} onChange={(e) => setGranularity(e.target.value)}><option value="day">Day</option><option value="week">Week</option><option value="month">Month</option></select></div>
              <div className="field"><label>Metric</label><select value={metric} onChange={(e) => setMetric(e.target.value)}><option value="sales">Sales</option><option value="units">Units</option><option value="orders">Orders</option><option value="aov">AOV</option></select></div>
              <div className="field">
                <label>Product</label>
                <select value={productTag} onChange={(e) => setProductTag(e.target.value)}>
                  {!insightProductOptions.length && <option value="">No products available</option>}
                  {insightProductOptions.map((tag) => (
                    <option key={tag} value={tag}>{tag}</option>
                  ))}
                </select>
              </div>
            </section>

            <section className="panel chart-panel">
              <div className="chart-panel-header">
                <h3>Product Line Trend</h3>
              </div>
              <div className="chart-wrap">
                <ResponsiveContainer width="100%" height={330}>
                  <LineChart data={trendByLine}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e8eaf0" />
                    <XAxis dataKey="period" tick={{ fill: "#8b90a0", fontSize: 12 }} />
                    <YAxis tick={{ fill: "#8b90a0", fontSize: 12 }} />
                    <Tooltip contentStyle={{ background: "#fff", border: "1px solid #e8eaf0", borderRadius: 10, fontSize: 13 }} />
                    <Legend />
                    <Line type="monotone" dataKey="IQBAR" stroke="#4f46e5" strokeWidth={2.5} dot={false} />
                    <Line type="monotone" dataKey="IQMIX" stroke="#0ea5e9" strokeWidth={2.5} dot={false} />
                    <Line type="monotone" dataKey="IQJOE" stroke="#f59e0b" strokeWidth={2.5} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section className="panel">
              <h3>Product Line Summary</h3>
              <table className="styled-table">
                <thead><tr><th>Product Line</th><th>Sales</th><th>Units</th><th>Orders</th><th>AOV</th></tr></thead>
                <tbody>
                  {productSummary
                    .filter((r) => String(r.product_line || "").toLowerCase() !== "unmapped")
                    .map((r) => (
                    <tr key={r.product_line}><td>{r.product_line}</td><td className="num-cell">{fmtMoney(r.sales)}</td><td className="num-cell">{Number(r.units || 0).toLocaleString()}</td><td className="num-cell">{Number(r.orders || 0).toLocaleString()}</td><td className="num-cell">{fmtMoney(r.aov)}</td></tr>
                  ))}
                </tbody>
              </table>
            </section>

            {topMovers && (
              <div className="two-col-grid">
                <section className="panel">
                  <h3>Top Gainers ({productTag || "Product"})</h3>
                  <table className="styled-table">
                    <thead><tr><th>Product</th><th>Sales</th><th>Prev</th><th>Change</th></tr></thead>
                    <tbody>
                      {(topMovers.gainers || []).map((r, i) => (
                        <tr key={`g-${i}`}>
                          <td title={r.sku}>{r.tag || r.sku}</td>
                          <td className="num-cell">{fmtMoney(r.sales)}</td>
                          <td className="num-cell">{fmtMoney(r.prev_sales)}</td>
                          <td className="num-cell"><span className="delta-badge up">{fmtMoney(r.change)}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
                <section className="panel">
                  <h3>Top Decliners ({productTag || "Product"})</h3>
                  <table className="styled-table">
                    <thead><tr><th>Product</th><th>Sales</th><th>Prev</th><th>Change</th></tr></thead>
                    <tbody>
                      {(topMovers.decliners || []).map((r, i) => (
                        <tr key={`d-${i}`}>
                          <td title={r.sku}>{r.tag || r.sku}</td>
                          <td className="num-cell">{fmtMoney(r.sales)}</td>
                          <td className="num-cell">{fmtMoney(r.prev_sales)}</td>
                          <td className="num-cell"><span className="delta-badge down">{fmtMoney(r.change)}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              </div>
            )}
          </>
        )}

        {/* ===================== BUSINESS HEALTH ===================== */}
        {activeTab === "business" && (
          <>
            <section className="business-kpi-grid">
              <KpiCard label="Total Sales" value={monthly.summary.total_sales || 0} delta={null} />
              <KpiCard label="Avg Monthly Sales" value={monthly.summary.avg_monthly_sales || 0} delta={null} />
              <KpiCard label="Best Total Month" value={businessBest.bestTotal.value} delta={null} note={businessBest.bestTotal.note} />
            </section>
            <section className="business-kpi-grid">
              <KpiCard label="Best IQBAR Month" value={businessBest.bestIqbar.value} delta={null} note={businessBest.bestIqbar.note} />
              <KpiCard label="Best IQMIX Month" value={businessBest.bestIqmix.value} delta={null} note={businessBest.bestIqmix.note} />
              <KpiCard label="Best IQJOE Month" value={businessBest.bestIqjoe.value} delta={null} note={businessBest.bestIqjoe.note} />
            </section>
            <section className="panel chart-panel">
              <div className="chart-panel-header">
                <h3>Monthly Revenue Breakdown</h3>
              </div>
              <div className="chart-wrap">
                <ResponsiveContainer width="100%" height={360}>
                  <BarChart data={monthly.rows || []}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e8eaf0" />
                    <XAxis dataKey="month" tick={{ fill: "#8b90a0", fontSize: 11 }} />
                    <YAxis tick={{ fill: "#8b90a0", fontSize: 11 }} tickFormatter={(v) => v >= 1000000 ? `${(v/1000000).toFixed(1)}M` : v >= 1000 ? `${(v/1000).toFixed(0)}K` : v} />
                    <Tooltip contentStyle={{ background: "#fff", border: "1px solid #e8eaf0", borderRadius: 10, fontSize: 13 }} formatter={(v) => fmtMoney(v)} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="iqbar" stackId="a" fill="#4f46e5" name="IQBAR" />
                    <Bar dataKey="iqmix" stackId="a" fill="#0ea5e9" name="IQMIX" />
                    <Bar dataKey="iqjoe" stackId="a" fill="#f59e0b" name="IQJOE" radius={[3,3,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>
          </>
        )}

        {/* ===================== FORECAST ===================== */}
        {activeTab === "forecast" && (
          <>
            <section className="panel controls-inline controls-7">
              <div className="field">
                <label>Scenario</label>
                <select value={forecastScenario} onChange={(e) => applyForecastScenario(e.target.value)}>
                  <option value="base">Base</option>
                  <option value="conservative">Conservative</option>
                  <option value="aggressive">Aggressive</option>
                  <option value="promo_push">Promo Push</option>
                  <option value="inventory_constrained">Inventory Constrained</option>
                </select>
              </div>
              <div className="field"><label>Recent Wt</label><input type="number" step="0.1" min="0" max="1" value={fRecentWeight} onChange={(e) => setFRecentWeight(Number(e.target.value))} /></div>
              <div className="field"><label>MoM Wt</label><input type="number" step="0.1" min="0" max="1" value={fMomWeight} onChange={(e) => setFMomWeight(Number(e.target.value))} /></div>
              <div className="field"><label>Weekday Str</label><input type="number" step="0.1" min="0" max="2" value={fWeekdayStrength} onChange={(e) => setFWeekdayStrength(Number(e.target.value))} /></div>
              <div className="field"><label>Manual Mult</label><input type="number" step="0.05" min="0.1" max="5" value={fManualMultiplier} onChange={(e) => setFManualMultiplier(Number(e.target.value))} /></div>
              <div className="field"><label>Promo Lift</label><input type="number" step="0.01" min="0" max="1" value={fPromoLift} onChange={(e) => setFPromoLift(Number(e.target.value))} /></div>
              <div className="field"><label>Content Lift</label><input type="number" step="0.01" min="0" max="1" value={fContentLift} onChange={(e) => setFContentLift(Number(e.target.value))} /></div>
              <div className="field"><label>In-Stock Rate</label><input type="number" step="0.01" min="0" max="1" value={fInstockRate} onChange={(e) => setFInstockRate(Number(e.target.value))} /></div>
              <div className="field"><label>Growth Floor</label><input type="number" step="0.05" min="0.1" max="2.5" value={fGrowthFloor} onChange={(e) => setFGrowthFloor(Number(e.target.value))} /></div>
              <div className="field"><label>Growth Ceiling</label><input type="number" step="0.05" min="0.2" max="3.5" value={fGrowthCeiling} onChange={(e) => setFGrowthCeiling(Number(e.target.value))} /></div>
              <div className="field"><label>Volatility</label><input type="number" step="0.05" min="0.5" max="2.0" value={fVolatility} onChange={(e) => setFVolatility(Number(e.target.value))} /></div>
              <div className="field" style={{ display: "flex", alignItems: "end", gap: 8 }}>
                <button className="btn btn-accent" onClick={applyForecastFactors} disabled={!hasPendingForecastChanges}>
                  Apply Forecast Factors
                </button>
                {hasPendingForecastChanges ? (
                  <span className="muted-note">Pending changes</span>
                ) : (
                  <span className="muted-note">Applied</span>
                )}
              </div>
            </section>

            <section className="kpi-grid">
              <KpiCard label="MTD Actual" value={forecast?.mtd_actual || 0} delta={null} />
              <KpiCard label="Dynamic Projection" value={forecast?.projected_total || 0} delta={null} badge={appliedScenarioDisplay} badgeClass="scenario" />
              <KpiCard label="Pace % to Goal" value={forecast?.pace_to_goal} isPercent delta={forecast?.pace_delta ?? null} />
              <KpiCard label="Backtest MAPE" value={forecast?.mape} isPercent delta={null} />
            </section>

            {forecast?.stat_sig && (
              <section className="panel stat-sig-panel">
                <h4>Growth Significance Test</h4>
                <div className="stat-sig-row">
                  <span>Z-score: <strong>{Number(forecast.stat_sig.z || 0).toFixed(2)}</strong></span>
                  <span>p-value: <strong>{Number(forecast.stat_sig.p_value || 0).toFixed(4)}</strong></span>
                  <span>Confidence: <strong>{fmtPct(forecast.stat_sig.confidence)}</strong></span>
                  <span>Curr Mean: <strong>{fmtMoney(forecast.stat_sig.mean_current)}</strong></span>
                  <span>Baseline Mean: <strong>{fmtMoney(forecast.stat_sig.mean_baseline)}</strong></span>
                </div>
              </section>
            )}

            <section className="panel">
              <div className="panel-row">
                <h3>AI Forecast Summary</h3>
                <button className="btn" onClick={() => navigator.clipboard?.writeText((forecastAiSummary || []).join("\n"))}>
                  Copy Summary
                </button>
              </div>
              <div className="digest-list">
                {(forecastAiSummary || []).map((line, idx) => (
                  <p key={`f-ai-${idx}`}>{line}</p>
                ))}
              </div>
              <p className="muted-note" style={{ marginTop: 8 }}>
                Auto-generated from forecast assumptions, backtest error, confidence interval, and statistical significance outputs.
              </p>
            </section>

            <section className="panel chart-panel">
              <div className="chart-panel-header">
                <h3>MTD Daily Sales + Forecast</h3>
              </div>
              <div className="chart-wrap">
                <ResponsiveContainer width="100%" height={350}>
                  <LineChart data={forecastChartData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e8eaf0" />
                    <XAxis dataKey="label" tick={{ fill: "#8b90a0", fontSize: 12 }} />
                    <YAxis tick={{ fill: "#8b90a0", fontSize: 12 }} />
                    <Tooltip contentStyle={{ background: "#fff", border: "1px solid #e8eaf0", borderRadius: 10, fontSize: 13 }} />
                    <Legend />
                    <Line type="monotone" dataKey="actual" stroke="#4f46e5" strokeWidth={3} dot={false} name="Actual" connectNulls={false} />
                    <Line type="monotone" dataKey="forecast" stroke="#10b981" strokeWidth={3} strokeDasharray="7 4" dot={false} name="Forecast" connectNulls={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </section>

            {forecast?.goal > 0 && (
              <section className="panel">
                <h4>Goal: {fmtMoney(forecast.goal)} | CI: [{fmtMoney(forecast.ci_low)} - {fmtMoney(forecast.ci_high)}] | Growth Factor: {Number(forecast.growth_factor || 0).toFixed(3)}</h4>
              </section>
            )}
          </>
        )}

        {/* ===================== INVENTORY ===================== */}
        {activeTab === "inventory" && (
          <>
            <div className="subtabs">
              {INVTABS.map(([id, label]) => (
                <button key={id} className={`tab-btn ${invSub === id ? "active" : ""}`} onClick={() => setInvSub(id)}>{label}</button>
              ))}
            </div>
            <section className="panel controls-inline">
              <div className="field"><label>L7 Weight %</label><input type="number" value={w7} onChange={(e) => setW7(Number(e.target.value || 0))} /></div>
              <div className="field"><label>L30 Weight %</label><input type="number" value={w30} onChange={(e) => setW30(Number(e.target.value || 0))} /></div>
              <div className="field"><label>L60 Weight %</label><input type="number" value={w60} onChange={(e) => setW60(Number(e.target.value || 0))} /></div>
              <div className="field"><label>L90 Weight %</label><input type="number" value={w90} onChange={(e) => setW90(Number(e.target.value || 0))} /></div>
              <div className="field"><label>Target WOS</label><input type="number" value={targetWos} step="0.5" onChange={(e) => setTargetWos(Number(e.target.value || 8))} /></div>
            </section>
            {weightTotal !== 100 && <div className="error-line">Demand weights must equal 100%. Current total: {weightTotal}%.</div>}

            {invSub === "table" && (
              <section className="panel">
                <div className="panel-row">
                  <h3>Inventory Table</h3>
                  <button className="btn" onClick={() => {
                    const exportRows = (inventory.rows || [])
                      .filter((r) => !String(r.tag || "").toLowerCase().includes("manual override"))
                      .map((r) => ({
                      PRODUCT: r.tag, WOS: Number(r.wos || 0).toFixed(1), STATUS: r.status,
                      "% AVAIL": fmtPct(r.pct_avail), "DAILY DEM": Number(r.daily_demand || 0).toFixed(1),
                      "30D SALES": Number(r.units_30d || 0), "TOTAL INV": Number(r.total_inventory || 0),
                      INBOUND: Number(r.inbound || 0), AVAILABLE: Number(r.available || 0),
                      RESERVED: Number(r.reserved || 0), RESTOCK: Math.round(Number(r.restock_units || 0)),
                    }));
                    downloadCsv("inventory_latest.csv", exportRows);
                  }}>Export Inventory CSV</button>
                </div>
                {["IQBAR", "IQMIX", "IQJOE"].map((line) => {
                  const baseRows = ((inventory.by_line || {})[line] || []).filter(
                    (r) => !String(r.tag || "").toLowerCase().includes("manual override"),
                  );
                  const rows = sortRows(baseRows, invSort.key, invSort.dir);
                  const totals = rows.reduce(
                    (acc, r) => {
                      acc.wos_sum += Number(r.wos || 0);
                      acc.sku_count += 1;
                      acc.daily_demand += Number(r.daily_demand || 0);
                      acc.units_30d += Number(r.units_30d || 0);
                      acc.total_inventory += Number(r.total_inventory || 0);
                      acc.inbound += Number(r.inbound || 0);
                      acc.available += Number(r.available || 0);
                      acc.reserved += Number(r.reserved || 0);
                      acc.restock_units += Number(r.restock_units || 0);
                      return acc;
                    },
                    {
                      wos_sum: 0,
                      sku_count: 0,
                      daily_demand: 0,
                      units_30d: 0,
                      total_inventory: 0,
                      inbound: 0,
                      available: 0,
                      reserved: 0,
                      restock_units: 0,
                    },
                  );
                  if (!rows.length) return null;
                  return (
                    <div key={line} className="line-block">
                      <h4>{line}</h4>
                      <table className="styled-table inv-table">
                        <thead>
                          <tr>
                            {invColumns.map((c) => (
                              <th key={c.key} className="sortable" onClick={() => toggleInvSort(c.key)}>
                                {c.label} {sortArrow(c.key)}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((r, i) => (
                            <Fragment key={`${line}-${r.sku}-${i}`}>
                              <tr key={`${line}-${r.sku}-${i}`}>
                                <td>
                                  <button
                                    className="expander"
                                    onClick={() => setExpandedSku((s) => (s === r.sku ? "" : r.sku))}
                                  >
                                    {expandedSku === r.sku ? "▾" : "▸"} {r.tag}
                                  </button>
                                </td>
                                <td className="num-cell">{Number(r.wos || 0).toFixed(1)}</td>
                                <td><span className="status-pill" style={{ background: statusColor(r.status) }}>{r.status}</span></td>
                                <td className="num-cell">{`${Math.round(Number(r.pct_avail || 0) * 100)}%`}</td>
                                <td className="num-cell">{Number(r.daily_demand || 0).toFixed(1)}</td>
                                <td className="num-cell">{Number(r.units_30d || 0).toLocaleString()}</td>
                                <td className="num-cell">{Number(r.total_inventory || 0).toLocaleString()}</td>
                                <td className="num-cell inbound-val">{Number(r.inbound || 0).toLocaleString()}</td>
                                <td className="num-cell available-val">{Number(r.available || 0).toLocaleString()}</td>
                                <td className="num-cell">{Number(r.reserved || 0).toLocaleString()}</td>
                                <td className="num-cell restock-val">{Math.round(Number(r.restock_units || 0)).toLocaleString()}</td>
                              </tr>
                              {expandedSku === r.sku && (
                                <tr key={`${line}-${r.sku}-${i}-expanded`}>
                                  <td colSpan={11}>
                                    <div className="sku-drill">
                                      <div className="sku-drill-controls">
                                        <strong>{r.sku}</strong>
                                        <select value={skuMetric} onChange={(e) => setSkuMetric(e.target.value)}>
                                          <option value="sales">Sales</option>
                                          <option value="units">Units</option>
                                        </select>
                                        <span className="muted-text">L30 actual + next 30 day projection</span>
                                      </div>
                                      <div className="chart-wrap">
                                        <ResponsiveContainer width="100%" height={220}>
                                          <LineChart data={skuChartData}>
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e8eaf0" />
                                            <XAxis dataKey="label" tick={{ fill: "#8b90a0", fontSize: 12 }} />
                                            <YAxis tick={{ fill: "#8b90a0", fontSize: 12 }} />
                                            <Tooltip
                                              contentStyle={{ background: "#fff", border: "1px solid #e8eaf0", borderRadius: 10, fontSize: 13 }}
                                              formatter={(val, name) => {
                                                const n = Math.round(Number(val || 0));
                                                return [skuMetric === "sales" ? fmtMoney(n) : n.toLocaleString(), name];
                                              }}
                                            />
                                            <Line type="monotone" dataKey="actual" stroke="#4f46e5" strokeWidth={3} dot={false} name="L30 Actual" connectNulls={false} />
                                            <Line type="monotone" dataKey="forecast" stroke="#10b981" strokeWidth={3} strokeDasharray="7 4" dot={false} name="Next 30 Forecast" connectNulls={false} />
                                          </LineChart>
                                        </ResponsiveContainer>
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          ))}
                          <tr className="summary-minihead">
                            <td>Totals</td>
                            <td className="num-cell">Avg WOS</td>
                            <td />
                            <td className="num-cell">% Avail</td>
                            <td className="num-cell">Daily Dem</td>
                            <td className="num-cell">30D Sales</td>
                            <td className="num-cell">Total Inv</td>
                            <td className="num-cell">Inbound</td>
                            <td className="num-cell">Available</td>
                            <td className="num-cell">Reserved</td>
                            <td className="num-cell">Restock</td>
                          </tr>
                          <tr className="summary-row">
                            <td>Total</td>
                            <td className="num-cell">{(totals.wos_sum / Math.max(1, totals.sku_count)).toFixed(1)}</td>
                            <td />
                            <td className="num-cell">{`${Math.round((totals.available / Math.max(1, totals.total_inventory)) * 100)}%`}</td>
                            <td className="num-cell">{totals.daily_demand.toFixed(1)}</td>
                            <td className="num-cell">{Math.round(totals.units_30d).toLocaleString()}</td>
                            <td className="num-cell">{Math.round(totals.total_inventory).toLocaleString()}</td>
                            <td className="num-cell inbound-val">{Math.round(totals.inbound).toLocaleString()}</td>
                            <td className="num-cell available-val">{Math.round(totals.available).toLocaleString()}</td>
                            <td className="num-cell">{Math.round(totals.reserved).toLocaleString()}</td>
                            <td className="num-cell restock-val">{Math.round(totals.restock_units).toLocaleString()}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  );
                })}
              </section>
            )}

            {invSub === "history" && (
              <section className="panel">
                <div className="panel-row">
                  <h3>Inventory History</h3>
                  <div className="field compact">
                    <label>Snapshot</label>
                    <select value={historySnapshotId} onChange={(e) => setHistorySnapshotId(e.target.value)}>
                      {(inventoryHistory || []).map((r) => (
                        <option key={r.id} value={String(r.id)}>
                          #{r.id} | {r.imported_at}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="chart-wrap">
                  <ResponsiveContainer width="100%" height={280}>
                    <LineChart data={inventoryHistory}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e8eaf0" />
                      <XAxis dataKey="id" tick={{ fill: "#8b90a0", fontSize: 12 }} />
                      <YAxis tick={{ fill: "#8b90a0", fontSize: 12 }} />
                      <Tooltip contentStyle={{ background: "#fff", border: "1px solid #e8eaf0", borderRadius: 10, fontSize: 13 }} />
                      <Line type="monotone" dataKey="total_units" stroke="#4f46e5" strokeWidth={3} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                {["IQBAR", "IQMIX", "IQJOE"].map((line) => {
                  const baseRows = ((historySnapshot.by_line || {})[line] || []).filter(
                    (r) => !String(r.tag || "").toLowerCase().includes("manual override"),
                  );
                  const rows = sortRows(baseRows, invSort.key, invSort.dir);
                  const totals = rows.reduce(
                    (acc, r) => {
                      acc.wos_sum += Number(r.wos || 0);
                      acc.sku_count += 1;
                      acc.daily_demand += Number(r.daily_demand || 0);
                      acc.units_30d += Number(r.units_30d || 0);
                      acc.total_inventory += Number(r.total_inventory || 0);
                      acc.inbound += Number(r.inbound || 0);
                      acc.available += Number(r.available || 0);
                      acc.reserved += Number(r.reserved || 0);
                      acc.restock_units += Number(r.restock_units || 0);
                      return acc;
                    },
                    {
                      wos_sum: 0,
                      sku_count: 0,
                      daily_demand: 0,
                      units_30d: 0,
                      total_inventory: 0,
                      inbound: 0,
                      available: 0,
                      reserved: 0,
                      restock_units: 0,
                    },
                  );
                  if (!rows.length) return null;
                  return (
                    <div key={`hist-${line}`} className="line-block" style={{ marginTop: 12 }}>
                      <h4>{line}</h4>
                      <table className="styled-table inv-table">
                        <thead>
                          <tr>
                            {invColumns.map((c) => (
                              <th key={`hist-${line}-${c.key}`} className="sortable" onClick={() => toggleInvSort(c.key)}>
                                {c.label} {sortArrow(c.key)}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((r, i) => (
                            <Fragment key={`hist-${line}-${r.sku}-${i}`}>
                              <tr>
                                <td>
                                  <button
                                    className="expander"
                                    onClick={() => setExpandedSku((s) => (s === r.sku ? "" : r.sku))}
                                  >
                                    {expandedSku === r.sku ? "▾" : "▸"} {r.tag}
                                  </button>
                                </td>
                                <td className="num-cell">{Number(r.wos || 0).toFixed(1)}</td>
                                <td><span className="status-pill" style={{ background: statusColor(r.status) }}>{r.status}</span></td>
                                <td className="num-cell">{`${Math.round(Number(r.pct_avail || 0) * 100)}%`}</td>
                                <td className="num-cell">{Number(r.daily_demand || 0).toFixed(1)}</td>
                                <td className="num-cell">{Number(r.units_30d || 0).toLocaleString()}</td>
                                <td className="num-cell">{Number(r.total_inventory || 0).toLocaleString()}</td>
                                <td className="num-cell inbound-val">{Number(r.inbound || 0).toLocaleString()}</td>
                                <td className="num-cell available-val">{Number(r.available || 0).toLocaleString()}</td>
                                <td className="num-cell">{Number(r.reserved || 0).toLocaleString()}</td>
                                <td className="num-cell restock-val">{Math.round(Number(r.restock_units || 0)).toLocaleString()}</td>
                              </tr>
                              {expandedSku === r.sku && (
                                <tr>
                                  <td colSpan={11}>
                                    <div className="sku-drill">
                                      <div className="sku-drill-controls">
                                        <strong>{r.sku}</strong>
                                        <select value={skuMetric} onChange={(e) => setSkuMetric(e.target.value)}>
                                          <option value="sales">Sales</option>
                                          <option value="units">Units</option>
                                        </select>
                                        <span className="muted-text">L30 actual + next 30 day projection</span>
                                      </div>
                                      <div className="chart-wrap">
                                        <ResponsiveContainer width="100%" height={220}>
                                          <LineChart data={skuChartData}>
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e8eaf0" />
                                            <XAxis dataKey="label" tick={{ fill: "#8b90a0", fontSize: 12 }} />
                                            <YAxis tick={{ fill: "#8b90a0", fontSize: 12 }} />
                                            <Tooltip
                                              contentStyle={{ background: "#fff", border: "1px solid #e8eaf0", borderRadius: 10, fontSize: 13 }}
                                              formatter={(val, name) => {
                                                const n = Math.round(Number(val || 0));
                                                return [skuMetric === "sales" ? fmtMoney(n) : n.toLocaleString(), name];
                                              }}
                                            />
                                            <Line type="monotone" dataKey="actual" stroke="#4f46e5" strokeWidth={3} dot={false} name="L30 Actual" connectNulls={false} />
                                            <Line type="monotone" dataKey="forecast" stroke="#10b981" strokeWidth={3} strokeDasharray="7 4" dot={false} name="Next 30 Forecast" connectNulls={false} />
                                          </LineChart>
                                        </ResponsiveContainer>
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          ))}
                          <tr className="summary-minihead">
                            <td>Totals</td>
                            <td className="num-cell">Avg WOS</td>
                            <td />
                            <td className="num-cell">% Avail</td>
                            <td className="num-cell">Daily Dem</td>
                            <td className="num-cell">30D Sales</td>
                            <td className="num-cell">Total Inv</td>
                            <td className="num-cell">Inbound</td>
                            <td className="num-cell">Available</td>
                            <td className="num-cell">Reserved</td>
                            <td className="num-cell">Restock</td>
                          </tr>
                          <tr className="summary-row">
                            <td>Total</td>
                            <td className="num-cell">{(totals.wos_sum / Math.max(1, totals.sku_count)).toFixed(1)}</td>
                            <td />
                            <td className="num-cell">{`${Math.round((totals.available / Math.max(1, totals.total_inventory)) * 100)}%`}</td>
                            <td className="num-cell">{totals.daily_demand.toFixed(1)}</td>
                            <td className="num-cell">{Math.round(totals.units_30d).toLocaleString()}</td>
                            <td className="num-cell">{Math.round(totals.total_inventory).toLocaleString()}</td>
                            <td className="num-cell inbound-val">{Math.round(totals.inbound).toLocaleString()}</td>
                            <td className="num-cell available-val">{Math.round(totals.available).toLocaleString()}</td>
                            <td className="num-cell">{Math.round(totals.reserved).toLocaleString()}</td>
                            <td className="num-cell restock-val">{Math.round(totals.restock_units).toLocaleString()}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  );
                })}
              </section>
            )}

            {invSub === "insights" && (
              <section className="panel">
                <h3>Insights</h3>
                <section className="kpi-grid">
                  <KpiCard label="In-Stock Quality" value={inventoryInsights?.kpis?.in_stock_quality} isPercent delta={null} />
                  <KpiCard label="Critical SKUs" value={inventoryInsights?.kpis?.critical_skus || 0} delta={null} isNumber />
                  <KpiCard label="Restock Queue" value={inventoryInsights?.kpis?.restock_queue || 0} delta={null} isNumber />
                  <KpiCard label="Overstock SKUs" value={inventoryInsights?.kpis?.overstock_skus || 0} delta={null} isNumber />
                </section>
                <ul className="insight-list">
                  {(inventoryInsights?.insights || []).map((s) => <li key={s}>{s}</li>)}
                </ul>
              </section>
            )}
          </>
        )}

        {showGoalEditor && (
          <div className="slideover-backdrop" onClick={() => setShowGoalEditor(false)}>
            <div className="slideover-panel" onClick={(e) => e.stopPropagation()}>
              <div className="panel-row">
                <h3>{goalDraft.id ? "Edit Goal" : "Add Goal"}</h3>
                <button className="btn" onClick={() => setShowGoalEditor(false)}>Close</button>
              </div>
              <div className="field"><label>Goal Name</label><input value={goalDraft.name} onChange={(e) => setGoalDraft((s) => ({ ...s, name: e.target.value }))} /></div>
              <div className="field"><label>Metric</label>
                <select value={goalDraft.metric} onChange={(e) => setGoalDraft((s) => ({ ...s, metric: e.target.value }))}>
                  {goalMetricOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div className="field"><label>Period</label>
                <select value={goalDraft.period} onChange={(e) => setGoalDraft((s) => ({ ...s, period: e.target.value }))}>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                </select>
              </div>
              <div className="field"><label>Year</label><input type="number" value={goalDraft.year} onChange={(e) => setGoalDraft((s) => ({ ...s, year: Number(e.target.value || new Date().getFullYear()) }))} /></div>
              {goalDraft.period === "monthly" ? (
                <div className="field"><label>Month</label><input type="number" min="1" max="12" value={goalDraft.month} onChange={(e) => setGoalDraft((s) => ({ ...s, month: Number(e.target.value || 1) }))} /></div>
              ) : (
                <div className="field"><label>Quarter</label><input type="number" min="1" max="4" value={goalDraft.quarter} onChange={(e) => setGoalDraft((s) => ({ ...s, quarter: Number(e.target.value || 1) }))} /></div>
              )}
              <div className="field"><label>Target Value</label><input type="number" value={goalDraft.targetValue} onChange={(e) => setGoalDraft((s) => ({ ...s, targetValue: Number(e.target.value || 0) }))} /></div>
              <div className="panel-row" style={{ marginTop: 12 }}>
                <button className="btn" onClick={() => setShowGoalEditor(false)}>Cancel</button>
                <button className="btn btn-accent" disabled={!canEdit} onClick={() => {
                  if (!canEdit) return;
                  const next = {
                    ...goalDraft,
                    id: goalDraft.id || uid("goal"),
                    createdAt: goalDraft.createdAt || new Date().toISOString(),
                  };
                  setGoals((rows) => {
                    const exists = rows.some((r) => r.id === next.id);
                    return exists ? rows.map((r) => (r.id === next.id ? next : r)) : [...rows, next];
                  });
                  setShowGoalEditor(false);
                }}>Save Goal</button>
              </div>
            </div>
          </div>
        )}

        {showDateModal && (
          <div className="date-modal-backdrop" onClick={() => setShowDateModal(false)}>
            <div className="date-modal-shell" onClick={(e) => e.stopPropagation()}>
              <div className="date-modal-body">
                <aside className="date-modal-presets">
                  <label className="toggle-line date-compare-toggle">
                    <input type="checkbox" checked={draftCompareEnabled} onChange={(e) => setDraftCompareEnabled(e.target.checked)} />
                    <span>Compare</span>
                  </label>
                  {["Yesterday", "This Week", "This Month", "YTD", "All Time", "Custom"].map((p) => {
                    const isActive = p === "This Month"
                      ? draftPreset === "MTD"
                      : (p === "Custom" ? draftPreset === "Custom" : draftPreset === p);
                    const r = p === "Custom" ? { start: draftStartDate, end: draftEndDate } : presetRangeForModal(p);
                    return (
                      <button key={p} className={`date-preset-item ${isActive ? "active" : ""}`} onClick={() => onSelectDatePreset(p)}>
                        <strong>{p}</strong>
                        <span>{fmtLongDate(r.start)} - {fmtLongDate(r.end)}</span>
                      </button>
                    );
                  })}
                </aside>
                <div className="date-modal-main">
                  <div className={`date-panel-grid ${draftCompareEnabled ? "compare-on" : "compare-off"}`}>
                    <section className="date-panel">
                      <h4>Primary</h4>
                      <div className="date-input-grid">
                        <label>
                          <span>Start date</span>
                          <input type="date" value={draftStartDate} onChange={(e) => { setDraftStartDate(e.target.value); setDraftPreset("Custom"); }} />
                        </label>
                        <label>
                          <span>End date</span>
                          <input type="date" value={draftEndDate} onChange={(e) => { setDraftEndDate(e.target.value); setDraftPreset("Custom"); }} />
                        </label>
                      </div>
                      <div className="date-span-note">{draftDays} day{draftDays === 1 ? "" : "s"}</div>
                    </section>
                    {draftCompareEnabled && (
                      <section className="date-panel">
                        <h4>Comparison</h4>
                        <div className="date-input-grid compare-mode-row">
                          <label>
                            <span>Mode</span>
                            <select value={draftCompareMode} onChange={(e) => setDraftCompareMode(e.target.value)}>
                              <option value="mom">MoM</option>
                              <option value="previous_period">Previous period</option>
                              <option value="previous_year">Previous year</option>
                            </select>
                          </label>
                        </div>
                        <div className="date-input-grid">
                          <label>
                            <span>Start date</span>
                            <input type="date" value={draftCompareRange.start || ""} readOnly />
                          </label>
                          <label>
                            <span>End date</span>
                            <input type="date" value={draftCompareRange.end || ""} readOnly />
                          </label>
                        </div>
                        <div className="date-span-note">{fmtLongDate(draftCompareRange.start)} - {fmtLongDate(draftCompareRange.end)}</div>
                      </section>
                    )}
                  </div>
                </div>
              </div>
              <div className="date-modal-footer">
                <button className="btn" onClick={() => setShowDateModal(false)}>Cancel</button>
                <button className="btn btn-accent" onClick={applyDateModal}>{draftCompareEnabled ? "Compare" : "Apply"}</button>
              </div>
            </div>
          </div>
        )}

        {showPromoEditor && (
          <div className="slideover-backdrop" onClick={() => setShowPromoEditor(false)}>
            <div className="slideover-panel" onClick={(e) => e.stopPropagation()}>
              <div className="panel-row">
                <h3>{promoDraft.id ? "Edit Promotion" : "Log Promotion"}</h3>
                <button className="btn" onClick={() => setShowPromoEditor(false)}>Close</button>
              </div>
              <div className="field"><label>Name</label><input value={promoDraft.name} onChange={(e) => setPromoDraft((s) => ({ ...s, name: e.target.value }))} /></div>
              <div className="field"><label>Type</label>
                <select value={promoDraft.type} onChange={(e) => setPromoDraft((s) => ({ ...s, type: e.target.value }))}>
                  <option value="lightning_deal">Lightning Deal</option><option value="coupon">Coupon</option><option value="prime_exclusive">Prime Exclusive</option><option value="sale">Sale</option><option value="bundle">Bundle</option><option value="other">Other</option>
                </select>
              </div>
              <div className="field"><label>Start Date</label><input type="date" value={promoDraft.startDate} onChange={(e) => setPromoDraft((s) => ({ ...s, startDate: e.target.value }))} /></div>
              <div className="field"><label>End Date</label><input type="date" value={promoDraft.endDate} onChange={(e) => setPromoDraft((s) => ({ ...s, endDate: e.target.value }))} /></div>
              <div className="field"><label>Product Line</label>
                <select value={promoDraft.productLine} onChange={(e) => setPromoDraft((s) => ({ ...s, productLine: e.target.value }))}>
                  <option>All</option><option>IQBAR</option><option>IQMIX</option><option>IQJOE</option>
                </select>
              </div>
              <div className="field"><label>Discount %</label><input type="number" value={promoDraft.discountPct} onChange={(e) => setPromoDraft((s) => ({ ...s, discountPct: e.target.value }))} /></div>
              <div className="field"><label>Notes</label><input value={promoDraft.notes} onChange={(e) => setPromoDraft((s) => ({ ...s, notes: e.target.value }))} /></div>
              <div className="panel-row" style={{ marginTop: 12 }}>
                <button className="btn" onClick={() => setShowPromoEditor(false)}>Cancel</button>
                <button className="btn btn-accent" disabled={!canEdit} onClick={() => {
                  if (!canEdit) return;
                  if (!promoDraft.name || !promoDraft.startDate || !promoDraft.endDate || promoDraft.endDate < promoDraft.startDate) return;
                  const during = (allDailyTotals || []).filter((d) => d.date >= promoDraft.startDate && d.date <= promoDraft.endDate);
                  const durRevenue = during.reduce((s, d) => s + d.total, 0);
                  const durDays = Math.max(1, during.length);
                  const preStart = new Date(`${promoDraft.startDate}T00:00:00`);
                  const baseStart = ymd(new Date(preStart.getTime() - 7 * 86400000));
                  const baseEnd = ymd(new Date(preStart.getTime() - 86400000));
                  const baselineRows = (allDailyTotals || []).filter((d) => d.date >= baseStart && d.date <= baseEnd);
                  const baselineAvg = baselineRows.reduce((s, d) => s + d.total, 0) / Math.max(1, baselineRows.length);
                  const baselineRevenue = baselineAvg * durDays;
                  const liftPct = baselineRevenue > 0 ? ((durRevenue / baselineRevenue) - 1) * 100 : 0;
                  const next = {
                    ...promoDraft,
                    id: promoDraft.id || uid("promo"),
                    liftPct,
                    createdAt: promoDraft.createdAt || new Date().toISOString(),
                  };
                  setPromotions((rows) => {
                    const exists = rows.some((r) => r.id === next.id);
                    return exists ? rows.map((r) => (r.id === next.id ? next : r)) : [...rows, next];
                  });
                  setShowPromoEditor(false);
                }}>Save Promotion</button>
              </div>
            </div>
          </div>
        )}

        

        {showScheduleEditor && (
          <div className="slideover-backdrop" onClick={() => setShowScheduleEditor(false)}>
            <div className="slideover-panel" onClick={(e) => e.stopPropagation()}>
              <div className="panel-row">
                <h3>{scheduleDraft.id ? "Edit Schedule" : "Create Schedule"}</h3>
                <button className="btn" onClick={() => setShowScheduleEditor(false)}>Close</button>
              </div>
              <div className="field"><label>Report Name</label><input value={scheduleDraft.name} onChange={(e) => setScheduleDraft((s) => ({ ...s, name: e.target.value }))} /></div>
              <div className="field"><label>Template</label>
                <select value={scheduleDraft.template} onChange={(e) => setScheduleDraft((s) => ({ ...s, template: e.target.value }))}>
                  <option value="weekly_performance">Weekly Performance</option>
                  <option value="monthly_executive">Monthly Executive</option>
                  <option value="inventory_alert">Inventory Alert</option>
                  <option value="ntb_monthly">NTB Monthly</option>
                  <option value="custom">Custom</option>
                </select>
              </div>
              <div className="field"><label>Frequency</label>
                <select value={scheduleDraft.frequency} onChange={(e) => setScheduleDraft((s) => ({ ...s, frequency: e.target.value }))}>
                  <option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option>
                </select>
              </div>
              <div className="field"><label>Delivery Time</label><input type="time" value={scheduleDraft.deliveryTime} onChange={(e) => setScheduleDraft((s) => ({ ...s, deliveryTime: e.target.value }))} /></div>
              <div className="field"><label>Email</label><input value={scheduleDraft.email} onChange={(e) => setScheduleDraft((s) => ({ ...s, email: e.target.value }))} /></div>
              <div className="field"><label>Slack Channel</label><input value={scheduleDraft.slackChannel} onChange={(e) => setScheduleDraft((s) => ({ ...s, slackChannel: e.target.value }))} /></div>
              <div className="field"><label>Recipient Name</label><input value={scheduleDraft.recipientName} onChange={(e) => setScheduleDraft((s) => ({ ...s, recipientName: e.target.value }))} /></div>
              <div className="panel-row" style={{ marginTop: 12 }}>
                <button className="btn" onClick={() => setShowScheduleEditor(false)}>Cancel</button>
                <button className="btn btn-accent" disabled={!canEdit} onClick={() => {
                  if (!canEdit) return;
                  const next = { ...scheduleDraft, id: scheduleDraft.id || uid("sched"), nextRun: new Date().toISOString() };
                  setReportSchedules((rows) => {
                    const exists = rows.some((r) => r.id === next.id);
                    return exists ? rows.map((r) => (r.id === next.id ? next : r)) : [...rows, next];
                  });
                  setShowScheduleEditor(false);
                }}>Save Schedule</button>
              </div>
            </div>
          </div>
        )}

        {showCommandPalette && (
          <div className="cmdk-overlay" onClick={() => setShowCommandPalette(false)}>
            <div className="cmdk-panel" onClick={(e) => e.stopPropagation()}>
              <div className="cmdk-input-row">
                <input
                  value={commandQuery}
                  onChange={(e) => setCommandQuery(e.target.value)}
                  placeholder="Search pages, actions, and data..."
                  autoFocus
                />
                <button className="btn" onClick={() => setShowCommandPalette(false)}>Esc</button>
              </div>
              <div className="cmdk-results">
                {commandItems.slice(0, 20).map((item) => (
                  <button
                    key={item.id}
                    className="cmdk-item"
                    onClick={() => {
                      item.run();
                      setShowCommandPalette(false);
                      setCommandQuery("");
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
