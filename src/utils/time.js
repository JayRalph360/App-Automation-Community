export function sleep(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

export function timestamp() {
    return new Date().toISOString().replace(/[:.]/g, "-");
}
