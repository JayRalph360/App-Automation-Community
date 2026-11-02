import "dotenv/config";
import pg from "pg";
import { databaseConfig } from "../config/database.js";

const { Pool } = pg;

if (!databaseConfig.password) {
    throw new Error(
        "DB_PASSWORD is missing. Add your PostgreSQL password to .env."
    );
}

export const pool = new Pool(databaseConfig);

pool.on("error", (error) => {
    console.error("Unexpected PostgreSQL pool error:", error.message);
});

export async function testDatabaseConnection() {
    const result = await pool.query(`
        SELECT
            current_database() AS database,
            current_user AS username,
            NOW() AS server_time
    `);

    return result.rows[0];
}