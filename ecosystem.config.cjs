/**
 * PM2 production layout — run BOTH processes on the VPS:
 *   pm2 start ecosystem.config.cjs
 *   pm2 save
 *
 * Web serves Next.js; worker drains BullMQ `email-campaign` jobs from Redis.
 * Both need the same .env.local (SUPABASE_SERVICE_ROLE_KEY, SMTP_ENCRYPTION_KEY, REDIS_URL).
 */
module.exports = {
  apps: [
    {
      name: "mymail-web",
      cwd: __dirname,
      script: "npm",
      args: "start",
      env: { NODE_ENV: "production" },
      max_restarts: 20,
      restart_delay: 5_000,
    },
    {
      name: "mymail-worker",
      cwd: __dirname,
      script: "npm",
      args: "run worker",
      env: { NODE_ENV: "production" },
      max_restarts: 20,
      restart_delay: 5_000,
    },
  ],
};
