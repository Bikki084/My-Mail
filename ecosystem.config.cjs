/**
 * PM2 production layout — run BOTH processes on the VPS:
 *   bash scripts/ensure-email-stack.sh
 *
 * Requires .env.local (Supabase, SMTP_ENCRYPTION_KEY, REDIS_URL).
 * After git pull: bash scripts/deploy-production.sh  (safe — site stays up during build)
 * First time / full recovery: bash scripts/pm2-fix-web.sh
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
        NEXT_DIST_DIR: "",
        EMAIL_CAMPAIGN_CONCURRENCY: "6",
        EMAIL_WORKER_CONCURRENCY: "6",
        GLOBAL_SMTP_CONCURRENCY: "36",
        GLOBAL_EGRESS_ROTATION_BURST: "200",
        SMTP_WORKER_CONCURRENCY: "6",
        AWS_LIGHTSAIL_SEND_EGRESS: "0",
        OUTBOUND_IP_EGRESS_MODE: "logical",
      },
      autorestart: true,
      min_uptime: "10s",
      max_restarts: 40,
      restart_delay: 4_000,
      exp_backoff_restart_delay: 200,
      kill_timeout: 10_000,
      listen_timeout: 15_000,
      max_memory_restart: "900M",
      // Keep a short outage if Next exits — cron watchdog is the backstop.
      merge_logs: true,
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
      autorestart: true,
      min_uptime: "8s",
      max_restarts: 40,
      restart_delay: 4_000,
      exp_backoff_restart_delay: 200,
      kill_timeout: 15_000,
      max_memory_restart: "900M",
      merge_logs: true,
    },
  ],
};
