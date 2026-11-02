import fs from "node:fs";
import path from "node:path";
import { exec, spawn } from "node:child_process";
import { settings } from "../config/settings.js";
import { PROJECT_ROOT } from "../config/paths.js";
import { sleep } from "../utils/time.js";

const APPIUM_HOST = settings.appium.host;
const APPIUM_PORT = settings.appium.port;
const APPIUM_URL = `http://${APPIUM_HOST}:${APPIUM_PORT}`;
const APPIUM_TIMEOUT = settings.timeouts.appium;

const IS_WINDOWS = process.platform === "win32";

// If Appium was installed in this project (npm install appium), use that
// copy and keep its drivers in the project's .appium folder. Otherwise
// fall back to a global Appium, exactly as before.
const LOCAL_APPIUM = path.join(
    PROJECT_ROOT,
    "node_modules",
    ".bin",
    IS_WINDOWS ? "appium.cmd" : "appium"
);

const USE_LOCAL_APPIUM = fs.existsSync(LOCAL_APPIUM);

const APPIUM_ENV = USE_LOCAL_APPIUM
    ? { ...process.env, APPIUM_HOME: path.join(PROJECT_ROOT, ".appium") }
    : process.env;

// Quoted for the Windows shell, which splits on spaces in paths.
const APPIUM_COMMAND = USE_LOCAL_APPIUM
    ? (IS_WINDOWS ? `"${LOCAL_APPIUM}"` : LOCAL_APPIUM)
    : "appium";

function runShellCommand(command, timeout = 30000) {
    return new Promise((resolve, reject) => {
        exec(
            command,
            {
                windowsHide: true,
                timeout,
                maxBuffer: 10 * 1024 * 1024,
                encoding: "utf8",
                env: APPIUM_ENV
            },
            (error, stdout, stderr) => {
                if (error) {
                    reject(new Error(
                        [
                            `Command failed: ${command}`,
                            error.message,
                            stderr?.trim(),
                            stdout?.trim()
                        ].filter(Boolean).join("\n")
                    ));
                    return;
                }

                resolve(stdout.trim());
            }
        );
    });
}

async function getInstalledDrivers() {
    try {
        return await runShellCommand(
            `${APPIUM_COMMAND} driver list --installed --json`
        );
    } catch (error) {
        throw new Error(
            "Could not list installed Appium drivers.\n" +
            "Run: appium driver list --installed\n" +
            error.message
        );
    }
}

async function checkAppiumInstallation() {
    // Both checks start the Appium CLI, which is slow on Windows,
    // so run them at the same time.
    const versionCheck = runShellCommand(`${APPIUM_COMMAND} --version`)
        .catch(error => {
            throw new Error(
                "Appium is not available.\n" +
                "Run 'npm install appium' in the project, or install it " +
                "globally with 'npm i -g appium'.\n" +
                error.message
            );
        });

    const [version, drivers] = await Promise.all([
        versionCheck,
        getInstalledDrivers()
    ]);

    console.log(
        `Appium version: ${version}` +
        (USE_LOCAL_APPIUM ? " (project copy)" : " (global)")
    );

    if (/uiautomator2/i.test(drivers)) {
        console.log("UiAutomator2 driver is installed.");
        return;
    }

    if (!USE_LOCAL_APPIUM) {
        throw new Error(
            "UiAutomator2 is not installed in the Appium installation " +
            "used by this script.\n" +
            "Run: appium driver install uiautomator2"
        );
    }

    // First run on a new computer: the project's own Appium has no
    // driver yet, so install it automatically (needs internet, takes
    // a minute or so).
    console.log(
        "Installing the UiAutomator2 driver into the project " +
        "(first run only)..."
    );

    await runShellCommand(
        `${APPIUM_COMMAND} driver install uiautomator2`,
        300000
    );

    console.log("UiAutomator2 driver is installed.");
}

async function isAppiumReady() {
    try {
        const response = await fetch(
            `${APPIUM_URL}/status`,
            {
                signal: AbortSignal.timeout(2000)
            }
        );

        if (!response.ok) {
            return false;
        }

        const data = await response.json();

        return data.value?.ready === true;
    } catch {
        return false;
    }
}

function startAppiumServer() {
    console.log(`Starting Appium at ${APPIUM_URL}...`);

    const appiumProcess = spawn(
        APPIUM_COMMAND,
        [
            "--address",
            APPIUM_HOST,
            "--port",
            String(APPIUM_PORT),
            // Suppress informational logs and retain warnings/errors.
            "--log-level",
            "warn"
        ],
        {
            stdio: "inherit",
            shell: IS_WINDOWS,
            windowsHide: true,
            env: APPIUM_ENV
        }
    );

    appiumProcess.on("error", error => {
        console.error(
            "Could not start Appium:",
            error.message
        );
    });

    appiumProcess.on("exit", (code, signal) => {
        if (code !== null && code !== 0) {
            console.error(`Appium exited with code ${code}.`);
        } else if (signal) {
            console.error(`Appium exited due to signal ${signal}.`);
        }
    });

    return appiumProcess;
}

export async function ensureAppium() {
    // If a server is already running, it is obviously installed and
    // working, so skip the slow CLI checks.
    if (await isAppiumReady()) {
        console.log("Appium server is already ready.");
        return APPIUM_URL;
    }

    await checkAppiumInstallation();

    startAppiumServer();

    const deadline = Date.now() + APPIUM_TIMEOUT;

    while (Date.now() < deadline) {
        if (await isAppiumReady()) {
            console.log("Appium server is ready.");
            return APPIUM_URL;
        }

        await sleep(500);
    }

    throw new Error(
        `Appium did not become ready at ${APPIUM_URL}.\n` +
        "Check whether the port is occupied or Appium failed to start."
    );
}