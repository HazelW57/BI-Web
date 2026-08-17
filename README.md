# Saphiant Commerce BI

Internal BI portal for `bi.saphiant.com`, deployed through Cloudflare Pages to a Cloudflare Worker with a Cloudflare D1 database.

## Modules

- BBY, Walmart, and Price Verification navigation placeholders
- TTS P&L Summary with month and SKU views
- TTS R&R with return rate and return-reason share by SKU
- TTS Data Health with manual and scheduled TikTok Shop sync status
- Settings for Hazel-only access management and CSV data uploads

## Data flow

TikTok Shop Order, Returns, and Finance APIs are synchronized into D1. Finance transactions are matched to order lines by:

1. `order_id + line_item_id`
2. `order_id + seller_sku` when the finance record has no usable line-item ID

P&L uses Finance API net sales and settlement values when matched, then falls back to the order-side estimate. Product cost and Video/LIVE agency fees are uploaded from the templates in `public/templates/`; a successful upload is immediately reflected in the next P&L query.

## Local development

Requires Node.js 22.13+ and pnpm.

```bash
pnpm install --frozen-lockfile
cp .env.example .dev.vars
pnpm run db:migrate:local
pnpm run dev
```

Do not commit `.dev.vars` or real credentials.

## Validation

```bash
pnpm run cf:typegen
pnpm run lint
pnpm run test
pnpm exec wrangler deploy --dry-run
```

## Cloudflare deployment

The production application Worker is configured in `wrangler.jsonc`:

- Worker: `bi-web`
- D1: `saphiant-bi` bound as `DB`
- TikTok scheduled sync: every six hours

`pages-gateway/` is the Git-connected Cloudflare Pages entry point for the
custom domain. Pages terminates TLS for `bi.saphiant.com` without moving the
`saphiant.com` nameservers, then forwards requests to `bi-web` through the
private `BI_WEB` Service binding. The Worker continues to own the application,
D1 binding, encrypted secrets, and scheduled synchronization.

Pages project settings:

- Project: `saphiant-bi-pages`
- Root directory: `pages-gateway`
- Build command: leave blank
- Build output directory: `dist`
- Production branch: `main`
- Service binding: `BI_WEB` -> `bi-web`
- Custom domain: `bi.saphiant.com`

Apply the D1 migration before the first release:

```bash
pnpm run db:migrate:remote
```

Configure these as encrypted Worker secrets:

- `SESSION_SECRET`
- `PRIMARY_BOOTSTRAP_PASSWORD`
- `RECOVERY_BOOTSTRAP_PASSWORD`
- `TIKTOK_APP_KEY`
- `TIKTOK_APP_SECRET`
- `TIKTOK_ACCESS_TOKEN`
- `TIKTOK_SHOP_CIPHER`

Then deploy with:

```bash
pnpm run deploy
```
