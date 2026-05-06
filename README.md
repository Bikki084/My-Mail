# MyMail SaaS

A single Next.js application that hosts both the **Admin** and **Client** panels behind one authentication system and one backend.

- **Framework:** Next.js 16 (App Router) + React 19 + Tailwind CSS v4
- **Auth + DB:** Supabase (SSR cookies via `@supabase/ssr`)
- **Queue / workers:** BullMQ + Redis (`ioredis`), Nodemailer for SMTP
- **One port:** everything runs on `http://localhost:3000`

> Do **not** add a second frontend (Vite, CRA, etc.). Both panels live in this app.

## Routing

Role-based routing is enforced in `middleware.ts` (which delegates to `src/lib/supabase/middleware.ts`):

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

1. Copy `env.example` to `.env.local` and fill in Supabase + Redis credentials.
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
| `npm run dev`       | Next.js dev server; if `REDIS_URL` is set, also starts the email worker. |
| `npm run dev:next`  | Next.js only (no worker), same as old `npm run dev`. |
| `npm run dev:clean` | Wipe `.next/` first, then same as `npm run dev`.    |
| `npm run build`     | Production build.                                   |
| `npm run start`     | Run the production build.                           |
| `npm run lint`      | ESLint.                                             |
| `npm run worker`    | Email worker only (BullMQ); use in prod or extra terminal. |

**Production:** `npm run start` runs only Next.js — run the worker as a separate service or container (same `REDIS_URL` and env as the app).

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
