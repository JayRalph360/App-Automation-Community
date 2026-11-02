
import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import ExcelJS from "exceljs";

function normalizeHeader(header) {
    return String(header ?? "")
        .trim()
        .toLowerCase()
        .replace(/[\s_-]+/g, "");
}

function getColumn(row, aliases) {
    const wanted = new Set(aliases.map(normalizeHeader));

    for (const [key, value] of Object.entries(row)) {
        if (wanted.has(normalizeHeader(key))) {
            return String(value ?? "").trim();
        }
    }

    return "";
}

export async function readSpreadsheet(filePath) {
    if (!fs.existsSync(filePath)) {
        throw new Error(`Spreadsheet not found: ${filePath}`);
    }

    const extension = path.extname(filePath).toLowerCase();
    let rawRows;

    if (extension === ".csv") {
        const content = fs.readFileSync(filePath, "utf8");

        rawRows = parse(content, {
            columns: true,
            skip_empty_lines: true,
            bom: true,
            trim: true
        });
    } else if (extension === ".xlsx") {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(filePath);

        const worksheet = workbook.worksheets[0];

        if (!worksheet) {
            throw new Error("The workbook contains no worksheets.");
        }

        const headers = worksheet.getRow(1).values;
        const columnNames = headers.slice(1).map(value =>
            String(value ?? "").trim()
        );

        rawRows = [];

        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber === 1) return;

            const record = {};

            columnNames.forEach((header, index) => {
                const cell = row.getCell(index + 1);
                record[header] = String(cell.text ?? "").trim();
            });

            if (Object.values(record).some(value => value !== "")) {
                rawRows.push(record);
            }
        });
    } else {
        throw new Error(
            `Unsupported file type "${extension}". Use .csv or .xlsx.`
        );
    }

    if (rawRows.length === 0) {
        throw new Error("The spreadsheet contains no data rows.");
    }

    return rawRows.map((row, index) => ({
        rowNumber: index + 2,
        businessName: getColumn(row, [
            "Business Name",
            "business_name"
        ]),
        number: getColumn(row, [
            "Number",
            "Phone Number",
            "Mobile Number"
        ]),
        email: getColumn(row, [
            "Email",
            "Email Address"
        ])
    }));
}
