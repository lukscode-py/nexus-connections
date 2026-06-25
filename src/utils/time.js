export function now() {
  return Date.now();
}

export function secondsFromNow(seconds) {
  return now() + seconds * 1000;
}

export function isExpired(timestamp) {
  return Number(timestamp) <= now();
}

export function toIso(timestamp = now()) {
  return new Date(timestamp).toISOString();
}
