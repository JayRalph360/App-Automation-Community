
import { runCommand } from "../utils/command.js";
import { settings } from "../config/settings.js";
import { ADB_PATH } from "../config/paths.js";

export async function launchApplication(deviceSerial) {
    const packageName = settings.application.package;
    const activityName = settings.application.activity;

    if (!packageName || !activityName) {
        throw new Error(
            "Configure the application package and activity in " +
            "src/config/settings.js."
        );
    }

    console.log(`Launching application on ${deviceSerial}...`);

    await runCommand(
        ADB_PATH,
        [
            "-s",
            deviceSerial,
            "shell",
            "am",
            "start",
            "-W",
            "-n",
            `${packageName}/${activityName}`
        ],
        { timeout: settings.timeouts.screen }
    );

    console.log("Application launch command completed.");

    return true;
}
