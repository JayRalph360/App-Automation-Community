
import {
    findMerchantByNumber,
    createMerchant
} from "./merchant-repository.js";

import { pool } from "./pool.js";

async function main() {
    try {
        const number = "233241234567";

        const existing = await findMerchantByNumber(number);
        console.log("Existing merchant:", existing);

        const result = await createMerchant({
            number,
            businessName: "Test Merchant",
            email: "testmerchant@example.com",
            status: "Incompleted",
            source: "manual"
        });

        console.log("Create result:", result);
    } catch (error) {
        console.error("Repository test failed:", error.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}

main();
