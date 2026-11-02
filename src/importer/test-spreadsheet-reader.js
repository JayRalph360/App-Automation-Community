
import { readSpreadsheet } from "./spreadsheet-reader.js";

async function main() {
    try {
        const filePath = "./test-data/sample-merchants.csv";
        const rows = await readSpreadsheet(filePath);

        console.log("Rows read:", rows.length);
        console.dir(rows, { depth: null });
    } catch (error) {
        console.error("Spreadsheet test failed:", error.message);
        process.exitCode = 1;
    }
}

main();
