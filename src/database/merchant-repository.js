
import { pool } from "./pool.js";

/**
 * Find a merchant by phone number.
 */
export async function findMerchantByNumber(number) {
    const query = `
        SELECT *
        FROM merchants
        WHERE number = $1;
    `;

    const result = await pool.query(query, [number]);

    return result.rows[0] ?? null;
}

/**
 * Insert a merchant if the number does not already exist.
 * Existing records are returned without being overwritten.
 */
export async function createMerchant(merchant) {
    const query = `
        INSERT INTO merchants (
            number,
            business_name,
            owner_number,
            office_number,
            merchant_attendant_name,
            merchant_payment_code,
            email,
            status,
            source
        )
        VALUES ($1, $2, $1, $1, $2, $1, $3, $4, $5)
        ON CONFLICT (number) DO NOTHING
        RETURNING *;
    `;

    const values = [
        merchant.number,
        merchant.businessName,
        merchant.email,
        merchant.status ?? "Incompleted",
        merchant.source ?? "spreadsheet"
    ];

    const result = await pool.query(query, values);

    if (result.rows.length > 0) {
        return {
            created: true,
            merchant: result.rows[0]
        };
    }

    return {
        created: false,
        merchant: await findMerchantByNumber(merchant.number)
    };
}

/**
 * Update registration status.
 *
 * attempt_count increases here only when transitioning into Active
 * from another status. claimNextMerchant() counts each actual claim.
 */
export async function updateMerchantStatus(
    number,
    status,
    lastError = null
) {
    const allowedStatuses = [
        "Completed",
        "Incompleted",
        "Active"
    ];

    if (!allowedStatuses.includes(status)) {
        throw new Error(`Invalid merchant status: ${status}`);
    }

    const query = `
        UPDATE merchants
        SET status = $2,
            last_error = $3,
            attempt_count = CASE
                WHEN $2 = 'Active' AND status <> 'Active'
                    THEN attempt_count + 1
                ELSE attempt_count
            END,
            updated_at = NOW()
        WHERE number = $1
        RETURNING *;
    `;

    const result = await pool.query(query, [
        number,
        status,
        lastError
    ]);

    return result.rows[0] ?? null;
}

/**
 * Update merchant details without changing the phone number.
 */
export async function updateMerchantDetails(number, details) {
    const query = `
        UPDATE merchants
        SET business_name = COALESCE($2, business_name),
            email = COALESCE($3, email),
            updated_at = NOW()
        WHERE number = $1
        RETURNING *;
    `;

    const result = await pool.query(query, [
        number,
        details.businessName ?? null,
        details.email ?? null
    ]);

    return result.rows[0] ?? null;
}

/**
 * Claim the next merchant.
 *
 * Priority:
 * 1. Active merchants from interrupted attempts.
 * 2. Incompleted merchants that have not been started.
 * 3. Oldest created_at first within each status.
 *
 * Completed merchants are never selected.
 * Merchants without a business name are not eligible.
 */
export async function claimNextMerchant() {
    const query = `
        WITH candidate AS (
            SELECT number
            FROM merchants
            WHERE status IN ('Active', 'Incompleted')
              AND TRIM(COALESCE(business_name, '')) <> ''
            ORDER BY
                CASE
                    WHEN status = 'Active' THEN 0
                    WHEN status = 'Incompleted' THEN 1
                END,
                created_at ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
        )
        UPDATE merchants AS merchant
        SET status = 'Active',
            last_error = NULL,
            attempt_count = merchant.attempt_count + 1,
            updated_at = NOW()
        FROM candidate
        WHERE merchant.number = candidate.number
        RETURNING merchant.*;
    `;

    const result = await pool.query(query);

    return result.rows[0] ?? null;
}
