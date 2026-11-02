import fs from "node:fs";
import path from "node:path";
import { pool } from "../database/pool.js";

// One report file for every run, kept in a "reports" folder in the
// project root (the folder you run `npm start` from).
const REPORT_DIR = path.resolve(process.cwd(), "reports");
const REPORT_FILE = path.join(REPORT_DIR, "onboarding-report.csv");

const HEADER = [
    "Run started",
    "Number",
    "Business name",
    "Outcome",
    "Seconds",
    "Attempts",
    "Error"
];


function csvCell(value) {
    const text = String(value ?? "");

    return /[",\r\n]/.test(text)
        ? `"${text.replace(/"/g, '""')}"`
        : text;
}


function csvLine(cells) {
    return cells.map(csvCell).join(",");
}


function formatTime(timestamp) {
    return new Date(timestamp)
        .toISOString()
        .replace("T", " ")
        .slice(0, 19);
}


function fileTimestamp(timestamp) {
    return new Date(timestamp)
        .toISOString()
        .replace(/:/g, "-")
        .slice(0, 19);
}


/**
 * Overall totals across the whole merchants table.
 * Returns null if the query fails, so the report is still written.
 */
async function getDatabaseTotals() {
    try {
        const result = await pool.query(
            `SELECT status, COUNT(*)::int AS count
             FROM merchants
             GROUP BY status`
        );

        const totals = {
            Completed: 0,
            Active: 0,
            Incompleted: 0
        };

        for (const row of result.rows) {
            totals[row.status] = row.count;
        }

        return totals;
    } catch (error) {
        console.error(
            "[REPORT] Could not read database totals:",
            error.message
        );

        return null;
    }
}


/**
 * Print a short summary of this run in the terminal.
 */
async function printRunSummary(results) {
    const created = results.filter(r => r.outcome === "Created");
    const existed = results.filter(r => r.outcome === "Already existed");
    const failed = results.filter(r => r.outcome === "Failed");

    const averageText = created.length > 0
        ? ` (average ${(
            created.reduce((sum, r) => sum + r.seconds, 0) /
            created.length
        ).toFixed(1)}s per created merchant)`
        : "";

    console.log(
        `[REPORT] This run: ${results.length} processed - ` +
        `${created.length} created, ${existed.length} already existed, ` +
        `${failed.length} failed${averageText}.`
    );

    const totals = await getDatabaseTotals();

    if (totals) {
        const total =
            totals.Completed + totals.Active + totals.Incompleted;

        console.log(
            `[REPORT] Database: ${total} merchants, ` +
            `${totals.Completed} completed, ` +
            `${totals.Incompleted + totals.Active} remaining.`
        );
    }
}


/**
 * Add rows to the report file, creating it (with a header) if needed.
 */
function appendRows(filePath, rows) {
    const isNewFile =
        !fs.existsSync(filePath) || fs.statSync(filePath).size === 0;

    // The BOM makes Excel read the file as UTF-8. It is only written
    // once, at the very start of a new file.
    const prefix = isNewFile
        ? "\uFEFF" + csvLine(HEADER) + "\r\n"
        : "";

    fs.appendFileSync(filePath, prefix + rows.join("\r\n") + "\r\n");
}


/**
 * Record an onboarding run: one row per merchant processed, added to
 * reports/onboarding-report.csv.
 *
 * results: [{ number, businessName, outcome, seconds, attempts, error }]
 * outcome is "Created", "Already existed" or "Failed".
 *
 * Returns the path of the file that was written.
 */
export async function writeOnboardingReport({
    results,
    startedAt
}) {
    await printRunSummary(results);

    fs.mkdirSync(REPORT_DIR, { recursive: true });

    const runLabel = formatTime(startedAt);

    const rows = results.map(r => csvLine([
        runLabel,
        r.number,
        r.businessName,
        r.outcome,
        r.seconds.toFixed(1),
        r.attempts ?? "",
        r.error ?? ""
    ]));

    try {
        appendRows(REPORT_FILE, rows);

        return REPORT_FILE;
    } catch (error) {
        // Most likely the report is open in Excel, which locks the file
        // on Windows. Save this run separately instead of losing it.
        const fallbackFile = path.join(
            REPORT_DIR,
            `onboarding-report-${fileTimestamp(startedAt)}.csv`
        );

        fs.writeFileSync(
            fallbackFile,
            "\uFEFF" +
            csvLine(HEADER) + "\r\n" +
            rows.join("\r\n") + "\r\n"
        );

        console.warn(
            `[REPORT] Could not update ${REPORT_FILE} ` +
            `(is it open in Excel?): ${error.message}`
        );

        return fallbackFile;
    }
}