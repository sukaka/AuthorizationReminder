const numberFromEnv = (value: string | undefined, fallback: number, minimum: number) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= minimum ? parsed : fallback
}

export const config = Object.freeze({
  auth: {
    serviceUrl: process.env.AUTH_SERVICE_URL || 'http://localhost:5180',
    systemKey: process.env.AUTH_SYSTEM_KEY || 'big-screen',
    cookieName: process.env.AUTH_COOKIE_NAME || 'juxin_auth_token',
    timeoutMs: numberFromEnv(process.env.AUTH_FETCH_TIMEOUT_MS, 5000, 1000),
  },
  database: {
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: numberFromEnv(process.env.MYSQL_PORT, 3306, 1),
    name: process.env.MYSQL_DATABASE || 'juxin_big_screen',
    user: process.env.MYSQL_USER || 'big_screen_user',
    password: process.env.MYSQL_PASSWORD || 'big_screen_pass',
    adminUser: process.env.MYSQL_ADMIN_USER || process.env.MYSQL_USER || 'root',
    adminPassword: process.env.MYSQL_ADMIN_PASSWORD ?? process.env.MYSQL_PASSWORD ?? '',
    connectionLimit: numberFromEnv(process.env.DB_CONNECTION_LIMIT, 10, 1),
    connectRetries: numberFromEnv(process.env.DB_CONNECT_RETRIES, 30, 1),
    connectDelayMs: numberFromEnv(process.env.DB_CONNECT_DELAY_MS, 2000, 1),
  },
  playTokenTtlMs: numberFromEnv(process.env.PLAY_TOKEN_TTL_MS, 30 * 60 * 1000, 60_000),
})
