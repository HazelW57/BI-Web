"use client";

import { ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";
import readXlsxFile from "read-excel-file/browser";

type Allowed = { email: string; role: string; createdAt: number };
type PnlRow = {
  key: string; gmv: number; orders: number; units: number; refunds: number; tiktokFees: number;
  sellerShippingCost: number; netRevenue: number; cogs: number; affiliateCommission: number; adSpend: number;
  videoAgencyFees: number; liveAgencyFees: number; returnShippingCost: number; otherCosts: number;
  operatingProfit: number; margin: number; settlement: number; estimatedReturnShipping: boolean;
  adjustments: number; unmappedDifference: number; financeFinal: number; financePending: number;
};
type Source = { metric: string; source: string; status?: string };
type Dimensions = { products: string[]; skus: string[]; returnTypes?: string[]; returnStatuses?: string[] };
type PnlData = { range: { from: string; to: string }; granularity: string; dimensions: Dimensions; total: PnlRow; trend: PnlRow[]; months: PnlRow[]; skus: PnlRow[]; sources: Source[]; financeCoverage?: { mappedLines: number; totalLines: number; percent: number; statementCount: number; settlementSummary: boolean; status: string } };
type Reason = { reason: string; count: number; share: number; refundAmount: number; rawReasons?: { reason: string; count: number }[] };
type ReturnSku = {
  sku: string; productName: string; soldUnits: number; returnedUnits: number; returnRate: number; refundAmount: number;
  refundGmvRate: number; returnShippingCost: number; reasons: Reason[];
  trend: { key: string; soldUnits: number; returnedUnits: number; returnRate: number }[];
  reasonTrend: { key: string; reasons: { reason: string; count: number; share: number }[] }[];
};
type ReturnsData = {
  range: { from: string; to: string }; granularity: string; dimensions: Dimensions; soldUnits: number; returnedUnits: number;
  returnRate: number; refundAmount: number; refundGmvRate: number; returnShippingCost: number; skuCount: number;
  returnsCreatedDuringPeriod: number; skus: ReturnSku[]; sources: Source[];
};
type SyncData = {
  configured: boolean;
  lastRun: null | { status: string; ordersUpserted: number; returnsUpserted: number; message: string; startedAt: number; completedAt: number | null };
  counts?: { salesLines: number; returnLines: number; productCostRules: number; agencyRules: number; returnShippingRules: number; manualCosts: number; financeOrders: number; validOrders: number };
};
type Tab = "bby" | "walmart" | "pricing" | "tts" | "settings";
type TtsTab = "pnl" | "sales" | "marketing" | "returns" | "costs" | "health";
type SettingsTab = "access" | "uploads";
type Granularity = "daily" | "weekly" | "monthly";

const emptyRow: PnlRow = { key: "total", gmv: 0, orders: 0, units: 0, refunds: 0, tiktokFees: 0, sellerShippingCost: 0, netRevenue: 0, cogs: 0, affiliateCommission: 0, adSpend: 0, videoAgencyFees: 0, liveAgencyFees: 0, returnShippingCost: 0, otherCosts: 0, operatingProfit: 0, margin: 0, settlement: 0, estimatedReturnShipping: false, adjustments: 0, unmappedDifference: 0, financeFinal: 0, financePending: 0 };
const emptyDimensions: Dimensions = { products: [], skus: [], returnTypes: [], returnStatuses: [] };
const emptyPnl: PnlData = { range: { from: "", to: "" }, granularity: "monthly", dimensions: emptyDimensions, total: emptyRow, trend: [], months: [], skus: [], sources: [] };
const emptyReturns: ReturnsData = { range: { from: "", to: "" }, granularity: "monthly", dimensions: emptyDimensions, soldUnits: 0, returnedUnits: 0, returnRate: 0, refundAmount: 0, refundGmvRate: 0, returnShippingCost: 0, skuCount: 0, returnsCreatedDuringPeriod: 0, skus: [], sources: [] };
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const preciseMoney = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const number = new Intl.NumberFormat("en-US");
const palette = ["#0B1F3A", "#1557D6", "#2878E8", "#54A6F5", "#25B7D3", "#7CC8F8", "#8EA9F8", "#B6D8FF", "#0D9B8C", "#D8E9FF"];

function dateInput(date: Date) { return date.toISOString().slice(0, 10); }
function percentOf(value: number, base: number) { return base ? `${(value / base * 100).toFixed(1)}% of GMV` : "0.0% of GMV"; }

export default function Dashboard({ email, admin, initialAllowed }: { email: string; admin: boolean; initialAllowed: Allowed[] }) {
  const today = useMemo(() => new Date(), []);
  const [tab, setTab] = useState<Tab>("tts");
  const [ttsTab, setTtsTab] = useState<TtsTab>("pnl");
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("uploads");
  const [from, setFrom] = useState("2026-05-01");
  const [to, setTo] = useState(dateInput(today));
  const [granularity, setGranularity] = useState<Granularity>("weekly");
  const [product, setProduct] = useState("ALL");
  const [sku, setSku] = useState("ALL");
  const [returnType, setReturnType] = useState("ALL");
  const [returnStatus, setReturnStatus] = useState("ALL");
  const [pnl, setPnl] = useState<PnlData>(emptyPnl);
  const [previousPnl, setPreviousPnl] = useState<PnlData>(emptyPnl);
  const [returns, setReturns] = useState<ReturnsData>(emptyReturns);
  const [previousReturns, setPreviousReturns] = useState<ReturnsData>(emptyReturns);
  const [sync, setSync] = useState<SyncData>({ configured: false, lastRun: null });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [items, setItems] = useState(initialAllowed);
  const [newEmail, setNewEmail] = useState("");

  const getJson = useCallback(async <T,>(url: string, init?: RequestInit) => {
    const response = await fetch(url, init);
    const payload = await response.json() as T & { error?: string };
    if (!response.ok) throw new Error(payload.error || "请求失败");
    return payload;
  }, []);

  const refresh = useCallback(async () => {
    setBusy(true); setError("");
    try {
      const query = new URLSearchParams({ from, to, granularity, product, sku, returnType, returnStatus });
      const returnsQuery = new URLSearchParams({ from, to, granularity, product, sku: "ALL", returnType, returnStatus });
      const start = new Date(`${from}T00:00:00Z`), end = new Date(`${to}T00:00:00Z`); const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1);
      const previousToDate = new Date(start.getTime() - 86_400_000), previousFromDate = new Date(previousToDate.getTime() - (days - 1) * 86_400_000);
      const previousQuery = new URLSearchParams({ from: dateInput(previousFromDate), to: dateInput(previousToDate), granularity, product, sku, returnType, returnStatus });
      const previousReturnsQuery = new URLSearchParams({ from: dateInput(previousFromDate), to: dateInput(previousToDate), granularity, product, sku: "ALL", returnType, returnStatus });
      const [pnlData, returnsData, priorPnlData, priorReturnsData, syncData] = await Promise.all([
        getJson<PnlData>(`/api/bi/pnl?${query}`), getJson<ReturnsData>(`/api/bi/returns?${returnsQuery}`),
        getJson<PnlData>(`/api/bi/pnl?${previousQuery}`), getJson<ReturnsData>(`/api/bi/returns?${previousReturnsQuery}`), getJson<SyncData>("/api/bi/sync"),
      ]);
      setPnl(pnlData); setReturns(returnsData); setPreviousPnl(priorPnlData); setPreviousReturns(priorReturnsData); setSync(syncData);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "数据读取失败"); }
    finally { setBusy(false); }
  }, [from, getJson, granularity, product, returnStatus, returnType, sku, to]);

  useEffect(() => { const timer = window.setTimeout(() => { void refresh(); }, 80); return () => window.clearTimeout(timer); }, [refresh]);

  async function upload(kind: string, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const body = new FormData(); body.set("kind", kind); body.set("file", file);
      const result = await getJson<{ rows: number }>("/api/bi/import", { method: "POST", body });
      setNotice(`已导入 ${result.rows} 行，所有 P&L 与 R&R 指标已自动重算。`); await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "上传失败"); setBusy(false); }
  }

  async function uploadWorkbook(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const workbook = await readXlsxFile(file);
      const mapping: Record<string, { kind: string; header: string }> = {
        "Product Cost": { kind: "product_cost", header: "Seller SKU" },
        "Agency Fee Rules": { kind: "agency_fee_rules", header: "Fee Name" },
        "Return Shipping Cost": { kind: "return_shipping_cost", header: "Seller SKU" },
        "Manual Costs": { kind: "manual_costs", header: "Date / Month" },
      };
      let imported = 0;
      for (const sheet of workbook) {
        const config = mapping[sheet.sheet]; if (!config) continue;
        const headerIndex = sheet.data.findIndex((row) => String(row[0] || "").trim() === config.header);
        if (headerIndex < 0) throw new Error(`${sheet.sheet} 缺少标准表头`);
        const rows = sheet.data.slice(headerIndex).filter((row, index) => index === 0 || (row.some((value) => value !== null && String(value).trim()) && !String(row[0] || "").startsWith("EXAMPLE")));
        if (rows.length === 1) continue;
        const csv = rows.map((row, rowIndex) => row.map((value, columnIndex) => {
          let output: string | number | boolean = value instanceof Date ? value.toISOString().slice(0, 10) : value ?? "";
          if (sheet.sheet === "Agency Fee Rules" && rowIndex > 0 && columnIndex === 5 && typeof output === "number" && output <= 1) output = `${output * 100}%`;
          const text = String(output); return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
        }).join(",")).join("\n");
        const body = new FormData(); body.set("kind", config.kind); body.set("file", new File([csv], `${config.kind}.csv`, { type: "text/csv" }));
        const result = await getJson<{ rows: number }>("/api/bi/import", { method: "POST", body }); imported += result.rows;
      }
      if (!imported) throw new Error("工作簿中没有可导入的数据；请在示例行下方填写实际成本。");
      setNotice(`Excel 工作簿已导入 ${imported} 行，P&L 与 R&R 已自动重算。`); await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Excel 导入失败"); setBusy(false); }
  }

  async function syncNow() {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await getJson<{ ordersUpserted: number; returnsUpserted: number }>("/api/bi/sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ days: 30 }) });
      setNotice(`TikTok 同步完成：${result.ordersUpserted} 条销售行，${result.returnsUpserted} 条退货行。`); await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "同步失败"); setBusy(false); }
  }

  async function updateAccess(method: "POST" | "DELETE", target: string) {
    const password = method === "POST" ? prompt("请为该邮箱设置至少 10 位临时密码：") || "" : undefined;
    if (method === "POST" && (!password || password.length < 10)) { setError("临时密码至少需要 10 位"); return; }
    try {
      const data = await getJson<{ items: Allowed[] }>("/api/access", { method, headers: { "content-type": "application/json" }, body: JSON.stringify({ email: target, password }) });
      setItems(data.items); setNewEmail("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "操作失败"); }
  }

  async function logout() { await fetch("/api/logout", { method: "POST" }); location.href = "/"; }
  const nav: { key: Tab; label: string; eyebrow: string }[] = [
    { key: "bby", label: "BBY", eyebrow: "BEST BUY" }, { key: "walmart", label: "Walmart", eyebrow: "MARKETPLACE" },
    { key: "pricing", label: "价格核验", eyebrow: "PRICE CHECK" }, { key: "tts", label: "TTS", eyebrow: "TIKTOK SHOP" },
    { key: "settings", label: "设置", eyebrow: "CONTROL" },
  ];
  const openCosts = () => { setTtsTab("costs"); setTab("tts"); };
  const dimensions = pnl.dimensions.products.length || pnl.dimensions.skus.length ? pnl.dimensions : returns.dimensions;

  return <main className="shell">
    <aside className="sidebar">
      <div className="side-brand"><img src="/saphiant-logo.png" alt="Saphiant" /><small>COMMERCE INTELLIGENCE</small></div>
      <nav>{nav.map((item, index) => <button key={item.key} onClick={() => setTab(item.key)} className={tab === item.key ? "active" : ""}><i>0{index + 1}</i><span>{item.label}<small>{item.eyebrow}</small></span></button>)}</nav>
      <div className="side-user"><strong>{admin ? "Hazel · Owner" : "Authorized Viewer"}</strong><small>{email}</small><button onClick={logout}>安全退出</button></div>
    </aside>

    <section className="workspace">
      <header className="topbar"><div><p className="crumb">SAPHIANT / COMMERCE INTELLIGENCE</p><h1>{nav.find((item) => item.key === tab)?.label}</h1></div><div className="top-status"><span className={sync.configured ? "live" : "pending"}>{sync.configured ? "TTS 数据在线" : "TTS API 待配置"}</span></div></header>
      {tab === "tts" && <div className="subnav tts-subnav">{[
        ["pnl", "P&L Overview"], ["sales", "Sales & Orders"], ["marketing", "Marketing"], ["returns", "R&R"], ["costs", "Cost Inputs"], ["health", "Data Health"],
      ].map(([key, label]) => <button key={key} className={ttsTab === key ? "active" : ""} onClick={() => setTtsTab(key as TtsTab)}>{label}</button>)}</div>}
      {tab === "settings" && admin && <div className="subnav"><button className={settingsTab === "uploads" ? "active" : ""} onClick={() => setSettingsTab("uploads")}>数据上传</button><button className={settingsTab === "access" ? "active" : ""} onClick={() => setSettingsTab("access")}>访问管理</button></div>}
      {tab === "tts" && ttsTab !== "health" && ttsTab !== "costs" && <GlobalFilters from={from} to={to} setFrom={setFrom} setTo={setTo} granularity={granularity} setGranularity={setGranularity} product={product} setProduct={setProduct} sku={sku} setSku={setSku} dimensions={dimensions} returnsMode={ttsTab === "returns"} returnType={returnType} setReturnType={setReturnType} returnStatus={returnStatus} setReturnStatus={setReturnStatus} busy={busy} refresh={refresh} />}
      {error && <div className="message error-message">{error}<button onClick={() => setError("")}>×</button></div>}
      {notice && <div className="message success-message">{notice}<button onClick={() => setNotice("")}>×</button></div>}

      {tab === "bby" && <PlatformView code="BBY" title="Best Buy Intelligence" description="为 Best Buy 销售、P&L、退货率和库存周转预留统一分析入口。" />}
      {tab === "walmart" && <PlatformView code="WMT" title="Walmart Intelligence" description="为 Walmart 订单、退货、广告和 SKU 经营表现预留统一分析入口。" />}
      {tab === "pricing" && <PlatformView code="PRICE" title="三平台价格核验" description="规划 Amazon、Walmart、Best Buy 的实时售价、基准价和异常提醒。" />}
      {busy && !pnl.trend.length && <div className="dashboard-skeleton"><i/><i/><i/><i/><i/><i/></div>}
      {tab === "tts" && ttsTab === "pnl" && <PnlView data={pnl} previous={previousPnl} admin={admin} onOpenCosts={openCosts} onSkuSelect={setSku} />}
      {tab === "tts" && ttsTab === "returns" && <ReturnsView data={returns} previous={previousReturns} selectedSku={sku} onSkuSelect={setSku} />}
      {tab === "tts" && ttsTab === "costs" && <UploadCenter busy={busy} onUpload={upload} onWorkbook={uploadWorkbook} embedded canUpload={admin} />}
      {tab === "tts" && ttsTab === "health" && <SyncView data={sync} admin={admin} busy={busy} onSync={syncNow} />}
      {tab === "tts" && (ttsTab === "sales" || ttsTab === "marketing") && <LightweightView type={ttsTab} pnl={pnl} />}
      {tab === "settings" && !admin && <section className="panel access"><Empty>设置仅对 Hazel 管理员开放。</Empty></section>}
      {tab === "settings" && admin && settingsTab === "uploads" && <UploadCenter busy={busy} onUpload={upload} onWorkbook={uploadWorkbook} canUpload />}
      {tab === "settings" && admin && settingsTab === "access" && <AccessView admin={admin} items={items} newEmail={newEmail} setNewEmail={setNewEmail} update={updateAccess} />}
    </section>
  </main>;
}

function GlobalFilters(props: {
  from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void; granularity: Granularity;
  setGranularity: (v: Granularity) => void; product: string; setProduct: (v: string) => void; sku: string; setSku: (v: string) => void;
  dimensions: Dimensions; returnsMode: boolean; returnType: string; setReturnType: (v: string) => void; returnStatus: string;
  setReturnStatus: (v: string) => void; busy: boolean; refresh: () => Promise<void>;
}) {
  return <div className="filters global-filters">
    <label>Date From<input type="date" value={props.from} onChange={(event) => props.setFrom(event.target.value)} /></label>
    <label>Date To<input type="date" value={props.to} onChange={(event) => props.setTo(event.target.value)} /></label>
    <label>Granularity<select value={props.granularity} onChange={(event) => props.setGranularity(event.target.value as Granularity)}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label>
    <label>Product<select value={props.product} onChange={(event) => { props.setProduct(event.target.value); props.setSku("ALL"); }}><option value="ALL">All Products</option>{props.dimensions.products.map((value) => <option key={value}>{value}</option>)}</select></label>
    <label>Search SKU<input list="sku-options" value={props.sku === "ALL" ? "" : props.sku} placeholder="All SKUs" onChange={(event) => props.setSku(event.target.value || "ALL")} /><datalist id="sku-options">{props.dimensions.skus.map((value) => <option key={value} value={value} />)}</datalist></label>
    {props.returnsMode && <><label>Return Type<select value={props.returnType} onChange={(event) => props.setReturnType(event.target.value)}><option value="ALL">All Types</option>{props.dimensions.returnTypes?.map((value) => <option key={value}>{value}</option>)}</select></label><label>Return Status<select value={props.returnStatus} onChange={(event) => props.setReturnStatus(event.target.value)}><option value="ALL">All Statuses</option>{props.dimensions.returnStatuses?.map((value) => <option key={value}>{value}</option>)}</select></label></>}
    <button className="apply" onClick={() => void props.refresh()} disabled={props.busy}>{props.busy ? "Refreshing…" : "Apply"}</button>
  </div>;
}

function Kpi({ label, value, note, tone, source, current, previous, spark = [], status }: { label: string; value: string; note: string; tone?: string; source?: string; current?: number; previous?: number; spark?: number[]; status?: "Actual" | "Preliminary" | "Pending" | "Not Mapped" }) {
  const delta = current !== undefined && previous !== undefined && previous !== 0 ? (current - previous) / Math.abs(previous) * 100 : null;
  const max = Math.max(...spark, 1), min = Math.min(...spark, 0), span = Math.max(max - min, 1);
  const points = spark.map((point, index) => `${spark.length < 2 ? 50 : index / (spark.length - 1) * 100},${30 - (point - min) / span * 26}`).join(" ");
  return <article className={`kpi ${tone || ""} ${status ? `status-${status.toLowerCase().replace(" ", "-")}` : ""}`}>
    <p>{label}{source && <span className="info-dot">i</span>}{status && <em>{status}</em>}</p><strong>{status === "Pending" || status === "Not Mapped" ? status : value}</strong>
    <div className="kpi-meta"><small>{delta === null ? note : `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}% vs previous period`}</small>{spark.length > 1 && <svg viewBox="0 0 100 32" preserveAspectRatio="none"><polyline points={points} /></svg>}</div>
  </article>;
}

function Empty({ children }: { children: React.ReactNode }) { return <div className="empty"><span>∅</span><strong>暂无数据</strong><small>{children}</small></div>; }

function riskSku(rows: ReturnSku[]) {
  return [...rows].filter(row=>row.soldUnits>=5).sort((a,b)=>(b.returnRate*Math.sqrt(b.returnedUnits))-(a.returnRate*Math.sqrt(a.returnedUnits)))[0] || [...rows].sort((a,b)=>b.returnedUnits-a.returnedUnits)[0];
}

function PlatformView({ code, title, description }: { code: string; title: string; description: string }) {
  const roadmap = code === "PRICE" ? ["实时售价采集", "基准价对比", "价格异常提醒"] : ["销售与 P&L", "Returns & Refunds", "SKU 经营表现"];
  return <section className="platform-view"><article className="panel platform-hero"><span>{code}</span><p className="kicker">MODULE ROADMAP</p><h2>{title}</h2><p>{description}</p><small>当前阶段优先完成 TTS；此入口保留真实数据接入位置，不展示模拟数字。</small></article><div className="roadmap-grid">{roadmap.map((item, index) => <article className="panel" key={item}><i>0{index + 1}</i><strong>{item}</strong><small>READY FOR DATA MAPPING</small></article>)}</div></section>;
}

function PnlView({ data, previous, admin, onOpenCosts, onSkuSelect }: { data: PnlData; previous: PnlData; admin: boolean; onOpenCosts: () => void; onSkuSelect: (sku: string) => void }) {
  const total = data.total;
  const costMetrics = [
    ["Refunds", total.refunds, "TikTok Finance + Returns API"], ["TikTok Fees", total.tiktokFees, "TikTok Finance API; Affiliate excluded"],
    ["Shipping Cost", total.sellerShippingCost, "TikTok Finance API seller-paid shipping"], ["Affiliate Commission", total.affiliateCommission, "TikTok Finance API"],
    ["Ad Spend", total.adSpend, "API for Business / uploaded manual cost"], ["Product Cost", total.cogs, "Uploaded effective-date Product Cost"],
    ["Video Agency Fee", total.videoAgencyFees, "Uploaded Agency Fee Rule"], ["LIVE Agency Fee", total.liveAgencyFees, "Uploaded Agency Fee Rule"],
    ["Return Shipping Cost", total.returnShippingCost, total.estimatedReturnShipping ? "Estimated from returned units × uploaded per-unit rule" : "TikTok Finance actual"],
    ["Other Cost", total.otherCosts, "Uploaded Manual Costs / Other rules"],
  ] as const;
  return <>
    <div className="kpi-grid executive-kpis">
      <Kpi label="GMV" value={money.format(total.gmv)} current={total.gmv} previous={previous.total.gmv} spark={data.trend.map(r=>r.gmv)} note={`${data.range.from} — ${data.range.to}`} source="TikTok Orders API" status="Actual" />
      <Kpi label="ORDERS" value={number.format(total.orders)} current={total.orders} previous={previous.total.orders} spark={data.trend.map(r=>r.orders)} note="Valid paid orders" source="TikTok Orders API; canceled/unpaid excluded" status="Actual" />
      <Kpi label="UNITS SOLD" value={number.format(total.units)} current={total.units} previous={previous.total.units} spark={data.trend.map(r=>r.units)} note="Valid order line quantity" source="TikTok Orders API" status="Actual" />
      <Kpi label="NET REVENUE" value={money.format(total.netRevenue)} current={total.netRevenue} previous={previous.total.netRevenue} spark={data.trend.map(r=>r.netRevenue)} note={`Finance coverage ${data.financeCoverage?.percent ?? 0}%`} source="TikTok Finance API only; missing finance is not estimated as GMV" status={data.financeCoverage?.settlementSummary ? "Actual" : "Preliminary"} />
      <Kpi label="OPERATING PROFIT" value={money.format(total.operatingProfit)} current={total.operatingProfit} previous={previous.total.operatingProfit} spark={data.trend.map(r=>r.operatingProfit)} note="After mapped internal costs" tone={total.operatingProfit < 0 ? "negative" : "positive"} source="Management P&L formula" status={data.financeCoverage?.settlementSummary ? "Preliminary" : "Pending"} />
      <Kpi label="MARGIN" value={`${total.margin.toFixed(1)}%`} current={total.margin} previous={previous.total.margin} spark={data.trend.map(r=>r.margin)} note="Operating Profit ÷ GMV" tone={total.margin < 0 ? "negative" : "positive"} source="Calculated management metric" status={data.financeCoverage?.settlementSummary ? "Preliminary" : "Pending"} />
    </div>
    {data.financeCoverage?.status !== "complete" && <div className="data-warning"><strong>Finance reconciliation status</strong><span>{data.financeCoverage?.settlementSummary ? `${number.format(data.financeCoverage.statementCount)} Finance statements included in total Net Revenue; ` : ""}{number.format(data.financeCoverage?.mappedLines || 0)} / {number.format(data.financeCoverage?.totalLines || 0)} sales lines have SKU-level Finance mapping. SKU profit/cost remains incomplete until transaction backfill finishes.</span></div>}
    <div className="cost-strip">{costMetrics.map(([label, value, source]) => { const unavailable = !value && (label === "Affiliate Commission" || label === "Ad Spend"); return <article key={label}><span>{label}<i title={source}>i</i></span><strong>{unavailable ? label === "Ad Spend" ? "Not Connected" : "Pending" : money.format(value)}</strong><small>{unavailable ? label === "Ad Spend" ? "Requires TikTok Ads API or upload" : "Awaiting transaction mapping" : percentOf(value, total.gmv)}</small></article>; })}</div>

    <div className="dashboard-grid pnl-bridge-grid">
      <section className="panel chart-panel bridge-panel"><div className="section-head"><div><p className="kicker">TIKTOK NET REVENUE RECONCILIATION</p><h2>GMV → Net Revenue Bridge</h2><small>Finance API deductions / credits；差额不被人工补平。</small></div></div><PlatformBridge total={total} /></section>
      <section className="panel chart-panel bridge-panel"><div className="section-head"><div><p className="kicker">INTERNAL COSTS</p><h2>Net Revenue → Operating Profit</h2><small>仅扣除 TikTok Net Revenue 尚未包含的内部成本。</small></div></div><InternalCostBridge total={total} /></section>
    </div>
    <div className="dashboard-grid excel-hero-grid">
      <section className="panel chart-panel primary-chart"><div className="section-head"><div><p className="kicker">BUSINESS PERFORMANCE</p><h2>Revenue & Profit Trend</h2><small>Revenue holds while margin softens · GMV / Net Revenue / Operating Profit / Orders</small></div><span className="range-badge">{data.granularity.toUpperCase()}</span></div>{data.trend.length ? <TrendChart rows={data.trend} /> : <Empty>当前筛选条件下没有销售记录。</Empty>}</section>
      <section className="panel chart-panel"><div className="section-head"><div><p className="kicker">WHERE MONEY WAS SPENT</p><h2>Cost Composition</h2></div></div><CostDonut total={total} /></section>
    </div>
    <div className="dashboard-grid two-up">
      <section className="panel chart-panel"><div className="section-head"><div><p className="kicker">MARGIN / COST RATIO</p><h2>Profit Quality Trend</h2></div></div><RatioTrend rows={data.trend} /></section>
      <section className="panel chart-panel"><div className="section-head"><div><p className="kicker">MARKETING EFFICIENCY</p><h2>Marketing Spend & Efficiency</h2></div></div><MarketingChart rows={data.trend} /></section>
    </div>
    <div className="dashboard-grid excel-hero-grid"><section className="panel chart-panel sku-profitability"><div className="section-head"><div><p className="kicker">WHICH SKU MAKES MONEY</p><h2>Profitability Ranking</h2><small>点击 SKU 可筛选整个 Dashboard。</small></div></div><SkuProfitability rows={data.skus} onSelect={onSkuSelect} /></section><section className="panel chart-panel"><div className="section-head"><div><p className="kicker">MANAGEMENT SIGNALS</p><h2>What Needs Attention</h2></div></div><ManagementSignals total={total} skus={data.skus} /></section></div>

    <section className="panel formula traceability"><div className="section-head"><div><p className="kicker">MANAGEMENT P&L</p><h2>口径与数据来源</h2></div>{admin && <button className="apply" onClick={onOpenCosts}>Cost Inputs</button>}</div>
      <div className="formula-grid"><div><span>GMV</span><b>{money.format(total.gmv)}</b></div><div><span>− Refunds</span><b>{money.format(total.refunds)}</b></div><div><span>− TikTok Fees</span><b>{money.format(total.tiktokFees)}</b></div><div><span>− Seller Shipping</span><b>{money.format(total.sellerShippingCost)}</b></div><div className="subtotal"><span>= Net Revenue</span><b>{money.format(total.netRevenue)}</b></div><div><span>− Product / Affiliate / Ads / Agency / Returns / Other</span><b>{money.format(total.netRevenue - total.operatingProfit)}</b></div><div className="total"><span>= Operating Profit</span><b>{money.format(total.operatingProfit)}</b></div></div>
      <div className="source-list">{data.sources.map((source) => <div key={source.metric}><strong>{source.metric}</strong><span>{source.source}</span><em>{source.status}</em></div>)}</div>
    </section>
  </>;
}

function TrendChart({ rows }: { rows: PnlRow[] }) {
  const width = 920, height = 290, left = 55, right = 35, top = 20, bottom = 38;
  const dollarMax = Math.max(...rows.flatMap((row) => [row.gmv, row.netRevenue, Math.max(0, row.operatingProfit)]), 1);
  const orderMax = Math.max(...rows.map((row) => row.orders), 1);
  const x = (index: number) => left + (rows.length === 1 ? (width - left - right) / 2 : index * (width - left - right) / (rows.length - 1));
  const yDollar = (value: number) => top + (height - top - bottom) * (1 - Math.max(0, value) / dollarMax);
  const yOrder = (value: number) => top + (height - top - bottom) * (1 - value / orderMax);
  const points = (key: "gmv" | "netRevenue" | "operatingProfit") => rows.map((row, index) => `${x(index)},${yDollar(row[key])}`).join(" ");
  return <div className="svg-chart"><div className="chart-legend"><span className="gmv">GMV</span><span className="net">Net Revenue</span><span className="profit">Operating Profit</span><span className="orders">Orders</span></div><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Revenue Profit Orders Trend">
    {[0, .25, .5, .75, 1].map((part) => <line key={part} x1={left} x2={width - right} y1={top + part * (height - top - bottom)} y2={top + part * (height - top - bottom)} className="grid-line" />)}
    {rows.map((row, index) => { const barWidth = Math.max(7, Math.min(24, (width - left - right) / Math.max(rows.length, 1) * .38)); const y = yOrder(row.orders); return <g key={row.key}><rect x={x(index) - barWidth / 2} y={y} width={barWidth} height={height - bottom - y} className="order-bar"><title>{`${row.key}\nGMV ${preciseMoney.format(row.gmv)}\nNet Revenue ${preciseMoney.format(row.netRevenue)}\nOperating Profit ${preciseMoney.format(row.operatingProfit)}\nOrders ${number.format(row.orders)}\nMargin ${row.margin.toFixed(2)}%`}</title></rect>{(rows.length <= 12 || index % Math.ceil(rows.length / 10) === 0) && <text x={x(index)} y={height - 12} textAnchor="middle">{row.key.slice(5)}</text>}</g>; })}
    <polyline points={points("gmv")} className="line-gmv" /><polyline points={points("netRevenue")} className="line-net" /><polyline points={points("operatingProfit")} className="line-profit" />
    {rows.map((row, index) => <g key={`dots-${row.key}`}><circle cx={x(index)} cy={yDollar(row.gmv)} r="4" className="dot-gmv"><title>{`${row.key} · GMV ${preciseMoney.format(row.gmv)}`}</title></circle><circle cx={x(index)} cy={yDollar(row.netRevenue)} r="4" className="dot-net"><title>{`${row.key} · Net Revenue ${preciseMoney.format(row.netRevenue)}`}</title></circle><circle cx={x(index)} cy={yDollar(row.operatingProfit)} r="4" className="dot-profit"><title>{`${row.key} · Operating Profit ${preciseMoney.format(row.operatingProfit)} · Margin ${row.margin.toFixed(2)}%`}</title></circle></g>)}
    <text x="4" y="18" className="axis-label">{money.format(dollarMax)}</text><text x={width - right} y="18" textAnchor="end" className="axis-label">{number.format(orderMax)} orders</text>
  </svg></div>;
}

function Waterfall({ total }: { total: PnlRow }) {
  const steps = [
    ["GMV", total.gmv, "total"], ["Refunds", -total.refunds, "cost"], ["TikTok Fees", -total.tiktokFees, "cost"],
    ["Shipping", -total.sellerShippingCost, "cost"], ["Net Revenue", total.netRevenue, "subtotal"], ["Product Cost", -total.cogs, "cost"],
    ["Affiliate", -total.affiliateCommission, "cost"], ["Ad Spend", -total.adSpend, "cost"], ["Video Agency", -total.videoAgencyFees, "cost"],
    ["LIVE Agency", -total.liveAgencyFees, "cost"], ["Return Shipping", -total.returnShippingCost, "cost"], ["Other", -total.otherCosts, "cost"],
    ["Operating Profit", total.operatingProfit, "total"],
  ] as const;
  const max = Math.max(...steps.map((step) => Math.abs(step[1])), 1);
  return <div className="waterfall">{steps.map(([label, value, kind]) => <div key={label} className={`${kind} tip`} data-tooltip={`${label}\n${value < 0 ? "-" : ""}${preciseMoney.format(Math.abs(value))}\n${percentOf(Math.abs(value), total.gmv)}`}><div><i style={{ height: `${Math.max(5, Math.abs(value) / max * 100)}%` }} /></div><strong>{value < 0 ? "−" : ""}{money.format(Math.abs(value))}</strong><span>{label}</span></div>)}</div>;
}

function Bridge({ startLabel, start, endLabel, end, items }: { startLabel: string; start: number; endLabel: string; end: number; items: { label: string; value: number; status?: string }[] }) {
  const max = Math.max(Math.abs(start), ...items.map(item => Math.abs(item.value)), Math.abs(end), 1);
  return <div className="bridge"><div className="bridge-step total tip" data-tooltip={`${startLabel}\n${preciseMoney.format(start)}\n100% starting point`}><i style={{height:`${Math.max(12,Math.abs(start)/max*100)}%`}}/><b>{money.format(start)}</b><span>{startLabel}</span></div>{items.map(item=><div className={`bridge-step ${item.value < 0 ? "deduction" : "credit"} tip`} data-tooltip={`${item.label}\n${item.status || preciseMoney.format(item.value)}\n${percentOf(Math.abs(item.value), start)}`} key={item.label}><i style={{height:`${Math.max(7,Math.abs(item.value)/max*100)}%`}}/><b>{item.status || `${item.value < 0 ? "−" : "+"}${money.format(Math.abs(item.value))}`}</b><small>{percentOf(Math.abs(item.value), start)}</small><span>{item.label}</span></div>)}<div className="bridge-step subtotal tip" data-tooltip={`${endLabel}\n${preciseMoney.format(end)}\n${percentOf(end,start)}`}><i style={{height:`${Math.max(12,Math.abs(end)/max*100)}%`}}/><b>{money.format(end)}</b><span>{endLabel}</span></div></div>;
}

function PlatformBridge({total}:{total:PnlRow}) {
  return <Bridge startLabel="GMV" start={total.gmv} endLabel="Net Revenue" end={total.netRevenue} items={[
    {label:"Refunds",value:-total.refunds},{label:"TikTok Fees",value:-total.tiktokFees},{label:"Shipping",value:-total.sellerShippingCost},
    {label:"Adjustments / Credits",value:total.adjustments},{label:"Affiliate",value:-total.affiliateCommission,status:total.affiliateCommission ? undefined : "Not Mapped"},
    {label:"Unmapped Difference",value:total.unmappedDifference,status:total.unmappedDifference ? undefined : undefined},
  ]}/>;
}

function InternalCostBridge({total}:{total:PnlRow}) {
  return <Bridge startLabel="Net Revenue" start={total.netRevenue} endLabel="Operating Profit" end={total.operatingProfit} items={[
    {label:"COGS",value:-total.cogs,status:total.cogs ? undefined : "Not Mapped"},{label:"Ads",value:-total.adSpend,status:total.adSpend ? undefined : "Not Connected"},
    {label:"Video Agency",value:-total.videoAgencyFees},{label:"LIVE Agency",value:-total.liveAgencyFees},{label:"Return Cost",value:-total.returnShippingCost},{label:"Other",value:-total.otherCosts},
  ]}/>;
}

function RatioTrend({rows}:{rows:PnlRow[]}) {
  const values=rows.map(row=>({key:row.key,margin:row.margin,cost:row.gmv ? (row.gmv-row.operatingProfit)/row.gmv*100:0}));
  return <div className="ratio-trend"><div className="chart-legend"><span className="profit">Margin</span><span className="orders">Cost Ratio</span></div>{values.map(row=><div className="tip" data-tooltip={`${row.key}\nMargin ${row.margin.toFixed(2)}%\nCost Ratio ${row.cost.toFixed(2)}%`} key={row.key}><span>{row.key.slice(5)}</span><i><u style={{width:`${Math.max(0,Math.min(100,row.margin))}%`}}/><em style={{width:`${Math.max(0,Math.min(100,row.cost))}%`}}/></i><b>{row.margin.toFixed(1)}%</b></div>)}</div>;
}

function CostDonut({ total }: { total: PnlRow }) {
  const parts = [{ label: "TikTok Fees", value: total.tiktokFees }, { label: "Shipping", value: total.sellerShippingCost }, { label: "Affiliate", value: total.affiliateCommission }, { label: "Ads", value: total.adSpend }, { label: "COGS", value: total.cogs }, { label: "Video Agency", value: total.videoAgencyFees }, { label: "LIVE Agency", value: total.liveAgencyFees }, { label: "Return", value: total.returnShippingCost }, { label: "Other", value: total.otherCosts }].filter((part) => part.value > 0);
  const [selected,setSelected]=useState(0); const sum = parts.reduce((value, part) => value + part.value, 0); const circumference=2*Math.PI*70; let offset=0; const active=parts[selected]||parts[0];
  if(!parts.length) return <Empty>成本尚未映射；缺失数据不会显示为 $0。</Empty>;
  return <div className="cost-donut-card interactive-cost-donut"><div className="svg-donut"><svg viewBox="0 0 180 180" aria-label="Cost composition">{parts.map((part,index)=>{const share=part.value/sum,start=offset;offset+=share;return <circle key={part.label} cx="90" cy="90" r="70" className={`donut-segment ${selected===index?'selected':''}`} stroke={palette[index%palette.length]} strokeDasharray={`${share*circumference} ${circumference}`} strokeDashoffset={-start*circumference} onClick={()=>setSelected(index)} />})}<circle cx="90" cy="90" r="52" className="donut-hole" /></svg><span><b>{money.format(sum)}</b><small>Total Cost</small></span></div><div className="cost-selection"><p>SELECTED COST</p><strong>{active.label}</strong><b>{preciseMoney.format(active.value)}</b><div><span>{(active.value/sum*100).toFixed(2)}% of cost</span><span>{total.gmv?(active.value/total.gmv*100).toFixed(2):'0.00'}% of GMV</span></div><small>点击 Donut 分区切换</small></div><div className="donut-legend">{parts.map((part,index)=><button className={selected===index?'active':''} key={part.label} onClick={()=>setSelected(index)}><i style={{background:palette[index%palette.length]}}/><span>{part.label}</span><b>{(part.value/sum*100).toFixed(1)}%</b></button>)}</div></div>;
}

function ManagementSignals({ total, skus }: { total: PnlRow; skus: PnlRow[] }) {
  const top = [...skus].sort((a, b) => b.operatingProfit - a.operatingProfit).slice(0, 2); const modeled = total.cogs + total.affiliateCommission + total.adSpend + total.videoAgencyFees + total.liveAgencyFees + total.returnShippingCost + total.otherCosts;
  return <div className="management-signals"><div><b>01 · MARGIN WATCH</b><span>{total.margin.toFixed(1)}% operating margin{total.financePending ? " · pending finance included" : ""}</span></div><div><b>02 · COST DRIVER</b><span>COGS + affiliate = {modeled ? ((total.cogs + total.affiliateCommission) / modeled * 100).toFixed(0) : 0}% of modeled cost</span></div><div><b>03 · SKU OPPORTUNITY</b><span>{top.length ? `${top.map((row) => row.key).join(" + ")} contribute ${money.format(top.reduce((sum, row) => sum + row.operatingProfit, 0))} profit` : "Waiting for SKU cost coverage"}</span></div></div>;
}

const costKeys: { key: keyof PnlRow; label: string }[] = [
  { key: "tiktokFees", label: "TikTok Fees" }, { key: "sellerShippingCost", label: "Shipping" }, { key: "cogs", label: "COGS" },
  { key: "affiliateCommission", label: "Affiliate" }, { key: "adSpend", label: "Ads" }, { key: "videoAgencyFees", label: "Video" },
  { key: "liveAgencyFees", label: "LIVE" }, { key: "returnShippingCost", label: "Return Shipping" }, { key: "otherCosts", label: "Other" },
];

function CostComposition({ rows }: { rows: PnlRow[] }) {
  const totals = rows.map((row) => costKeys.reduce((sum, item) => sum + Number(row[item.key] || 0), 0));
  const max = Math.max(...totals, 1);
  return <><div className="stack-legend">{costKeys.map((item, index) => <span key={item.key}><i style={{ background: palette[index] }} />{item.label}</span>)}</div><div className="stacked-chart">{rows.map((row, rowIndex) => <div key={row.key}><div style={{ height: `${Math.max(6, totals[rowIndex] / max * 100)}%` }}>{costKeys.map((item, index) => { const value = Number(row[item.key] || 0); return value ? <i key={item.key} style={{ height: `${value / totals[rowIndex] * 100}%`, background: palette[index] }} title={`${row.key} · ${item.label}\n${preciseMoney.format(value)}\n${percentOf(value, row.gmv)}`} /> : null; })}</div><span>{row.key.slice(5)}</span></div>)}</div></>;
}

function SkuProfitability({ rows, onSelect }: { rows: PnlRow[]; onSelect: (sku: string) => void }) {
  const [sort, setSort] = useState<"gmv" | "netRevenue" | "operatingProfit" | "margin" | "units">("operatingProfit");
  const ranked = [...rows].sort((a, b) => b[sort] - a[sort]).slice(0, 20);
  const max = Math.max(...ranked.map((row) => Math.abs(row[sort])), 1);
  return <><div className="metric-switch">{([['gmv','GMV'],['netRevenue','Net Revenue'],['operatingProfit','Profit'],['margin','Margin'],['units','Units']] as const).map(([key,label])=><button key={key} className={sort === key ? "active" : ""} onClick={() => setSort(key)}>{label}</button>)}</div><div className="rank-bars">{ranked.map((row) => {const calculated=row.financeFinal+row.financePending!==0; const needsFinance=sort==='netRevenue'||sort==='operatingProfit'||sort==='margin'; return <button className="tip" data-tooltip={`${row.key}\nGMV ${preciseMoney.format(row.gmv)}\nUnits ${number.format(row.units)}\nNet Revenue ${calculated?preciseMoney.format(row.netRevenue):'Not Calculated'}\nOperating Profit ${calculated?preciseMoney.format(row.operatingProfit):'Not Calculated'}\nMargin ${calculated?row.margin.toFixed(2)+'%':'Not Calculated'}\nClick to cross-filter`} key={row.key} onClick={() => onSelect(row.key)}><strong>{row.key}</strong><i><u style={{ width: `${Math.max(1, Math.abs(row[sort]) / max * 100)}%` }} /></i><span>{needsFinance&&!calculated?'Not Calculated':sort === "margin" ? `${row.margin.toFixed(1)}%` : sort==='units'?number.format(row.units):money.format(row[sort])}</span></button>})}</div></>;
}

function MarketingChart({ rows }: { rows: PnlRow[] }) {
  const max = Math.max(...rows.map((row) => row.adSpend + row.affiliateCommission + row.videoAgencyFees + row.liveAgencyFees), 1);
  return <div className="marketing-chart">{rows.map((row) => { const costs = [row.adSpend, row.affiliateCommission, row.videoAgencyFees, row.liveAgencyFees]; const total = costs.reduce((a, b) => a + b, 0); return <div key={row.key} title={`${row.key}\nAd Spend ${preciseMoney.format(row.adSpend)}\nAffiliate ${preciseMoney.format(row.affiliateCommission)}\nVideo ${preciseMoney.format(row.videoAgencyFees)}\nLIVE ${preciseMoney.format(row.liveAgencyFees)}`}><div style={{ height: `${Math.max(5, total / max * 100)}%` }}>{costs.map((cost, index) => cost ? <i key={index} style={{ height: `${cost / total * 100}%`, background: palette[index + 3] }} /> : null)}</div><span>{row.key.slice(5)}</span></div>; })}</div>;
}

function ReturnsView({ data, previous, selectedSku, onSkuSelect }: { data: ReturnsData; previous: ReturnsData; selectedSku: string; onSkuSelect: (sku: string) => void }) {
  const selected = selectedSku !== "ALL" ? data.skus.find((row) => row.sku === selectedSku) : undefined;
  return <>
    <div className="kpi-grid returns-kpis">
      <Kpi label="SOLD UNITS" value={number.format(data.soldUnits)} current={data.soldUnits} previous={previous.soldUnits} note="Sales cohort denominator" source="TikTok Orders API" status="Actual" />
      <Kpi label="RETURNED UNITS" value={number.format(data.returnedUnits)} current={data.returnedUnits} previous={previous.returnedUnits} note="Completed physical returns only" source="Returns API; rejected/canceled/pending excluded" status="Actual" />
      <Kpi label="OVERALL RETURN RATE" value={`${data.returnRate.toFixed(2)}%`} current={data.returnRate} previous={previous.returnRate} note="Returned Units ÷ Sold Units" tone={data.returnRate > 10 ? "negative" : ""} source="Sales cohort calculation" status="Actual" />
      <Kpi label="REFUND GMV RATE" value={`${data.refundGmvRate.toFixed(2)}%`} current={data.refundGmvRate} previous={previous.refundGmvRate} note={money.format(data.refundAmount)} source="TikTok Returns / Finance API" status="Actual" />
      <Kpi label="RETURNS CREATED" value={number.format(data.returnsCreatedDuringPeriod)} current={data.returnsCreatedDuringPeriod} previous={previous.returnsCreatedDuringPeriod} note="Created in selected period" source="Returns API event date" status="Actual" />
      <Kpi label="HIGHEST-RISK SKU" value={riskSku(data.skus)?.sku || "—"} note={riskSku(data.skus) ? `${riskSku(data.skus)!.returnedUnits} returns / ${riskSku(data.skus)!.soldUnits} sold` : "No completed returns"} tone="negative" source="Volume-adjusted risk score" status="Actual" />
    </div>
    {selected && <section className="sku-diagnosis"><button onClick={()=>onSkuSelect("ALL")}>← All SKUs</button><div><span>SKU</span><b>{selected.sku}</b></div><div><span>Sold</span><b>{number.format(selected.soldUnits)}</b></div><div><span>Returned</span><b>{number.format(selected.returnedUnits)}</b></div><div><span>Return Rate</span><b>{selected.returnRate.toFixed(2)}%</b></div><div><span>Refund</span><b>{money.format(selected.refundAmount)}</b></div><div><span>vs Shop Avg</span><b>{selected.returnRate-data.returnRate>=0?'+':''}{(selected.returnRate-data.returnRate).toFixed(2)}pp</b></div></section>}
    <div className="dashboard-grid two-up">
      <section className="panel chart-panel"><div className="section-head"><div><p className="kicker">OVERALL RETURN RATE</p><h2>Return Rate Trend</h2><small>销售 cohort 口径：该期间售出的商品最终发生的退货。</small></div></div><OverallReturnTrend skus={data.skus} /></section>
      <section className="panel chart-panel"><div className="section-head"><div><p className="kicker">SKU SHARE OF TOTAL RETURNS</p><h2>Returned Units Composition</h2><small>点击蓝色分区联动选择 SKU。</small></div></div><ReturnShareDonut rows={data.skus} onSelect={onSkuSelect} /></section>
    </div>
    <div className={`dashboard-grid ${selected ? "two-up" : ""}`}>
      <section className="panel chart-panel"><div className="section-head"><div><p className="kicker">RETURN RATE BY SKU · CLICK TO CROSS-FILTER</p><h2>SKU Risk Ranking</h2></div><button className="clear-filter" onClick={() => onSkuSelect("ALL")}>All SKUs</button></div><ReturnRateBars rows={data.skus} onSelect={onSkuSelect} /></section>
      {selected && <section className="panel chart-panel"><div className="section-head"><div><p className="kicker">SELECTED SKU TREND</p><h2>{selected.sku}</h2></div></div><ReturnTrend rows={selected.trend} /></section>}
    </div>
    {selected && <div className="dashboard-grid two-up"><section className="panel chart-panel"><div className="section-head"><div><p className="kicker">SELECTED SKU RETURN REASONS</p><h2>{`Why ${selected.sku} Is Returned`}</h2></div></div><ReasonDistribution skus={data.skus} selected={selected} /></section><section className="panel chart-panel"><div className="section-head"><div><p className="kicker">SKU × RETURN REASON MIX (100%)</p><h2>Reason Composition by SKU</h2></div></div><ReasonDistribution skus={data.skus} /></section></div>}
    <section className="panel source-panel"><div className="section-head"><div><p className="kicker">TRACEABILITY</p><h2>R&R 数据来源</h2></div></div><div className="source-list">{data.sources.map((source) => <div key={source.metric}><strong>{source.metric}</strong><span>{source.source}</span></div>)}</div></section>
  </>;
}

function OverallReturnTrend({ skus }: { skus: ReturnSku[] }) {
  const keys = [...new Set(skus.flatMap((sku) => sku.trend.map((point) => point.key)))].sort();
  const points = keys.map((key) => { const rows = skus.map((sku) => sku.trend.find((point) => point.key === key)).filter(Boolean) as ReturnSku["trend"]; const sold = rows.reduce((sum, row) => sum + row.soldUnits, 0); const returned = rows.reduce((sum, row) => sum + row.returnedUnits, 0); return { key, sold, returned, rate: sold ? returned / sold * 100 : 0 }; });
  const max = Math.max(...points.map((point) => point.rate), 1); return <div className="overall-return-trend">{points.map((point) => <div key={point.key} title={`${point.key}\nSold ${point.sold}\nReturned ${point.returned}\nReturn Rate ${point.rate.toFixed(2)}%`}><strong>{point.rate.toFixed(1)}%</strong><i><u style={{ height: `${Math.max(3, point.rate / max * 100)}%` }} /></i><span>{point.key.slice(5)}</span></div>)}</div>;
}

function ReturnShareDonut({ rows, onSelect }: { rows: ReturnSku[]; onSelect: (sku: string) => void }) {
  const ranked = rows.filter((row) => row.returnedUnits).sort((a, b) => b.returnedUnits - a.returnedUnits).slice(0, 10); const total = ranked.reduce((sum, row) => sum + row.returnedUnits, 0); const circumference = 2 * Math.PI * 72; let offset = 0;
  return <div className="return-donut-wrap"><div className="svg-donut"><svg viewBox="0 0 180 180" aria-label="SKU share of total returns"><circle cx="90" cy="90" r="72" className="donut-track" />{ranked.map((row, index) => { const share = total ? row.returnedUnits / total : 0; const start = offset; offset += share; return <circle key={row.sku} cx="90" cy="90" r="72" className="donut-segment" stroke={palette[index % palette.length]} strokeDasharray={`${share * circumference} ${circumference}`} strokeDashoffset={-start * circumference} onClick={() => onSelect(row.sku)}><title>{`${row.sku}\nReturned Units ${row.returnedUnits}\nShare ${(share * 100).toFixed(2)}%\nClick to filter`}</title></circle>; })}</svg><span><b>{number.format(total)}</b><small>returned units</small></span></div><div className="donut-legend">{ranked.map((row, index) => <button className="tip" data-tooltip={`${row.sku}\nReturned Units ${row.returnedUnits}\nShare ${total ? (row.returnedUnits / total * 100).toFixed(2) : 0}%\nClick to filter`} key={row.sku} onClick={() => onSelect(row.sku)}><i style={{ background: palette[index % palette.length] }} /><span>{row.sku}</span><b>{total ? (row.returnedUnits / total * 100).toFixed(1) : 0}%</b></button>)}</div></div>;
}

function ReturnRateBars({ rows, onSelect }: { rows: ReturnSku[]; onSelect: (sku: string) => void }) {
  const max = Math.max(...rows.map((row) => row.returnRate), 1);
  return <div className="return-rate-bars">{rows.slice(0, 30).map((row) => <button key={row.sku} onClick={() => onSelect(row.sku)} title={`SKU: ${row.sku}\nSold Units ${number.format(row.soldUnits)}\nReturned Units ${number.format(row.returnedUnits)}\nReturn Rate ${row.returnRate.toFixed(2)}%\nRefund Amount ${preciseMoney.format(row.refundAmount)}\nTop Return Reason ${row.reasons[0]?.reason || "None"}`}><strong>{row.sku}</strong><i><u style={{ width: `${row.returnRate / max * 100}%` }} /></i><span>{row.returnRate.toFixed(2)}%</span></button>)}</div>;
}

function ReturnTrend({ rows }: { rows: ReturnSku["trend"] }) {
  const maxUnits = Math.max(...rows.flatMap((row) => [row.soldUnits, row.returnedUnits]), 1);
  const maxRate = Math.max(...rows.map((row) => row.returnRate), 1);
  return <><div className="trend-axis-head"><span>Units · 0–{number.format(maxUnits)}</span><b><i className="sold-key" />Sold Units <i className="returned-key" />Returned Units <i className="rate-key" />Return Rate</b><span>Rate · 0–{maxRate.toFixed(1)}%</span></div><div className="return-trend">{rows.map((row) => <div className="tip" data-tooltip={`${row.key}\nSold Units: ${number.format(row.soldUnits)}\nReturned Units: ${number.format(row.returnedUnits)}\nReturn Rate: ${row.returnRate.toFixed(2)}%`} key={row.key}><span className="rate-line" style={{ bottom: `${row.returnRate / maxRate * 75 + 15}%` }}>{row.returnRate.toFixed(1)}%</span><div className="unit-bars"><i style={{ height: `${row.soldUnits / maxUnits * 100}%` }} /><i style={{ height: `${row.returnedUnits / maxUnits * 100}%` }} /></div><small>{row.key}</small></div>)}</div><div className="x-axis-title">Sales Cohort Period</div></>;
}

function ReasonDistribution({ skus, selected }: { skus: ReturnSku[]; selected?: ReturnSku }) {
  const [mode,setMode]=useState<"share"|"units">("share");
  const universe = [...new Set(skus.flatMap((row) => row.reasons.map((reason) => reason.reason)))];
  if (selected) { const byReason = new Map(selected.reasons.map((reason) => [reason.reason, reason])); const max=Math.max(...selected.reasons.map(r=>r.count),1); return <><div className="metric-switch"><button className={mode==='share'?'active':''} onClick={()=>setMode('share')}>% Composition</button><button className={mode==='units'?'active':''} onClick={()=>setMode('units')}>Return Units</button></div><div className="reason-ranked">{universe.map((name) => { const reason = byReason.get(name) || { reason: name, count: 0, share: 0, refundAmount: 0,rawReasons:[] }; const raw=reason.rawReasons?.map(item=>`${item.reason}: ${item.count}`).join("\n")||"No raw reason"; const width=mode==='share'?reason.share:reason.count/max*100; return <button className="tip" data-tooltip={`${reason.reason}\nReturned Units: ${reason.count}\nShare of SKU Returns: ${reason.share.toFixed(2)}%\nRefund Amount: ${preciseMoney.format(reason.refundAmount)}\n\nRaw TikTok Reasons\n${raw}`} key={reason.reason}><strong>{reason.reason}</strong><i><u style={{ width: `${width}%` }} /></i><em>{mode==='share'?`${reason.share.toFixed(1)}%`:`${reason.count} units`}</em></button>; })}</div></>; }
  return <><div className="stack-legend">{universe.map((reason, index) => <span key={reason}><i style={{ background: palette[index % palette.length] }} />{reason}</span>)}</div><div className="reason-stack-list">{skus.filter((row) => row.returnedUnits).slice(0, 18).map((row) => { const byReason = new Map(row.reasons.map((reason) => [reason.reason, reason])); return <div key={row.sku}><strong>{row.sku}</strong><span>{universe.map((name, index) => { const reason = byReason.get(name); return <i className="tip" data-tooltip={`${row.sku}\n${name}\nReturned Units: ${reason?.count || 0}\nShare: ${(reason?.share || 0).toFixed(2)}%`} key={name} style={{ width: `${reason?.share || 0}%`, background: palette[index % palette.length] }} />; })}</span></div>; })}</div></>;
}

function ReasonTrend({ rows }: { rows: ReturnSku["reasonTrend"] }) {
  const reasons = [...new Set(rows.flatMap((row) => row.reasons.map((reason) => reason.reason)))];
  return <><div className="stack-legend">{reasons.map((reason, index) => <span key={reason}><i style={{ background: palette[index % palette.length] }} />{reason}</span>)}</div><div className="reason-trend">{rows.map((row) => <div key={row.key}><span>{row.reasons.map((reason) => <i key={reason.reason} style={{ height: `${reason.share}%`, background: palette[reasons.indexOf(reason.reason) % palette.length] }} title={`${row.key} · ${reason.reason}\n${reason.count} units · ${reason.share.toFixed(2)}%`} />)}</span><small>{row.key.slice(5)}</small></div>)}</div></>;
}

function UploadCenter({ busy, onUpload, onWorkbook, embedded = false, canUpload }: { busy: boolean; onUpload: (kind: string, event: ChangeEvent<HTMLInputElement>) => void; onWorkbook: (event: ChangeEvent<HTMLInputElement>) => void; embedded?: boolean; canUpload: boolean }) {
  const cards = [
    ["product_cost", "Product Cost", "有效期成本；历史成本不会被新成本覆盖", "/templates/product-cost.csv"],
    ["agency_fee_rules", "Agency Fee Rules", "Video / LIVE / Creator / Other，多种计算方法", "/templates/agency-fee-rules.csv"],
    ["return_shipping_cost", "Return Shipping Cost", "ALL 默认值 + SKU 覆盖值", "/templates/return-shipping-cost.csv"],
    ["manual_costs", "Manual Costs", "广告、样品、一次性费用与手工调整", "/templates/manual-costs.csv"],
  ];
  return <section className="panel upload-center"><div className="section-head"><div><p className="kicker">{embedded ? "TTS / COST INPUTS" : "SETTINGS / DATA UPLOAD"}</p><h2>Management Cost Rules</h2><small>上传后按生效日期和 SKU 自动重算；同一规则键更新，不覆盖其他历史期间。</small></div><span className="owner">仅 Hazel 可上传</span></div><article className="workbook-upload"><div><span>XLSX</span><strong>Phase 1 Cost Inputs Workbook</strong><small>一个工作簿包含 Product Cost、Agency Fee Rules、Return Shipping Cost、Manual Costs 四个 Sheet。</small></div><div><a href="/templates/tts-cost-inputs.xlsx" download>下载 Excel 模板</a>{canUpload && <label className={busy ? "disabled" : ""}>上传 Excel<input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={busy} onChange={onWorkbook} /></label>}</div></article><div className="upload-grid cost-upload-grid">{cards.map(([kind, title, description, template]) => <article className="upload-card" key={kind}><span>CSV</span><div><strong>{title}</strong><small>{description}</small></div><div className="upload-actions"><a href={template} download>下载单表 CSV</a>{canUpload && <label className={busy ? "disabled" : ""}>上传 CSV<input type="file" accept=".csv,text/csv" disabled={busy} onChange={(event) => onUpload(kind, event)} /></label>}</div></article>)}</div>{!canUpload && <div className="upload-note"><strong>只读模式</strong><span>你可以下载模板；只有 Hazel 管理员可以上传并修改成本规则。</span></div>}<div className="integrity-rules"><strong>Phase 1 数据完整性</strong><span>Affiliate 不重复计入 TikTok Fees</span><span>Buyer-paid shipping 不作卖家成本</span><span>Rejected / Canceled / Pending 不计物理退货</span><span>Actual Return Shipping 优先于估算</span></div></section>;
}

function SyncView({ data, admin, busy, onSync }: { data: SyncData; admin: boolean; busy: boolean; onSync: () => void }) {
  const last = data.lastRun; const counts = data.counts;
  return <section className="sync-layout"><article className="panel sync-hero"><p className="kicker">TIKTOK SHOP OPEN API</p><h2>{data.configured ? "自动数据管道已就绪" : "还差 TikTok API 凭证"}</h2><p>{data.configured ? "Cloudflare Worker 每 6 小时拉取订单、退货和 SKU 级财务结算，并写入 D1。" : "在 Cloudflare Secrets 中加入 App Key、App Secret、Access Token 与 Shop Cipher 后即可启用。"}</p>{admin && <button className="primary-action" onClick={onSync} disabled={busy || !data.configured}>{busy ? "同步中…" : "立即同步最近 30 天"}</button>}</article><article className="panel sync-details"><div><span>Orders API</span><b>POST · 202309</b></div><div><span>Returns API</span><b>POST · 202602</b></div><div><span>Finance API</span><b>GET · 202501</b></div><div><span>Cloudflare Cron</span><b>Every 6 hours</b></div>{counts && <><div><span>D1 Sales Lines</span><b>{number.format(counts.salesLines)}</b></div><div><span>D1 Return Lines</span><b>{number.format(counts.returnLines)}</b></div></>}</article><article className="panel sync-run"><p className="kicker">LAST RUN</p>{last ? <><h2 className={last.status === "success" ? "green" : last.status === "failed" ? "red" : ""}>{last.status.toUpperCase()}</h2><p>{last.message}</p><div><span>销售行</span><b>{last.ordersUpserted}</b></div><div><span>退货行</span><b>{last.returnsUpserted}</b></div><small>{new Date(last.startedAt).toLocaleString("zh-CN")}</small></> : <Empty>尚未执行过 TikTok 同步。</Empty>}</article>{counts && <article className="panel sync-run"><p className="kicker">COST RULE COVERAGE</p><div><span>Product Cost</span><b>{counts.productCostRules}</b></div><div><span>Agency Rules</span><b>{counts.agencyRules}</b></div><div><span>Return Shipping</span><b>{counts.returnShippingRules}</b></div><div><span>Manual Costs</span><b>{counts.manualCosts}</b></div></article>}</section>;
}

function LightweightView({ type, pnl }: { type: "sales" | "marketing"; pnl: PnlData }) {
  if (type === "sales") return <section className="panel lightweight"><p className="kicker">SALES & ORDERS</p><h2>订单活动概览</h2><div className="kpi-grid"><Kpi label="GMV" value={money.format(pnl.total.gmv)} note="Current filters" /><Kpi label="Orders" value={number.format(pnl.total.orders)} note="Valid paid orders" /><Kpi label="Units" value={number.format(pnl.total.units)} note="Valid sold units" /></div><TrendChart rows={pnl.trend} /></section>;
  return <section className="panel lightweight"><p className="kicker">MARKETING</p><h2>Marketing Cost Overview</h2><p>Phase 1 先展示 Finance Affiliate 与上传的 Agency / Ad Cost；TikTok API for Business 接入后补全 billed cost、attributed GMV 与 ROAS。</p><MarketingChart rows={pnl.trend} /></section>;
}

function AccessView({ admin, items, newEmail, setNewEmail, update }: { admin: boolean; items: Allowed[]; newEmail: string; setNewEmail: (value: string) => void; update: (method: "POST" | "DELETE", target: string) => void }) {
  return <section className="panel access"><div className="section-head"><div><p className="kicker">ACCESS CONTROL</p><h2>允许访问的邮箱</h2></div><span className="owner">最终管理员 · Hazel</span></div>{!admin ? <div className="empty"><strong>只有 Hazel 管理员可以管理访问权限。</strong></div> : <><form className="invite" onSubmit={(event) => { event.preventDefault(); void update("POST", newEmail); }}><label>允许新的邮箱访问<small>添加后，请把临时密码安全地发给对方。</small></label><input type="email" required value={newEmail} onChange={(event) => setNewEmail(event.target.value)} placeholder="colleague@saphiant.com" /><button>加入白名单</button></form><div className="allowlist"><div><span>邮箱</span><span>权限</span><span>状态</span><span /></div>{items.map((item) => { const protectedAdmin = item.role === "owner" || item.role === "recovery"; const roleLabel = item.role === "owner" ? "超级管理员" : item.role === "recovery" ? "管理员" : "查看者"; return <div key={item.email}><span>{item.email}</span><span>{roleLabel}</span><span className="green">● 已允许</span><button disabled={protectedAdmin} onClick={() => void update("DELETE", item.email)}>{protectedAdmin ? "不可删除" : "移除"}</button></div>; })}</div></>}</section>;
}
