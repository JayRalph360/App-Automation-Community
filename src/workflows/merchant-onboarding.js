import {
    claimNextMerchant,
    updateMerchantStatus
} from "../database/merchant-repository.js";

import { searchMerchant } from "./merchant-search.js";
import { registerMerchant } from "./registration-runner.js";
import { writeOnboardingReport } from "../reports/onboarding-report.js";

export async function runMerchantOnboarding(driver) {
    let completedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    // One entry per merchant handled in this run, used for the CSV report.
    const results = [];
    const runStartedAt = Date.now();

    console.log("\nStarting database-driven merchant onboarding.");

    while (true) {
        console.log(
            "\n[ONBOARDING] Requesting the next merchant from PostgreSQL..."
        );

        const merchant = await claimNextMerchant();

        if (!merchant) {
            console.log("No more eligible merchants to process.");
            break;
        }

        const number = String(merchant.number);
        const businessName = merchant.business_name;
        const merchantStartedAt = Date.now();

        const record = outcome => ({
            number,
            businessName,
            outcome,
            seconds: (Date.now() - merchantStartedAt) / 1000,
            attempts: merchant.attempt_count
        });

        console.log("[ONBOARDING] Merchant claimed:", {
            businessName,
            number,
            status: merchant.status,
            attemptCount: merchant.attempt_count
        });

        try {
            console.log(`\nProcessing ${businessName} (${number})`);

            const search = await searchMerchant(driver, number);

            // Merchant already exists in the app.
            if (search.found) {
                const updatedMerchant = await updateMerchantStatus(
                    number,
                    "Completed"
                );

                if (!updatedMerchant) {
                    throw new Error(
                        `Merchant ${number} was found in the app, ` +
                        "but its database record could not be updated."
                    );
                }

                console.log(
                    `[ONBOARDING] ${number} already exists in the app. ` +
                    "Marked Completed."
                );

                results.push(record("Already existed"));
                skippedCount++;
                continue;
            }

            // App displays its empty-state message: start onboarding.
            if (search.emptyState) {
                console.log(
                    `[ONBOARDING] No merchants created yet for ${number}. ` +
                    "Starting merchant registration."
                );
            } else {
                console.log(
                    `[ONBOARDING] No matching merchant found for ${number}. ` +
                    "Proceeding with Create Merchant."
                );
            }

            const registration = await registerMerchant(driver, {
                businessName,
                number,
                email: merchant.email,
                digitalAddress: merchant.digital_address
            });

            const updatedMerchant = await updateMerchantStatus(
                number,
                "Completed"
            );

            if (!updatedMerchant) {
                throw new Error(
                    `Registration returned successfully for ${number}, ` +
                    "but its database record could not be marked Completed."
                );
            }

            // The search missed it, but the app said the number was
            // already registered when we submitted. It is done either way.
            if (registration?.alreadyExisted) {
                console.log(
                    `[ONBOARDING] ${number} turned out to be registered ` +
                    "already (the app rejected the duplicate). " +
                    "Marked Completed."
                );

                results.push(record("Already existed"));
                skippedCount++;
                continue;
            }

            console.log(
                `[ONBOARDING] Successfully completed: ${businessName}`
            );

            results.push(record("Created"));
            completedCount++;
        } catch (error) {
            failedCount++;

            results.push({
                ...record("Failed"),
                error: error.message
            });

            console.error(
                `\n[ONBOARDING] Failed: ${businessName} (${number})`
            );

            console.error("[ONBOARDING] Reason:", error.message);

            console.log(
                `[ONBOARDING] Keeping ${number} as Active so the next ` +
                "run can resume this merchant first."
            );

            try {
                const savedMerchant = await updateMerchantStatus(
                    number,
                    "Active",
                    error.message
                );

                if (!savedMerchant) {
                    console.error(
                        `[ONBOARDING] WARNING: No database record was ` +
                        `updated for ${number}.`
                    );
                } else {
                    console.log(
                        `[ONBOARDING] Saved recovery state for ${number}.`
                    );
                }
            } catch (statusError) {
                console.error(
                    `[ONBOARDING] CRITICAL: Could not save recovery ` +
                    `status for ${number}:`,
                    statusError.message
                );
            }

            // Stop if an error occurs because the app may be on
            // an unexpected screen.
            break;
        }
    }

    const summary = {
        completed: completedCount,
        alreadyExisted: skippedCount,
        failed: failedCount
    };

    console.log("\nOnboarding summary:", summary);

    // Write the CSV report. A problem here must never affect the run.
    if (results.length > 0) {
        try {
            const reportPath = await writeOnboardingReport({
                results,
                startedAt: runStartedAt,
                finishedAt: Date.now()
            });

            console.log(`[REPORT] Saved: ${reportPath}`);
        } catch (error) {
            console.error(
                "[REPORT] Could not write the report:",
                error.message
            );
        }
    }

    return summary;
}