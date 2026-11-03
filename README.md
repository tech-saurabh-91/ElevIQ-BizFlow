# ElevIQ SFA

**Multi-tenant Sales Force Automation + Order & Invoice SaaS** — a Platform Admin Panel for the service provider and a per-company Workspace for sales, collections and field teams.

> Phases 1–9 complete: core platform → company masters → catalog → orders → inventory → field force → documents → reports & notifications → **production hardening & deploy**.

## Features

**Platform console** (`/platform`) — companies & lifecycle (trial/active/suspended/expired), subscription plans, platform audit logs, announcements, platform-wide reports (growth, plan adoption, user headcount, audit activity).

**Company workspace** (`/app`) — role-gated modules:

| Area | What it covers |
|---|---|
| Dashboard | Sales, collections, overdue receivables, low stock, visit coverage |
| Masters | Customers, products, price lists, suppliers, routes/territories, warehouses |
| Sales | Quotes → orders (approval workflow) → invoices → credit notes → payments |
| Inventory | Stock balances, adjustments, transfers, GRN/PO, low-stock alerts |
| Field force | Daily plans, visits with geo check-in, attendance, expenses, targets |
| Reports | Sales, receivables, collections, inventory, field force — charts + Excel/JSON export |
| Notifications | In-app inbox (unread counts, filters, overdue reminders) |
| Settings | Company profile, users & roles, tax/numbering, sessions & security |

## Tech stack

- **Server**: Node.js LTS · Express 4 (ESM) · Mongoose · MongoDB Atlas · Zod validation on every endpoint · JWT (15 m access + 7 d rotating refresh cookie) · bcrypt · helmet/CORS/rate-limit/mongo-sanitize/hpp · winston · node-cron · pdfkit · exceljs · swagger-ui
- **Client**: Vite · React 18 · React Router · TanStack Query · Axios · Zustand · Tailwind v3 · Recharts · React Hook Form + Zod
- **Tenancy**: single database (`SFA_ERP`), shared collections, `companyId` on every document, AsyncLocalStorage tenant scope that fails closed (`TENANT_SCOPE_MISSING`), soft deletes with hard-delete blocked by default.

## Repository layout

```
SFA/
├── server/           # Express API (src/{config,models,controllers,services,routes,middlewares,validators,utils,jobs,seeders})
│   ├── Dockerfile
│   └── tests/        # Jest + supertest + mongodb-memory-server
├── client/           # Vite React SPA (src/{api,components,pages,hooks,store,routes,utils})
│   ├── Dockerfile
│   └── nginx.conf    # SPA + /api reverse proxy (production image)
├── docker-compose.yml
├── ecosystem.config.js   # PM2 (API cluster)
└── .env.example      # reference environment for the whole monorepo
```

## Quickstart (development)

**Prerequisites**: Node.js ≥ 20, npm, a MongoDB database (Atlas or local).

```bash
# 1. configure the API
cp server/.env.example server/.env
#    edit server/.env → set MONGO_URI, DB_NAME, JWT_* secrets, SUPER_ADMIN_*

# 2. install
npm install                 # root (lint/format tooling)
npm install --prefix server
npm install --prefix client

# 3. seed plans, super admin and the demo company
npm run seed

# 4. run both apps (server :5000, client :5173)
npm run dev
```

Open http://localhost:5173.

**Demo credentials** (created by `npm run seed`):

| Workspace | Login |
|---|---|
| Company | `admin@demotraders.com` / `Eleviq@123`, company code `DEMO01` (also `manager@`, `amit@`, `sneha@`, `accountant@`, `warehouse@` …) |
| Platform | `superadmin@eleviqsfa.com` / value of `SUPER_ADMIN_PASSWORD` (default `ChangeMe#SuperAdmin1`) |

> **Quoting `#`**: dotenv treats a bare `#` as a comment — keep `SUPER_ADMIN_PASSWORD="ChangeMe#SuperAdmin1"` quoted in `.env`.

## Scripts

| Where | Command | Purpose |
|---|---|---|
| root | `npm run dev` | server + client together (concurrently) |
| root | `npm test` | full server test suite |
| root | `npm run lint` / `npm run format` | ESLint / Prettier |
| server | `npm run dev` | API with nodemon |
| server | `npm start` | API (production, plain node) |
| server | `npm run seed` | idempotent seed (plans, super admin, demo company) |
| server | `npm test` / `npm run test:watch` | Jest (in-memory MongoDB — never touches Atlas) |
| client | `npm run dev` / `build` / `preview` | Vite dev server / production bundle |

## Configuration

All configuration comes from the environment — **no credentials in code**. Copy `server/.env.example` → `server/.env` (the server reads it; the root `.env.example` mirrors it for compose).

| Variable | Notes |
|---|---|
| `MONGO_URI`, `DB_NAME` | MongoDB connection (Atlas). Tests refuse to run against non-local URIs. |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | ≥ 32 random chars each (`openssl rand -base64 48`) |
| `JWT_ACCESS_EXPIRES` / `JWT_REFRESH_EXPIRES` | defaults `15m` / `7d` |
| `COOKIE_SECURE`, `COOKIE_SAME_SITE`, `CORS_ORIGINS` | `COOKIE_SECURE=true` behind HTTPS; origins comma-separated |
| `RATE_LIMIT_*`, `AUTH_RATE_LIMIT_MAX` | global + auth-brute-force limits |
| `SUPER_ADMIN_EMAIL/PASSWORD/NAME` | seeded platform console login (quote values containing `#`) |
| `SMTP_URL` | full SMTP URL (`smtps://user:pass@host:465`). **Blank = email disabled**: password reset then returns a dev link instead of sending mail. |
| `EMAIL_FROM`, `APP_URL` | From-header and public URL used to build reset links |
| `MAX_UPLOAD_MB`, `UPLOAD_DIR`, `LOG_LEVEL` | uploads and logging |

**Email**: set `SMTP_URL` to enable outbound mail (password reset today; the `mailer.js` service is the single send path for future notifications). Without it the API logs the reset link in non-production environments so QA can complete the flow.

## API, health & docs

| Endpoint | Purpose |
|---|---|
| `GET /health` | liveness (app up, uptime) |
| `GET /live` | minimal liveness probe |
| `GET /ready` | readiness — 503 until MongoDB is connected |
| `GET /api-docs` | Swagger UI (all REST endpoints) |
| `/api/auth/*` | shared login/refresh/logout, forgot/reset password, sessions |
| `/api/platform/*` | platform console API |
| `/api/v1/*` | company workspace API |

Responses are consistent: `{ success, message, data?, meta? }` / `{ success:false, code, message, errors[] }`.

## Production deployment

### Option A — Docker Compose (recommended)

```bash
cp .env.example .env        # fill MONGO_URI, JWT secrets, SUPER_ADMIN_*
docker compose up --build -d
# web  → http://localhost:8080  (nginx: SPA + /api proxy, same-origin cookies)
# api  → http://localhost:5000  (optional direct port)
docker compose ps           # api shows healthy when /health passes
```

- The **web** container builds `client/dist` and serves it with `client/nginx.conf`, which reverse-proxies `/api`, `/uploads`, `/health`, `/ready`, `/api-docs` to the **api** container — refresh cookies stay same-origin.
- Uploads persist in the `uploads-data` volume; logs go to stdout (docker log driver).
- Seeding a fresh database: `docker compose exec api node src/seeders/index.js`.

### Option B — PM2 (VPS without Docker)

```bash
# build the client
npm run build --prefix client
# serve client/dist with nginx/Caddy and proxy /api → 127.0.0.1:5000
# (same directives as client/nginx.conf, proxy_pass → 127.0.0.1:5000)

cp server/.env.example server/.env   # NODE_ENV=production + secrets
npm ci --omit=dev --prefix server
pm2 start ecosystem.config.js --env production
pm2 save && pm2 startup               # survive reboots
```

### Production checklist

- [ ] `NODE_ENV=production`, strong `JWT_*` secrets, `SUPER_ADMIN_PASSWORD` changed (quoted if it contains `#`)
- [ ] `COOKIE_SECURE=true` and `CORS_ORIGINS` set to the exact HTTPS origin(s) (only needed if web and API are on different origins)
- [ ] `APP_URL` = public HTTPS URL (reset links)
- [ ] MongoDB: IP allow-list / VPC, least-privilege DB user, Atlas continuous backups
- [ ] TLS terminated at your reverse proxy (nginx/Caddy/Cloudflare)
- [ ] `LOG_LEVEL=info` with a log shipper; `/health` + `/ready` wired into uptime checks
- [ ] Rate limits are per-IP behind a proxy — `trust proxy` is already set to `1`
- [ ] `SMTP_URL` configured if you want password-reset emails in production

## Backup & restore (MongoDB Atlas)

The entire product state lives in one database (`DB_NAME`, default `SFA_ERP`).

```bash
# backup (requires local mongodump from MongoDB Database Tools)
mongodump "$MONGO_URI" --db SFA_ERP --gzip --out ./backups/$(date +%Y%m%d)

# restore into the same or a fresh cluster
mongorestore "$MONGO_URI" --db SFA_ERP --gzip --drop ./backups/20261103/SFA_ERP
```

- **Atlas UI → Backups**: enable continuous snapshots + set a restore point — recommended for production.
- Also back up the `uploads/` volume (invoice PDFs, photos): `docker compose cp eleviq-sfa_api-1:/app/uploads ./uploads-backup`.
- `npm run seed` is idempotent — safe to re-run after a restore to top up plans/defaults.

## Security model (summary)

- **Auth**: JWT access (15 m, in memory) + refresh (7 d, httpOnly cookie, rotation with reuse detection and a 60 s grace window), bcrypt cost 12, account lockout after repeated failures.
- **Tenant isolation**: request-scoped `companyId` injected into every query/update by a Mongoose plugin — fail-closed if missing; cross-tenant reads require an explicit `.skipTenant()` escape hatch used only by platform code and cron jobs.
- **RBAC**: platform roles (`SUPER_ADMIN`, `PLATFORM_SUPPORT`) and company roles (`COMPANY_ADMIN`, `MANAGER`, `SALESMAN`, `ACCOUNTANT`, `WAREHOUSE`); route-level permission guards in the UI and `authorize()` middleware on the API.
- **Hardening**: helmet + CSP, CORS whitelist, `express-mongo-sanitize`, `hpp`, body-size limits, global + auth rate limits, Zod validation on every endpoint, structured request IDs/logs, central error handler, graceful shutdown with SIGTERM drain.

## Tests

```bash
npm test                     # from server/ or repo root — 12+ suites
node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand tests/auth.test.js
```

Tests boot an **in-memory MongoDB** (never Atlas) and assert tenant isolation, RBAC, validation, report numbers, notification rules and the password-reset flow.

## License

Private — ElevIQ SFA.
