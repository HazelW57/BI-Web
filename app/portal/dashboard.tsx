"use client";

import { ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";

type Allowed = { email: string; role: string; createdAt: number };
type PnlRow = { key: string; revenue: number; units: number; cogs: number; platformFees: number; shippingCost: number; agencyFees: number; contributionProfit: number; operatingProfit: number; margin: number; settlement: number };
type PnlData = { range: { from: string; to: string }; total: PnlRow; months: PnlRow[]; skus: PnlRow[] };
type ReturnSku = { sku: string; soldUnits: number; returnedUnits: number; returnRate: number; reasons: { reason: string; count: number; share: number }[] };
type ReturnsData = { range: { from: string; to: string }; soldUnits: number; returnedUnits: number; returnRate: number; skuCount: number; skus: ReturnSku[] };
type SyncData = { configured: boolean; lastRun: null | { status: string; ordersUpserted: number; returnsUpserted: number; message: string; startedAt: number; completedAt: number | null } };
type Tab = "bby" | "walmart" | "pricing" | "tts" | "settings";
type TtsTab = "pnl" | "returns" | "health";
type SettingsTab = "access" | "uploads";

const emptyPnl: PnlData = { range: { from: "", to: "" }, total: { key: "total", revenue: 0, units: 0, cogs: 0, platformFees: 0, shippingCost: 0, agencyFees: 0, contributionProfit: 0, operatingProfit: 0, margin: 0, settlement: 0 }, months: [], skus: [] };
const emptyReturns: ReturnsData = { range: { from: "", to: "" }, soldUnits: 0, returnedUnits: 0, returnRate: 0, skuCount: 0, skus: [] };
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const number = new Intl.NumberFormat("en-US");

function dateInput(date: Date) { return date.toISOString().slice(0, 10); }

export default function Dashboard({ email, admin, initialAllowed }: { email: string; admin: boolean; initialAllowed: Allowed[] }) {
  const today = useMemo(() => new Date(), []);
  const [tab, setTab] = useState<Tab>("tts");
  const [ttsTab, setTtsTab] = useState<TtsTab>("pnl");
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("uploads");
  const [from, setFrom] = useState(dateInput(new Date(today.getTime() - 89 * 86_400_000)));
  const [to, setTo] = useState(dateInput(today));
  const [pnl, setPnl] = useState<PnlData>(emptyPnl);
  const [returns, setReturns] = useState<ReturnsData>(emptyReturns);
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
      const query = new URLSearchParams({ from, to });
      const [pnlData, returnsData, syncData] = await Promise.all([
        getJson<PnlData>(`/api/bi/pnl?${query}`),
        getJson<ReturnsData>(`/api/bi/returns?${query}`),
        getJson<SyncData>("/api/bi/sync"),
      ]);
      setPnl(pnlData); setReturns(returnsData); setSync(syncData);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "数据读取失败"); }
    finally { setBusy(false); }
  }, [from, getJson, to]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void refresh(); }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  async function upload(kind: string, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const body = new FormData(); body.set("kind", kind); body.set("file", file);
      const result = await getJson<{ rows: number }>("/api/bi/import", { method: "POST", body });
      setNotice(`已导入 ${result.rows} 行，P&L 已自动重算。`);
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "上传失败"); setBusy(false); }
  }

  async function syncNow() {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await getJson<{ ordersUpserted: number; returnsUpserted: number }>("/api/bi/sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ days: 30 }) });
      setNotice(`TikTok 同步完成：${result.ordersUpserted} 条销售行，${result.returnsUpserted} 条退货行。`);
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "同步失败"); setBusy(false); }
  }

  async function updateAccess(method: "POST" | "DELETE", target: string) {
    const password = method === "POST" ? prompt("请为该邮箱设置至少 10 位临时密码：") || "" : undefined;
    if (method === "POST" && password.length < 10) { setError("临时密码至少需要 10 位"); return; }
    try {
      const data = await getJson<{ items: Allowed[] }>("/api/access", { method, headers: { "content-type": "application/json" }, body: JSON.stringify({ email: target, password }) });
      setItems(data.items); setNewEmail("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "操作失败"); }
  }

  async function logout() { await fetch("/api/logout", { method: "POST" }); location.href = "/"; }

  const nav: { key: Tab; label: string; eyebrow: string }[] = [
    { key: "bby", label: "BBY", eyebrow: "BEST BUY" },
    { key: "walmart", label: "Walmart", eyebrow: "MARKETPLACE" },
    { key: "pricing", label: "价格核验", eyebrow: "PRICE CHECK" },
    { key: "tts", label: "TTS", eyebrow: "TIKTOK SHOP" },
    { key: "settings", label: "设置", eyebrow: "CONTROL" },
  ];
  const openUploads = () => { setSettingsTab("uploads"); setTab("settings"); };

  return <main className="shell">
    <aside className="sidebar">
      <div className="side-brand"><span className="brand-mark">S</span><span>SAPHIANT<small>COMMERCE BI</small></span></div>
      <nav>{nav.map((item, index) => <button key={item.key} onClick={() => setTab(item.key)} className={tab === item.key ? "active" : ""}><i>0{index + 1}</i><span>{item.label}<small>{item.eyebrow}</small></span></button>)}</nav>
      <div className="side-user"><strong>{admin ? "Hazel · Owner" : "Authorized Viewer"}</strong><small>{email}</small><button onClick={logout}>安全退出</button></div>
    </aside>

    <section className="workspace">
      <header className="topbar"><div><p className="crumb">SAPHIANT / COMMERCE INTELLIGENCE</p><h1>{nav.find((item) => item.key === tab)?.label}</h1></div><div className="top-status"><span className={sync.configured ? "live" : "pending"}>{sync.configured ? "TTS 数据在线" : "TTS API 待配置"}</span></div></header>
      {tab === "tts" && <div className="subnav"><button className={ttsTab === "pnl" ? "active" : ""} onClick={() => setTtsTab("pnl")}>P&amp;L Summary</button><button className={ttsTab === "returns" ? "active" : ""} onClick={() => setTtsTab("returns")}>R&amp;R</button><button className={ttsTab === "health" ? "active" : ""} onClick={() => setTtsTab("health")}>Data Health</button></div>}
      {tab === "settings" && admin && <div className="subnav"><button className={settingsTab === "uploads" ? "active" : ""} onClick={() => setSettingsTab("uploads")}>数据上传</button><button className={settingsTab === "access" ? "active" : ""} onClick={() => setSettingsTab("access")}>访问管理</button></div>}
      {tab === "tts" && ttsTab !== "health" && <div className="filters"><label>开始日期<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label>结束日期<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label><button className="apply" onClick={refresh} disabled={busy}>{busy ? "刷新中…" : "应用日期"}</button></div>}
      {error && <div className="message error-message">{error}<button onClick={() => setError("")}>×</button></div>}
      {notice && <div className="message success-message">{notice}<button onClick={() => setNotice("")}>×</button></div>}

      {tab === "bby" && <PlatformView code="BBY" title="Best Buy Intelligence" description="为 Best Buy 销售、P&L、退货率和库存周转预留统一分析入口。" />}
      {tab === "walmart" && <PlatformView code="WMT" title="Walmart Intelligence" description="为 Walmart 订单、退货、广告和 SKU 经营表现预留统一分析入口。" />}
      {tab === "pricing" && <PlatformView code="PRICE" title="三平台价格核验" description="规划 Amazon、Walmart、Best Buy 的实时售价、基准价和异常提醒。" />}
      {tab === "tts" && ttsTab === "pnl" && <PnlView data={pnl} admin={admin} onOpenUploads={openUploads} />}
      {tab === "tts" && ttsTab === "returns" && <ReturnsView data={returns} />}
      {tab === "tts" && ttsTab === "health" && <SyncView data={sync} admin={admin} busy={busy} onSync={syncNow} />}
      {tab === "settings" && !admin && <section className="panel access"><Empty>设置仅对 Hazel 管理员开放。</Empty></section>}
      {tab === "settings" && admin && settingsTab === "uploads" && <UploadCenter busy={busy} onUpload={upload} />}
      {tab === "settings" && admin && settingsTab === "access" && <AccessView admin={admin} items={items} newEmail={newEmail} setNewEmail={setNewEmail} update={updateAccess} />}
    </section>
  </main>;
}

function Kpi({ label, value, note, tone }: { label: string; value: string; note: string; tone?: string }) {
  return <article className={`kpi ${tone || ""}`}><p>{label}</p><strong>{value}</strong><small>{note}</small></article>;
}

function Empty({ children }: { children: React.ReactNode }) { return <div className="empty"><span>∅</span><strong>暂无数据</strong><small>{children}</small></div>; }

function PlatformView({ code, title, description }: { code: string; title: string; description: string }) {
  const roadmap = code === "PRICE" ? ["实时售价采集", "基准价对比", "价格异常提醒"] : ["销售与 P&L", "Returns & Refunds", "SKU 经营表现"];
  return <section className="platform-view"><article className="panel platform-hero"><span>{code}</span><p className="kicker">MODULE ROADMAP</p><h2>{title}</h2><p>{description}</p><small>当前阶段优先完成 TTS；此入口保留真实数据接入位置，不展示模拟数字。</small></article><div className="roadmap-grid">{roadmap.map((item, index) => <article className="panel" key={item}><i>0{index + 1}</i><strong>{item}</strong><small>READY FOR DATA MAPPING</small></article>)}</div></section>;
}

function PnlView({ data, admin, onOpenUploads }: { data: PnlData; admin: boolean; onOpenUploads: () => void }) {
  const maxProfit = Math.max(...data.months.map((row) => Math.abs(row.operatingProfit)), 1);
  return <>
    <div className="kpi-grid">
      <Kpi label="NET REVENUE" value={money.format(data.total.revenue)} note={`${number.format(data.total.units)} units`} />
      <Kpi label="PRODUCT COST" value={money.format(data.total.cogs)} note="SKU 成本 × 销售数量" />
      <Kpi label="AGENCY FEES" value={money.format(data.total.agencyFees)} note="Video + LIVE" />
      <Kpi label="OPERATING PROFIT" value={money.format(data.total.operatingProfit)} note={`${data.total.margin.toFixed(1)}% margin`} tone={data.total.operatingProfit < 0 ? "negative" : "positive"} />
    </div>

    <div className="content-grid">
      <section className="panel pnl-chart"><div className="section-head"><div><p className="kicker">MONTHLY P&L</p><h2>经营利润趋势</h2></div><span className="range-badge">{data.range.from} — {data.range.to}</span></div>
        {!data.months.length ? <Empty>同步 TikTok API 后，这里会显示每月净销售额与利润。</Empty> : <div className="profit-bars">{data.months.map((row) => <div className="profit-column" key={row.key}><strong>{money.format(row.operatingProfit)}</strong><div><i className={row.operatingProfit < 0 ? "loss" : ""} style={{ height: `${Math.max(8, Math.abs(row.operatingProfit) / maxProfit * 100)}%` }} /></div><span>{row.key}</span></div>)}</div>}
      </section>
      <section className="panel formula"><p className="kicker">CALCULATION</p><h2>当前利润口径</h2><div className="formula-line"><span>Net Revenue</span><b>API 净销售额</b></div><div className="formula-line minus"><span>− Product Cost</span><b>SKU × 数量</b></div><div className="formula-line minus"><span>− TikTok Fees</span><b>Finance API</b></div><div className="formula-line minus"><span>− Shipping Cost</span><b>Finance API</b></div><div className="formula-line minus"><span>− Agency Fees</span><b>手工模板</b></div><div className="formula-total"><span>= Operating Profit</span><b>{money.format(data.total.operatingProfit)}</b></div><small>SKU 维度的月度 Agency Fee 按该月各 SKU 净销售额占比分摊。</small></section>
    </div>

    {admin && <section className="panel upload-section upload-reserved"><div><p className="kicker">P&L INPUT STATUS</p><h2>成本与费用上传区</h2><small>Product Cost、Video Agency Fee、LIVE Agency Fee 的实际上传集中在“设置 → 数据上传”。</small></div><div className="input-statuses"><span>Product Cost</span><span>Video Agency Fee</span><span>LIVE Agency Fee</span></div><button className="apply" onClick={onOpenUploads}>前往数据上传</button></section>}

    <section className="panel data-table"><div className="section-head"><div><p className="kicker">SKU CONTRIBUTION</p><h2>SKU 利润明细</h2></div></div>{!data.skus.length ? <Empty>尚无可计算的 SKU 销售记录。</Empty> : <div className="table-scroll"><table><thead><tr><th>SKU</th><th>Units</th><th>Net Revenue</th><th>Product Cost</th><th>TikTok + Shipping</th><th>Agency Fee</th><th>Operating Profit</th><th>Margin</th></tr></thead><tbody>{data.skus.map((row) => <tr key={row.key}><td><strong>{row.key}</strong></td><td>{number.format(row.units)}</td><td>{money.format(row.revenue)}</td><td>{money.format(row.cogs)}</td><td>{money.format(row.platformFees + row.shippingCost)}</td><td>{money.format(row.agencyFees)}</td><td className={row.operatingProfit < 0 ? "red" : "green"}>{money.format(row.operatingProfit)}</td><td>{row.margin.toFixed(1)}%</td></tr>)}</tbody></table></div>}</section>
  </>;
}

function ReturnsView({ data }: { data: ReturnsData }) {
  return <>
    <div className="kpi-grid">
      <Kpi label="SOLD UNITS" value={number.format(data.soldUnits)} note="所选周期销售数量" />
      <Kpi label="RETURNED UNITS" value={number.format(data.returnedUnits)} note="排除 rejected / canceled" />
      <Kpi label="RETURN RATE" value={`${data.returnRate.toFixed(2)}%`} note="Returned Units ÷ Sold Units" tone={data.returnRate > 10 ? "negative" : ""} />
      <Kpi label="ACTIVE SKUS" value={number.format(data.skuCount)} note="有销售或退货记录" />
    </div>
    <section className="panel return-section"><div className="section-head"><div><p className="kicker">SKU RETURN INTELLIGENCE</p><h2>按 SKU 的退货率与原因占比</h2><small>原因占比以每个 SKU 的退货件数为分母。</small></div><span className="range-badge">{data.range.from} — {data.range.to}</span></div>
      {!data.skus.length ? <Empty>同步 TikTok Return API 后，这里会按 SKU 展示退货率和原因结构。</Empty> : <div className="return-list"><div className="return-header"><span>SKU</span><span>Sold</span><span>Returned</span><span>Return Rate</span><span>Return Reason Mix</span></div>{data.skus.map((row) => <article className="return-row" key={row.sku}><strong>{row.sku}</strong><span>{number.format(row.soldUnits)}</span><span>{number.format(row.returnedUnits)}</span><b className={row.returnRate > 10 ? "rate high" : "rate"}>{row.returnRate.toFixed(2)}%</b><div className="reason-mix">{row.reasons.length ? row.reasons.map((reason) => <div key={reason.reason}><span><b>{reason.reason}</b><em>{reason.share.toFixed(1)}%</em></span><i><u style={{ width: `${reason.share}%` }} /></i></div>) : <small>暂无退货原因</small>}</div></article>)}</div>}
    </section>
  </>;
}

function UploadCenter({ busy, onUpload }: { busy: boolean; onUpload: (kind: string, event: ChangeEvent<HTMLInputElement>) => void }) {
  const cards = [
    ["product_cost", "Product Cost", "按 SKU + 生效日维护单位产品成本", "/templates/product-cost.csv"],
    ["video_agency_fee", "Video Agency Fee", "按月维护短视频 Agency Fee", "/templates/video-agency-fee.csv"],
    ["live_agency_fee", "LIVE Agency Fee", "按月维护直播 Agency Fee", "/templates/live-agency-fee.csv"],
  ];
  return <section className="panel upload-center"><div className="section-head"><div><p className="kicker">SETTINGS / DATA UPLOAD</p><h2>TTS 成本与费用数据</h2><small>下载标准 CSV，填写后上传；同一 SKU/月份的新文件会覆盖旧值并自动重算 P&amp;L。</small></div><span className="owner">仅 Hazel 可上传</span></div><div className="upload-grid">{cards.map(([kind, title, description, template]) => <article className="upload-card" key={kind}><span>CSV</span><div><strong>{title}</strong><small>{description}</small></div><div className="upload-actions"><a href={template} download>下载模板</a><label className={busy ? "disabled" : ""}>上传文件<input type="file" accept=".csv,text/csv" disabled={busy} onChange={(event) => onUpload(kind, event)} /></label></div></article>)}</div><div className="upload-note"><strong>TikTok 自动数据</strong><span>销售、Finance、Returns 由 Worker 定时同步，无需手工上传。</span></div></section>;
}

function SyncView({ data, admin, busy, onSync }: { data: SyncData; admin: boolean; busy: boolean; onSync: () => void }) {
  const last = data.lastRun;
  return <section className="sync-layout"><article className="panel sync-hero"><p className="kicker">TIKTOK SHOP OPEN API</p><h2>{data.configured ? "自动数据管道已就绪" : "还差 TikTok API 凭证"}</h2><p>{data.configured ? "Cloudflare Worker 每 6 小时拉取订单、退货和 SKU 级财务结算，并写入 D1。" : "在 Cloudflare Secrets 中加入 App Key、App Secret、Access Token 与 Shop Cipher 后即可启用。"}</p>{admin && <button className="primary-action" onClick={onSync} disabled={busy || !data.configured}>{busy ? "同步中…" : "立即同步最近 30 天"}</button>}</article><article className="panel sync-details"><div><span>Orders API</span><b>202309</b></div><div><span>Returns API</span><b>202602</b></div><div><span>Finance API</span><b>202501</b></div><div><span>Cloudflare Cron</span><b>Every 6 hours</b></div></article><article className="panel sync-run"><p className="kicker">LAST RUN</p>{last ? <><h2 className={last.status === "success" ? "green" : last.status === "failed" ? "red" : ""}>{last.status.toUpperCase()}</h2><p>{last.message}</p><div><span>销售行</span><b>{last.ordersUpserted}</b></div><div><span>退货行</span><b>{last.returnsUpserted}</b></div><small>{new Date(last.startedAt).toLocaleString("zh-CN")}</small></> : <Empty>尚未执行过 TikTok 同步。</Empty>}</article></section>;
}

function AccessView({ admin, items, newEmail, setNewEmail, update }: { admin: boolean; items: Allowed[]; newEmail: string; setNewEmail: (value: string) => void; update: (method: "POST" | "DELETE", target: string) => void }) {
  return <section className="panel access"><div className="section-head"><div><p className="kicker">ACCESS CONTROL</p><h2>允许访问的邮箱</h2></div><span className="owner">最终管理员 · Hazel</span></div>{!admin ? <div className="empty"><strong>只有 Hazel 管理员可以管理访问权限。</strong></div> : <><form className="invite" onSubmit={(event) => { event.preventDefault(); void update("POST", newEmail); }}><label>允许新的邮箱访问<small>添加后，请把临时密码安全地发给对方。</small></label><input type="email" required value={newEmail} onChange={(event) => setNewEmail(event.target.value)} placeholder="colleague@saphiant.com" /><button>加入白名单</button></form><div className="allowlist"><div><span>邮箱</span><span>权限</span><span>状态</span><span /></div>{items.map((item) => { const protectedAdmin = item.role === "owner" || item.role === "recovery"; const roleLabel = item.role === "owner" ? "超级管理员" : item.role === "recovery" ? "管理员" : "查看者"; return <div key={item.email}><span>{item.email}</span><span>{roleLabel}</span><span className="green">● 已允许</span><button disabled={protectedAdmin} onClick={() => void update("DELETE", item.email)}>{protectedAdmin ? "不可删除" : "移除"}</button></div>; })}</div></>}</section>;
}
