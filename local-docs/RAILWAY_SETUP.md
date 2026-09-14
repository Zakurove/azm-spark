# Azm SPARK — Railway Setup

**Status:** Live
**First deployed:** 2026-09-14
**Railway project:** `azm-spark` — https://railway.com/project/23a13025-1b56-41d5-b15a-b16cb6b1e495
**Live URL:** https://web-production-a88aa.up.railway.app
**Future domain:** `azm-spark.gymwise.ai` (referenced by the KSCDR poster QR)

One service (`web`) runs the whole product: the Vite-built client and the Node account API
together (`npm run build` → `npm start`, serving `dist/` + API from one origin).

## Environment variables (service `web`)

| Var | Value | Why |
|-----|-------|-----|
| `HOST` | `0.0.0.0` | Server defaults to loopback; Railway needs all interfaces |
| `NODE_ENV` | `production` | Secure cookies |
| `AZM_ORIGIN` | `https://web-production-a88aa.up.railway.app` | Exact origin for the same-origin mutation check. **Must be updated when the custom domain is added, or sign-in breaks** |
| `AZM_DATABASE` | `/data/azm.sqlite` | SQLite on the persistent volume |

Volume `web-volume` mounted at `/data` keeps accounts and records across deploys.

## Deploying updates

```bash
cd ~/Development/Azm5.0
railway up --ci --service web
```

CLI-only deploys (no GitHub connection). Commit before deploying.

## Custom domain (when ready)

```bash
railway domain azm-spark.gymwise.ai --service web
# then point DNS per Railway's instructions, and:
railway variables --set "AZM_ORIGIN=https://azm-spark.gymwise.ai" --service web
```

The `AZM_ORIGIN` update is mandatory after cutover (mutations 403 otherwise). It takes
effect on the next deploy or restart (`railway redeploy -y`).

## Demo deep links

| URL | What it shows |
|-----|----------------|
| `/` | Landing page (AR default, EN toggle) |
| `/?demo=1&autostart=1` | Instant guided demo, chair profile, no account or camera |
| `/?demo=1&autostart=1&profile=wheelchair` | Instant demo with the wheelchair profile |
| `/?demo=1&autostart=1&profile=hemiparesis_right` | Demo with right-side support profile |
| `/?lang=en` | English |
| `/?app=1` | Skip landing, straight to sign-in |

Demo sessions run the real scoring engine on synthetic movement and never write to
personal history.

## Verified after deploy (2026-09-14)

Landing (AR/EN), account registration against the live API (origin check + cookies +
SQLite volume), intake form load, and the wheelchair demo (calibration + live scoring),
all via headless browser against the production URL. 52 automated tests pass locally.
