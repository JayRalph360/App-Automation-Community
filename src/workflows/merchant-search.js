const ELEMENT_TIMEOUT = 15000;
const POLL_INTERVAL = 300;

// Max time to wait for a definite answer (found / not found).
const SEARCH_TIMEOUT = 30000;

// "Not found" is only trusted after the screen has shown no results,
// no loading overlay, and no changes for this long.
const NOT_FOUND_CONFIRM_MS = 3000;

const LOADING_MARKER = 'content-desc="Loading..."';
const EMPTY_MARKER = 'content-desc="No merchants created yet"';

// The app's notice banner, for example
//   "Alt Merchant Created Successfully, with id: 666804."
// It stays on screen for a few seconds after a merchant is created and
// covers the top of the screen, including the Search field. Typing while
// it is showing does nothing, and the app then shows its empty state.
const NOTICE_MARKER = 'content-desc="Notice';

// How long to wait for the notice (or loading overlay) to go away.
const NOTICE_LEAVE_TIMEOUT = 15000;

// Typing the number is retried if the Search field does not take it.
const MAX_ENTRY_ATTEMPTS = 4;
const ENTRY_VERIFY_TIMEOUT = 2000;


const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));


/**
 * Normalize a phone number by keeping digits only.
 */
function normalizePhoneNumber(value) {
    return String(value ?? "").replace(/\D/g, "");
}


/**
 * Extract all content-desc attributes from the XML hierarchy.
 *
 * We deliberately do not search for android.widget.Button because
 * merchant results can be represented as android.view.View.
 */
function getContentDescriptions(pageSource) {
    const descriptions = [];
    const regex = /content-desc="([^"]*)"/g;

    for (const match of pageSource.matchAll(regex)) {
        if (match[1]) {
            descriptions.push(match[1]);
        }
    }

    return descriptions;
}


/**
 * Read the text currently inside the Search field, straight from the
 * page source. Returns null if the field is not on screen.
 */
function getSearchFieldText(pageSource) {
    const match = pageSource.match(
        /<android\.widget\.EditText\b[^>]*?\stext="([^"]*)"[^>]*?\shint="Search"/
    );

    return match ? match[1] : null;
}


/**
 * Return every result description that contains the phone number.
 *
 * A result looks like:
 *   "Business&#10;Business&#10;233244275903"
 * so each line is checked separately. Only the number matters;
 * the business name is ignored.
 */
function findMatches(pageSource, normalizedNumber) {
    if (!normalizedNumber) {
        return [];
    }

    return getContentDescriptions(pageSource)
        .filter(description =>
            description
                .split(/&#10;|\n/)
                .some(line =>
                    normalizePhoneNumber(line) === normalizedNumber
                )
        )
        .map(description => description.replace(/&#10;/g, "\n"));
}


/**
 * Wait until no notice banner and no loading overlay is on screen.
 *
 * If one is still showing after NOTICE_LEAVE_TIMEOUT, carry on: the
 * number that gets typed is verified afterwards, so nothing is trusted
 * blindly.
 */
async function waitForNoticeToLeave(driver) {
    const deadline = Date.now() + NOTICE_LEAVE_TIMEOUT;

    let logged = false;

    while (Date.now() < deadline) {
        const source = await driver.getPageSource();

        const notice = source.includes(NOTICE_MARKER);
        const loading = source.includes(LOADING_MARKER);

        if (!notice && !loading) {
            return;
        }

        if (notice && !logged) {
            console.log(
                "[SEARCH] A notice is covering the Search field. " +
                "Waiting for it to disappear..."
            );

            logged = true;
        }

        await sleep(POLL_INTERVAL);
    }

    console.warn(
        "[SEARCH] A notice or loading overlay is still showing. " +
        "Continuing; the typed number will be verified."
    );
}


/**
 * Type the number into the Search field and confirm the field really
 * contains it. Retries if it does not, for example because a notice
 * swallowed the taps. Throws if it never works, so a number is never
 * treated as "not found" without having been searched.
 */
async function enterSearchNumber(driver, number) {
    const wanted = normalizePhoneNumber(number);

    for (let attempt = 1; attempt <= MAX_ENTRY_ATTEMPTS; attempt++) {
        await waitForNoticeToLeave(driver);

        const searchField = await driver.$(
            '//android.widget.EditText[@hint="Search"]'
        );

        await searchField.waitForDisplayed({
            timeout: ELEMENT_TIMEOUT,
            interval: POLL_INTERVAL,
            timeoutMsg: "The merchant Search field did not appear."
        });

        await searchField.waitForEnabled({
            timeout: ELEMENT_TIMEOUT,
            interval: POLL_INTERVAL,
            timeoutMsg: "The merchant Search field is not enabled."
        });

        await searchField.click();
        await searchField.clearValue();
        await searchField.setValue(String(number));

        const deadline = Date.now() + ENTRY_VERIFY_TIMEOUT;

        while (Date.now() < deadline) {
            const source = await driver.getPageSource();
            const typed = getSearchFieldText(source);

            if (typed !== null && normalizePhoneNumber(typed) === wanted) {
                return;
            }

            await sleep(150);
        }

        console.warn(
            `[SEARCH] The Search field did not take the number ` +
            `(attempt ${attempt}/${MAX_ENTRY_ATTEMPTS}). Trying again...`
        );
    }

    throw new Error(
        `Could not enter ${number} in the Search field after ` +
        `${MAX_ENTRY_ATTEMPTS} attempts. Not onboarding it, to avoid ` +
        "a duplicate."
    );
}


/**
 * Wait for a definite search answer.
 *
 * - Found: return immediately.
 * - Loading overlay visible: keep waiting, never trust the screen.
 * - Search field does not contain the number: never trust the screen.
 * - Not found: only after the screen has been stable (no loading,
 *   no match, no changes) for NOT_FOUND_CONFIRM_MS.
 * - Never gets a definite answer: throw, so we never create a
 *   duplicate merchant by mistake.
 */
async function waitForSearchResult(driver, number) {
    const deadline = Date.now() + SEARCH_TIMEOUT;
    const normalizedNumber = normalizePhoneNumber(number);

    let notFoundSince = null;
    let previousSignature = null;

    while (Date.now() < deadline) {
        const source = await driver.getPageSource();

        if (!source.includes('hint="Search"')) {
            throw new Error(
                "The merchant Search field disappeared during search."
            );
        }

        // 1. Positive result: act immediately.
        const matches = findMatches(source, normalizedNumber);

        if (matches.length > 0) {
            console.log(`[SEARCH] Found ${number} in the results.`);

            return {
                matches,
                emptyState: false
            };
        }

        // 2. Still loading: nothing on screen can be trusted yet.
        if (source.includes(LOADING_MARKER)) {
            notFoundSince = null;
            previousSignature = null;

            await sleep(POLL_INTERVAL);
            continue;
        }

        // 3. The Search field must contain the number. If it does not,
        // the screen is showing a default list, not our search, so an
        // empty result means nothing.
        const typed = getSearchFieldText(source);

        if (typed === null || normalizePhoneNumber(typed) !== normalizedNumber) {
            notFoundSince = null;
            previousSignature = null;

            await sleep(POLL_INTERVAL);
            continue;
        }

        // 4. Not loading, number searched, no match: it must stay that
        // way for a while.
        const signature = getContentDescriptions(source)
            .sort()
            .join("\n");

        if (signature !== previousSignature || notFoundSince === null) {
            previousSignature = signature;
            notFoundSince = Date.now();
        }

        if (Date.now() - notFoundSince >= NOT_FOUND_CONFIRM_MS) {
            const emptyState = source.includes(EMPTY_MARKER);

            console.log(
                `[SEARCH] ${number} not found after ` +
                `${NOT_FOUND_CONFIRM_MS}ms of stable, non-loading results.`
            );

            return {
                matches: [],
                emptyState
            };
        }

        await sleep(POLL_INTERVAL);
    }

    throw new Error(
        `Could not get a definite search answer for ${number} within ` +
        `${SEARCH_TIMEOUT}ms (the app may still be loading, or the ` +
        "number was not searched). Not creating the merchant, to avoid " +
        "a duplicate."
    );
}


export async function searchMerchant(driver, number) {
    await enterSearchNumber(driver, number);

    await driver.pause(500);

    const searchResult = await waitForSearchResult(driver, number);

    const matches = searchResult.matches;
    const found = matches.length > 0;

    if (found) {
        console.log(
            `[SEARCH] Existing merchant found for ${number}.`
        );

        for (const description of matches) {
            console.log(
                `[SEARCH] Match: ${description.replace(/\n/g, " | ")}`
            );
        }
    } else if (searchResult.emptyState) {
        console.log(
            `[SEARCH] No existing merchant result for ${number}; ` +
            "the app displays its empty state."
        );
    } else {
        console.log(
            `[SEARCH] No matching merchant result for ${number}.`
        );
    }

    return {
        number: String(number),
        found,
        emptyState: searchResult.emptyState,
        matches: matches.map(description => ({
            description
        }))
    };
}