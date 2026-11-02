
import { pool } from "./pool.js";

async function main() {
    try {
        const batchResult = await pool.query(
            `SELECT *
             FROM import_batches
             WHERE id = $1`,
            [4]
        );

        console.log("IMPORT BATCH:");
        console.table(batchResult.rows);

        const logsResult = await pool.query(
            `SELECT row_number, number, outcome, reason
             FROM import_row_logs
             WHERE batch_id = $1
             ORDER BY row_number`,
            [4]
        );

        console.log("ROW LOGS:");
        console.table(logsResult.rows);

        const merchantsResult = await pool.query(
            `SELECT number, business_name, email, status, source
             FROM merchants
             WHERE source IN ('csv', 'xlsx', 'spreadsheet')
             ORDER BY created_at`
        );

        console.log("IMPORTED MERCHANTS:");
        console.table(merchantsResult.rows);
    } catch (error) {
        console.error("Verification failed:", error.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}

main();
