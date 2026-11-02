import { fillMerchantForm } from "./merchant-form.js";
import { fillBusinessProfile } from "./business-profile.js";
import {
    captureMerchantPhoto,
    submitMerchant
} from "./merchant-photo.js";
import { searchMerchant } from "./merchant-search.js";


const ELEMENT_TIMEOUT = 15000;
const POLL_INTERVAL = 300;
const LOADING_MARKER = 'content-desc="Loading..."';

// How long to keep trying to close the form after a rejected submit.
// The notice covers the X button, so the tap only works once the
// notice has gone away.
const CLOSE_FORM_TIMEOUT = 25000;

// The app's notice banner, which appears on screen as:
//   content-desc="Notice\nAgent number already exists. ..."
const NOTICE_MARKER = 'content-desc="Notice';

// How long to wait for the notice to disappear before tapping Close.
const NOTICE_LEAVE_TIMEOUT = 15000;


/**
 * Run a stage and log how long it took (also when it fails), so the
 * slowest part of the registration is easy to spot.
 */
async function timed(label, action) {
    const startedAt = Date.now();

    try {
        return await action();
    } finally {
        const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);

        console.log(`[TIMING] ${label}: ${seconds}s`);
    }
}


/**
 * Make sure the full-screen "Loading..." overlay is gone before
 * interacting. A tap on Create Merchant while the overlay is
 * showing is swallowed and the form never opens.
 */
async function waitForLoadingToFinish(driver) {
    const deadline = Date.now() + 30000;

    while (Date.now() < deadline) {
        const source = await driver.getPageSource();

        if (!source.includes(LOADING_MARKER)) {
            return;
        }

        await driver.pause(POLL_INTERVAL);
    }

    throw new Error(
        "The app is still showing its loading overlay. " +
        "Refusing to click Create Merchant."
    );
}


/**
 * True when the merchant list is showing and the Create Merchant form
 * is closed. Does not throw.
 */
async function isMerchantListVisible(driver) {
    const source = await driver.getPageSource();

    return (
        source.includes('pane-title="Merchant Onboarding"') &&
        source.includes('hint="Search"') &&
        !source.includes('pane-title="Create Merchant"')
    );
}


async function waitForMerchantForm(driver) {
    const deadline = Date.now() + 15000;

    const businessNameField = await driver.$(
        '//android.widget.EditText[@hint="Business name"]'
    );

    while (Date.now() < deadline) {
        if (
            await businessNameField.isDisplayed().catch(() => false)
        ) {
            console.log(
                "[ONBOARDING] Merchant registration screen confirmed."
            );

            return;
        }

        await driver.pause(POLL_INTERVAL);
    }

    console.error(
        "[ONBOARDING] Merchant registration screen did not appear."
    );

    throw new Error(
        "Create Merchant was clicked, but the registration screen " +
        "could not be confirmed."
    );
}


/**
 * Wait for the app's notice banner to disappear on its own. It sits on
 * top of the X button, so a tap on X while it is showing would hit the
 * notice instead.
 */
async function waitForNoticeToLeave(driver) {
    const deadline = Date.now() + NOTICE_LEAVE_TIMEOUT;

    while (Date.now() < deadline) {
        const source = await driver.getPageSource();

        if (!source.includes(NOTICE_MARKER)) {
            return;
        }

        await driver.pause(POLL_INTERVAL);
    }

    console.warn(
        "[ONBOARDING] The notice is still showing. " +
        "Trying to close the form anyway."
    );
}


/**
 * Close the Create Merchant form with the X button at the top left.
 *
 * The notice is left to disappear on its own first. The tap is then
 * repeated until the form closes, in case the notice was still covering
 * the button.
 */
async function closeFormAfterRejection(driver) {
    console.log("[ONBOARDING] Waiting for the notice to disappear...");

    await waitForNoticeToLeave(driver);

    const deadline = Date.now() + CLOSE_FORM_TIMEOUT;

    let attempt = 0;

    while (Date.now() < deadline) {
        attempt++;

        const closeButton = await driver.$("~Close");

        if (await closeButton.isDisplayed().catch(() => false)) {
            console.log(
                `[ONBOARDING] Tapping Close (attempt ${attempt})...`
            );

            await closeButton.click().catch(() => {});
        }

        // Give the app a moment to leave the form.
        const settleDeadline = Date.now() + 2500;

        while (Date.now() < settleDeadline) {
            if (await isMerchantListVisible(driver)) {
                console.log(
                    "[ONBOARDING] Form closed; the merchant list is showing."
                );

                return;
            }

            await driver.pause(POLL_INTERVAL);
        }
    }

    throw new Error(
        "The submission was rejected, but the Create Merchant form " +
        "could not be closed."
    );
}


/**
 * The app refused the submission. Close the form (once the notice has
 * gone), then decide what the rejection means.
 *
 * - The app said the number already exists (rejection.duplicate): trust
 *   it and return { alreadyExisted: true } without searching. The search
 *   is what missed the number in the first place.
 * - The form just stayed open with no readable message: search for the
 *   number to confirm it exists. Throws if it is not found, so a
 *   different kind of rejection is never hidden.
 */
async function handleRejectedSubmission(driver, merchant, rejection) {
    const reason = rejection.reason;

    console.log(
        `[ONBOARDING] The app rejected the submission for ` +
        `${merchant.number}: ${reason}`
    );

    await closeFormAfterRejection(driver);

    if (rejection.duplicate) {
        console.log(
            `[ONBOARDING] ${merchant.number} already exists in the app ` +
            "(reported by the app)."
        );

        return { alreadyExisted: true };
    }

    console.log(
        `[ONBOARDING] No readable message. Checking whether ` +
        `${merchant.number} already exists in the app...`
    );

    const search = await searchMerchant(driver, merchant.number);

    if (search.found) {
        console.log(
            `[ONBOARDING] ${merchant.number} already exists in the app.`
        );

        return { alreadyExisted: true };
    }

    throw new Error(
        `The submission was rejected (${reason}) and ${merchant.number} ` +
        "could not be found in the app afterwards."
    );
}


/**
 * Register a merchant in the app.
 *
 * Returns { alreadyExisted: false } when the merchant was created, or
 * { alreadyExisted: true } when the app turned out to have the number
 * already (the search before registration missed it).
 */
export async function registerMerchant(driver, merchant) {
    // Never tap Create Merchant while the loading overlay is on top.
    await waitForLoadingToFinish(driver);

    const createButton = await driver.$('//*[@content-desc="Create Merchant"]/..');

    await createButton.waitForDisplayed({
        timeout: ELEMENT_TIMEOUT,
        interval: POLL_INTERVAL,
        timeoutMsg: "Create Merchant button did not appear."
    });

    await createButton.waitForEnabled({
        timeout: ELEMENT_TIMEOUT,
        interval: POLL_INTERVAL,
        timeoutMsg: "Create Merchant button is not enabled."
    });

    await timed("Open form", async () => {
        await createButton.click();
        await waitForMerchantForm(driver);
    });

    await timed("Merchant details", () =>
        fillMerchantForm(driver, merchant)
    );

    await timed("Business profile", () =>
        fillBusinessProfile(driver, merchant)
    );

    await timed("Photo", () =>
        captureMerchantPhoto(driver)
    );

    // On success, submitMerchant has already confirmed that the app is
    // back on the merchant list, so no second check is needed.
    const submitResult = await timed("Submit", () =>
        submitMerchant(driver)
    );

    if (submitResult.status === "Rejected") {
        return timed("Recover from rejected submit", () =>
            handleRejectedSubmission(
                driver,
                merchant,
                submitResult
            )
        );
    }

    console.log(
        `Merchant list confirmed after submission for ${merchant.businessName}.`
    );

    return { alreadyExisted: false };
}