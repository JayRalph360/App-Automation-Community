
import path from "node:path";

import { pool } from "../database/pool.js";
import { readSpreadsheet } from "./spreadsheet-reader.js";
import { validateMerchantRow } from "./row-validator.js";
import { generateDigitalAddress } from "../utils/merchant-defaults.js";

const TERMINAL_OUTCOMES = new Set([
    "Inserted",
    "Duplicate",
    "Rejected"
]);

const ALLOWED_OUTCOMES = [
    "Inserted",
    "Duplicate",
    "Rejected",
    "Failed"
];

async function createImportBatch(filePath) {
    const extension = path.extname(filePath).toLowerCase();

    if (![".csv", ".xlsx"].includes(extension)) {
        throw new Error(`Unsupported file type: ${extension}`);
    }

    const sourceType = extension === ".csv" ? "csv" : "xlsx";

    const result = await pool.query(
        `INSERT INTO import_batches (source_file, source_type)
         VALUES ($1, $2)
         RETURNING id`,
        [path.basename(filePath), sourceType]
    );

    return result.rows[0].id;
}

async function logRow(
    client,
    batchId,
    row,
    outcome,
    reason,
    number = null
) {
    await client.query(
        `INSERT INTO import_row_logs
            (batch_id, row_number, number, outcome, reason, row_data)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         ON CONFLICT (batch_id, row_number)
         DO UPDATE SET
            number = EXCLUDED.number,
            outcome = EXCLUDED.outcome,
            reason = EXCLUDED.reason,
            row_data = EXCLUDED.row_data,
            handled_at = NOW()`,
        [
            batchId,
            row.rowNumber,
            number,
            outcome,
            reason,
            JSON.stringify(row)
        ]
    );
}

async function processRow(batchId, row, sourceType) {
    const validation = validateMerchantRow(row);
    const merchant = validation.merchant;
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        if (!merchant.number) {
            await logRow(
                client,
                batchId,
                row,
                "Rejected",
                validation.errors.join(" "),
                null
            );

            await client.query("COMMIT");
            return "Rejected";
        }

        const existing = await client.query(
            `SELECT number, status
             FROM merchants
             WHERE number = $1
             FOR UPDATE`,
            [merchant.number]
        );

        if (existing.rowCount > 0) {
            await logRow(
                client,
                batchId,
                row,
                "Duplicate",
                `Existing merchant preserved (status: ${existing.rows[0].status}).`,
                merchant.number
            );

            await client.query("COMMIT");
            return "Duplicate";
        }

        const digitalAddress = generateDigitalAddress();

        const inserted = await client.query(
            `INSERT INTO merchants (
                number,
                business_name,
                owner_number,
                office_number,
                merchant_attendant_name,
                merchant_payment_code,
                email,
                digital_address,
                status,
                source
            )
            VALUES ($1, $2, $1, $1, $2, $1, $3, $4, 'Incompleted', $5)
            ON CONFLICT (number) DO NOTHING
            RETURNING number`,
            [
                merchant.number,
                merchant.businessName,
                merchant.email,
                digitalAddress,
                sourceType
            ]
        );

        if (inserted.rowCount === 0) {
            await logRow(
                client,
                batchId,
                row,
                "Duplicate",
                "Another process inserted this number; existing record preserved.",
                merchant.number
            );

            await client.query("COMMIT");
            return "Duplicate";
        }

        const reason = merchant.businessName
            ? "Merchant saved as Incompleted pending onboarding."
            : "Business name missing; saved as Incompleted and skipped for onboarding.";

        await logRow(
            client,
            batchId,
            row,
            "Inserted",
            reason,
            merchant.number
        );

        await client.query("COMMIT");
        return "Inserted";
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

async function recordFailure(batchId, row, error) {
    await pool.query(
        `INSERT INTO import_row_logs
            (batch_id, row_number, number, outcome, reason, row_data)
         VALUES ($1, $2, NULL, 'Failed', $3, $4::jsonb)
         ON CONFLICT (batch_id, row_number)
         DO UPDATE SET
            number = NULL,
            outcome = 'Failed',
            reason = EXCLUDED.reason,
            row_data = EXCLUDED.row_data,
            handled_at = NOW()`,
        [
            batchId,
            row.rowNumber,
            error.message,
            JSON.stringify(row)
        ]
    );
}

async function getCounts(batchId) {
    const result = await pool.query(
        `SELECT outcome, COUNT(*)::int AS count
         FROM import_row_logs
         WHERE batch_id = $1
         GROUP BY outcome`,
        [batchId]
    );

    const counts = {
        Inserted: 0,
        Duplicate: 0,
        Rejected: 0,
        Failed: 0
    };

    for (const row of result.rows) {
        counts[row.outcome] = row.count;
    }

    return counts;
}

async function finalizeBatch(batchId, totalRows, fatalError = false) {
    const counts = await getCounts(batchId);

    const handledCount = Object.values(counts)
        .reduce((sum, count) => sum + count, 0);

    const hasErrors =
        counts.Failed > 0 ||
        handledCount < totalRows;

    const status = fatalError
        ? "Failed"
        : hasErrors
            ? "CompletedWithErrors"
            : "Completed";

    await pool.query(
        `UPDATE import_batches
         SET total_rows = $2,
             inserted_rows = $3,
             duplicate_rows = $4,
             rejected_rows = $5,
             failed_rows = $6,
             status = $7,
             finished_at = NOW()
         WHERE id = $1`,
        [
            batchId,
            totalRows,
            counts.Inserted,
            counts.Duplicate,
            counts.Rejected,
            counts.Failed,
            status
        ]
    );

    return {
        batchId,
        totalRows,
        ...counts,
        status
    };
}

async function runBatch(batchId, filePath, rows, isResume) {
    const batchResult = await pool.query(
        `SELECT id, source_file, source_type, status
         FROM import_batches
         WHERE id = $1`,
        [batchId]
    );

    if (batchResult.rowCount === 0) {
        throw new Error(`Import batch ${batchId} was not found.`);
    }

    const batch = batchResult.rows[0];
    const extension = path.extname(filePath).toLowerCase();
    const sourceType = extension === ".csv" ? "csv" : "xlsx";

    if (
        batch.source_file !== path.basename(filePath) ||
        batch.source_type !== sourceType
    ) {
        throw new Error(
            "The supplied file name or type does not match this batch."
        );
    }

    if (isResume && batch.status === "Completed") {
        throw new Error(
            "This batch is already Completed and does not need recovery."
        );
    }

    if (!isResume && batch.status !== "Processing") {
        throw new Error(
            "This batch is not a new Processing batch."
        );
    }

    if (isResume && ![
        "Processing",
        "Failed",
        "CompletedWithErrors"
    ].includes(batch.status)) {
        throw new Error(
            `Batch status "${batch.status}" cannot be resumed.`
        );
    }

    // Load existing row outcomes so we can skip handled rows.
    const logsResult = await pool.query(
        `SELECT row_number, outcome
         FROM import_row_logs
         WHERE batch_id = $1`,
        [batchId]
    );

    const outcomesByRow = new Map(
        logsResult.rows.map(log => [
            log.row_number,
            log.outcome
        ])
    );

    await pool.query(
        `UPDATE import_batches
         SET status = 'Processing', finished_at = NULL
         WHERE id = $1`,
        [batchId]
    );

    let fatalError = null;

    for (const row of rows) {
        const previousOutcome = outcomesByRow.get(row.rowNumber);

        if (
            previousOutcome &&
            TERMINAL_OUTCOMES.has(previousOutcome)
        ) {
            continue;
        }

        try {
            await processRow(batchId, row, sourceType);
        } catch (error) {
            console.error(
                `Failed to process source row ${row.rowNumber}:`,
                error.message
            );

            try {
                await recordFailure(batchId, row, error);
            } catch (loggingError) {
                fatalError = loggingError;
                break;
            }

            if (
                ["ECONNREFUSED", "57P01", "57P02", "57P03"].includes(error.code)
            ) {
                fatalError = error;
                break;
            }
        }
    }

    try {
        const summary = await finalizeBatch(
            batchId,
            rows.length,
            Boolean(fatalError)
        );

        if (fatalError) {
            const error = new Error(
                `Batch ${batchId} stopped and may need recovery.`
            );
            error.cause = fatalError;
            error.summary = summary;
            throw error;
        }

        return summary;
    } catch (error) {
        console.error("Batch finalization/recovery issue:", error.message);
        throw error;
    }
}

export async function importSpreadsheet(filePath) {
    const rows = await readSpreadsheet(filePath);
    const batchId = await createImportBatch(filePath);

    return runBatch(batchId, filePath, rows, false);
}

export async function resumeImport(batchId, filePath) {
    const rows = await readSpreadsheet(filePath);

    return runBatch(String(batchId), filePath, rows, true);
}
