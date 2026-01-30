module.exports = {
  apps: [{
    name: 'receipt-title',
    script: 'npm',
    args: 'start',
    instances: 1,
    exec_mode: 'fork',
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    autorestart: true,
    watch: false,
    max_restarts: 10,
    min_uptime: '10s'
  }]
};
