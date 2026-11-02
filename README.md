# App Automation

Node.js + PostgreSQL + Appium (UiAutomator2) automation that onboards
Telecel business numbers through an Android app running on an emulator.

## What you need installed

| Software | Notes |
|---|---|
| Node.js 20 or newer | Check with `node -v` |
| PostgreSQL | Remember the password you set for the `postgres` user |
| Android SDK | Needs `platform-tools`, `emulator` and a system image |
| JDK | Set `JAVA_HOME` |
| Virtualization | Turn on VT-x / AMD-V in the BIOS (Hyper-V/WHPX on Windows, KVM on Linux) |

Set `ANDROID_HOME` to the Android SDK folder (for example
`C:\Users\<you>\AppData\Local\Android\Sdk`).

Appium and its UiAutomator2 driver are installed by the project itself
(see step 2), so they do not need to be installed separately.

## First-time setup

1. **Get the project files.** Copy the project folder, but not
   `node_modules` or `.appium`. Make sure these exist:
   - `app/commercial-internal-app-v1.6.6+248.apk` (keep the exact name)
   - `assets/capture_img.png` (the image the emulator camera returns)

2. **Install packages.**
   ```
   npm install
   npm install appium
   ```
   The first `npm start` also downloads the UiAutomator2 driver into
   `.appium` (needs internet, takes about a minute, only once).

3. **Create `.env`.** Copy `.env.example` to `.env` and fill in the
   database password (and user/name if they differ).

4. **Create the database.** Create an empty database whose name matches
   `DB_NAME` (default `app_automation`), then create the tables:
   ```
   createdb app_automation
   npm run db:init
   ```

5. **Create the emulator.** In Android Studio's Device Manager, create an
   AVD named `Pixel_8` (or change `emulatorAvd` in `src/config/settings.js`).

6. **Check `src/config/settings.js`.**
   - `device.mode`: `"emulator"`, `"physical"` or `"auto"`
   - `device.emulatorAvd` / `emulatorSerial`: usually `Pixel_8` / `emulator-5554`
   - `device.physicalDeviceSerial`: only for a real phone (see `adb devices`)
   - `device.emulatorGpu`: leave as `""` first; `"host"` uses the computer's GPU

7. **Windows only?** `src/config/paths.js` looks for `adb.exe` and
   `emulator.exe`. On Mac or Linux it must be updated to use `adb` and
   `emulator` instead.

## Running it

1. Put the merchant files (CSV or Excel) in the importer's input folder
   and import them:
   ```
   npm run import:merchants
   ```
   Files that import cleanly move to the processed folder; files with
   failed rows move to the failed folder. Rows that are rejected on
   purpose (for example, not an MTN number) do not count as failures.

2. Start the onboarding:
   ```
   npm start
   ```
   This starts Appium, boots the emulator, installs the app and onboards
   the pending numbers one by one.

## Output

- `reports/onboarding-report.csv`: one row per number processed, added
  after every run (Run started, Number, Business name, Outcome, Seconds,
  Attempts, Error). If the file is open in Excel, the run is saved as
  `onboarding-report-<timestamp>.csv` instead.
- Terminal summary: totals for the run and for the database.
- `artifacts/`: files saved by the automation.

## Moving to another computer

Repeat the first-time setup above. To bring the data across, either
import the CSV/Excel files again, or copy the database:

```
pg_dump app_automation > backup.sql     (old computer)
psql app_automation < backup.sql        (new computer, after createdb)
```

Also copy `reports/onboarding-report.csv` if you want to keep the history.

## Troubleshooting

| Problem | Check |
|---|---|
| `DB_PASSWORD is missing` | `.env` exists in the project root and has `DB_PASSWORD` |
| `adb` or `emulator` not found | `ANDROID_HOME` is set and the tools exist in the SDK folder |
| Emulator is very slow or will not start | Virtualization is turned on; try `emulatorGpu: "host"` |
| Emulator graphics setting ignored | Close the emulator completely first; a running emulator is reused |
| `AVD "Pixel_8" was not found` | Create the AVD or change `emulatorAvd` |
| Appium driver install fails | Internet access; then run `npm start` again |
| Report not updated | Close `onboarding-report.csv` in Excel |
