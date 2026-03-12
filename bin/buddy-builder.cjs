#!/usr/bin/env node
const { spawn } = require("child_process");
const path = require("path");

const electronPath = require("electron");
const appPath = path.join(__dirname, "..", "dist", "main.cjs");

const child = spawn(electronPath, [appPath], {
  stdio: "inherit",
  windowsHide: false,
});

child.on("close", (code) => process.exit(code ?? 0));
