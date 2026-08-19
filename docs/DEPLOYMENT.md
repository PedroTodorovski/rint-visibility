# Deployment — rint-visibility

## Environments

| Environment | Railway | Public URL |
|-------------|---------|------------|
| Production | Project `rint-visibility` → service `rint-visibility` | `https://visibility.rint.io` |
| Railway default | Same service | `https://rint-visibility-production.up.railway.app` |

Health check: `GET /health`

## Railway settings

| Setting | Value |
|---------|--------|
| Build | `npm run build` |
| Start | `npm start` |
| Healthcheck path | `/health` |
| Branch | `main` |

## Diagnostic worker

The dominant diagnostics engine is asynchronous. Production must run two Railway services from the same repository:

1. API service: `npm start`
2. Worker service: `npm run start:worker`

Both services need the same runtime variables, including `GEMINI_API_KEY` (and `GEMINI_MODEL` if set). The API enqueues jobs in BullMQ; the worker consumes them and writes job status, evidence, financial risk, and final diagnostics back to Supabase.

`GET /health` reports `diagnostic_queue: "bullmq" | "in_process"`. In production this must be `"bullmq"`, and the worker service must be healthy — otherwise jobs stay `pending`/`running` forever.

Within each job, Gemini queries run with bounded concurrency (`DIAGNOSTIC_QUERY_CONCURRENCY`, default 3) so multi-query diagnoses finish in wall-clock time proportional to batches, not N× sequential calls.

For local development without `REDIS_URL`, the API uses an in-process queue fallback. Do not rely on that fallback in production.

## Custom domain — `visibility.rint.io`

### 1. Railway

Service → **Settings** → **Networking** → **Custom Domain** → add:

```text
visibility.rint.io
```

Copy **both** records shown (CNAME target + TXT verification).

### 2. Cloudflare (`rint.io`)

Add two records (match values from Railway dashboard):

| Type | Name | Content | Proxy |
|------|------|---------|-------|
| CNAME | `visibility` | `….up.railway.app` (from Railway) | **DNS only** (grey cloud) |
| TXT | `_railway-verify.visibility` | `railway-verify=…` (from Railway) | DNS only |

Same pattern as `content.rint.io` / `intelligence.rint.io`.

If SSL stays on "Validating" >10 min: set CNAME to DNS only, wait for green check in Railway, then optionally enable proxy.

If proxied (orange cloud): Cloudflare SSL/TLS mode = **Full** (not Full Strict).

### 3. Verify

```bash
curl https://visibility.rint.io/health
```

Expected: `{"status":"ok","service":"rint-visibility",...}`

## Variables (Railway)

| Variable | Notes |
|----------|--------|
| `PORT` | Injected by Railway |
| `NODE_ENV` | `production` |
| `VISIBILITY_API_KEY` | Bearer token for rint-app → engine |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side only |
| `REDIS_URL` | Required in production for BullMQ diagnostics queue |
| `GEMINI_API_KEY` | Required in production on **API and worker**. Grounded shopper probes. |
| `GEMINI_MODEL` | Optional, defaults to `gemini-2.5-flash`. Same value on API and worker. |
| `GEMINI_COPY_MODEL` | Optional founder-copy model. Same services. |
| `OPENAI_API_KEY` / Perplexity | Next providers on the same diagnostic job — not required until those adapters ship. |
| `DIAGNOSTIC_QUERY_CONCURRENCY` | Optional, defaults to `3` — parallel shopper queries per job |
| `DIAGNOSTIC_JOB_ATTEMPTS` | Optional, defaults to `3` |
| `DIAGNOSTIC_JOB_BACKOFF_MS` | Optional, defaults to `30000` |
| `DIAGNOSTIC_WEBHOOK_SECRET` | Optional shared secret for diagnostic completion webhooks |

Supabase **migration deploy** secrets live in GitHub (`rint-visibility` environments `dev` / `prod`), not Railway.

## rint-app (future)

When `admin-visibility-shell` ships, set in Cloudflare Workers / wrangler:

```text
VISIBILITY_API_URL=https://visibility.rint.io
```
