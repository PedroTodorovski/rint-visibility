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
| `VISIBILITY_API_KEY` | Bearer token for rint-admin → engine |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side only |

Supabase **migration deploy** secrets live in GitHub (`rint-visibility` environments `dev` / `prod`), not Railway.

## rint-admin (future)

When `admin-visibility-shell` ships, set in Cloudflare Workers / wrangler:

```text
VISIBILITY_API_URL=https://visibility.rint.io
```
