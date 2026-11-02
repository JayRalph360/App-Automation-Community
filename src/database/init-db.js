
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

// npm run db:init

const { Client, Pool } = pg;

const databaseName = process.env.DB_NAME || "app_automation";
const currentDirectory = path.dirname(fileURLToPath(import.meta.url));

const connectionConfig = {
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD,
    connectionTimeoutMillis: 5000,
};

function quoteIdentifier(value) {
    return `"${value.replace(/"/g, '""')}"`;
}

async function ensureDatabaseExists() {
    if (!connectionConfig.password) {
        throw new Error("DB_PASSWORD is missing from .env.");
    }

    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(databaseName)) {
        throw new Error("DB_NAME contains unsupported characters.");
    }

    const client = new Client({
        ...connectionConfig,
        database: "postgres",
    });

    try {
        await client.connect();

        const result = await client.query(
            "SELECT 1 FROM pg_database WHERE datname = $1",
            [databaseName]
        );

        if (result.rowCount > 0) {
            console.log(`[DATABASE] "${databaseName}" already exists.`);
            return;
        }

        try {
            await client.query(
                `CREATE DATABASE ${quoteIdentifier(databaseName)}`
            );

            console.log(`[DATABASE] "${databaseName}" created.`);
        } catch (error) {
            if (error.code !== "42P04") {
                throw error;
            }

            console.log(
                `[DATABASE] "${databaseName}" was created by another process.`
            );
        }
    } finally {
        await client.end();
    }
}

async function initializeSchema() {
    const pool = new Pool({
        ...connectionConfig,
        database: databaseName,
        max: Number(process.env.DB_POOL_MAX || 5),
        idleTimeoutMillis: 30000,
    });

    try {
        const connection = await pool.query(`
            SELECT current_database() AS database,
                   current_user AS username
        `);

        console.log(
            `[DATABASE] Connected to ${connection.rows[0].database}.`
        );

        const schemaPath = path.join(currentDirectory, "schema.sql");
        const schema = await fs.readFile(schemaPath, "utf8");

        await pool.query(schema);

        console.log("[DATABASE] Schema initialized successfully.");
    } finally {
        await pool.end();
    }
}

/**
 * Ensures the PostgreSQL database and its tables exist.
 * Safe to call whenever the application starts.
 */
export async function initializeDatabase() {
    console.log("[DATABASE] Checking database setup...");

    await ensureDatabaseExists();
    await initializeSchema();

    console.log("[DATABASE] Initialization completed.");
}

// Preserve the standalone npm run db:init functionality.
if (
    process.argv[1] &&
    path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
    initializeDatabase().catch((error) => {
        console.error(
            "[DATABASE] Initialization failed:",
            error.message
        );

        process.exitCode = 1;
    });
}
