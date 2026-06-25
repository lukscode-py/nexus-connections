import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { env } from "../config/env.js";

const require = createRequire(import.meta.url);
const archiverModule = require("archiver");
const archiver = typeof archiverModule === "function"
  ? archiverModule
  : archiverModule.default;

if (typeof archiver !== "function") {
  throw new Error("Archiver não carregou corretamente.");
}

export function createSessionZipName(date = new Date()) {
  const stamp = date
    .toISOString()
    .replace(/\.\d+Z$/, "")
    .replaceAll(":", "-")
    .replace("T", "-");

  return `${env.session.prefix}-${stamp}.zip`;
}

export async function ensureCredsExists(authDir) {
  const credsPath = path.join(authDir, "creds.json");

  try {
    await fsp.access(credsPath);
    return true;
  } catch {
    return false;
  }
}

export async function zipDirectory(sourceDir, outputPath) {
  await fsp.rm(outputPath, { force: true });

  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath);
    const archive = archiver("zip", {
      zlib: {
        level: 9
      }
    });

    output.on("close", () => resolve({
      bytes: archive.pointer()
    }));

    output.on("error", reject);
    archive.on("error", reject);

    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}

export async function zipCredsOnly(authDir, outputPath) {
  const credsPath = path.join(authDir, "creds.json");

  await fsp.access(credsPath);
  await fsp.mkdir(path.dirname(outputPath), { recursive: true });
  await fsp.rm(outputPath, { force: true });

  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", () => resolve({
      outputPath,
      size: archive.pointer()
    }));

    archive.on("error", reject);

    archive.pipe(output);
    archive.file(credsPath, { name: "creds.json" });
    archive.finalize();
  });
}

