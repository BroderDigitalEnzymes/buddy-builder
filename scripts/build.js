import { build, context } from "esbuild";
import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync, watch as fsWatch } from "fs";

const isWatch = process.argv.includes("--watch");

const shared = {
  bundle: true,
  sourcemap: true,
  logLevel: "info",
};

/** Copy file only if content has actually changed (avoids spurious electronmon reloads). */
function copyIfChanged(src, dst) {
  const srcBuf = readFileSync(src);
  if (existsSync(dst)) {
    const dstBuf = readFileSync(dst);
    if (srcBuf.equals(dstBuf)) return false;
  }
  writeFileSync(dst, srcBuf);
  return true;
}

function copyStatic() {
  copyIfChanged("src/renderer/index.html", "dist/renderer/index.html");
  copyIfChanged("src/renderer/styles.css", "dist/renderer/styles.css");
  mkdirSync("dist/renderer/styles", { recursive: true });
  cpSync("src/renderer/styles", "dist/renderer/styles", { recursive: true });
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
    external: ["electron", "better-sqlite3", "electron-updater"],
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
    let copyTimer = null;
    for (const file of ["src/renderer/styles.css", "src/renderer/index.html"]) {
      fsWatch(file, () => {
        if (copyTimer) return;
        copyTimer = setTimeout(() => {
          copyTimer = null;
          const changed = copyIfChanged(file, file.replace("src/", "dist/"));
          if (changed) console.log(`Copied ${file}`);
        }, 100);
      });
    }

    // Watch styles directory for split CSS files
    fsWatch("src/renderer/styles", { recursive: true }, (_eventType, filename) => {
      if (!filename || copyTimer) return;
      copyTimer = setTimeout(() => {
        copyTimer = null;
        cpSync("src/renderer/styles", "dist/renderer/styles", { recursive: true });
        console.log(`Copied styles/${filename}`);
      }, 100);
    });

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
