# rint-visibility

Rint v1 **engine API** — weekly AI visibility probes (ChatGPT + Gemini), score, catalog fixes.

- **Stack:** Fastify 5, TypeScript, Supabase (`rint` schema)
- **Deploy:** Railway — `https://api.rint.io` (see `docs/DEPLOYMENT.md`)
- **No UI** — consumed by [`rint-admin`](https://github.com/PedroTodorovski/rint-admin)
- **Migrations SSOT** — `supabase/migrations/` in **this repo** (ADR-002)

## Database

- Governance: `docs/database/GOVERNANCE.md`
- Deploy: GitHub Actions → **Database Deploy** (environments `dev` / `prod` on **this repo**)
- Verify: `npm run db:guard && npm test`
- Secrets: GitHub **Settings → Environments** on this repo — not rint-admin

## Quick start

```bash
npm install
cp .env.example .env.local
npm run dev
curl http://localhost:3010/health
```

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Local server with reload |
| `npm run typecheck` | TypeScript |
| `npm test` | Vitest |
| `npm run db:guard` | Migration safety checks |
| `npm run build && npm start` | Production (Railway) |

## Boundaries

- **All** Supabase `rint.*` SQL lives here — never in rint-admin
- Bearer auth via `VISIBILITY_API_KEY` (wired in MVP slice)
- Legacy repos (`rint-intelligence`, etc.) are parked — do not import

## Related

| Repo | Role |
|------|------|
| `rint-admin` | Admin UI + D1 (auth, billing, CMS) |
| `rint` | Landing |

Harness docs: [`rint-admin/docs/harness/`](https://github.com/PedroTodorovski/rint-admin/tree/main/docs/harness) (Rint platform SSOT)
