
import { execFile } from "node:child_process";

export function runCommand(
    executable,
    args = [],
    options = {}
) {
    const {
        timeout = 30000,
        cwd,
        env,
        maxBuffer = 10 * 1024 * 1024
    } = options;

    return new Promise((resolve, reject) => {
        execFile(
            executable,
            args,
            {
                cwd,
                env: env ? { ...process.env, ...env } : process.env,
                timeout,
                maxBuffer,
                windowsHide: true,
                encoding: "utf8"
            },
            (error, stdout, stderr) => {
                if (error) {
                    const details = [
                        `Command failed: ${executable}`,
                        `Arguments: ${args.join(" ")}`,
                        `Reason: ${error.message}`,
                        stderr ? `STDERR:\n${stderr.trim()}` : "",
                        stdout ? `STDOUT:\n${stdout.trim()}` : ""
                    ].filter(Boolean).join("\n");

                    const commandError = new Error(details, {
                        cause: error
                    });

                    commandError.stdout = stdout;
                    commandError.stderr = stderr;
                    commandError.code = error.code;

                    reject(commandError);
                    return;
                }

                resolve({
                    stdout: stdout.trim(),
                    stderr: stderr.trim()
                });
            }
        );
    });
}
