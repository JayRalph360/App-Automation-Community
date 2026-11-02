
import path from "node:path";
import { fileURLToPath } from "node:url";
import { importSpreadsheet } from "./import-service.js";
import { pool } from "../database/pool.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const filePath = path.resolve(
    __dirname,
    "../../test-data/sample-merchants.csv"
);

try {
    console.log(`Importing merchants from:\n${filePath}\n`);

    const summary = await importSpreadsheet(filePath);

    console.log("\nImport finished:");
    console.table(summary);
} catch (error) {
    console.error("\nImport failed:", error.message);
    process.exitCode = 1;
} finally {
    await pool.end();
}
