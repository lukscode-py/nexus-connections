import { now } from "../utils/time.js";

export function secondsUntil(timestamp) {
  if (!timestamp) return 0;
  return Math.max(0, Math.ceil((Number(timestamp) - now()) / 1000));
}

export function publicSession(session) {
  if (!session) return null;

  return {
    id: session.id,
    method: session.method,
    status: session.status,
    phoneMasked: session.phoneMasked || null,
    qrDataUrl: session.qrDataUrl || null,
    pairCode: session.pairCode || null,
    downloadUrl: session.downloadUrl || null,
    downloadName: session.downloadName || null,
    expiresIn: secondsUntil(session.expiresAt),
    downloadExpiresIn: secondsUntil(session.downloadExpiresAt),
    error: session.error || null
  };
}
