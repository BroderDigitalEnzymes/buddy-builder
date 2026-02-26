import { build } from "esbuild";
import { cpSync, mkdirSync } from "fs";

const shared = {
  bundle: true,
  sourcemap: true,
  logLevel: "info",
};

async function main() {
  mkdirSync("dist/renderer", { recursive: true });

  await Promise.all([
    // Main process (.cjs so "type":"module" in package.json doesn't interfere)
    build({
      ...shared,
      entryPoints: ["src/main/entry.ts"],
      outfile: "dist/main.cjs",
      platform: "node",
      format: "cjs",
      external: ["electron"],
    }),

    // Preload (.cjs for same reason)
    build({
      ...shared,
      entryPoints: ["src/main/preload.ts"],
      outfile: "dist/preload.cjs",
      platform: "node",
      format: "cjs",
      external: ["electron"],
    }),

    // Renderer (browser context — no node, no zod at runtime)
    build({
      ...shared,
      entryPoints: ["src/renderer/app.ts"],
      outfile: "dist/renderer/app.js",
      platform: "browser",
      format: "iife",
    }),
  ]);

  // Copy static files
  cpSync("src/renderer/index.html", "dist/renderer/index.html");
  cpSync("src/renderer/styles.css", "dist/renderer/styles.css");

  console.log("Build complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
