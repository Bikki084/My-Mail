/**
 * PM2 production layout — run BOTH processes on the VPS:
 *   pm2 start ecosystem.config.cjs
 *   pm2 save
 *
 * Web serves Next.js; worker drains BullMQ `email-campaign` jobs from Redis.
 * Both need the same .env.local (SUPABASE_SERVICE_ROLE_KEY, SMTP_ENCRYPTION_KEY, REDIS_URL).
 *
 * Send governor: 100+ users can queue campaigns; only EMAIL_CAMPAIGN_CONCURRENCY
 * run at once on this box. Increase both concurrency vars together on a bigger VPS.
 */
module.exports = {
  apps: [
    {
      name: "mymail-web",
      cwd: __dirname,
      script: "npm",
      args: "start",
      env: {
        NODE_ENV: "production",
        // Never run bulk SMTP inside the web process — prevents 502 during sends.
        FORCE_EMAIL_QUEUE: "1",
        // Queue unlimited users; 6 campaigns send in parallel on this VPS (tune up on larger instance).
        EMAIL_CAMPAIGN_CONCURRENCY: "6",
        EMAIL_WORKER_CONCURRENCY: "6",
        GLOBAL_SMTP_CONCURRENCY: "36",
        GLOBAL_EGRESS_ROTATION_BURST: "200",
        SMTP_WORKER_CONCURRENCY: "6",
        // Keep primary static IP attached during sends (avoids site dropouts). Set 1 only if you accept brief DNS/IP churn.
        AWS_LIGHTSAIL_SEND_EGRESS: "0",
        OUTBOUND_IP_EGRESS_MODE: "logical",
      },
      max_restarts: 20,
      restart_delay: 5_000,
      max_memory_restart: "750M",
    },
    {
      name: "mymail-worker",
      cwd: __dirname,
      script: "npm",
      args: "run worker",
      env: {
        NODE_ENV: "production",
        EMAIL_CAMPAIGN_CONCURRENCY: "6",
        EMAIL_WORKER_CONCURRENCY: "6",
        GLOBAL_SMTP_CONCURRENCY: "36",
        GLOBAL_EGRESS_ROTATION_BURST: "200",
        SMTP_WORKER_CONCURRENCY: "6",
        AWS_LIGHTSAIL_SEND_EGRESS: "0",
        OUTBOUND_IP_EGRESS_MODE: "logical",
      },
      max_restarts: 20,
      restart_delay: 5_000,
      max_memory_restart: "900M",
    },
  ],
};
