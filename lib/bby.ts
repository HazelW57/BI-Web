import type { Granularity } from "./bi";

type BbyEnv = Env & { BESTBUY_MIRAKL_URL?: string; BESTBUY_SAP_API_KEY?: string; BESTBUY_JS_API_KEY?: string };
type Obj = Record<string, any>;

function n(value: any) { const raw = value && typeof value === "object" ? value.amount : value; const parsed = Number(raw); return Number.isFinite(parsed) ? parsed : 0; }
function s(...values: any[]) { return String(values.find((value) => value !== undefined && value !== null && String(value).trim()) ?? "").trim(); }
function ts(value: any) { const parsed = Date.parse(s(value)); return Number.isFinite(parsed) ? parsed : Date.now(); }
function key(date: number, granularity: Granularity) { const d = new Date(date); if (granularity === "daily") return d.toISOString().slice(0,10); if (granularity === "monthly") return d.toISOString().slice(0,7); const day=(d.getUTCDay()+6)%7; d.setUTCDate(d.getUTCDate()-day); return d.toISOString().slice(0,10); }

export async function ensureBbySchema(db: D1Database) {
  await db.exec(`CREATE TABLE IF NOT EXISTS bby_sales_lines (id TEXT PRIMARY KEY,store_code TEXT NOT NULL,order_id TEXT NOT NULL,sku TEXT NOT NULL,product_name TEXT NOT NULL,quantity INTEGER NOT NULL,ordered_at INTEGER NOT NULL,gross_sales REAL NOT NULL,status TEXT NOT NULL,raw_json TEXT NOT NULL,updated_at INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS idx_bby_sales_store_date ON bby_sales_lines(store_code,ordered_at);
  CREATE TABLE IF NOT EXISTS bby_return_lines (id TEXT PRIMARY KEY,store_code TEXT NOT NULL,order_id TEXT,line_item_id TEXT,sku TEXT NOT NULL,reason TEXT NOT NULL,quantity INTEGER NOT NULL,refund_amount REAL NOT NULL,status TEXT NOT NULL,requested_at INTEGER NOT NULL,raw_json TEXT NOT NULL,updated_at INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS idx_bby_returns_store_date ON bby_return_lines(store_code,requested_at);`);
  await db.exec(`CREATE TABLE IF NOT EXISTS bby_sync_windows (id TEXT PRIMARY KEY,store_code TEXT NOT NULL,window_start TEXT NOT NULL,window_end TEXT NOT NULL,status TEXT NOT NULL,orders_count INTEGER NOT NULL,returns_count INTEGER NOT NULL,updated_at INTEGER NOT NULL);`);
}

async function allRows<T>(db:D1Database, sql:string, bindings:any[]) {
  const rows:T[]=[]; let offset=0; const limit=500;
  while(true){
    const page=await db.prepare(`${sql} LIMIT ? OFFSET ?`).bind(...bindings,limit,offset).all<T>();
    rows.push(...page.results);
    if(page.results.length<limit)break;
    offset+=page.results.length;
  }
  return rows;
}

function credential(env: BbyEnv, store: string) { const apiKey = store === "JS" ? env.BESTBUY_JS_API_KEY : env.BESTBUY_SAP_API_KEY; if (!apiKey) throw new Error(`Best Buy ${store} Mirakl secret is not configured`); return apiKey; }
async function mirakl(env: BbyEnv, store: string, path: string, params: Record<string,string>) {
  const base=(env.BESTBUY_MIRAKL_URL || "https://bestbuyus-prod.mirakl.net").replace(/\/$/,""); const url=new URL(`${base}${path}`); Object.entries(params).forEach(([k,v])=>url.searchParams.set(k,v));
  const token=credential(env,store); let response=await fetch(url,{headers:{Authorization:token,Accept:"application/json"}});
  if(response.status===401||response.status===403) response=await fetch(url,{headers:{Authorization:`Bearer ${token}`,Accept:"application/json"}});
  if(!response.ok) throw new Error(`Mirakl ${path} ${response.status}`); return response.json() as Promise<Obj>;
}

export async function syncBby(env: BbyEnv, store: "SAP"|"JS", from: string, to: string) {
  await ensureBbySchema(env.DB); const windowId=`${store}:${from}:${to}`; const existing=await env.DB.prepare("SELECT status FROM bby_sync_windows WHERE id=?").bind(windowId).first<{status:string}>(); if(existing?.status==="success")return {store,orders:0,returns:0,skipped:true}; let offset=0,ordersCount=0,returnsCount=0;
  for(let page=0;page<500;page++) { const data=await mirakl(env,store,"/api/orders",{start_date:`${from}T00:00:00Z`,end_date:`${to}T23:59:59Z`,max:"100",offset:String(offset),order_tax_mode:"TAX_INCLUDED"}); const orders=(data.orders||[]) as Obj[];
    for(const order of orders){ const orderId=s(order.order_id,order.id); const orderedAt=ts(order.created_date,order.date_created); for(const line of (order.order_lines||[]) as Obj[]){ const lineId=s(line.order_line_id,line.id); const sku=s(line.offer_sku,line.product_sku,line.product?.sku,"UNKNOWN-SKU"); const quantity=Math.max(1,n(line.quantity)||1); const gross=n(line.price)||n(line.unit_price)*quantity; await env.DB.prepare(`INSERT INTO bby_sales_lines VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET sku=excluded.sku,product_name=excluded.product_name,quantity=excluded.quantity,gross_sales=excluded.gross_sales,status=excluded.status,raw_json=excluded.raw_json,updated_at=excluded.updated_at`).bind(`${store}:${lineId}`,store,orderId,sku,s(line.product_title,line.product?.title,sku),quantity,orderedAt,gross,s(line.order_line_state,order.order_state),JSON.stringify({order,line}),Date.now()).run(); ordersCount++;
      for(const refund of (line.refunds||[]) as Obj[]){ const id=s(refund.refund_id,refund.id,`${lineId}:${refund.created_date||refund.date_created||refund.reason_code}`); const qty=Math.max(1,n(refund.quantity)||1); await env.DB.prepare(`INSERT INTO bby_return_lines VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET reason=excluded.reason,quantity=excluded.quantity,refund_amount=excluded.refund_amount,status=excluded.status,raw_json=excluded.raw_json,updated_at=excluded.updated_at`).bind(`${store}:${id}`,store,orderId,lineId,sku,s(refund.reason_label,refund.reason_code,"Refund"),qty,n(refund.amount)||n(refund.refund_amount),s(refund.state,refund.status,"REFUNDED"),ts(refund.created_date,refund.date_created,order.last_updated_date),JSON.stringify(refund),Date.now()).run(); returnsCount++; }
    }} if(orders.length<100) break; offset+=orders.length;
  }
  await env.DB.prepare(`INSERT INTO bby_sync_windows VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status='success',orders_count=excluded.orders_count,returns_count=excluded.returns_count,updated_at=excluded.updated_at`).bind(windowId,store,from,to,"success",ordersCount,returnsCount,Date.now()).run();
  return {store,orders:ordersCount,returns:returnsCount,skipped:false};
}

export async function getBbyReturns(db:D1Database, input:{store:string;from:string;to:string;granularity:Granularity;sku?:string}) {
  await ensureBbySchema(db); const start=Date.parse(`${input.from}T00:00:00Z`),end=Date.parse(`${input.to}T23:59:59Z`);
  const sales=await allRows<any>(db,`SELECT * FROM bby_sales_lines WHERE store_code=? AND ordered_at BETWEEN ? AND ?`,[input.store,start,end]);
  const orderIds=[...new Set(sales.map(r=>r.order_id))]; const returns:any[]=[]; for(let i=0;i<orderIds.length;i+=90){const ids=orderIds.slice(i,i+90); if(!ids.length)continue; const q=ids.map(()=>"?").join(","); returns.push(...await allRows<any>(db,`SELECT * FROM bby_return_lines WHERE store_code=? AND order_id IN (${q})`,[input.store,...ids]));}
  const bySku=new Map<string,any>(); for(const sale of sales){if(input.sku&&input.sku!=="ALL"&&sale.sku!==input.sku)continue; const row=bySku.get(sale.sku)||{sku:sale.sku,productName:sale.product_name,soldUnits:0,returnedUnits:0,refundAmount:0,reasons:new Map(),trend:new Map()}; row.soldUnits+=sale.quantity; const k=key(sale.ordered_at,input.granularity); const t=row.trend.get(k)||{key:k,soldUnits:0,returnedUnits:0,returnRate:0};t.soldUnits+=sale.quantity;row.trend.set(k,t);bySku.set(sale.sku,row);}
  for(const ret of returns){const row=bySku.get(ret.sku);if(!row)continue; row.returnedUnits+=ret.quantity;row.refundAmount+=ret.refund_amount;row.reasons.set(ret.reason,(row.reasons.get(ret.reason)||0)+ret.quantity); const sale=sales.find(x=>x.order_id===ret.order_id&&x.sku===ret.sku);if(sale){const t=row.trend.get(key(sale.ordered_at,input.granularity));if(t)t.returnedUnits+=ret.quantity;}}
  const skus=[...bySku.values()].map(row=>{const reasons=[...row.reasons.entries()].map(([reason,count]:any)=>({reason,count,share:row.returnedUnits?count/row.returnedUnits*100:0,refundAmount:0,rawReasons:[{reason,count}]})).sort((a,b)=>b.count-a.count);const trend=[...row.trend.values()].sort((a:any,b:any)=>a.key.localeCompare(b.key)).map((t:any)=>({...t,returnRate:t.soldUnits?t.returnedUnits/t.soldUnits*100:0}));return {...row,reasons,trend,reasonTrend:[],returnRate:row.soldUnits?row.returnedUnits/row.soldUnits*100:0,refundGmvRate:0,returnShippingCost:0};}).sort((a,b)=>b.returnedUnits-a.returnedUnits);
  const soldUnits=skus.reduce((x,r)=>x+r.soldUnits,0),returnedUnits=skus.reduce((x,r)=>x+r.returnedUnits,0),refundAmount=skus.reduce((x,r)=>x+r.refundAmount,0),gmv=sales.reduce((x,r)=>x+r.gross_sales,0);
  return {range:{from:input.from,to:input.to},granularity:input.granularity,dimensions:{products:[...new Set(sales.map(r=>r.product_name))],skus:[...new Set(sales.map(r=>r.sku))],returnTypes:[],returnStatuses:[]},soldUnits,returnedUnits,returnRate:soldUnits?returnedUnits/soldUnits*100:0,refundAmount,refundGmvRate:gmv?refundAmount/gmv*100:0,returnShippingCost:0,skuCount:skus.length,returnsCreatedDuringPeriod:returns.filter(r=>r.requested_at>=start&&r.requested_at<=end).reduce((x,r)=>x+r.quantity,0),skus,sources:[{metric:"Sales cohort",source:`Best Buy ${input.store} · Mirakl OR11`},{metric:"Returns / refunds",source:"Mirakl order-line refunds; missing values are not treated as zero"}],totalSoldUnits:soldUnits,sampleUnits:0,commercialSoldUnits:soldUnits};
}
