const ELEMENT_TIMEOUT = 20000;
const POLL_INTERVAL = 300;
const MAX_SCROLL_ATTEMPTS = 6;

// Longest we wait for Submit to produce a result of any kind.
const SUBMIT_TIMEOUT = 45000;

// If the form is still open (and not loading) this long after Submit,
// treat the submission as rejected. This covers a rejection notice
// that cannot be read from the screen.
const STUCK_AFTER_MS = 12000;

const LOADING_MARKER = 'content-desc="Loading..."';

// The app's rejection notice, for example:
//   "Notice - Agent number already exists. Duplicate not allowed."
const DUPLICATE_NOTICE_PATTERN =
    /(?:content-desc|text)="([^"]*(?:already exists|duplicate not allowed)[^"]*)"/i;


async function waitForCondition(
    condition,
    description,
    timeout = ELEMENT_TIMEOUT
) {
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
        if (await condition()) {
            return;
        }

        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
    }

    throw new Error(`Timed out waiting for ${description}.`);
}


async function findDisplayedElement(driver, selectors) {
    for (const selector of selectors) {
        const element = await driver.$(selector);

        if (await element.isDisplayed().catch(() => false)) {
            return element;
        }
    }

    return null;
}


/**
 * Compact summary of the current screen for failure logs:
 * the pane title plus every content-desc, instead of the full XML.
 */
function describeScreen(source) {
    const paneTitle = source.match(/pane-title="([^"]*)"/)?.[1] ?? "(none)";

    const descriptions = [];

    for (const match of source.matchAll(/content-desc="([^"]*)"/g)) {
        if (match[1]) {
            descriptions.push(match[1].replace(/&#10;/g, " | "));
        }
    }

    return (
        `pane-title="${paneTitle}"; content-desc: ` +
        JSON.stringify(descriptions)
    );
}


/**
 * Run an action and, if it fails, log what the screen looked like.
 */
async function dumpScreenOnFailure(driver, label, action) {
    try {
        return await action();
    } catch (error) {
        try {
            const source = await driver.getPageSource();

            console.error(
                `[PHOTO] ${label} failed. Screen at failure: ` +
                describeScreen(source)
            );
        } catch {
            // Ignore: the original error is more useful.
        }

        throw error;
    }
}


/**
 * The app's Photo step now shows a captured image.
 *
 * Submit is deliberately NOT required here: before the form is
 * scrolled it sits at the very bottom edge of the screen and may be
 * missing from the accessibility tree. It is located later, after
 * scrolling.
 */
function isPhotoPreviewReady(source) {
    return (
        source.includes('pane-title="Create Merchant"') &&
        source.includes('content-desc="Re-capture Image"')
    );
}


/**
 * The camera app's review screen that appears after the shutter is
 * pressed: Retake / Done (tick) / Cancel.
 */
function isCameraReviewScreen(source) {
    return (
        source.includes("com.android.camera2:id/done_button") ||
        (
            source.includes('content-desc="Done"') &&
            source.includes('content-desc="Retake"')
        )
    );
}


async function waitForPhotoStep(driver) {
    await waitForCondition(
        async () => {
            const source = await driver.getPageSource();

            return (
                source.includes('pane-title="Create Merchant"') &&
                source.includes('content-desc="Photo"')
            );
        },
        "the Photo step"
    );
}


async function openCamera(driver) {
    const button = await findDisplayedElement(driver, [
        "~Capture Image",
        "~Re-capture Image"
    ]);

    if (!button) {
        throw new Error(
            "Neither Capture Image nor Re-capture Image is available."
        );
    }

    await button.click();

    await waitForCondition(
        async () => {
            const source = await driver.getPageSource();

            return (
                source.includes("shutter_button") ||
                source.includes('content-desc="Shutter"') ||
                source.includes('content-desc="Take picture"') ||
                source.includes('content-desc="Capture"')
            );
        },
        "the camera shutter",
        30000
    );

    console.log("Camera is ready.");
}


/**
 * After the shutter, the camera shows a review screen. The photo is
 * only handed back to the app once Done (the tick) is tapped.
 */
async function confirmCameraReview(driver) {
    const doneButton = await findDisplayedElement(driver, [
        "id=com.android.camera2:id/done_button",
        "~Done"
    ]);

    if (!doneButton) {
        throw new Error(
            "The camera review screen is open, but its Done button " +
            "could not be located."
        );
    }

    await doneButton.click();

    console.log("Photo accepted with Done.");
}


async function capturePhoto(driver) {
    const shutter = await findDisplayedElement(driver, [
        "id=com.android.camera2:id/shutter_button",
        "id=com.google.android.GoogleCamera:id/shutter_button",
        "~Shutter",
        "~Take picture",
        "~Capture"
    ]);

    if (!shutter) {
        throw new Error(
            "Camera opened, but its shutter button could not be located."
        );
    }

    await shutter.click();

    // Step 1: wait for the camera's review screen (or for the app, in
    // case this camera returns to the app without a review screen).
    let screen = null;

    await waitForCondition(
        async () => {
            const source = await driver.getPageSource();

            if (isCameraReviewScreen(source)) {
                screen = "review";
                return true;
            }

            if (isPhotoPreviewReady(source)) {
                screen = "preview";
                return true;
            }

            return false;
        },
        "the camera review screen",
        30000
    );

    // Step 2: accept the photo.
    if (screen === "review") {
        await confirmCameraReview(driver);
    }

    // Step 3: wait for the app to show the captured photo.
    await dumpScreenOnFailure(
        driver,
        "Waiting for the photo preview",
        () => waitForCondition(
            async () => isPhotoPreviewReady(await driver.getPageSource()),
            "the captured photo preview in the app",
            45000
        )
    );

    console.log("Photo captured; preview is available.");
}


export async function captureMerchantPhoto(driver) {
    await waitForPhotoStep(driver);

    const source = await driver.getPageSource();

    if (source.includes('content-desc="Re-capture Image"')) {
        console.log("A captured photo is already available.");
        return;
    }

    await openCamera(driver);
    await capturePhoto(driver);
}


/**
 * Scroll the Photo step to its very bottom.
 *
 * Before scrolling, Submit sits at the screen's bottom edge and is
 * partly cut off, so it is not safe to tap. Scrolling until the
 * ScrollView cannot move any further puts it fully on screen.
 */
async function scrollFormToBottom(driver) {
    const scrollView = await driver.$("//android.widget.ScrollView");

    await scrollView.waitForDisplayed({
        timeout: ELEMENT_TIMEOUT,
        interval: POLL_INTERVAL,
        timeoutMsg: "The Photo step ScrollView was not found."
    });

    for (let attempt = 1; attempt <= MAX_SCROLL_ATTEMPTS; attempt++) {
        console.log(
            `[PHOTO] Scrolling down to Submit ` +
            `(${attempt}/${MAX_SCROLL_ATTEMPTS})...`
        );

        // Returns true while the view can still scroll further.
        const canScrollMore = await driver.execute(
            "mobile: scrollGesture",
            {
                elementId: scrollView.elementId,
                direction: "down",
                percent: 0.75
            }
        );

        await driver.pause(400);

        if (!canScrollMore) {
            console.log("[PHOTO] Reached the bottom of the form.");
            return;
        }
    }

    console.log(
        "[PHOTO] Scroll attempts used up; continuing to look for Submit."
    );
}


/**
 * The merchant list is showing again (the Create Merchant form closed).
 */
function isMerchantListVisible(source) {
    return (
        source.includes('pane-title="Merchant Onboarding"') &&
        source.includes('hint="Search"') &&
        !source.includes('pane-title="Create Merchant"') &&
        !source.includes(LOADING_MARKER)
    );
}


/**
 * Read the duplicate / "already exists" notice from the screen, if the
 * app exposes it. Returns the notice text, or null.
 */
function findDuplicateNotice(source) {
    const match = source.match(DUPLICATE_NOTICE_PATTERN);

    return match
        ? match[1].replace(/&#10;/g, " ").trim()
        : null;
}


/**
 * Wait for the outcome of tapping Submit.
 *
 * Returns:
 *   { status: "Submitted" }
 *       the app returned to the merchant list
 *   { status: "Rejected", reason, duplicate: true }
 *       the app's own "already exists" notice was read from the screen
 *   { status: "Rejected", reason, duplicate: false }
 *       the form simply stayed open (and not loading) for STUCK_AFTER_MS;
 *       the caller must verify what really happened before trusting it
 */
async function waitForSubmitResult(driver) {
    const deadline = Date.now() + SUBMIT_TIMEOUT;

    let quietSince = null;

    while (Date.now() < deadline) {
        const source = await driver.getPageSource();

        const loading = source.includes(LOADING_MARKER);
        const formOpen = source.includes('pane-title="Create Merchant"');

        // Success: the form closed and the merchant list is back.
        if (isMerchantListVisible(source)) {
            return { status: "Submitted" };
        }

        // Rejected, with the app's own message.
        const notice = findDuplicateNotice(source);

        if (notice) {
            return {
                status: "Rejected",
                reason: notice,
                duplicate: true
            };
        }

        // Rejected, without a readable message: the form stays open
        // and nothing is loading.
        if (formOpen && !loading) {
            quietSince ??= Date.now();

            if (Date.now() - quietSince >= STUCK_AFTER_MS) {
                return {
                    status: "Rejected",
                    reason:
                        "The form stayed open after Submit with no " +
                        "confirmation.",
                    duplicate: false
                };
            }
        } else {
            quietSince = null;
        }

        await driver.pause(POLL_INTERVAL);
    }

    throw new Error(
        "Timed out waiting for the result of Submit " +
        `(${SUBMIT_TIMEOUT}ms).`
    );
}


/**
 * Tap Submit and report what happened. Returns the same object as
 * waitForSubmitResult.
 */
export async function submitMerchant(driver) {
    // Do not tap anything while the app's loading overlay is showing.
    await waitForCondition(
        async () => !(await driver.getPageSource()).includes(LOADING_MARKER),
        "the app to finish loading before Submit",
        30000
    );

    await dumpScreenOnFailure(driver, "Reaching Submit", async () => {
        await scrollFormToBottom(driver);

        const submitButton = await driver.$("~Submit");

        await submitButton.waitForDisplayed({
            timeout: ELEMENT_TIMEOUT,
            interval: POLL_INTERVAL,
            timeoutMsg: "Submit button did not appear after scrolling."
        });

        await submitButton.waitForEnabled({
            timeout: ELEMENT_TIMEOUT,
            interval: POLL_INTERVAL,
            timeoutMsg: "Submit button did not become enabled."
        });

        await submitButton.click();
    });

    console.log("Submit tapped; waiting for registration to finish.");

    const result = await dumpScreenOnFailure(
        driver,
        "Waiting for the result of Submit",
        () => waitForSubmitResult(driver)
    );

    if (result.status === "Submitted") {
        console.log("The app returned to the merchant list.");
    } else {
        console.warn(`[PHOTO] Submit was rejected: ${result.reason}`);
    }

    return result;
}