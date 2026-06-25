import fs from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env.js";

const locks = new Map();

async function ensureDir() {
  await fs.mkdir(env.paths.dataDir, { recursive: true });
}

function safeName(name) {
  return String(name).replace(/[^a-z0-9_-]/gi, "_").toLowerCase();
}

function filePath(name) {
  return path.join(env.paths.dataDir, `${safeName(name)}.json`);
}

async function withLock(key, task) {
  const prev = locks.get(key) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => {
    release = resolve;
  });

  locks.set(key, prev.then(() => current));

  try {
    await prev;
    return await task();
  } finally {
    release();
    if (locks.get(key) === current) locks.delete(key);
  }
}

export async function readStore(name, fallback = {}) {
  await ensureDir();
  const target = filePath(name);

  try {
    const raw = await fs.readFile(target, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

export async function writeStore(name, data) {
  await ensureDir();
  const target = filePath(name);
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;

  await fs.writeFile(tmp, JSON.stringify(data, null, 2));
  await fs.rename(tmp, target);
}

export async function updateStore(name, fallback, updater) {
  return withLock(name, async () => {
    const current = await readStore(name, fallback);
    const next = await updater(current);
    await writeStore(name, next);
    return next;
  });
}
