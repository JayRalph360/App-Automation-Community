
import { randomInt } from "node:crypto";
import { normalizeMtnNumber } from "./phone.js";

export function normalizeBusinessName(value) {
    return String(value ?? "").trim().replace(/\s+/g, " ");
}

function emailSlug(name) {
    return name
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ".")
        .replace(/^\.+|\.+$/g, "")
        .slice(0, 50);
}

export function generateEmail(businessName, number) {
    const slug = emailSlug(businessName);

    // Include the number to make generated addresses more distinct.
    const suffix = number.slice(-9);

    return `${slug || "merchant"}.${suffix}@gmail.com`;
}

export function generateDigitalAddress() {
    const area = String(randomInt(0, 1000)).padStart(3, "0");
    const unique = String(randomInt(0, 10000)).padStart(4, "0");

    return `GE-${area}-${unique}`;
}

export function buildMerchantRecord(input, source = "manual") {
    const number = normalizeMtnNumber(input.number);
    const businessName = normalizeBusinessName(input.businessName);

    const providedEmail = String(input.email ?? "").trim();
    const email = providedEmail || (
        businessName
            ? generateEmail(businessName, number)
            : ""
    );

    return {
        number,
        business_name: businessName,
        owner_number: number,
        office_number: number,
        merchant_attendant_name: businessName,
        merchant_payment_code: number,
        email,

        business_registration_type:
            input.business_registration_type || "Business Certificate",
        business_registration_number:
            input.business_registration_number || "N/A",
        business_type: input.business_type || "Private Company",
        industry: input.industry || "General good retail",
        service_type: input.service_type || "B2C",
        tin_number: input.tin_number || "N/A",
        digital_address:
            input.digital_address || generateDigitalAddress(),
        items_given: input.items_given || ["Stickers"],

        status: businessName ? "Incompleted" : "Incompleted",
        visited_status: "Not completed",
        source,
    };
}
