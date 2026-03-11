import * as fs from "fs";
import * as path from "path";
import { app } from "electron";

const logPath = path.join(app.getPath("userData"), "debug.log");

fs.appendFileSync(logPath, `\n${"=".repeat(60)}\nSession started ${new Date().toISOString()}\n${"=".repeat(60)}\n`);

/** Synchronous append — survives native crashes. */
export function dlog(...args: unknown[]): void {
  const line = `[${new Date().toISOString()}] ${args.map(String).join(" ")}\n`;
  fs.appendFileSync(logPath, line);
}

dlog("Log file:", logPath);
