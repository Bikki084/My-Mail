/**
 * PM2 production layout — run BOTH processes on the VPS:
 *   pm2 delete all
 *   pm2 start ecosystem.config.cjs
 *   pm2 save
 *
 * Requires .env.local in project root (Supabase, SMTP_ENCRYPTION_KEY, REDIS_URL).
 * After code pull: npm run build:prod && pm2 restart ecosystem.config.cjs
 */
module.exports = {
  apps: [
    {
      name: "mymail-web",
      cwd: __dirname,
      script: "scripts/start-prod.cjs",
      interpreter: "node",
      env: {
        NODE_ENV: "production",
        FORCE_EMAIL_QUEUE: "1",
        EMAIL_CAMPAIGN_CONCURRENCY: "6",
        EMAIL_WORKER_CONCURRENCY: "6",
        GLOBAL_SMTP_CONCURRENCY: "36",
        GLOBAL_EGRESS_ROTATION_BURST: "200",
        SMTP_WORKER_CONCURRENCY: "6",
        AWS_LIGHTSAIL_SEND_EGRESS: "0",
        OUTBOUND_IP_EGRESS_MODE: "logical",
      },
      min_uptime: "8s",
      max_restarts: 15,
      restart_delay: 8_000,
      exp_backoff_restart_delay: 200,
      kill_timeout: 8_000,
      max_memory_restart: "1G",
    },
    {
      name: "mymail-worker",
      cwd: __dirname,
      script: "scripts/email-worker.ts",
      interpreter: "node",
      interpreter_args: "--import tsx",
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
      min_uptime: "5s",
      max_restarts: 15,
      restart_delay: 8_000,
      exp_backoff_restart_delay: 200,
      kill_timeout: 10_000,
      max_memory_restart: "1G",
    },
  ],
};
