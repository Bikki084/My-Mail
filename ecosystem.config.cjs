/**
 * PM2 production layout — run BOTH processes on the VPS:
 *   bash scripts/ensure-email-stack.sh
 *
 * Requires .env.local (Supabase, SMTP_ENCRYPTION_KEY, REDIS_URL).
 * After git pull: bash scripts/pm2-fix-web.sh  (first time / after OOM)
 * Daily recovery: bash scripts/ensure-email-stack.sh
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
      script: "scripts/run-worker.cjs",
      interpreter: "node",
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
      max_restarts: 20,
      restart_delay: 5_000,
      exp_backoff_restart_delay: 200,
      kill_timeout: 15_000,
      max_memory_restart: "1G",
    },
  ],
};
