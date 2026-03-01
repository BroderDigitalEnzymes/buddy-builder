import { app } from "electron";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

export type AppConfig = {
  claudePath: string;
};

const DEFAULTS: AppConfig = {
  claudePath: "claude",
};

function configPath(): string {
  const dir = app.getPath("userData");
  mkdirSync(dir, { recursive: true });
  return join(dir, "buddy-config.json");
}

export function loadConfig(): AppConfig {
  try {
    const raw = readFileSync(configPath(), "utf-8");
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveConfig(config: AppConfig): void {
  writeFileSync(configPath(), JSON.stringify(config, null, 2), "utf-8");
}
