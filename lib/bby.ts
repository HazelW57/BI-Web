import type { Granularity } from "./bi";

type BbyEnv = Env & { BBY_SAP_DB?:D1Database;BBY_JS_DB?:D1Database;BESTBUY_MIRAKL_URL?: string; BESTBUY_SAP_API_KEY?: string; BESTBUY_JS_API_KEY?: string; SESSION_SECRET?:string };
type Obj = Record<string, any>;
type Store = "SAP"|"JS";

function n(value: any) { const raw = value && typeof value === "object" ? value.amount : value; const parsed = Number(raw); return Number.isFinite(parsed) ? parsed : 0; }
function s(...values: any[]) { return String(values.find((value) => value !== undefined && value !== null && String(value).trim()) ?? "").trim(); }
function ts(...values: any[]) { const parsed = Date.parse(s(...values)); return Number.isFinite(parsed) ? parsed : Date.now(); }
function key(date: number, granularity: Granularity) { const d = new Date(date); if (granularity === "daily") return d.toISOString().slice(0,10); if (granularity === "monthly") return d.toISOString().slice(0,7); const day=(d.getUTCDay()+6)%7; d.setUTCDate(d.getUTCDate()-day); return d.toISOString().slice(0,10); }

function tables(store:Store){const prefix=store==="JS"?"bby_js":"bby_sap";return{sales:`${prefix}_sales_lines`,returns:`${prefix}_return_lines`,returnReasons:`${prefix}_return_reasons`,reasonCatalog:`${prefix}_reason_catalog`,windows:`${prefix}_sync_windows`,credentials:`${prefix}_credentials`,exclusions:`${prefix}_excluded_orders`,prefix};}
export function bbyDatabase(env:BbyEnv,store:Store){return store==="JS"?(env.BBY_JS_DB||env.DB):(env.BBY_SAP_DB||env.DB);}

export async function ensureBbySchema(db: D1Database,store:Store) {
  const t=tables(store);
  await db.exec(`CREATE TABLE IF NOT EXISTS ${t.sales} (id TEXT PRIMARY KEY,order_id TEXT NOT NULL,sku TEXT NOT NULL,product_name TEXT NOT NULL,quantity INTEGER NOT NULL,ordered_at INTEGER NOT NULL,gross_sales REAL NOT NULL,status TEXT NOT NULL,raw_json TEXT NOT NULL,updated_at INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS idx_${t.prefix}_sales_date ON ${t.sales}(ordered_at);
  CREATE INDEX IF NOT EXISTS idx_${t.prefix}_sales_order_sku ON ${t.sales}(order_id,sku);
  CREATE TABLE IF NOT EXISTS ${t.returns} (id TEXT PRIMARY KEY,order_id TEXT NOT NULL,line_item_id TEXT,sku TEXT NOT NULL,reason TEXT NOT NULL,quantity INTEGER NOT NULL,refund_amount REAL NOT NULL,status TEXT NOT NULL,requested_at INTEGER NOT NULL,raw_json TEXT NOT NULL,updated_at INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS idx_${t.prefix}_returns_date ON ${t.returns}(requested_at);
  CREATE INDEX IF NOT EXISTS idx_${t.prefix}_returns_order_sku ON ${t.returns}(order_id,sku);
  CREATE TABLE IF NOT EXISTS ${t.windows} (id TEXT PRIMARY KEY,window_start TEXT NOT NULL,window_end TEXT NOT NULL,status TEXT NOT NULL,orders_count INTEGER NOT NULL,returns_count INTEGER NOT NULL,updated_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS ${t.credentials} (id INTEGER PRIMARY KEY CHECK(id=1),ciphertext TEXT NOT NULL,iv TEXT NOT NULL,updated_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS ${t.exclusions} (order_id TEXT PRIMARY KEY,note TEXT NOT NULL DEFAULT '',submitted_by TEXT NOT NULL,created_at INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS idx_${t.prefix}_excluded_created ON ${t.exclusions}(created_at);
  CREATE TABLE IF NOT EXISTS ${t.returnReasons} (id TEXT PRIMARY KEY,return_id TEXT NOT NULL,order_id TEXT NOT NULL,line_item_id TEXT NOT NULL,reason_code TEXT NOT NULL,reason_label TEXT NOT NULL,quantity INTEGER NOT NULL,status TEXT NOT NULL,requested_at INTEGER NOT NULL,raw_json TEXT NOT NULL,updated_at INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS idx_${t.prefix}_reason_line ON ${t.returnReasons}(line_item_id,requested_at);
  CREATE TABLE IF NOT EXISTS ${t.reasonCatalog} (code TEXT PRIMARY KEY,label TEXT NOT NULL,reason_type TEXT NOT NULL,updated_at INTEGER NOT NULL);`);
  const legacy=await db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='bby_sales_lines'`).first();
  if(legacy){
    await db.prepare(`INSERT OR IGNORE INTO ${t.sales}(id,order_id,sku,product_name,quantity,ordered_at,gross_sales,status,raw_json,updated_at) SELECT id,order_id,sku,product_name,quantity,ordered_at,gross_sales,status,raw_json,updated_at FROM bby_sales_lines WHERE store_code=?`).bind(store).run();
    await db.prepare(`INSERT OR IGNORE INTO ${t.returns}(id,order_id,line_item_id,sku,reason,quantity,refund_amount,status,requested_at,raw_json,updated_at) SELECT id,order_id,line_item_id,sku,reason,quantity,refund_amount,status,requested_at,raw_json,updated_at FROM bby_return_lines WHERE store_code=?`).bind(store).run();
    await db.prepare(`INSERT OR IGNORE INTO ${t.windows}(id,window_start,window_end,status,orders_count,returns_count,updated_at) SELECT id,window_start,window_end,status,orders_count,returns_count,updated_at FROM bby_sync_windows WHERE store_code=?`).bind(store).run();
  }
}

export async function listBbyExcludedOrders(db:D1Database,store:Store){await ensureBbySchema(db,store);const t=tables(store);return db.prepare(`SELECT order_id AS orderId,note,submitted_by AS submittedBy,created_at AS createdAt FROM ${t.exclusions} ORDER BY created_at DESC`).all<{orderId:string;note:string;submittedBy:string;createdAt:number}>();}
export async function addBbyExcludedOrders(db:D1Database,store:Store,orderIds:string[],note:string,submittedBy:string){await ensureBbySchema(db,store);const t=tables(store),clean=[...new Set(orderIds.map(value=>value.trim()).filter(Boolean))];if(!clean.length)throw new Error("At least one order ID is required");for(const orderId of clean)await db.prepare(`INSERT INTO ${t.exclusions}(order_id,note,submitted_by,created_at) VALUES(?,?,?,?) ON CONFLICT(order_id) DO UPDATE SET note=excluded.note,submitted_by=excluded.submitted_by,created_at=excluded.created_at`).bind(orderId,note.trim(),submittedBy,Date.now()).run();return{store,submitted:clean.length};}
export async function deleteBbyExcludedOrder(db:D1Database,store:Store,orderId:string){await ensureBbySchema(db,store);const t=tables(store);await db.prepare(`DELETE FROM ${t.exclusions} WHERE order_id=?`).bind(orderId).run();return{store,deleted:true};}

function base64(bytes:Uint8Array){let text="";for(const byte of bytes)text+=String.fromCharCode(byte);return btoa(text);}
function bytes(value:string){const text=atob(value),result=new Uint8Array(text.length);for(let i=0;i<text.length;i++)result[i]=text.charCodeAt(i);return result;}
async function encryptionKey(env:BbyEnv){if(!env.SESSION_SECRET)throw new Error("Credential encryption secret is not configured");const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(env.SESSION_SECRET));return crypto.subtle.importKey("raw",digest,{name:"AES-GCM"},false,["encrypt","decrypt"]);}
export async function configureBbyCredential(env:BbyEnv,store:Store,apiKey:string){await ensureBbySchema(bbyDatabase(env,store),store);if(!apiKey.trim())throw new Error("Mirakl API key is required");const t=tables(store),iv=crypto.getRandomValues(new Uint8Array(12));const ciphertext=await crypto.subtle.encrypt({name:"AES-GCM",iv},await encryptionKey(env),new TextEncoder().encode(apiKey.trim()));await bbyDatabase(env,store).prepare(`INSERT INTO ${t.credentials}(id,ciphertext,iv,updated_at) VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET ciphertext=excluded.ciphertext,iv=excluded.iv,updated_at=excluded.updated_at`).bind(base64(new Uint8Array(ciphertext)),base64(iv),Date.now()).run();return {store,configured:true};}
async function credential(env: BbyEnv, store: Store) {const t=tables(store);const saved=(await bbyDatabase(env,store).prepare(`SELECT ciphertext,iv FROM ${t.credentials} WHERE id=1`).first<{ciphertext:string;iv:string}>())||(await env.DB.prepare(`SELECT ciphertext,iv FROM ${t.credentials} WHERE id=1`).first<{ciphertext:string;iv:string}>());if(saved){const plaintext=await crypto.subtle.decrypt({name:"AES-GCM",iv:bytes(saved.iv)},await encryptionKey(env),bytes(saved.ciphertext));return new TextDecoder().decode(plaintext);}const apiKey = store === "JS" ? env.BESTBUY_JS_API_KEY : env.BESTBUY_SAP_API_KEY; if (!apiKey) throw new Error(`Best Buy ${store} Mirakl secret is not configured`); return apiKey; }
async function mirakl(env: BbyEnv, store: Store, path: string, params: Record<string,string>) {
  const base=(env.BESTBUY_MIRAKL_URL || "https://bestbuyus-prod.mirakl.net").replace(/\/$/,""); const url=new URL(`${base}${path}`); Object.entries(params).forEach(([k,v])=>url.searchParams.set(k,v));
  const token=await credential(env,store); let response=await fetch(url,{headers:{Authorization:token,Accept:"application/json"}});
  if(response.status===401||response.status===403) response=await fetch(url,{headers:{Authorization:`Bearer ${token}`,Accept:"application/json"}});
  if(!response.ok) throw new Error(`Mirakl ${path} ${response.status}`); return response.json() as Promise<Obj>;
}

async function runBatches(db:D1Database, statements:D1PreparedStatement[]){for(let index=0;index<statements.length;index+=50)await db.batch(statements.slice(index,index+50));}

export async function syncBbyReturnReasons(env:BbyEnv,store:Store,from:string,to:string){
  const t=tables(store),now=Date.now();
  const catalog=await mirakl(env,store,"/api/reasons",{locale:"en_US"});
  const catalogRows=((catalog.reasons||catalog.data||[]) as Obj[]).filter(reason=>s(reason.code));
  await runBatches(bbyDatabase(env,store),catalogRows.map(reason=>bbyDatabase(env,store).prepare(`INSERT OR REPLACE INTO ${t.reasonCatalog}(code,label,reason_type,updated_at) VALUES(?,?,?,?)`).bind(s(reason.code),s(reason.label,reason.code),s(reason.type),now)));
  const labels=await bbyDatabase(env,store).prepare(`SELECT code,label FROM ${t.reasonCatalog}`).all<{code:string;label:string}>(),labelMap=new Map(labels.results.map(row=>[row.code,row.label]));
  let token="",offset=0,mapped=0,pages=0;
  for(let page=0;page<500;page++){
    const params:Record<string,string>={return_creation_date_from:`${from}T00:00:00Z`,return_creation_date_to:`${to}T23:59:59Z`,max:"100"};
    if(token)params.page_token=token;else if(offset)params.offset=String(offset);
    const data=await mirakl(env,store,"/api/returns",params),items=((data.data||data.returns||[]) as Obj[]),statements:D1PreparedStatement[]=[];
    for(const item of items){
      const returnId=s(item.id,item.return_id),orderId=s(item.order_id,item.order_commercial_id),requestedAt=ts(item.date_created,item.created_date,item.return_creation_date);
      for(const line of (item.return_lines||item.lines||[]) as Obj[]){
        const lineId=s(line.order_line_id,line.orderline_id,line.id),reasonCode=s(line.reason_code,line.return_reason_code,item.reason_code,"UNSPECIFIED"),reasonLabel=labelMap.get(reasonCode)||s(line.reason_label,line.reason,reasonCode);
        if(!returnId||!lineId)continue;
        statements.push(bbyDatabase(env,store).prepare(`INSERT INTO ${t.returnReasons} VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET order_id=excluded.order_id,line_item_id=excluded.line_item_id,reason_code=excluded.reason_code,reason_label=excluded.reason_label,quantity=excluded.quantity,status=excluded.status,requested_at=excluded.requested_at,raw_json=excluded.raw_json,updated_at=excluded.updated_at`).bind(`${returnId}:${lineId}`,returnId,orderId,lineId,reasonCode,reasonLabel,Math.max(1,n(line.quantity)||1),s(item.state,item.status,"UNKNOWN"),requestedAt,JSON.stringify({return:item,line}),now));
        mapped++;
      }
    }
    await runBatches(bbyDatabase(env,store),statements);pages++;
    token=s(data.next_page_token,data.nextPageToken);
    const total=n(data.total_count)||n(data.total);
    if(token)continue;
    offset+=items.length;
    if(items.length<100||(total&&offset>=total))break;
  }
  return {mapped,pages,catalog:catalogRows.length};
}

export async function syncBby(env: BbyEnv, store: Store, from: string, to: string) {
  const db=bbyDatabase(env,store);await ensureBbySchema(db,store);const t=tables(store),windowId=`${from}:${to}`;
  const existing=await db.prepare(`SELECT status FROM ${t.windows} WHERE id=?`).bind(windowId).first<{status:string}>();
  if(existing?.status==="success")return {store,orders:0,returns:0,skipped:true};
  let offset=0,ordersCount=0,returnsCount=0;
  for(let page=0;page<500;page++){
    const data=await mirakl(env,store,"/api/orders",{start_date:`${from}T00:00:00Z`,end_date:`${to}T23:59:59Z`,max:"100",offset:String(offset),order_tax_mode:"TAX_INCLUDED"});
    const orders=(data.orders||[]) as Obj[],statements:D1PreparedStatement[]=[];
    for(const order of orders){const orderId=s(order.order_id,order.id),orderedAt=ts(order.created_date,order.date_created);
      for(const line of (order.order_lines||[]) as Obj[]){const lineId=s(line.order_line_id,line.id),sku=s(line.offer_sku,line.product_sku,line.product?.sku,"UNKNOWN-SKU"),quantity=Math.max(1,n(line.quantity)||1),gross=n(line.price)||n(line.unit_price)*quantity;
        statements.push(db.prepare(`INSERT INTO ${t.sales} VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET sku=excluded.sku,product_name=excluded.product_name,quantity=excluded.quantity,gross_sales=excluded.gross_sales,status=excluded.status,raw_json=excluded.raw_json,updated_at=excluded.updated_at`).bind(`${store}:${lineId}`,orderId,sku,s(line.product_title,line.product?.title,sku),quantity,orderedAt,gross,s(line.order_line_state,order.order_state),JSON.stringify({order,line}),Date.now()));ordersCount++;
        for(const refund of (line.refunds||[]) as Obj[]){const id=s(refund.refund_id,refund.id,`${lineId}:${refund.created_date||refund.date_created||refund.reason_code}`),qty=Math.max(1,n(refund.quantity)||1);statements.push(db.prepare(`INSERT INTO ${t.returns} VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET reason=excluded.reason,quantity=excluded.quantity,refund_amount=excluded.refund_amount,status=excluded.status,raw_json=excluded.raw_json,updated_at=excluded.updated_at`).bind(`${store}:${id}`,orderId,lineId,sku,s(refund.reason_label,refund.reason_code,"Refund"),qty,n(refund.amount)||n(refund.refund_amount),s(refund.state,refund.status,"REFUNDED"),ts(refund.created_date,refund.date_created,order.last_updated_date),JSON.stringify(refund),Date.now()));returnsCount++;}
      }
    }
    await runBatches(db,statements);if(orders.length<100)break;offset+=orders.length;
  }
  await db.prepare(`INSERT INTO ${t.windows} VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status='success',orders_count=excluded.orders_count,returns_count=excluded.returns_count,updated_at=excluded.updated_at`).bind(windowId,from,to,"success",ordersCount,returnsCount,Date.now()).run();
  return {store,orders:ordersCount,returns:returnsCount,skipped:false};
}

export async function getBbyReturns(db:D1Database, input:{store:string;from:string;to:string;granularity:Granularity;sku?:string}) {
  const store:Store=input.store==="JS"?"JS":"SAP",t=tables(store);
  // Each BBY storefront has an independent D1 database. A read may be the
  // first request after a new schema version is deployed, so apply the
  // idempotent storefront schema before querying optional/newer tables.
  await ensureBbySchema(db,store);
  const start=Date.parse(`${input.from}T00:00:00Z`),end=Date.parse(`${input.to}T23:59:59Z`);
  if(!Number.isFinite(start)||!Number.isFinite(end)||start>end)throw new Error("Invalid Best Buy date range");
  const [salesResult,returnsResult,createdResult,excludedResult,coverageResult]=await db.batch([
    db.prepare(`SELECT order_id,sku,product_name,quantity,ordered_at,gross_sales,status FROM ${t.sales} WHERE ordered_at BETWEEN ? AND ?`).bind(start,end),
    db.prepare(`SELECT r.id,r.order_id,r.line_item_id,r.sku,r.reason AS workflow_reason,
      (SELECT rr.reason_label FROM ${t.returnReasons} rr
       WHERE rr.line_item_id=r.line_item_id AND (rr.order_id=r.order_id OR rr.order_id='')
         AND UPPER(rr.reason_code) NOT IN ('REFUND_FOR_RETURN','REFUND_ON_ISSUE')
       ORDER BY rr.requested_at DESC LIMIT 1) AS customer_reason,
      CASE WHEN EXISTS(SELECT 1 FROM ${t.returnReasons} rr
       WHERE rr.line_item_id=r.line_item_id AND (rr.order_id=r.order_id OR rr.order_id='')
         AND UPPER(rr.reason_code) NOT IN ('REFUND_FOR_RETURN','REFUND_ON_ISSUE')) THEN 1 ELSE 0 END AS reason_mapped,
      r.quantity,r.refund_amount,r.status,r.requested_at,r.raw_json
      FROM ${t.returns} r WHERE EXISTS (SELECT 1 FROM ${t.sales} s WHERE s.order_id=r.order_id AND s.sku=r.sku AND s.ordered_at BETWEEN ? AND ?)`).bind(start,end),
    db.prepare(`SELECT COALESCE(SUM(quantity),0) AS count FROM ${t.returns} WHERE requested_at BETWEEN ? AND ?`).bind(start,end),
    db.prepare(`SELECT order_id AS orderId FROM ${t.exclusions}`),
    db.prepare(`SELECT MAX(ordered_at) AS latest FROM ${t.sales}`),
  ]);
  const sales=salesResult.results;
  const validSales=sales.filter(row=>!/(CANCEL|CANCELED|CANCELLED|REFUSED|REJECTED)/i.test(String(row.status||"")));
  const excludedOrders=new Set(excludedResult.results.map(row=>row.orderId));
  const commercialSales=validSales.filter(row=>!excludedOrders.has(row.order_id));
  const returns=returnsResult.results;
  const bySku=new Map<string,any>(); for(const sale of commercialSales){if(input.sku&&input.sku!=="ALL"&&sale.sku!==input.sku)continue; const row=bySku.get(sale.sku)||{sku:sale.sku,productName:sale.product_name,soldUnits:0,returnedUnits:0,refundAmount:0,reasons:new Map(),reasonMappedUnits:0,workflowRefundUnits:0,workflowDuplicateUnits:0,workflowMissingReasonUnits:0,trend:new Map()}; row.soldUnits+=sale.quantity; const k=key(sale.ordered_at,input.granularity); const bucket=row.trend.get(k)||{key:k,soldUnits:0,returnedUnits:0,returnRate:0};bucket.soldUnits+=sale.quantity;row.trend.set(k,bucket);bySku.set(sale.sku,row);}
  for(const ret of returns){if(excludedOrders.has(ret.order_id))continue;const row=bySku.get(ret.sku);if(!row)continue; row.returnedUnits+=ret.quantity;row.refundAmount+=ret.refund_amount;
    // Customer return reasons and refund workflow codes are separate domains. Never
    // use the latter as a label fallback or in the customer-reason denominator.
    if(ret.reason_mapped&&ret.customer_reason){row.reasonMappedUnits+=ret.quantity;row.reasons.set(ret.customer_reason,(row.reasons.get(ret.customer_reason)||0)+ret.quantity);}
    if(/^(REFUND_FOR_RETURN|REFUND_ON_ISSUE)$/i.test(String(ret.workflow_reason||""))){row.workflowRefundUnits+=ret.quantity;if(ret.reason_mapped)row.workflowDuplicateUnits+=ret.quantity;else row.workflowMissingReasonUnits+=ret.quantity;}
    const sale=commercialSales.find(x=>x.order_id===ret.order_id&&x.sku===ret.sku);if(sale){const bucket=row.trend.get(key(sale.ordered_at,input.granularity));if(bucket)bucket.returnedUnits+=ret.quantity;}}
  const skus=[...bySku.values()].map(row=>{const reasons=[...row.reasons.entries()].map(([reason,count]:any)=>({reason,count,share:row.reasonMappedUnits?count/row.reasonMappedUnits*100:0,refundAmount:0,rawReasons:[{reason,count}]})).sort((a,b)=>b.count-a.count);const trend=[...row.trend.values()].sort((a:any,b:any)=>a.key.localeCompare(b.key)).map((t:any)=>({...t,returnRate:t.soldUnits?t.returnedUnits/t.soldUnits*100:0}));return {...row,reasons,trend,reasonTrend:[],reasonCoverage:{mappedUnits:row.reasonMappedUnits,totalUnits:row.returnedUnits,rate:row.returnedUnits?row.reasonMappedUnits/row.returnedUnits*100:0},reasonAudit:{workflowUnits:row.workflowRefundUnits,duplicateUnits:row.workflowDuplicateUnits,unavailableReasonUnits:row.workflowMissingReasonUnits},returnRate:row.soldUnits?row.returnedUnits/row.soldUnits*100:0,refundGmvRate:0,returnShippingCost:0};}).sort((a,b)=>b.returnedUnits-a.returnedUnits);
  const selectedValid=validSales.filter(r=>!input.sku||input.sku==="ALL"||r.sku===input.sku),selectedCommercial=commercialSales.filter(r=>!input.sku||input.sku==="ALL"||r.sku===input.sku);const totalSoldUnits=selectedValid.reduce((x,r)=>x+r.quantity,0),soldUnits=skus.reduce((x,r)=>x+r.soldUnits,0),returnedUnits=skus.reduce((x,r)=>x+r.returnedUnits,0),refundAmount=skus.reduce((x,r)=>x+r.refundAmount,0),gmv=selectedCommercial.reduce((x,r)=>x+r.gross_sales,0),orderCount=new Set(selectedValid.map(r=>r.order_id)).size,commercialOrderCount=new Set(selectedCommercial.map(r=>r.order_id)).size,eligibleReturns=returns.filter(row=>!excludedOrders.has(row.order_id)&&(!input.sku||input.sku==="ALL"||row.sku===input.sku)),reasonMappedUnits=eligibleReturns.filter(row=>row.reason_mapped).reduce((sum,row)=>sum+row.quantity,0);
  return {range:{from:input.from,to:input.to},dataThrough:coverageResult.results[0]?.latest?new Date(coverageResult.results[0].latest).toISOString().slice(0,10):null,granularity:input.granularity,dimensions:{products:[...new Set(commercialSales.map(r=>r.product_name))],skus:[...new Set(commercialSales.map(r=>r.sku))],returnTypes:[],returnStatuses:[]},orderCount,commercialOrderCount,excludedOrderCount:orderCount-commercialOrderCount,excludedUnits:totalSoldUnits-soldUnits,soldUnits,returnedUnits,returnRate:soldUnits?returnedUnits/soldUnits*100:0,refundAmount,refundGmvRate:gmv?refundAmount/gmv*100:0,returnShippingCost:0,skuCount:skus.length,returnsCreatedDuringPeriod:eligibleReturns.filter(row=>row.requested_at>=start&&row.requested_at<=end).reduce((sum,row)=>sum+row.quantity,0),reasonCoverage:{mappedUnits:reasonMappedUnits,totalUnits:returnedUnits,rate:returnedUnits?reasonMappedUnits/returnedUnits*100:0},skus,sources:[{metric:"Orders",source:`Best Buy ${input.store} · distinct Mirakl order_id`},{metric:"Commercial Orders / Units",source:"Mirakl sales minus submitted excluded-order register"},{metric:"Return reasons",source:`Best Buy ${input.store} Mirakl Returns API + platform reason catalog; ${reasonMappedUnits}/${returnedUnits} returned units mapped`},{metric:"Returns / refunds",source:"Sales cohort after excluded orders; missing values are not treated as zero"}],totalSoldUnits,sampleUnits:totalSoldUnits-soldUnits,commercialSoldUnits:soldUnits};
}
