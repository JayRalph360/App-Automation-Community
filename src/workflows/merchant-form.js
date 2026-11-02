const ELEMENT_TIMEOUT = 10000;
const POLL_INTERVAL = 200;
const MAX_SCROLL_ATTEMPTS = 8;
const VERIFY_TIMEOUT = 2000;


async function waitForElement(element, description) {
    await element.waitForDisplayed({
        timeout: ELEMENT_TIMEOUT,
        interval: POLL_INTERVAL,
        timeoutMsg: `${description} did not appear.`
    });


    await element.waitForEnabled({
        timeout: ELEMENT_TIMEOUT,
        interval: POLL_INTERVAL,
        timeoutMsg: `${description} is not enabled.`
    });


    return element;
}


/**
 * Scroll the form down until the target field becomes visible.
 *
 * Uses the form's Android ScrollView where possible, rather than
 * swiping across the entire screen.
 */
async function scrollToField(driver, selector, description) {
    const field = await driver.$(selector);


    // Reuse the element if it is already visible.
    if (await field.isDisplayed().catch(() => false)) {
        return field;
    }


    const scrollView = await driver.$(
        "//android.widget.ScrollView"
    );


    await scrollView.waitForDisplayed({
        timeout: ELEMENT_TIMEOUT,
        interval: POLL_INTERVAL,
        timeoutMsg: "The merchant form ScrollView was not found."
    });


    for (let attempt = 1; attempt <= MAX_SCROLL_ATTEMPTS; attempt++) {
        console.log(
            `[FORM] ${description} is not visible. ` +
            `Scrolling down (${attempt}/${MAX_SCROLL_ATTEMPTS})...`
        );


        await driver.execute("mobile: scrollGesture", {
            elementId: scrollView.elementId,
            direction: "down",
            percent: 0.60
        });


        await driver.pause(300);


        if (await field.isDisplayed().catch(() => false)) {
            console.log(`[FORM] ${description} is now visible.`);
            return field;
        }
    }


    throw new Error(
        `[FORM] Could not find ${description} after ` +
        `${MAX_SCROLL_ATTEMPTS} scroll attempts.`
    );
}


/**
 * Enter and verify a field's value.
 *
 * scrollToField has already confirmed the field is on screen, so there
 * is no separate wait for it to be displayed. The value is verified by
 * polling briefly instead of pausing for a fixed time.
 */
async function fillField(driver, hint, value, description) {
    const selector =
        `//android.widget.EditText[@hint="${hint}"]`;


    const field = await scrollToField(
        driver,
        selector,
        description
    );


    if (!(await field.isEnabled())) {
        throw new Error(`[FORM] ${description} is not enabled.`);
    }


    const rawValue = String(value ?? "");
    const expected = rawValue.trim();


    console.log(
        `[FORM] Entering ${description}: ${JSON.stringify(rawValue)}`
    );


    await field.click();
    await field.setValue(rawValue);


    const deadline = Date.now() + VERIFY_TIMEOUT;
    let actual = "";


    while (true) {
        actual = String(await field.getText()).trim();


        if (actual === expected) {
            break;
        }


        if (Date.now() >= deadline) {
            throw new Error(
                `[FORM] ${description} mismatch. ` +
                `Expected ${JSON.stringify(expected)}, ` +
                `received ${JSON.stringify(actual)}.`
            );
        }


        await driver.pause(100);
    }


    console.log(`[FORM] Verified ${description}.`);
}


/**
 * Fill the merchant details and proceed to the next screen.
 */
async function fillMerchantForm(driver, merchant) {
    const {
        businessName,
        number,
        email
    } = merchant;


    if (!businessName?.trim()) {
        throw new Error(
            "Cannot register a merchant without a business name."
        );
    }


    if (!number) {
        throw new Error(
            "Cannot register a merchant without a phone number."
        );
    }


    if (!email?.trim()) {
        throw new Error(
            "Cannot register a merchant without an email address."
        );
    }


    const fields = [
        ["Business name", businessName, "Business name"],
        ["Owner Number", number, "Owner Number"],
        ["Office Number", number, "Office Number"],
        [
            "Merchant Attendant Name",
            businessName,
            "Merchant Attendant Name"
        ],
        [
            "Merchant Payment Code",
            number,
            "Merchant Payment Code"
        ],
        [
            "Merchant Payment Phone Number",
            number,
            "Merchant Payment Phone Number"
        ],
        ["Email", email, "Email"]
    ];


    for (const [hint, value, description] of fields) {
        await fillField(driver, hint, value, description);


        // After entering Email, scroll down to expose the
        // remaining form fields and the Continue button.
        if (hint === "Email") {
            console.log(
                "[FORM] Email entered. Scrolling down to expose " +
                "the remaining form controls..."
            );


            const continueSelector =
                '//android.widget.Button[@content-desc="Continue"]';


            const continueButton = await scrollToField(
                driver,
                continueSelector,
                "Continue button"
            );


            await waitForElement(
                continueButton,
                "Continue button"
            );


            console.log(
                "[FORM] Continue button is visible and enabled."
            );
        }
    }


    // Find Continue again in case the layout changed.
    const continueButton = await scrollToField(
        driver,
        '//android.widget.Button[@content-desc="Continue"]',
        "Continue button"
    );


    await waitForElement(continueButton, "Continue button");
    await continueButton.click();


    console.log(
        `[FORM] Merchant details entered for ${businessName}.`
    );
}


export { fillMerchantForm };