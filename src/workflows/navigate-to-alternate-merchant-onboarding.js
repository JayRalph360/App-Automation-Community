import { sleep } from "../utils/time.js";

const TARGET_SCREEN_TITLE = "Merchant Onboarding";
const TARGET_BUTTON = "~Alternate Merchant Onboarding";
const MENU_TITLE = 'pane-title="Navigation menu"';

// Pane titles of the pop-ups that can be left open when the app starts:
//   "Popup menu" - a drop-down list (for example Business Type)
//   "Alert"      - a dialog (for example the items selector with OK/CANCEL)
const OVERLAY_PANES = [
    'pane-title="Popup menu"',
    'pane-title="Alert"'
];

const MAX_OVERLAY_ATTEMPTS = 6;

// The camera app that the merchant form opens for the photo step. If
// the automation starts while it is on screen, the app is hidden behind it.
const CAMERA_PACKAGES = [
    "com.android.camera2",
    "com.google.android.GoogleCamera"
];

const MAX_CAMERA_ATTEMPTS = 5;

// The app's notice banner, for example "Error getting Image" after the
// camera was cancelled. It covers the X button for a few seconds, and a
// tap on X while it is showing is absorbed by the banner.
const NOTICE_MARKER = 'content-desc="Notice';

// How long to keep trying to close the stale form before giving up.
const CLOSE_FORM_TIMEOUT = 30000;

async function getPageSource(driver) {
    return await driver.getPageSource();
}

async function waitForAppReady(driver, timeout = 60000) {
    console.log("Waiting for the app to finish loading...");

    await waitForSource(
        driver,
        source => !source.includes('content-desc="Loading..."'),
        "the app to finish loading",
        timeout
    );

    console.log("App loading indicator has disappeared.");
}

async function waitForSource(driver, predicate, description, timeout = 20000) {
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
        const source = await getPageSource(driver);

        if (predicate(source)) {
            return source;
        }

        await sleep(500);
    }

    throw new Error(
        `Timed out waiting for ${description}.`
    );
}

async function isTargetScreen(driver) {
    const source = await getPageSource(driver);

    return (
        source.includes(`pane-title="${TARGET_SCREEN_TITLE}"`) &&
        source.includes('content-desc="Create Merchant"')
    );
}


function hasOverlay(source) {
    return OVERLAY_PANES.some(pane => source.includes(pane));
}


/**
 * Press the Android Back key.
 */
async function pressBack(driver) {
    try {
        await driver.execute("mobile: pressKey", { keycode: 4 });
    } catch {
        await driver.back();
    }
}


/**
 * The camera app is in front of our app. Its screens show up in the
 * page source with the camera's package name.
 */
function isCameraScreen(source) {
    return CAMERA_PACKAGES.some(pkg => source.includes(`package="${pkg}"`));
}


/**
 * The camera's review screen (Retake / Done / Cancel), shown after a
 * photo has been taken, as opposed to the live viewfinder.
 */
function isCameraReviewScreen(source) {
    return (
        source.includes("com.android.camera2:id/cancel_button") ||
        (
            source.includes('content-desc="Retake"') &&
            source.includes('content-desc="Cancel"')
        )
    );
}


/**
 * If the camera is open (viewfinder or review screen), leave it and
 * return to the app, so the form's X button can be reached.
 *
 *   - Review screen: tap Cancel, which hands nothing back to the app.
 *   - Viewfinder: press the Android Back key.
 *
 * Nothing is saved from the interrupted photo step. The merchant is
 * simply registered again from the start on this run.
 */
async function leaveCamera(driver) {
    for (let attempt = 1; attempt <= MAX_CAMERA_ATTEMPTS; attempt++) {
        const source = await getPageSource(driver);

        if (!isCameraScreen(source)) {
            if (attempt > 1) {
                console.log("Back in the app.");
            }

            return;
        }

        const review = isCameraReviewScreen(source);

        console.log(
            `The camera ${review ? "review screen" : "viewfinder"} is ` +
            `open (attempt ${attempt}/${MAX_CAMERA_ATTEMPTS}). ` +
            "Going back to the app..."
        );

        let tapped = false;

        if (review) {
            for (const selector of [
                "id=com.android.camera2:id/cancel_button",
                "~Cancel"
            ]) {
                const cancelButton = await driver.$(selector);

                if (await cancelButton.isDisplayed().catch(() => false)) {
                    await cancelButton.click().catch(() => {});
                    tapped = true;
                    break;
                }
            }
        }

        if (!tapped) {
            await pressBack(driver);
        }

        await sleep(800);
    }

    const finalSource = await getPageSource(driver);

    if (isCameraScreen(finalSource)) {
        throw new Error(
            "The camera is still open and could not be closed."
        );
    }
}


/**
 * Close any drop-down list or dialog that is open on top of the screen.
 *
 * If the app was left (or restored) with, for example, the Business Type
 * list open, the form underneath, including its X button, is hidden and
 * cannot be reached until that pop-up is closed.
 *
 * The "Dismiss" element is deliberately NOT tapped: it covers the whole
 * screen, so tapping its center would land on the drop-down's options
 * and select one.
 *
 * Attempts alternate between:
 *   - CANCEL (dialogs that have it) or the Android Back key
 *   - a tap on the empty backdrop near the top of the screen
 */
async function dismissOverlays(driver) {
    for (let attempt = 1; attempt <= MAX_OVERLAY_ATTEMPTS; attempt++) {
        const source = await getPageSource(driver);

        if (!hasOverlay(source)) {
            if (attempt > 1) {
                console.log("The pop-up is closed.");
            }

            return;
        }

        const kind = source.includes('pane-title="Alert"')
            ? "dialog"
            : "drop-down";

        console.log(
            `A ${kind} is open (attempt ${attempt}/${MAX_OVERLAY_ATTEMPTS}). ` +
            "Closing it..."
        );

        const useBackdropTap = attempt % 2 === 0;

        if (useBackdropTap) {
            const { width, height } = await driver.getWindowSize();

            await driver.execute("mobile: clickGesture", {
                x: Math.round(width * 0.5),
                y: Math.round(height * 0.06)
            });
        } else if (source.includes('content-desc="CANCEL"')) {
            // CANCEL changes nothing, unlike OK.
            try {
                const cancelButton = await driver.$("~CANCEL");

                await cancelButton.click();
            } catch (error) {
                console.warn(
                    "CANCEL tap failed, using Back instead:",
                    error.message
                );

                await pressBack(driver);
            }
        } else {
            await pressBack(driver);
        }

        await sleep(600);
    }

    const finalSource = await getPageSource(driver);

    if (hasOverlay(finalSource)) {
        throw new Error(
            "A pop-up or drop-down is still open and could not be closed."
        );
    }
}


async function openNavigationMenu(driver) {
    const deadline = Date.now() + 30000;

    console.log("Waiting for the navigation menu to open...");

    while (Date.now() < deadline) {
        let source = await getPageSource(driver);

        if (source.includes(MENU_TITLE)) {
            console.log("Navigation menu opened.");
            return;
        }

        const menuButton = await driver.$("~Open navigation menu");

        if (await menuButton.isExisting()) {
            try {
                await menuButton.click();
                await sleep(1200);
            } catch (error) {
                console.warn(
                    "Menu button click failed:",
                    error.message
                );
            }

            source = await getPageSource(driver);

            if (source.includes(MENU_TITLE)) {
                console.log("Navigation menu opened with element click.");
                return;
            }

            // Retry using the actual button location.
            try {
                const rect = await menuButton.getRect();

                await driver.execute("mobile: clickGesture", {
                    x: Math.round(rect.x + rect.width / 2),
                    y: Math.round(rect.y + rect.height / 2)
                });

                await sleep(1200);
            } catch (error) {
                console.warn(
                    "Coordinate tap failed:",
                    error.message
                );
            }

            source = await getPageSource(driver);

            if (source.includes(MENU_TITLE)) {
                console.log("Navigation menu opened with coordinate tap.");
                return;
            }
        } else {
            await sleep(500);
        }
    }

    const finalSource = await getPageSource(driver);

    console.error(
        "Navigation menu failed to open after retries."
    );
    console.error(
        "Home visible:",
        finalSource.includes('pane-title="Home v1.6.0"')
    );
    console.error(
        "Menu button visible:",
        finalSource.includes(
            'content-desc="Open navigation menu"'
        )
    );
    console.error(
        "Navigation menu visible:",
        finalSource.includes(MENU_TITLE)
    );

    throw new Error(
        "Navigation menu did not open after repeated attempts."
    );
}


async function openFieldOperations(driver) {
    let source = await getPageSource(driver);

    if (source.includes('content-desc="Field operations, Expanded"')) {
        console.log("Field operations is already expanded.");
        return;
    }

    const collapsedSection = await driver.$(
        "~Field operations, Collapsed"
    );

    if (!(await collapsedSection.isExisting())) {
        throw new Error(
            "Could not find Field operations in the navigation menu."
        );
    }

    await collapsedSection.click();

    await waitForSource(
        driver,
        currentSource =>
            currentSource.includes(
                'content-desc="Field operations, Expanded"'
            ) &&
            currentSource.includes(
                'content-desc="Alternate Merchant Onboarding"'
            ),
        "the expanded Field operations section"
    );

    console.log("Field operations expanded.");
}

async function selectAlternateMerchantOnboarding(driver) {
    const targetButton = await driver.$(TARGET_BUTTON);

    await targetButton.waitForDisplayed({
        timeout: 15000,
        timeoutMsg: "Alternate Merchant Onboarding was not displayed."
    });

    await targetButton.click();

    await waitForSource(
        driver,
        source =>
            source.includes(`pane-title="${TARGET_SCREEN_TITLE}"`) &&
            source.includes('content-desc="Create Merchant"'),
        "the Alternate Merchant Onboarding screen",
        30000
    );

    // Give the destination screen a moment to settle.
    // await sleep(1500);

    console.log("Alternate Merchant Onboarding is open.");
}


/**
 * True when the merchant list is showing and the Create Merchant form
 * is closed.
 */
function isMerchantListShowing(source) {
    return (
        source.includes('pane-title="Merchant Onboarding"') &&
        source.includes('content-desc="Create Merchant"') &&
        !source.includes('pane-title="Create Merchant"')
    );
}


/**
 * Close a Create Merchant form that was left open.
 *
 * The app's notice banner (for example "Error getting Image" after the
 * camera was cancelled) sits on top of the X button for a few seconds.
 * While it is showing, nothing is tapped. Once it has gone, X is tapped,
 * and the tap is repeated until the merchant list appears.
 */
async function closeStaleMerchantForm(driver) {
    const source = await getPageSource(driver);

    // Only close the form if it is currently open.
    if (!source.includes('pane-title="Create Merchant"')) {
        return false;
    }

    console.log(
        "Create Merchant form is already open. Closing it to reset the workflow..."
    );

    const deadline = Date.now() + CLOSE_FORM_TIMEOUT;

    let attempt = 0;
    let waitingLogged = false;

    while (Date.now() < deadline) {
        const current = await getPageSource(driver);

        if (isMerchantListShowing(current)) {
            console.log("Merchant list is ready.");
            return true;
        }

        // A notice is covering the X button: let it disappear first.
        if (current.includes(NOTICE_MARKER)) {
            if (!waitingLogged) {
                console.log(
                    "A notice is covering the X button. " +
                    "Waiting for it to disappear..."
                );

                waitingLogged = true;
            }

            await sleep(300);
            continue;
        }

        const closeButton = await driver.$("~Close");

        if (
            current.includes('pane-title="Create Merchant"') &&
            await closeButton.isDisplayed().catch(() => false)
        ) {
            attempt++;

            console.log(`Tapping Close (attempt ${attempt})...`);

            await closeButton.click().catch(() => {});
        }

        // Give the app a moment to leave the form.
        await sleep(1000);
    }

    throw new Error(
        "Timed out waiting for the merchant list after closing the form."
    );
}


export async function navigateToAlternateMerchantOnboarding(driver) {
    console.log(
        "\nNavigating to Alternate Merchant Onboarding..."
    );

    // If the app was left on the camera, return to the app first.
    await leaveCamera(driver);

    // Close any drop-down or dialog left open, so the form underneath
    // (and its X button) can be reached.
    await dismissOverlays(driver);

    // Recover if the app restored a previous Create Merchant form.
    await closeStaleMerchantForm(driver);

    // If already on the target screen, don't navigate away.
    if (await isTargetScreen(driver)) {
        console.log(
            "Already on Alternate Merchant Onboarding. Skipping navigation."
        );
        return;
    }

    await waitForAppReady(driver);

    await openNavigationMenu(driver);

    // Check again in case the menu interaction exposed the target screen
    // or the app changed state unexpectedly.
    if (await isTargetScreen(driver)) {
        console.log("Target screen is already open.");
        return;
    }

    await openFieldOperations(driver);
    await selectAlternateMerchantOnboarding(driver);

    console.log(
        "Navigation completed. Form automation has not started."
    );
}