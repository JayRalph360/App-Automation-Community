
import { runCommand } from "../utils/command.js";
import { settings } from "../config/settings.js";
import { ADB_PATH } from "../config/paths.js";
import { ensureEmulator } from "./emulator.js";

async function getConnectedDevices() {
    const result = await runCommand(
        ADB_PATH,
        ["devices", "-l"]
    );

    const devices = [];

    for (const line of result.stdout.split(/\r?\n/)) {
        const parts = line.trim().split(/\s+/);

        if (parts.length < 2 || parts[1] !== "device") {
            continue;
        }

        const serial = parts[0];

        if (serial === "List") {
            continue;
        }

        const details = parts.slice(2).join(" ");
        const isEmulator =
            serial.startsWith("emulator-") ||
            details.includes("model:sdk_gphone");

        devices.push({
            serial,
            details,
            type: isEmulator ? "emulator" : "physical"
        });
    }

    return devices;
}

export async function selectDevice() {
    const config = settings.device;
    const mode = config.mode;

    if (mode !== "emulator" && mode !== "physical") {
        throw new Error(
            'Device mode must be "emulator" or "physical".'
        );
    }

    const preferredSerial =
        mode === "emulator"
            ? config.emulatorSerial
            : config.physicalDeviceSerial;

    const devices = await getConnectedDevices();

    // 1. Honor an explicitly configured serial.
    if (preferredSerial) {
        const preferredDevice = devices.find(
            device => device.serial === preferredSerial
        );

        if (preferredDevice) {
            if (preferredDevice.type !== mode) {
                throw new Error(
                    `Configured device ${preferredSerial} is a ` +
                    `${preferredDevice.type}, but mode is "${mode}".`
                );
            }

            console.log(
                `Selected ${preferredDevice.type}: ${preferredDevice.serial}`
            );

            return preferredDevice;
        }

        if (mode === "physical") {
            throw new Error(
                `Configured physical device ${preferredSerial} is not ` +
                "connected or ready. Check USB debugging and run adb devices."
            );
        }

        // Do not accidentally use a different running emulator.
        const otherEmulators = devices.filter(
            device => device.type === "emulator"
        );

        if (otherEmulators.length > 0) {
            throw new Error(
                `Configured emulator ${preferredSerial} is not running, ` +
                "but another emulator is connected: " +
                otherEmulators.map(device => device.serial).join(", ") +
                ". Close the other emulator or update emulatorSerial."
            );
        }

        console.log(
            `Configured emulator ${preferredSerial} is not running. ` +
            "Starting the configured AVD..."
        );

        const serial = await ensureEmulator();

        return {
            serial,
            details: "Started or prepared by ensureEmulator",
            type: "emulator"
        };
    }

    // 2. Discover devices matching the requested mode.
    const candidates = devices.filter(
        device => device.type === mode
    );

    // 3. Select the only matching device.
    if (candidates.length === 1) {
        console.log(
            `Selected ${candidates[0].type}: ${candidates[0].serial}`
        );

        return candidates[0];
    }

    // 4. Avoid choosing an arbitrary device.
    if (candidates.length > 1) {
        throw new Error(
            `Multiple ${mode} devices are connected:\n` +
            candidates
                .map(device => `- ${device.serial}`)
                .join("\n") +
            `\nSet ${mode === "emulator"
                ? "emulatorSerial"
                : "physicalDeviceSerial"} in settings.js.`
        );
    }

    // 5. Start an emulator when none matches.
    if (mode === "emulator") {
        console.log("No running emulator found. Starting one...");

        const serial = await ensureEmulator();

        return {
            serial,
            details: "Started or prepared by ensureEmulator",
            type: "emulator"
        };
    }

    throw new Error(
        "No connected physical Android device matches your configuration. " +
        "Connect and unlock your phone, enable USB debugging, and authorize " +
        "the computer when prompted."
    );
}
