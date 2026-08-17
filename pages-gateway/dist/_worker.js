/**
 * Cloudflare Pages gateway for bi.saphiant.com.
 *
 * Pages terminates TLS for the externally managed subdomain, then forwards the
 * original request to the production BI Worker through a private Service
 * binding. The Worker keeps ownership of application routing, D1, secrets, and
 * scheduled TikTok synchronization.
 */
export default {
  async fetch(request, env) {
    if (!env.BI_WEB || typeof env.BI_WEB.fetch !== "function") {
      return Response.json(
        {
          error: "BI service binding is unavailable",
          recovery: "Bind BI_WEB to the bi-web Worker and redeploy the Pages project.",
        },
        {
          status: 503,
          headers: { "Cache-Control": "no-store" },
        },
      );
    }

    return env.BI_WEB.fetch(request);
  },
};
