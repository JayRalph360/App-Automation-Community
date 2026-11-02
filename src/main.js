import { initializeDatabase } from "./database/init-db.js";
import { runConfiguredImport } from "./importer/import-runner.js";
import { settings } from "./config/settings.js";
import { selectDevice } from "./device/device-manager.js";
import { ensurePhysicalDevice } from "./device/physical-device.js";
import { ensureAppium } from "./appium/appium-manager.js";
import { createSession } from "./appium/session.js";
import { installApplication } from "./application/installer.js";
import { launchApplication } from "./application/launcher.js";
import { monitorScreens } from "./workflows/screen-monitor.js";
import { runMerchantOnboarding } from "./workflows/merchant-onboarding.js";
import {
    startArtifactRun,
    saveErrorArtifact,
    finishArtifactRun
} from "./artifacts/artifact-manager.js";
import {
    navigateToAlternateMerchantOnboarding
} from "./workflows/navigate-to-alternate-merchant-onboarding.js";

function secondsSince(startedAt) {
    return ((Date.now() - startedAt) / 1000).toFixed(1);
}

async function main() {
    let driver;
    let artifactRunStarted = false;
    let deviceSerial = null;
    let appiumUrl = null;

    const runStartedAt = Date.now();

    try {

        // 1. Ensure database and tables exist.
        await initializeDatabase();

        console.log("AppAutomation starting...");
        console.log(`Device mode: ${settings.device.mode}`);

        await runConfiguredImport();

        // 2. Start Appium NOW, in the background. It does not need the
        // device, so it can start while the emulator is booting. The
        // result is awaited later, right before the session is created.
        const appiumPromise = ensureAppium();

        // Prevents an "unhandled rejection" warning if device setup
        // fails first. The real error is thrown when it is awaited below.
        appiumPromise.catch(() => {});

        // 3. Select a device, starting the configured emulator if necessary.
        const selectedDevice = await selectDevice();

        if (selectedDevice.type === "physical") {
            deviceSerial = await ensurePhysicalDevice(
                selectedDevice.serial
            );
        } else {
            // selectDevice() has already prepared and verified the emulator.
            deviceSerial = selectedDevice.serial;
        }

        // 4. Install or update the application if necessary.
        await installApplication(deviceSerial);

        // 5. Wait for Appium (usually already ready by now).
        appiumUrl = await appiumPromise;

        // 6. Create an Appium session for the selected device.
        driver = await createSession(deviceSerial, appiumUrl);

        await launchApplication(deviceSerial);

        console.log(
            `[TIMING] Device, Appium and session ready after ` +
            `${secondsSince(runStartedAt)}s.`
        );

        // 7. Choose screen capture while navigating.
        if (settings.screenMonitor.enabled) {
            console.log("\nScreen capture mode is enabled.");
            console.log("New screens will be captured automatically.");

            // Create a directory for this capture session.
            await startArtifactRun(deviceSerial);
            artifactRunStarted = true;

            await monitorScreens(driver);
        } else {
            console.log("Screen monitoring is disabled.");
        }

        console.log("Running the automatic merchant onboarding navigation.");

        console.log("[1/3] Starting navigation...");
        await navigateToAlternateMerchantOnboarding(driver);
        console.log("[1/3] Navigation completed successfully.");

        console.log("[2/3] Starting merchant onboarding...");
        const onboardingStartedAt = Date.now();
        const summary = await runMerchantOnboarding(driver);
        console.log(
            "[3/3] Merchant onboarding finished:",
            summary,
            `(${secondsSince(onboardingStartedAt)}s)`
        );

        // 8. Record that the capture session has ended.
        if (artifactRunStarted) {
            await finishArtifactRun("stopped", {
                deviceSerial,
                appiumUrl,
                applicationPackage: settings.application.package,
                applicationActivity: settings.application.activity
            });

            artifactRunStarted = false;
        }

        console.log(
            `\nAutomation finished successfully in ` +
            `${secondsSince(runStartedAt)}s.`
        );
    } catch (error) {
        console.error("\nAutomation failed:");
        console.error(error.message);

        // Save diagnostic information when possible.
        if (driver && artifactRunStarted) {
            try {
                await saveErrorArtifact(error);
            } catch (artifactError) {
                console.error(
                    "Could not save error details:",
                    artifactError.message
                );
            }
        }

        if (artifactRunStarted) {
            try {
                await finishArtifactRun("failed", {
                    deviceSerial,
                    appiumUrl,
                    error: error.message
                });

                artifactRunStarted = false;
            } catch (artifactError) {
                console.error(
                    "Could not finish artifact run:",
                    artifactError.message
                );
            }
        }

        process.exitCode = 1;
    } finally {
        // 9. Close the Appium session without intentionally
        // shutting down the Android emulator.
        if (driver) {
            try {
                await driver.deleteSession();
                console.log("Appium session closed.");
            } catch (error) {
                console.error(
                    "Could not close Appium session:",
                    error.message
                );

                process.exitCode = 1;
            }
        }
    }
}

main();