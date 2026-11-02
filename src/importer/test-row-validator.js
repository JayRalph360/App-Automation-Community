
import { readSpreadsheet } from "./spreadsheet-reader.js";
import { validateMerchantRow } from "./row-validator.js";

async function main() {
    const rows = await readSpreadsheet(
        "./test-data/sample-merchants.csv"
    );

    for (const row of rows) {
        const result = validateMerchantRow(row);

        console.log(`\nSource row ${row.rowNumber}`);
        console.log("Valid:", result.valid);
        console.log("Errors:", result.errors);
        console.log("Merchant:", result.merchant);
    }
}

main().catch(error => {
    console.error("Validation test failed:", error.message);
    process.exitCode = 1;
});
