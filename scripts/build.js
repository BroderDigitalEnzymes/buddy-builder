import { build, context } from "esbuild";
import { cpSync, mkdirSync, watch as fsWatch } from "fs";

const isWatch = process.argv.includes("--watch");

const shared = {
  bundle: true,
  sourcemap: true,
  logLevel: "info",
};

function copyStatic() {
  cpSync("src/renderer/index.html", "dist/renderer/index.html");
  cpSync("src/renderer/styles.css", "dist/renderer/styles.css");
  mkdirSync("dist/assets", { recursive: true });
  cpSync("assets", "dist/assets", { recursive: true });
}

const configs = [
  // Main process
  {
    ...shared,
    entryPoints: ["src/main/entry.ts"],
    outfile: "dist/main.cjs",
    platform: "node",
    format: "cjs",
    external: ["electron"],
  },
  // Preload
  {
    ...shared,
    entryPoints: ["src/main/preload.ts"],
    outfile: "dist/preload.cjs",
    platform: "node",
    format: "cjs",
    external: ["electron"],
  },
  // Renderer
  {
    ...shared,
    entryPoints: ["src/renderer/app.tsx"],
    outfile: "dist/renderer/app.js",
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    minify: !isWatch,
  },
];

async function main() {
  mkdirSync("dist/renderer", { recursive: true });

  if (isWatch) {
    const contexts = await Promise.all(configs.map((c) => context(c)));
    await Promise.all(contexts.map((ctx) => ctx.watch()));
    copyStatic();

    // Watch static files (CSS, HTML) and re-copy on change
    for (const file of ["src/renderer/styles.css", "src/renderer/index.html"]) {
      fsWatch(file, () => {
        copyStatic();
        console.log(`Copied ${file}`);
      });
    }

    console.log("Watching for changes...");
  } else {
    await Promise.all(configs.map((c) => build(c)));
    copyStatic();
    console.log("Build complete.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
