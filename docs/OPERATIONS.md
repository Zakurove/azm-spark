# Azm — operations and verification

8 September 2026. This is a local implementation handoff, not a public deployment record.

## Run and build

Node 22.18+; `npm install`; `npm run dev` serves http://localhost:5205. The default page is sign-in. Create a new account for this installation or explore the labeled demonstration. Hosted Azm 2.0 credentials have not been imported.

`npm run build` compiles the client into `dist/` and bundles the server into `.runtime/server.mjs`. `npm start` runs both together. Stop the development server first or use a different `PORT`. Production defaults to loopback; `HOST` changes the bind address. No public exposure is configured by this document.

| Variable | Meaning |
|---|---|
| `AZM_DATABASE` | SQLite file path; defaults to `.data/azm.sqlite` |
| `PORT` | Built server port; defaults to 5205 |
| `HOST` | Built server bind address; defaults to 127.0.0.1 |
| `AZM_ORIGIN` | Exact trusted origin for mutations; set to the public HTTPS origin behind a proxy |
| `NODE_ENV=production` | Enables Secure session cookies; requires HTTPS for deployed use |

Preserve the database across restarts. Use a consistent SQLite backup process and protect backups as health data. Do not include `.data`, `.runtime`, `.env` or credentials in shared artifacts. The database has owner-only permissions but is not encrypted by the application.

## Data boundary

The server stores accounts, consented health history, plans, workout progression and derived real-set records. Browser localStorage holds presentation/speech preferences, not the new medical profile. Camera pixels, raw landmark streams and calibration frames remain in the browser. No runtime external voice or LLM requests are added.

Logout revokes the server session. It does not delete health records. No account deletion UI, password recovery, email verification, clinician role or verified-clearance upload is implemented. Decide and implement the required account/retention operations before collecting participant records on a deployed service.

## Verification evidence

Recorded on 8 September: 52 automated tests across 9 files pass; type checking and client/server production build pass; a separate temporary database was used for the built-server authentication smoke test; package audit reported zero vulnerabilities.

- `npm run check`: type checking.
- `npm test`: engine, audio/camera lifecycle, product behavior, medical planning and account/API checks.
- `npm run shots`: 3× demo screenshots, with the local development server running.
- `node scripts/medical-qa.mjs`: 3× onboarding/program screenshots plus synthetic-profile and virtual-camera workflow checks. It creates `qa-medical-…@example.test` test accounts in the connected local database; use an isolated QA database when repeating it. Accounts created during the completed rework were removed afterward.

The full browser check covers registration, intake, stroke-profile planning, Arabic/mobile layout, virtual-camera launch/exit, prescribed demo sets, enforced rest and next set, high-effort stop, demo/history separation, cardiac review and logout. API tests independently cover real-result persistence, ownership, changed plans, inconsistent rep data and recovery enforcement.

These checks do not measure real-camera accuracy, clinical benefit or participant usability. Earlier pre-account QA scripts and archived screenshots describe historical journeys and should not be used as the current release checklist.
