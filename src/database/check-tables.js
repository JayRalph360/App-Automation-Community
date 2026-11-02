
import { pool } from "./pool.js";

async function main() {
    try {
        const result = await pool.query(`
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_type = 'BASE TABLE'
            ORDER BY table_name;
        `);

        console.log("Tables in app_automation:");

        for (const row of result.rows) {
            console.log(`- ${row.table_name}`);
        }
    } catch (error) {
        console.error("Could not inspect tables:", error.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}

main();
