
const MTN_PREFIXES = new Set([
    "024",
    "025",
    "053",
    "054",
    "055",
    "059",
]);

export function normalizeMtnNumber(input) {
    if (input === null || input === undefined) {
        throw new Error("Phone number is missing.");
    }

    let number = String(input).trim();

    // Permit common visual separators, but not arbitrary letters.
    number = number.replace(/[\s()-]/g, "");

    if (number.startsWith("+")) {
        number = number.slice(1);
    }

    if (number.startsWith("00")) {
        number = number.slice(2);
    }

    if (number.startsWith("0")) {
        number = `233${number.slice(1)}`;
    }

    if (!/^233\d{9}$/.test(number)) {
        throw new Error(
            `Invalid Ghanaian number "${input}". Expected a 10-digit local number or 233 followed by 9 digits.`
        );
    }

    const nationalNumber = `0${number.slice(3, 5)}${number.slice(5)}`;
    const localPrefix = nationalNumber.slice(0, 3);

    if (!MTN_PREFIXES.has(localPrefix)) {
        throw new Error(
            `Number "${input}" does not match the configured Ghanaian MTN prefixes.`
        );
    }

    return number;
}
