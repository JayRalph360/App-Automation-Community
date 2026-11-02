
function slugifyBusinessName(businessName) {
    return String(businessName ?? "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ".")
        .replace(/^\.+|\.+$/g, "")
        .slice(0, 40);
}

export function generateBusinessEmail(businessName) {
    const slug = slugifyBusinessName(businessName);

    if (!slug) {
        throw new Error(
            "Cannot generate an email without a business name."
        );
    }

    return `${slug}@gmail.com`;
}

export function resolveBusinessEmail(email, businessName) {
    const suppliedEmail = String(email ?? "").trim();

    const emailIsValid =
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(suppliedEmail);

    if (emailIsValid) {
        return suppliedEmail;
    }

    return generateBusinessEmail(businessName);
}
