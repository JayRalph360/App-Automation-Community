
import { resumeImport } from "./import-service.js";
import { pool } from "../database/pool.js";

async function main() {
    try {
        // Batch 4 is a test batch with existing row logs.
        // It should skip its already handled rows.
        const summary = await resumeImport(
            4,
            "./test-data/sample-merchants.csv"
        );

        console.log("Recovery result:");
        console.dir(summary, { depth: null });
    } catch (error) {
        console.error("Recovery test failed:", error.message);

        if (error.summary) {
            console.dir(error.summary, { depth: null });
        }

        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}

main();
