import fs from "node:fs";

export function assertFileExists(filePath, description = "File") {
    if (!fs.existsSync(filePath)) {
        throw new Error(`${description} not found: ${filePath}`);
    }
}

export function ensureDirectory(directoryPath) {
    fs.mkdirSync(directoryPath, { recursive: true });
}
