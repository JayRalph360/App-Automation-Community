export const settings = {
    importer: {
        enabled: true,
        inputDir: "./data-imports/incoming",
        processedDir: "./data-imports/processed",
        failedDir: "./data-imports/failed"
    },
    
    device: {
        mode: "emulator", // "auto", "emulator", or "physical"
        emulatorAvd: "Pixel_8", // Optional: preferred AVD name, e.g. "Pixel_8"
        emulatorSerial: "emulator-5554", // Optional: exact running emulator serial, e.g. "emulator-5554"
        physicalDeviceSerial: "148807059A002686", // Optional: exact physical-device serial
        
        // Emulator graphics:
        //   ""               = default, same as now (software rendering)
        //   "host"           = use the computer's GPU
        //   "angle_indirect" = another GPU mode that sometimes works when "host" does not
        emulatorGpu: "host"
    },

    camera: {
        applyImage: true,
        restartEmulatorToApply: true
    },

    artifacts: {
        mode: "archive" // "archive" or "overwrite"
    },

    appium: {
        host: "127.0.0.1",
        port: 4723
    },

    application: {
        package: "com.example.commercial_internal_app",
        activity: "com.example.commercial_internal_app.MainActivity",
        expectedOnboardingText: ""
    },

    timeouts: {
        device: 120000,
        appium: 30000,
        element: 15000,
        screen: 15000
    },

    screenMonitor: {
        enabled: false  // (true or false), screen monitoring runs and captures (true) screenshots/XML or skipped (false).
    },
};
