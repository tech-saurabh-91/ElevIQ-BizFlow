/**
 * PM2 process file for the ElevIQ SFA API (single-node / VPS deployment).
 *
 *   pm2 start ecosystem.config.js --env production
 *   pm2 logs eleviq-api
 *   pm2 reload ecosystem.config.js --env production   # zero-downtime restart
 *
 * The web client is a static build (client/dist): serve it with nginx/Caddy
 * and reverse-proxy /api to this process, or use `docker compose up` which
 * bundles both. See README.md → Production deployment.
 */
module.exports = {
  apps: [
    {
      name: 'eleviq-api',
      script: 'src/server.js',
      cwd: './server',
      // Node cluster: one process per CPU, shared port.
      instances: process.env.INSTANCES || 'max',
      exec_mode: 'cluster',
      max_memory_restart: '512M',
      env: { NODE_ENV: 'development' },
      env_production: { NODE_ENV: 'production' },
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      merge_logs: true,
      time: true,
      // Must exceed the server's 15s graceful-shutdown cap so SIGTERM is
      // given time to drain connections before PM2 force-kills.
      kill_timeout: 16000,
      listen_timeout: 10000,
    },
  ],
};
