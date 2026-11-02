
import fs from "node:fs/promises";
import path from "node:path";
import { ARTIFACTS_DIR } from "../config/paths.js";
import { settings } from "../config/settings.js";
import { ensureDirectory } from "../utils/files.js";
import { timestamp } from "../utils/time.js";

let currentRunDirectory = null;

export async function startArtifactRun(deviceSerial) {

    if (!settings.screenMonitor.enabled) {
        return null;
    }

    const mode = settings.artifacts.mode;

    if (!["archive", "overwrite"].includes(mode)) {
        throw new Error(
            `Unsupported artifact mode: ${mode}. ` +
            'Use "archive" or "overwrite".'
        );
    }

    const runDirectory = mode === "archive"
        ? path.join(ARTIFACTS_DIR, "runs", timestamp())
        : path.join(ARTIFACTS_DIR, "latest");

    await ensureDirectory(runDirectory);
    currentRunDirectory = runDirectory;

    const metadata = {
        startedAt: new Date().toISOString(),
        deviceSerial,
        artifactMode: mode
    };

    await fs.writeFile(
        path.join(runDirectory, "run-info.json"),
        JSON.stringify(metadata, null, 2),
        "utf8"
    );

    console.log(`Artifacts directory: ${runDirectory}`);

    return runDirectory;
}

function getRunDirectory() {
    if (!currentRunDirectory) {
        throw new Error(
            "Artifact run has not been started. " +
            "Call startArtifactRun() first."
        );
    }

    return currentRunDirectory;
}

export async function saveScreenshot(
    driver,
    name = "screenshot"
) {
    if (!settings.screenMonitor.enabled) {
        return null;
    }
    
    const directory = getRunDirectory();
    const filePath = path.join(
        directory,
        `${name}-${timestamp()}.png`
    );

    const base64Image = await driver.takeScreenshot();

    await fs.writeFile(
        filePath,
        Buffer.from(base64Image, "base64")
    );

    console.log(`Screenshot saved: ${filePath}`);

    return filePath;
}

export async function savePageSource(
    driver,
    name = "page-source"
) {

    if (!settings.screenMonitor.enabled) {
        return null;
    }

    const directory = getRunDirectory();
    const filePath = path.join(
        directory,
        `${name}-${timestamp()}.xml`
    );

    const source = await driver.getPageSource();

    await fs.writeFile(filePath, source, "utf8");

    console.log(`Page source saved: ${filePath}`);

    return filePath;
}

export async function saveTextArtifact(name, content) {
    const directory = getRunDirectory();
    const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "_");
    const filePath = path.join(directory, `${safeName}.txt`);

    await fs.writeFile(filePath, String(content), "utf8");

    return filePath;
}

export async function saveErrorArtifact(error) {
    const directory = getRunDirectory();

    const errorDetails = {
        capturedAt: new Date().toISOString(),
        name: error?.name ?? "Error",
        message: error?.message ?? String(error),
        stack: error?.stack ?? null
    };

    const filePath = path.join(directory, "error.json");

    await fs.writeFile(
        filePath,
        JSON.stringify(errorDetails, null, 2),
        "utf8"
    );

    console.log(`Error details saved: ${filePath}`);

    return filePath;
}

export async function finishArtifactRun(status, details = {}) {
    const directory = getRunDirectory();
    const metadataPath = path.join(directory, "run-info.json");

    let metadata = {};

    try {
        metadata = JSON.parse(
            await fs.readFile(metadataPath, "utf8")
        );
    } catch {
        // Continue so the final status can still be recorded.
    }

    metadata.finishedAt = new Date().toISOString();
    metadata.status = status;
    metadata.details = details;

    await fs.writeFile(
        metadataPath,
        JSON.stringify(metadata, null, 2),
        "utf8"
    );

    console.log(`Artifact run finished: ${status}`);

    currentRunDirectory = null;
}

export async function captureScreen(driver, label = "screen") {
    if (!settings.screenMonitor.enabled) {
        return null;
    }

    if (!currentRunDirectory) {
        throw new Error("Start an artifact run before capturing screens.");
    }

    const captureTime = timestamp();

    const [screenshot, pageSource] = await Promise.all([
        driver.takeScreenshot(),
        driver.getPageSource()
    ]);

    const screenshotPath = path.join(
        currentRunDirectory,
        `${label}-${captureTime}.png`
    );

    const xmlPath = path.join(
        currentRunDirectory,
        `${label}-${captureTime}.xml`
    );

    await Promise.all([
        fs.writeFile(screenshotPath, screenshot, "base64"),
        fs.writeFile(xmlPath, pageSource, "utf8")
    ]);

    console.log(`Screen captured: ${label}`);
    console.log(`  Screenshot: ${screenshotPath}`);
    console.log(`  XML:        ${xmlPath}`);

    return { screenshotPath, xmlPath, pageSource };
}