
import { importSpreadsheet } from "./import-service.js";
import { pool } from "../database/pool.js";

async function main() {
    try {
        const summary = await importSpreadsheet(
            "./test-data/sample-merchants.csv"
        );

        console.log("Import finished:");
        console.dir(summary, { depth: null });
    } catch (error) {
        console.error("Import failed:", error.message);

        if (error.summary) {
            console.dir(error.summary, { depth: null });
        }

        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}

main();
