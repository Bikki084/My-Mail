# MyMail SaaS

A single Next.js application that hosts both the **Admin** and **Client** panels behind one authentication system and one backend.

- **Framework:** Next.js 16 (App Router) + React 19 + Tailwind CSS v4
- **Auth + DB:** Supabase (SSR cookies via `@supabase/ssr`)
- **Queue / workers:** BullMQ + Redis (`ioredis`), Nodemailer for SMTP
- **One port:** everything runs on `http://localhost:3000`

> Do **not** add a second frontend (Vite, CRA, etc.). Both panels live in this app.

## Routing

Role-based routing is enforced in `src/middleware.ts` (which delegates to `src/lib/supabase/middleware.ts`):

| Path                | Audience               | Notes                                                       |
| ------------------- | ---------------------- | ----------------------------------------------------------- |
| `/`                 | Public landing         | Marketing page with link to `/login`.                       |
| `/login`, `/signin` | Public                 | Authenticated users are redirected to their role dashboard. |
| `/forgot-password`  | Public                 | Same redirect rule as `/login`.                             |
| `/admin/*`          | `profiles.role=admin`  | Admin console (users, credits, monitor, reports, …).        |
| `/client/*`         | `profiles.role=client` | Client console (campaigns, recipients, SMTP, …).            |
| `/api/*`            | Backend                | Route handlers for campaigns, sending, etc.                 |

The middleware reads the user's role from the `profiles` table on every request and bounces them to the correct panel if they hit the wrong one.

## Getting Started

1. **Environment (required for Supabase + Gmail):** Real secrets must never be committed. After `git clone`, run `npm run setup:env` to create `.env.local` from `.env.example`, then edit `.env.local` with your Supabase URL/keys and (if needed) `ADMIN_RESET_SMTP_*` Gmail values. `.env.local` is gitignored.
2. Install deps and run the dev server:

   ```bash
   npm install
   npm run dev
   ```

3. **Email worker:** If `REDIS_URL` is set in `.env.local`, `npm run dev` also starts the BullMQ worker in the same process tree (no second terminal). Without Redis, small campaigns still send synchronously from the API.

   To run **only** Next.js: `npm run worker` is still available alone, or use `npm run dev:next`.

Open [http://localhost:3000](http://localhost:3000).

## Scripts

| Script              | What it does                                        |
| ------------------- | --------------------------------------------------- |
| `npm run setup:env` | Create `.env.local` from `.env.example` if missing (safe local secrets). |
| `npm run dev`       | Next.js dev server; if `REDIS_URL` is set, also starts the email worker. |
| `npm run dev:next`  | Next.js only (no worker), same as old `npm run dev`. |
| `npm run dev:clean` | Wipe `.next/` first, then same as `npm run dev`.    |
| `npm run build`     | Production build.                                   |
| `npm run start`     | Run the production build.                           |
| `npm run lint`      | ESLint.                                             |
| `npm run worker`    | Email worker only (BullMQ); required in production whenever `REDIS_URL` is set (see below). |

**Production (bulk / BullMQ):** `npm run start` only serves Next.js. The API **enqueues** sends to Redis when `REDIS_URL` is set and Redis is reachable; the **`npm run worker`** process **consumes** those jobs (same Docker image, different command).

On **Render** (see repo `render.yaml`):

1. Use a **Render Key Value** (Redis) instance — Blueprint wires `REDIS_URL` from its private `connectionString`.
2. Add a **Background Worker** with the same repo/image and **`dockerCommand: npm run worker`**.
3. Copy every secret the worker needs from your **Web** service to the **Worker**: at minimum `SUPABASE_SERVICE_ROLE_KEY`, `SMTP_ENCRYPTION_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, plus any mail vars (`ADMIN_RESET_SMTP_*`, etc.). Without **`SUPABASE_SERVICE_ROLE_KEY`**, the worker exits immediately.
4. Large campaigns (`> 200` recipients) **require** a working queue + worker; smaller sends can fall back to in-process delivery if Redis is unset.

## Project Structure

```
src/
  app/
    admin/        # /admin/* — admin panel pages + layout
    client/       # /client/* — client panel pages + layout
    api/          # backend route handlers
    login/        # shared sign-in page
    ...
  components/
    admin/        # admin-only UI
    client/       # client-only UI
    ui/           # shared shadcn-style primitives
  lib/
    supabase/     # SSR + browser + admin clients, middleware helper
    queue/        # BullMQ email queue
middleware.ts     # entry point for role-based route protection
scripts/
  email-worker.ts # standalone BullMQ worker
supabase/
  migrations/     # SQL migrations
```

## Deliverability — fixing "mail goes to Outlook Junk"

The app already sets the standard bulk-sender headers (`List-Unsubscribe`, `List-Unsubscribe-Post`, `List-ID`, `Feedback-ID`, `Precedence: bulk`, stable Message-ID aligned to the From domain, and an unsubscribe footer). Microsoft / Outlook still junks mail when the **sender authentication and reputation** are weak — and that part lives outside the app, in DNS and at the SMTP relay. In priority order:

1. **Stop sending bulk from a free-mail address.** A `@gmail.com` / `@yahoo.com` / `@outlook.com` From address shipping marketing-style content is the #1 reason Outlook flags Junk. Use a domain you own (e.g. `mail.your-co.com`) with a real transactional SMTP relay — Brevo, SendGrid, Mailgun, Postmark, Amazon SES, or Resend all have free / low-volume tiers and signed DKIM out of the box.
2. **Publish SPF, DKIM, and DMARC on the sender domain.** Most ESPs walk you through this in their setup wizard. Verify with [mail-tester.com](https://www.mail-tester.com) — aim for 9+/10. A DKIM signature *aligned with the From domain* is the single biggest signal Outlook uses to trust you.
3. **Sign up for Microsoft SNDS + JMRP (free).** Visit [SNDS](https://sendersupport.olc.protection.outlook.com/snds/) and the [Junk Mail Reporting Program](https://sendersupport.olc.protection.outlook.com/pm/) — gives you visibility into Outlook's view of your IP / domain reputation and routes recipient "Mark as Junk" clicks back to you.
4. **Warm up.** Start with 50–100 sends per day to engaged contacts, ramp gradually. Outlook learns sender reputation per IP+domain; brand-new senders blasting thousands of recipients are treated as suspicious by default.
5. **Configure `MAILER_PUBLIC_URL`** so the HTTPS one-click unsubscribe URL is included (RFC 8058). Apply migration `20260504170000_unsubscribes.sql` so the route actually persists suppressions and the send loop skips them next time.
6. **Tell the affected recipient to right-click → "Mark as not junk" → "Add sender to Safe Senders".** One-time fix that also signals Outlook to trust your domain for that recipient going forward.

What the app already does for you, so you don't have to think about it: header authentication aligned with the From domain (when set up), per-recipient `X-Entity-Ref-ID` and `Feedback-ID` so abuse reports map back to a campaign, automatic plain-text fallback generated from the HTML, an unsubscribe footer when the template doesn't ship its own, and a working `/api/unsubscribe` endpoint that mailbox providers can validate.
