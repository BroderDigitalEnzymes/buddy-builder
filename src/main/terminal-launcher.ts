import { spawn as spawnChild } from "child_process";

/**
 * Open a command in the platform's default terminal emulator.
 * Pure Node.js — no Electron dependency.
 */
export function openInTerminal(cwd: string, command: string): void {
  if (process.platform === "win32") {
    // "start" treats the first quoted arg as a window title — pass "" explicitly.
    spawnChild("cmd.exe", ["/c", "start", '""', "/d", cwd, "cmd", "/k", command], { detached: true, stdio: "ignore" });
  } else if (process.platform === "darwin") {
    const cmd = `cd ${cwd} && ${command}`;
    spawnChild("osascript", [
      "-e", `tell application "Terminal" to activate`,
      "-e", `tell application "Terminal" to do script ${JSON.stringify(cmd)}`,
    ], { detached: true, stdio: "ignore" });
  } else {
    // Linux: try common terminal emulators
    const cmd = `cd "${cwd}" && ${command}`;
    for (const term of ["x-terminal-emulator", "gnome-terminal", "konsole", "xterm"]) {
      try {
        if (term === "gnome-terminal") {
          spawnChild(term, ["--", "bash", "-c", cmd], { detached: true, stdio: "ignore" });
        } else {
          spawnChild(term, ["-e", `bash -c ${JSON.stringify(cmd)}`], { detached: true, stdio: "ignore" });
        }
        break;
      } catch { continue; }
    }
  }
}
