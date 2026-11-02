
import { captureScreen } from "../artifacts/artifact-manager.js";
import { sleep } from "../utils/time.js";

const POLL_INTERVAL_MS = 1000;
const STABILITY_DELAY_MS = 700;

export async function monitorScreens(driver) {
    let screenNumber = 0;
    let stopping = false;

    const handleStop = () => {
        stopping = true;
        console.log("\nStopping screen capture...");
    };

    process.on("SIGINT", handleStop);

    try {
        // Wait for the current screen's hierarchy.
        let lastCapturedSource = await driver.getPageSource();

        // Capture the screen visible when monitoring begins.
        screenNumber++;

        let result = await captureScreen(
            driver,
            `screen-${String(screenNumber).padStart(3, "0")}`
        );

        lastCapturedSource = result.pageSource;

        console.log(`Captured screen ${screenNumber}.`);
        console.log("Screen monitoring is active.");
        console.log("Tap buttons in the emulator to open new screens.");
        console.log("Press Ctrl+C when you are finished.\n");

        while (!stopping) {
            await sleep(POLL_INTERVAL_MS);

            if (stopping) break;

            let currentSource = await driver.getPageSource();

            // No UI hierarchy change: keep monitoring.
            if (currentSource === lastCapturedSource) {
                continue;
            }

            // Give animations and screen transitions time to finish.
            await sleep(STABILITY_DELAY_MS);

            if (stopping) break;

            const stableSource = await driver.getPageSource();

            // The screen is still changing; wait for the next poll.
            if (stableSource !== currentSource) {
                continue;
            }

            // Ignore a hierarchy that has returned to the last captured state.
            if (stableSource === lastCapturedSource) {
                continue;
            }

            screenNumber++;

            result = await captureScreen(
                driver,
                `screen-${String(screenNumber).padStart(3, "0")}`
            );

            lastCapturedSource = result.pageSource ?? stableSource;

            console.log(`Captured new screen ${screenNumber}.`);
        }
    } finally {
        process.removeListener("SIGINT", handleStop);
        console.log("Screen monitoring stopped.");
    }
}
