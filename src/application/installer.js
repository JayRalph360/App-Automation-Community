
import fs from "node:fs/promises";
import path from "node:path";
import { ADB_PATH, ANDROID_SDK, APK_PATH } from "../config/paths.js";
import { runCommand } from "../utils/command.js";
import { assertFileExists } from "../utils/files.js";

async function getAaptPath() {
    const buildToolsPath = path.join(ANDROID_SDK, "build-tools");

    let versions;

    try {
        versions = await fs.readdir(buildToolsPath);
    } catch {
        throw new Error(
            `Android SDK build-tools not found: ${buildToolsPath}`
        );
    }

    const availableTools = [];

    for (const version of versions) {
        const aaptPath = path.join(buildToolsPath, version, "aapt.exe");

        try {
            await fs.access(aaptPath);
            availableTools.push({
                version,
                path: aaptPath
            });
        } catch {
            // This build-tools version does not contain aapt.exe.
        }
    }

    availableTools.sort((a, b) =>
        b.version.localeCompare(a.version, undefined, {
            numeric: true
        })
    );

    if (availableTools.length === 0) {
        throw new Error(
            "aapt.exe was not found in Android SDK build-tools. " +
            "Install Android SDK Build-Tools using SDK Manager."
        );
    }

    return availableTools[0].path;
}

async function getApkInfo() {
    assertFileExists(APK_PATH, "APK file");

    const aaptPath = await getAaptPath();

    const result = await runCommand(
        aaptPath,
        ["dump", "badging", APK_PATH],
        { timeout: 30000 }
    );

    const packageMatch = result.stdout.match(
        /^package:\s+name='([^']+)'.*versionCode='([^']+)'.*versionName='([^']*)'/m
    );

    if (!packageMatch) {
        throw new Error(
            "Could not read the package name and version from the APK."
        );
    }

    return {
        packageName: packageMatch[1],
        versionCode: packageMatch[2],
        versionName: packageMatch[3]
    };
}

async function getInstalledAppInfo(deviceSerial, packageName) {
    // List packages instead of using "pm path".
    // An absent package returns an empty list rather than causing
    // the installation check to fail.
    const result = await runCommand(
        ADB_PATH,
        [
            "-s",
            deviceSerial,
            "shell",
            "pm",
            "list",
            "packages",
            packageName
        ],
        { timeout: 30000 }
    );

    const packageIsInstalled = result.stdout
        .split(/\r?\n/)
        .some(line => line.trim() === `package:${packageName}`);

    if (!packageIsInstalled) {
        return null;
    }

    // The package exists, so retrieve its installed version.
    const details = await runCommand(
        ADB_PATH,
        [
            "-s",
            deviceSerial,
            "shell",
            "dumpsys",
            "package",
            packageName
        ],
        { timeout: 30000 }
    );

    const versionCodeMatch = details.stdout.match(
        /^\s*versionCode=(\d+)/m
    );

    const versionNameMatch = details.stdout.match(
        /^\s*versionName=([^\s]+)/m
    );

    if (!versionCodeMatch) {
        throw new Error(
            `Could not read the installed version of ${packageName}.`
        );
    }

    return {
        packageName,
        versionCode: versionCodeMatch[1],
        versionName: versionNameMatch?.[1] ?? ""
    };
}

export async function installApplication(deviceSerial) {
    console.log(`Checking APK: ${APK_PATH}`);

    const apk = await getApkInfo();

    console.log(`APK package: ${apk.packageName}`);
    console.log(`APK version: ${apk.versionName} (${apk.versionCode})`);

    const installed = await getInstalledAppInfo(
        deviceSerial,
        apk.packageName
    );

    if (installed) {
        console.log(
            `Installed version: ${installed.versionName} ` +
            `(${installed.versionCode})`
        );

        if (
            installed.versionCode === apk.versionCode &&
            installed.versionName === apk.versionName
        ) {
            console.log(
                "The installed version matches the APK. Skipping installation."
            );

            return {
                installed: false,
                action: "skipped",
                packageName: apk.packageName,
                versionCode: apk.versionCode,
                versionName: apk.versionName
            };
        }

        if (
            Number(installed.versionCode) > Number(apk.versionCode)
        ) {
            throw new Error(
                "The installed app has a higher version code than the APK. " +
                "Installation was stopped to avoid an unintended downgrade."
            );
        }

        console.log("The installed version differs. Updating the app...");
    } else {
        console.log("App is not installed. Installing it...");
    }

    const result = await runCommand(
        ADB_PATH,
        [
            "-s",
            deviceSerial,
            "install",
            "-r",
            APK_PATH
        ],
        { timeout: 120000 }
    );

    if (!/\bSuccess\b/.test(result.stdout)) {
        throw new Error(
            `APK installation did not report success.\n${result.stdout}`
        );
    }

    const verified = await getInstalledAppInfo(
        deviceSerial,
        apk.packageName
    );

    if (
        !verified ||
        verified.versionCode !== apk.versionCode ||
        verified.versionName !== apk.versionName
    ) {
        throw new Error(
            "ADB reported installation success, but the installed " +
            "package version could not be verified."
        );
    }

    console.log("APK installation/update verified successfully.");

    return {
        installed: true,
        action: installed ? "updated" : "installed",
        packageName: apk.packageName,
        versionCode: apk.versionCode,
        versionName: apk.versionName
    };
}
