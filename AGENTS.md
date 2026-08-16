<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Agent instructions — Mailshooter

## 1. Read `brain.md` first

Before exploring the codebase or answering architecture / production / capacity questions:

1. Read **`brain.md`** at the repo root — it is the project knowledge base (routes, limits, deploy, env, recent features).
2. Only open other files when `brain.md` is missing detail or you are editing code.

Do **not** run broad repo scans when `brain.md` already answers the question.

## 2. Keep `brain.md` updated (required)

Whenever you implement or change something meaningful, **update `brain.md` in the same session** (same commit as the code when possible):

- New features, routes, admin pages, API endpoints
- Env vars, deploy/migration steps, PM2 defaults
- Sending limits, queue behavior, retention, provider (SendGrid, etc.)
- Production infra or branding

Add a row to the **Changelog** table at the top with the date and a one-line summary.

Never put real secrets in `brain.md`.

## 3. Code conventions

- Minimize diff scope; match existing patterns in surrounding files.
- Admin: Server Actions + `assertAdmin()`; dark UI via `AdminShell` / `AdminPageHeader`.
- Migrations: `supabase/migrations/YYYYMMDDHHMMSS_description.sql` → document in brain.md.
- Commit/push only when the user asks (unless they explicitly want parallel doc updates with every push).

## 4. Production deploy reminder

After pulling on Lightsail: `npm run db:migrate` (if migrations changed) → `bash scripts/deploy-production.sh`.
