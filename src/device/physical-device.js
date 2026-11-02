
import { runCommand } from "../utils/command.js";
import { settings } from "../config/settings.js";
import { ADB_PATH } from "../config/paths.js";

export async function ensurePhysicalDevice(
    deviceSerial = settings.device.physicalDeviceSerial
) {
    const serial = deviceSerial;

    if (!serial) {
        throw new Error(
            "Set physicalDeviceSerial in src/config/settings.js."
        );
    }

    const result = await runCommand(
        ADB_PATH,
        ["devices", "-l"]
    );

    const lines = result.stdout.split(/\r?\n/);
    let deviceFound = false;

    for (const line of lines) {
        const parts = line.trim().split(/\s+/);

        if (parts[0] !== serial) {
            continue;
        }

        if (parts[1] === "unauthorized") {
            throw new Error(
                `Device ${serial} is unauthorized. Unlock your phone ` +
                "and accept the USB debugging authorization prompt."
            );
        }

        if (parts[1] !== "device") {
            throw new Error(
                `Device ${serial} is not ready. ADB status: ${parts[1]}.`
            );
        }

        deviceFound = true;
        break;
    }

    if (!deviceFound) {
        throw new Error(
            `Physical device ${serial} is not connected or visible to ADB.`
        );
    }

    await runCommand(
        ADB_PATH,
        ["-s", serial, "wait-for-device"],
        { timeout: settings.timeouts.device }
    );

    console.log(`Physical device ready: ${serial}`);

    return serial;
}
