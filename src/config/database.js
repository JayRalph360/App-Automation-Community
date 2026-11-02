export const databaseConfig = {
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME || "app_automation",
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD,
    max: Number(process.env.DB_POOL_MAX || 5),
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
};