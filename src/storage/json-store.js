import fs from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env.js";

function resolveSafeDataPath(fileName) {
  const safeName = path.basename(fileName);

  let baseDir = env.paths.dataDir;

  if (
    env.isReadonlyServerless &&
    (baseDir.startsWith("/var/task") || baseDir.includes("/var/task/"))
  ) {
    baseDir = "/tmp/nexus-connections/data";
  }

  return path.join(baseDir, safeName);
}

async function ensureDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

export async function readStore(fileName, fallback) {
  const filePath = resolveSafeDataPath(fileName);

  await ensureDir(filePath);

  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

export async function writeStore(fileName, data) {
  const filePath = resolveSafeDataPath(fileName);

  await ensureDir(filePath);

  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(data, null, 2));
  await fs.rename(tmpPath, filePath);

  return data;
}

export async function updateStore(fileName, fallback, updater) {
  const current = await readStore(fileName, fallback);
  const next = await updater(current);

  await writeStore(fileName, next);

  return next;
}

export async function removeStore(fileName) {
  const filePath = resolveSafeDataPath(fileName);

  try {
    await fs.rm(filePath, { force: true });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
