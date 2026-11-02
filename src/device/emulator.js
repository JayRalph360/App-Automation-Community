import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { runCommand } from "../utils/command.js";
import { settings } from "../config/settings.js";
import { sleep } from "../utils/time.js";
import {
    ADB_PATH,
    EMULATOR_PATH,
    CAMERA_IMAGE_PATH
} from "../config/paths.js";

async function getRunningEmulators() {
    const result = await runCommand(
        ADB_PATH,
        ["devices"]
    );

    return result.stdout
        .split(/\r?\n/)
        .map(line => line.trim().split(/\s+/))
        .filter(parts =>
            parts[0]?.startsWith("emulator-") &&
            parts[1] === "device"
        )
        .map(parts => parts[0]);
}

async function getAvailableAvds() {
    const result = await runCommand(
        EMULATOR_PATH,
        ["-list-avds"]
    );

    return result.stdout
        .split(/\r?\n/)
        .map(name => name.trim())
        .filter(Boolean);
}

async function waitForEmulator(serial) {
    const timeout = settings.timeouts.device;
    const startTime = Date.now();

    console.log(`Waiting for ${serial} to become ready...`);

    await runCommand(
        ADB_PATH,
        ["-s", serial, "wait-for-device"],
        { timeout }
    );

    while (Date.now() - startTime < timeout) {
        try {
            const result = await runCommand(
                ADB_PATH,
                ["-s", serial, "shell", "getprop", "sys.boot_completed"],
                { timeout: 5000 }
            );

            if (result.stdout === "1") {
                console.log("Android has finished booting.");
                return;
            }
        } catch {
            // The emulator may still be starting.
        }

        await sleep(500);
    }

    throw new Error(
        `Emulator ${serial} did not finish booting within ${timeout} ms.`
    );
}

/**
 * Turn off Android's UI animations. These settings are stored on the
 * emulator, so they persist between runs. To restore them, run:
 *   adb shell settings put global window_animation_scale 1
 *   adb shell settings put global transition_animation_scale 1
 *   adb shell settings put global animator_duration_scale 1
 */
async function disableAnimations(serial) {
    const names = [
        "window_animation_scale",
        "transition_animation_scale",
        "animator_duration_scale"
    ];

    try {
        await Promise.all(
            names.map(name =>
                runCommand(
                    ADB_PATH,
                    [
                        "-s", serial,
                        "shell", "settings", "put", "global", name, "0"
                    ],
                    { timeout: 10000 }
                )
            )
        );

        console.log("Emulator animations are turned off.");
    } catch (error) {
        // Not fatal: the automation still works, just more slowly.
        console.warn(
            "Could not turn off emulator animations:",
            error.message
        );
    }
}

function startEmulator(avdName, args) {
    console.log(`Starting emulator: ${avdName}`);

    const emulatorProcess = spawn(
        EMULATOR_PATH,
        ["-avd", avdName, ...args],
        {
            stdio: "inherit",
            windowsHide: true,
        }
    );

    emulatorProcess.once("error", error => {
        console.error("Failed to start emulator:", error.message);
    });

    // Let the emulator continue running independently.
    emulatorProcess.unref();
}

export async function ensureEmulator() {
    const config = settings.device;

    const runningEmulators = await getRunningEmulators();

    if (
        config.emulatorSerial &&
        runningEmulators.includes(config.emulatorSerial)
    ) {
        console.log(`Reusing emulator: ${config.emulatorSerial}`);

        await waitForEmulator(config.emulatorSerial);
        await disableAnimations(config.emulatorSerial);

        return config.emulatorSerial;
    }

    if (
        config.emulatorSerial &&
        runningEmulators.length > 0
    ) {
        throw new Error(
            `Configured emulator ${config.emulatorSerial} is not running, ` +
            "but another emulator is already running. Close the other " +
            "emulator or update emulatorSerial in settings.js."
        );
    }

    if (runningEmulators.length > 1) {
        throw new Error(
            "Multiple emulators are running. Set emulatorSerial in settings.js."
        );
    }

    if (runningEmulators.length === 1) {
        const serial = runningEmulators[0];

        console.log(`Reusing running emulator: ${serial}`);
        await waitForEmulator(serial);
        await disableAnimations(serial);
        return serial;
    }

    const availableAvds = await getAvailableAvds();
    let avdName = config.emulatorAvd;

    if (!avdName && availableAvds.length === 1) {
        avdName = availableAvds[0];
    }

    if (!avdName) {
        throw new Error(
            availableAvds.length === 0
                ? "No Android Virtual Devices found. Create an AVD first."
                : "Multiple AVDs found. Set emulatorAvd in settings.js."
        );
    }

    if (!availableAvds.includes(avdName)) {
        throw new Error(
            `AVD "${avdName}" was not found. Available AVDs: ` +
            availableAvds.join(", ")
        );
    }

    // Skip the boot animation and the audio device: neither is needed
    // for automation.
    const args = ["-no-boot-anim", "-no-audio"];

    // Optional: add  emulatorGpu: "host"  to settings.device to use the
    // computer's GPU instead of software rendering. Leave it unset to
    // keep the current behaviour. Changing the graphics mode can make
    // the emulator discard its saved snapshot, so the first start after
    // a change is slower.
    if (config.emulatorGpu) {
        args.push("-gpu", config.emulatorGpu);
    }

    if (settings.camera.applyImage) {
        try {
            await fs.access(CAMERA_IMAGE_PATH);
        } catch {
            throw new Error(
                `Camera image not found: ${CAMERA_IMAGE_PATH}`
            );
        }

        args.push(
            "-camera-back",
            `imagefile:${CAMERA_IMAGE_PATH}`
        );
    }

    startEmulator(avdName, args);

    const startTime = Date.now();
    const timeout = settings.timeouts.device;
    let serial;

    while (Date.now() - startTime < timeout) {
        const currentEmulators = await getRunningEmulators();

        if (currentEmulators.length === 1) {
            serial = currentEmulators[0];
            break;
        }

        if (currentEmulators.length > 1) {
            throw new Error(
                "Multiple emulators appeared during startup. " +
                "Set emulatorSerial in settings.js."
            );
        }

        await sleep(500);
    }

    if (!serial) {
        throw new Error(
            `Emulator did not appear within ${timeout} ms.`
        );
    }

    await waitForEmulator(serial);
    await disableAnimations(serial);

    console.log(`Emulator ready: ${serial}`);
    return serial;
}