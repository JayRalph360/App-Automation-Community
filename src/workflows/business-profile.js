const ELEMENT_TIMEOUT = 15000;
const POLL_INTERVAL = 200;
const MAX_SCROLL_ATTEMPTS = 8;
const SCROLL_PERCENT = 0.60;
const VERIFY_TIMEOUT = 2000;

const SELECTORS = {
    registrationType:
        '//android.widget.EditText[@hint="Business Registration Type"]',

    registrationNumber:
        '//android.widget.EditText[@hint="Business registration number"]',

    tinNumber:
        '//android.widget.EditText[@hint="Tin Number"]',

    digitalAddress:
        '//android.widget.EditText[@hint="Digital Address"]',

    businessType: "~Business Type",
    industry: "~Industry",
    serviceType: "~Service Type",
    itemsGiven: "~Select items given to merchant",
    continue: "~Continue",

    // UiSelector is much faster than XPath on UiAutomator2.
    photoStep: 'android=new UiSelector().descriptionContains("Step 3 of 3")'
};

/**
 * Wait until an element is displayed.
 */
async function waitForDisplayed(element, description) {
    await element.waitForDisplayed({
        timeout: ELEMENT_TIMEOUT,
        interval: POLL_INTERVAL,
        timeoutMsg: `${description} did not appear.`
    });

    return element;
}

/**
 * Wait for an element to be displayed and enabled, then click it.
 */
async function clickWhenReady(element, description) {
    await waitForDisplayed(element, description);

    // Only wait for "enabled" if it is not already.
    if (!(await element.isEnabled())) {
        await element.waitForEnabled({
            timeout: ELEMENT_TIMEOUT,
            interval: POLL_INTERVAL,
            timeoutMsg: `${description} is not enabled.`
        });
    }

    await element.click();
}

/**
 * Poll until an element is no longer displayed (or has been removed).
 * Returns true once hidden, false if it is still showing at the timeout.
 */
async function waitUntilHidden(driver, element, timeout = ELEMENT_TIMEOUT) {
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
        if (!(await element.isDisplayed().catch(() => false))) {
            return true;
        }

        await driver.pause(150);
    }

    return false;
}

/**
 * Find the business profile form's ScrollView.
 */
async function getScrollView(driver) {
    const scrollView = await driver.$(
        "//android.widget.ScrollView"
    );

    await scrollView.waitForDisplayed({
        timeout: ELEMENT_TIMEOUT,
        interval: POLL_INTERVAL,
        timeoutMsg: "Business Profile ScrollView was not found."
    });

    return scrollView;
}

/**
 * Scroll to the top of the business profile form before
 * starting to enter information.
 *
 * The gesture stops when Android reports that there is
 * no more content to scroll upward.
 */
async function scrollToTop(driver) {
    console.log("[PROFILE] Scrolling to the top of the form...");

    const scrollView = await getScrollView(driver);

    for (
        let attempt = 1;
        attempt <= MAX_SCROLL_ATTEMPTS;
        attempt++
    ) {
        const canScrollFurther = await driver.execute(
            "mobile: scrollGesture",
            {
                elementId: scrollView.elementId,
                direction: "up",
                percent: SCROLL_PERCENT
            }
        );

        await driver.pause(200);

        if (!canScrollFurther) {
            console.log("[PROFILE] Reached the top of the form.");
            return;
        }

        console.log(
            `[PROFILE] Scrolling up (${attempt}/${MAX_SCROLL_ATTEMPTS})...`
        );
    }

    console.log(
        "[PROFILE] Upward scroll limit reached. Starting form entry."
    );
}

/**
 * Scroll the main form down until the requested element
 * becomes visible.
 *
 * This helper is for the main form. Dropdown popup scrolling
 * is handled separately by scrollDropdownUntilVisible().
 */
async function scrollToField(driver, selector, description) {
    const field = await driver.$(selector);

    // Return immediately if the target is already visible.
    if (await field.isDisplayed().catch(() => false)) {
        return field;
    }

    let scrollView;

    try {
        scrollView = await driver.$(
            "//android.widget.ScrollView"
        );

        await scrollView.waitForDisplayed({
            timeout: 3000,
            interval: POLL_INTERVAL
        });
    } catch {
        console.log(
            "[PROFILE] ScrollView not found. " +
            "Will use screen swipes."
        );
    }

    const { width, height } = await driver.getWindowSize();

    for (
        let attempt = 1;
        attempt <= MAX_SCROLL_ATTEMPTS;
        attempt++
    ) {
        console.log(
            `[PROFILE] Scrolling down to find ${description} ` +
            `(${attempt}/${MAX_SCROLL_ATTEMPTS})...`
        );

        let scrolled = false;

        // First attempt: scroll inside the form container.
        if (scrollView) {
            try {
                await driver.execute(
                    "mobile: scrollGesture",
                    {
                        elementId: scrollView.elementId,
                        direction: "down",
                        percent: 0.70
                    }
                );

                scrolled = true;
            } catch (error) {
                console.warn(
                    "[PROFILE] ScrollView gesture failed:",
                    error.message
                );

                scrollView = null;
            }
        }

        // Fallback: swipe over the main screen.
        if (!scrolled) {
            await driver.execute(
                "mobile: swipeGesture",
                {
                    left: Math.floor(width * 0.08),
                    top: Math.floor(height * 0.25),
                    width: Math.floor(width * 0.84),
                    height: Math.floor(height * 0.60),
                    direction: "up",
                    percent: 0.70
                }
            );
        }

        await driver.pause(300);

        if (await field.isDisplayed().catch(() => false)) {
            console.log(
                `[PROFILE] ${description} is now visible.`
            );

            return field;
        }
    }

    throw new Error(
        `[PROFILE] Could not bring ${description} into view ` +
        `after ${MAX_SCROLL_ATTEMPTS} scrolling attempts.`
    );
}

/**
 * Enter and verify a text field.
 *
 * scrollToField has already confirmed the field is on screen, so there
 * is no separate wait for it to be displayed. The value is verified by
 * polling briefly instead of pausing for a fixed time.
 */
async function fillTextField(
    driver,
    selector,
    value,
    description
) {
    const field = await scrollToField(
        driver,
        selector,
        description
    );

    const expected = String(value ?? "");

    if (!expected.trim()) {
        throw new Error(
            `[PROFILE] ${description} cannot be empty.`
        );
    }

    console.log(
        `[PROFILE] Entering ${description}:`,
        JSON.stringify(expected)
    );

    await field.click();
    await field.setValue(expected);

    const deadline = Date.now() + VERIFY_TIMEOUT;
    let actual = "";

    while (true) {
        actual = String(await field.getText()).trim();

        if (actual === expected.trim()) {
            break;
        }

        if (Date.now() >= deadline) {
            throw new Error(
                `[PROFILE] ${description} verification failed. ` +
                `Expected ${JSON.stringify(expected)}, ` +
                `received ${JSON.stringify(actual)}.`
            );
        }

        await driver.pause(100);
    }

    console.log(`[PROFILE] Verified ${description}.`);
}

/**
 * Open a dropdown, select an option, and verify the selection.
 */
async function selectDropdownOption(
    driver,
    fieldSelector,
    optionLabel,
    description
) {
    const field = await scrollToField(
        driver,
        fieldSelector,
        `${description} dropdown`
    );

    console.log(`[PROFILE] Opening ${description}...`);

    await clickWhenReady(field, description);

    const option = await driver.$(`~${optionLabel}`);

    await clickWhenReady(
        option,
        `${description} option "${optionLabel}"`
    );

    // Confirm that the option popup has closed.
    if (!(await waitUntilHidden(driver, option))) {
        throw new Error(
            `${description} remained open after selecting "${optionLabel}".`
        );
    }

    // Confirm the selected value is reflected in the field.
    const selectedField = await driver.$(
        `//*[contains(@content-desc, "${description}") ` +
        `and contains(@content-desc, "${optionLabel}")]`
    );

    await waitForDisplayed(
        selectedField,
        `${description} selected value "${optionLabel}"`
    );

    console.log(
        `[PROFILE] Selected ${description}: ${optionLabel}`
    );
}

/**
 * Scroll inside an open dropdown until its option is visible.
 *
 * This is separate from the main form scrolling because
 * the dropdown may have its own scrollable area.
 */
async function scrollDropdownUntilVisible(
    driver,
    optionLabel,
    description
) {
    const option = await driver.$(`~${optionLabel}`);

    for (let attempt = 1; attempt <= 6; attempt++) {
        if (await option.isDisplayed().catch(() => false)) {
            console.log(
                `[PROFILE] Found ${optionLabel} in ${description}.`
            );

            await clickWhenReady(
                option,
                `${description}: ${optionLabel}`
            );

            return;
        }

        console.log(
            `[PROFILE] Scrolling ${description} ` +
            `to find ${optionLabel} (${attempt}/6)...`
        );

        const { width, height } = await driver.getWindowSize();

        await driver.execute("mobile: scrollGesture", {
            left: Math.floor(width * 0.05),
            top: Math.floor(height * 0.30),
            width: Math.floor(width * 0.90),
            height: Math.floor(height * 0.55),
            direction: "down",
            percent: 0.55
        });

        await driver.pause(300);
    }

    throw new Error(
        `[PROFILE] Could not find ${optionLabel} in ${description} ` +
        "after scrolling."
    );
}

/**
 * Open the merchant-items selector and ensure Stickers is selected.
 */
async function selectMerchantItems(driver) {
    const description = "Items given to merchant";

    const itemsDropdown = await scrollToField(
        driver,
        SELECTORS.itemsGiven,
        description
    );

    await clickWhenReady(itemsDropdown, description);

    const stickersSelector = "~Stickers";
    const stickers = await driver.$(stickersSelector);

    await waitForDisplayed(stickers, "Stickers option");

    let checked = await stickers.getAttribute("checked");

    console.log(
        `[PROFILE] Stickers checked state: ${checked}`
    );

    // Select Stickers only if it is not already checked.
    if (checked !== "true") {
        await clickWhenReady(stickers, "Stickers option");

        // Poll for the checked state. The element is looked up again
        // each time because the checkbox may be redrawn after the tap.
        const deadline = Date.now() + VERIFY_TIMEOUT;

        do {
            await driver.pause(100);

            const current = await driver.$(stickersSelector);

            checked = await current
                .getAttribute("checked")
                .catch(() => checked);
        } while (checked !== "true" && Date.now() < deadline);
    }

    if (checked !== "true") {
        throw new Error(
            `[PROFILE] Stickers checkbox is not checked. State: ${checked}`
        );
    }

    console.log("[PROFILE] Stickers checkbox verified.");

    const okButton = await driver.$(
        '//android.widget.Button[@content-desc="OK"]'
    );

    await waitForDisplayed(okButton, "Items dialog OK button");

    if (!(await okButton.isEnabled())) {
        await okButton.waitForEnabled({
            timeout: ELEMENT_TIMEOUT,
            interval: POLL_INTERVAL,
            timeoutMsg: "Items dialog OK button is disabled."
        });
    }

    // First attempt: standard WebdriverIO click.
    await okButton.click();

    let dialogClosed = await waitUntilHidden(driver, okButton, 3000);

    // Fallback: tap the center if the dialog remains visible.
    if (!dialogClosed) {
        console.warn(
            "[PROFILE] Standard click did not close the dialog. " +
            "Trying a coordinate tap."
        );

        const rect = await okButton.getRect();

        await driver.execute("mobile: clickGesture", {
            x: Math.round(rect.x + rect.width / 2),
            y: Math.round(rect.y + rect.height / 2)
        });

        dialogClosed = await waitUntilHidden(driver, okButton, 3000);
    }

    if (!dialogClosed) {
        throw new Error(
            "[PROFILE] OK was tapped, but the items dialog is still open."
        );
    }

    console.log(
        "[PROFILE] Merchant items confirmed: Stickers."
    );
}

/**
 * After selecting Stickers, scroll down until Continue is visible,
 * click it once, and verify that the Photo screen appears.
 */
async function showContinueAndProceed(driver) {
    console.log(
        "[PROFILE] Scrolling down to Continue..."
    );

    const scrollView = await getScrollView(driver);

    for (
        let attempt = 1;
        attempt <= MAX_SCROLL_ATTEMPTS;
        attempt++
    ) {
        console.log(
            `[PROFILE] Scrolling form down (${attempt}/${MAX_SCROLL_ATTEMPTS})...`
        );

        const canScrollMore = await driver.execute(
            "mobile: scrollGesture",
            {
                elementId: scrollView.elementId,
                direction: "down",
                percent: SCROLL_PERCENT
            }
        );

        await driver.pause(300);

        if (!canScrollMore) {
            console.log(
                "[PROFILE] ScrollView reached its lower limit."
            );
            break;
        }
    }

    // Re-query the button after scrolling.
    const continueButton = await driver.$(
        SELECTORS.continue
    );

    await continueButton.waitForDisplayed({
        timeout: ELEMENT_TIMEOUT,
        interval: POLL_INTERVAL,
        timeoutMsg:
            "Continue button was not found after scrolling."
    });

    if (!(await continueButton.isEnabled())) {
        await continueButton.waitForEnabled({
            timeout: ELEMENT_TIMEOUT,
            interval: POLL_INTERVAL,
            timeoutMsg:
                "Continue button is disabled."
        });
    }

    console.log(
        "[PROFILE] Continue is displayed and enabled. Clicking..."
    );

    await continueButton.click();

    console.log(
        "[PROFILE] Click completed. Waiting for Photo screen..."
    );

    const photoStep = await driver.$(
        SELECTORS.photoStep
    );

    try {
        await photoStep.waitForDisplayed({
            timeout: ELEMENT_TIMEOUT,
            interval: POLL_INTERVAL,
            timeoutMsg:
                "Photo screen did not appear after clicking Continue."
        });
    } catch (error) {
        throw new Error(
            "[PROFILE] Continue was clicked, but Step 3 of 3 " +
            "did not appear. Check the UI hierarchy for validation " +
            `errors or missing fields. ${error.message}`
        );
    }

    console.log(
        "[PROFILE] Successfully reached the Photo screen."
    );
}

/**
 * Complete the Business Profile form and proceed to Photo.
 */
async function fillBusinessProfile(driver, merchant) {
    if (!merchant?.businessName?.trim()) {
        throw new Error(
            "[PROFILE] A business name is required."
        );
    }

    const profile = {
        registrationType:
            merchant.registrationType ?? "Business Certificate",

        registrationNumber:
            merchant.registrationNumber ?? "N/A",

        businessType:
            merchant.businessType ?? "Sole Proprietorship",

        industry:
            merchant.industry ?? "General good retail",

        serviceType:
            merchant.serviceType ?? "B2C",

        tinNumber:
            merchant.tinNumber ?? "N/A",

        digitalAddress:
            String(
                merchant.digital_address ??
                merchant.digitalAddress ??
                ""
            ).trim(),

        itemsGiven:
            merchant.itemsGiven ?? "Stickers"
    };

    console.log(
        `[PROFILE] Starting Business Profile for ${merchant.businessName}.`
    );

    // 0. Start at the top of the form.
    await scrollToTop(driver);

    // 1. Business registration type.
    await fillTextField(
        driver,
        SELECTORS.registrationType,
        profile.registrationType,
        "Business Registration Type"
    );

    // 2. Business registration number.
    await fillTextField(
        driver,
        SELECTORS.registrationNumber,
        profile.registrationNumber,
        "Business registration number"
    );

    // 3. Business type.
    await selectDropdownOption(
        driver,
        SELECTORS.businessType,
        profile.businessType,
        "Business Type"
    );

    // 4. Industry.
    const industryDropdown = await scrollToField(
        driver,
        SELECTORS.industry,
        "Industry dropdown"
    );

    await clickWhenReady(
        industryDropdown,
        "Industry dropdown"
    );

    await scrollDropdownUntilVisible(
        driver,
        profile.industry,
        "Industry dropdown"
    );

    // 5. Service type.
    await selectDropdownOption(
        driver,
        SELECTORS.serviceType,
        profile.serviceType,
        "Service Type"
    );

    // 6. TIN.
    await fillTextField(
        driver,
        SELECTORS.tinNumber,
        profile.tinNumber,
        "Tin Number"
    );

    // 7. Digital address.
    await fillTextField(
        driver,
        SELECTORS.digitalAddress,
        profile.digitalAddress,
        "Digital Address"
    );

    // 8. Select the merchant items.
    if (profile.itemsGiven !== "Stickers") {
        throw new Error(
            `[PROFILE] Unsupported configured test item: ${profile.itemsGiven}`
        );
    }

    await selectMerchantItems(driver);

    // 9. Scroll down, click Continue once, and verify Photo screen.
    await showContinueAndProceed(driver);

    console.log(
        `[PROFILE] Business Profile completed for ${merchant.businessName}.`
    );
}

export { fillBusinessProfile };