import path from "node:path";
import { fileURLToPath } from "node:url";

const currentFile = fileURLToPath(import.meta.url);
const currentDirectory = path.dirname(currentFile);

export const PROJECT_ROOT = path.resolve(currentDirectory, "../..");

export const ANDROID_SDK =
    process.env.ANDROID_HOME ||
    process.env.ANDROID_SDK_ROOT ||
    path.join(process.env.LOCALAPPDATA || "", "Android", "Sdk");

export const APK_PATH = path.join(
    PROJECT_ROOT,
    "app",
    // "commercial_app-v1.6.0-build241.apk",
    "commercial-internal-app-v1.6.6+248.apk"
);

export const CAMERA_IMAGE_PATH = path.join(
    PROJECT_ROOT,
    "assets",
    "capture_img.png"
);

export const ADB_PATH = path.join(
    ANDROID_SDK,
    "platform-tools",
    "adb.exe"
);

export const EMULATOR_PATH = path.join(
    ANDROID_SDK,
    "emulator",
    "emulator.exe"
);

export const ARTIFACTS_DIR = path.join(PROJECT_ROOT, "artifacts");
