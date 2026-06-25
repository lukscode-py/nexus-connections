import { env } from "../config/env.js";
import { readStore, writeStore } from "../storage/json-store.js";
import { hashValue } from "../utils/ids.js";
import { now } from "../utils/time.js";
import { normalizePhone } from "../utils/phone.js";

const STORE = "rate-limit";

function cleanBucket(bucket, currentTime) {
  const next = {};

  for (const [key, item] of Object.entries(bucket || {})) {
    if (item.blockedUntil && item.blockedUntil > currentTime) {
      next[key] = item;
      continue;
    }

    const events = Array.isArray(item.events)
      ? item.events.filter((eventTime) => eventTime > currentTime - item.windowMs)
      : [];

    if (events.length > 0) {
      next[key] = { ...item, events, blockedUntil: 0 };
    }
  }

  return next;
}

async function readRateStore() {
  const currentTime = now();
  const store = await readStore(STORE, {
    errors: {},
    fast: {},
    phones: {}
  });

  return {
    errors: cleanBucket(store.errors, currentTime),
    fast: cleanBucket(store.fast, currentTime),
    phones: cleanBucket(store.phones, currentTime)
  };
}

async function touch(bucket, key, limit, windowSeconds, blockSeconds) {
  const currentTime = now();
  const store = await readRateStore();

  const item = store[bucket][key] || {
    events: [],
    blockedUntil: 0,
    windowMs: windowSeconds * 1000
  };

  if (item.blockedUntil && item.blockedUntil > currentTime) {
    return {
      allowed: false,
      blockedUntil: item.blockedUntil,
      retryAfterSeconds: Math.ceil((item.blockedUntil - currentTime) / 1000)
    };
  }

  const minTime = currentTime - windowSeconds * 1000;
  const events = [...(item.events || []).filter((eventTime) => eventTime > minTime), currentTime];

  if (events.length >= limit) {
    item.events = events;
    item.blockedUntil = currentTime + blockSeconds * 1000;
    store[bucket][key] = item;
    await writeStore(STORE, store);

    return {
      allowed: false,
      blockedUntil: item.blockedUntil,
      retryAfterSeconds: blockSeconds
    };
  }

  item.events = events;
  item.blockedUntil = 0;
  item.windowMs = windowSeconds * 1000;
  store[bucket][key] = item;
  await writeStore(STORE, store);

  return { allowed: true };
}

export function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];

  if (env.http.trustProxy && typeof forwarded === "string") {
    return forwarded.split(",")[0].trim();
  }

  return req.socket?.remoteAddress || req.ip || "unknown";
}

export async function checkFastAttempts(req) {
  const ip = hashValue(getClientIp(req));

  return touch(
    "fast",
    ip,
    env.rate.fastLimit,
    env.rate.fastWindowSeconds,
    env.rate.fastBlockSeconds
  );
}

export async function registerError(req) {
  const ip = hashValue(getClientIp(req));

  return touch(
    "errors",
    ip,
    env.rate.errorLimit,
    env.rate.errorWindowSeconds,
    env.rate.errorBlockSeconds
  );
}

export async function checkPhoneAttempts(phone) {
  const cleanPhone = normalizePhone(phone);
  const key = hashValue(cleanPhone);

  return touch(
    "phones",
    key,
    env.rate.phoneLimit,
    env.rate.phoneWindowSeconds,
    env.rate.phoneBlockSeconds
  );
}
