
import { pool } from "./pool.js";

async function main() {
    try {
        const result = await pool.query(
            `DELETE FROM merchants
             WHERE number = $1
               AND business_name = $2
               AND email = $3
             RETURNING number`,
            [
                "233241234567",
                "Test Merchant",
                "testmerchant@example.com"
            ]
        );

        console.log("Test records removed:", result.rowCount);
    } catch (error) {
        console.error("Cleanup failed:", error.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}

main();
