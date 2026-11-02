import { remote } from "webdriverio";

// UiAutomator2 waits for the screen to go "idle" before every command.
// The default is 10 seconds, and an app that is always animating (such
// as a Flutter app) can make each command wait close to that long.
// A low value makes every command much faster. Our scripts already use
// explicit waits. If the automation becomes flaky, raise this to
// 500-1000, or remove the updateSettings call below.
const WAIT_FOR_IDLE_TIMEOUT_MS = 100;

export async function createSession(
    deviceSerial,
    appiumUrl
) {
    console.log(
        `Creating Appium session for device ${deviceSerial}...`
    );

    const capabilities = {
        platformName: "Android",
        "appium:automationName": "UiAutomator2",
        "appium:udid": deviceSerial,
        "appium:newCommandTimeout": 120,
        "appium:autoGrantPermissions": true,

        // Turns off window animations while the session is active.
        "appium:disableWindowAnimation": true,

        // The emulator renders in software, so give the on-device
        // UiAutomator2 server more time to start.
        "appium:uiautomator2ServerLaunchTimeout": 60000,
        "appium:adbExecTimeout": 60000
    };

    const serverUrl = new URL(appiumUrl);

    const driver = await remote({
        protocol: serverUrl.protocol.replace(":", ""),
        hostname: serverUrl.hostname,
        port: Number(serverUrl.port),
        path: "/",
        // Only display warnings and errors from WebdriverIO.
        logLevel: "warn",
        capabilities
    });

    try {
        await driver.updateSettings({
            waitForIdleTimeout: WAIT_FOR_IDLE_TIMEOUT_MS
        });
    } catch (error) {
        // Not fatal: the automation still works, just more slowly.
        console.warn(
            "Could not lower the idle wait timeout:",
            error.message
        );
    }

    console.log("Appium session created successfully.");

    return driver;
}