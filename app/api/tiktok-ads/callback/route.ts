const CALLBACK_URL = "https://bi.saphiant.com/api/tiktok-ads/callback";

function page(title: string, message: string, status = 200) {
  const body = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{margin:0;background:#f3f7fd;color:#10284a;font:16px/1.6 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:grid;min-height:100vh;place-items:center}.card{width:min(560px,calc(100vw - 48px));background:#fff;border:1px solid #d8e5f5;border-radius:22px;padding:34px;box-shadow:0 22px 60px rgba(30,79,145,.12)}.mark{color:#2365df;font-size:13px;font-weight:800;letter-spacing:.14em;text-transform:uppercase}h1{font-size:28px;line-height:1.2;margin:10px 0}p{color:#5d708d;margin:0}.url{margin-top:22px;padding:12px 14px;background:#edf4ff;border-radius:10px;color:#174caa;font:13px ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere}</style></head><body><main class="card"><div class="mark">Saphiant · TikTok Marketing API</div><h1>${title}</h1><p>${message}</p><div class="url">${CALLBACK_URL}</div></main></body></html>`;
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const error = url.searchParams.get("error") || url.searchParams.get("error_description");
  if (error) return page("TikTok Ads authorization was not completed", "TikTok returned an authorization error. No token was stored.", 400);

  const authCode = url.searchParams.get("auth_code");
  if (!authCode) return page("Callback endpoint is ready", "This production HTTPS endpoint is online and ready to receive TikTok Ads authorization callbacks.");

  return page("Authorization received", "The callback reached Saphiant successfully. Token exchange will be enabled after the TikTok Ads application credentials are issued.", 202);
}
