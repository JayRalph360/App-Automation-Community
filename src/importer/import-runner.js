
import fs from "node:fs/promises";
import path from "node:path";

import { settings } from "../config/settings.js";
import { PROJECT_ROOT } from "../config/paths.js";
import { importSpreadsheet } from "./import-service.js";

const SUPPORTED_EXTENSIONS = [".csv", ".xlsx"];

async function moveFileWithoutOverwrite(sourcePath, destinationDir) {
    const extension = path.extname(sourcePath);
    const filename = path.basename(sourcePath, extension);

    let destinationPath = path.join(
        destinationDir,
        path.basename(sourcePath)
    );

    let counter = 1;

    while (true) {
        try {
            await fs.access(destinationPath);

            destinationPath = path.join(
                destinationDir,
                `${filename} (${counter})${extension}`
            );

            counter++;
        } catch {
            break;
        }
    }

    await fs.rename(sourcePath, destinationPath);

    console.log(`[IMPORT] File moved to: ${destinationPath}`);

    return destinationPath;
}

export async function runConfiguredImport() {
    if (!settings.importer.enabled) {
        console.log(
            "[IMPORT] Disabled. Using existing PostgreSQL records."
        );

        return null;
    }

    const inputDir = path.resolve(
        PROJECT_ROOT,
        settings.importer.inputDir
    );

    const processedDir = path.resolve(
        PROJECT_ROOT,
        settings.importer.processedDir
    );

    const failedDir = path.resolve(
        PROJECT_ROOT,
        settings.importer.failedDir
    );

    // Create directories if they do not exist.
    await Promise.all([
        fs.mkdir(inputDir, { recursive: true }),
        fs.mkdir(processedDir, { recursive: true }),
        fs.mkdir(failedDir, { recursive: true })
    ]);

    // Find supported spreadsheet files.
    const directoryEntries = await fs.readdir(inputDir, {
        withFileTypes: true
    });

    const files = directoryEntries
        .filter(entry =>
            entry.isFile() &&
            SUPPORTED_EXTENSIONS.includes(
                path.extname(entry.name).toLowerCase()
            )
        )
        .map(entry => entry.name)
        .sort();

    if (files.length === 0) {
        console.log(
            "\n[IMPORT] No CSV or Excel files found."
        );

        console.log(
            "[IMPORT] Using existing PostgreSQL records."
        );

        return [];
    }

    console.log(
        `\n[IMPORT] Found ${files.length} file(s) to import.`
    );

    const results = [];
    const importErrors = [];

    for (const filename of files) {
        const filePath = path.join(inputDir, filename);

        console.log("\n====================================");
        console.log(`[IMPORT] Processing: ${filename}`);
        console.log("====================================");

        try {
            const summary = await importSpreadsheet(filePath);

            console.log("[IMPORT] Import finished:");
            console.dir(summary, { depth: null });

            const destinationDir =
                summary.status === "Completed"
                    ? processedDir
                    : failedDir;

            await moveFileWithoutOverwrite(
                filePath,
                destinationDir
            );

            results.push({
                filename,
                ...summary
            });

            if (summary.status === "Failed") {
                importErrors.push(filename);
            }

        } catch (error) {
            console.error(
                `[IMPORT] Failed to import ${filename}:`,
                error.message
            );

            // Preserve the file for inspection or recovery.
            try {
                await moveFileWithoutOverwrite(
                    filePath,
                    failedDir
                );
            } catch (moveError) {
                console.error(
                    `[IMPORT] Could not move ${filename}:`,
                    moveError.message
                );

                throw new Error(
                    `Import failed and the file could not be moved: ${filename}`
                );
            }

            importErrors.push(filename);
        }
    }

    console.log("\n====================================");
    console.log("[IMPORT] ALL FILES PROCESSED");
    console.log("====================================");

    console.table(results);

    console.log(
        `[IMPORT] Successfully handled files: ${results.length}`
    );

    console.log(
        `[IMPORT] Files requiring attention: ${importErrors.length}`
    );

    if (importErrors.length > 0) {
        throw new Error(
            `${importErrors.length} file(s) encountered fatal import errors. ` +
            "Check the failed directory before continuing."
        );
    }

    console.log(
        "[IMPORT] PostgreSQL import stage finished."
    );

    return results;
}
