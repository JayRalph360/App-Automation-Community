
import { normalizeMtnNumber } from "../utils/phone.js";
import { resolveBusinessEmail } from "../utils/email.js";

export function validateMerchantRow(row) {
    const errors = [];

    const businessName = String(row.businessName ?? "").trim();

    if (!businessName) {
        errors.push("Business Name is required.");
    }

    let number = "";

    try {
        number = normalizeMtnNumber(row.number);
    } catch (error) {
        errors.push(error.message);
    }

    let email = "";

    if (businessName) {
        email = resolveBusinessEmail(row.email, businessName);
    }

    return {
        valid: errors.length === 0,
        errors,
        merchant: {
            number,
            businessName,
            email
        }
    };
}
