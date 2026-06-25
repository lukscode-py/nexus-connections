import { env } from "../config/env.js";
import { listSessions, finalizeSession, updateSession, removeSessionFiles } from "./session-store.js";
import { SESSION_STATUS } from "./session-state.js";
import { now, isExpired } from "../utils/time.js";

export async function cleanupExpiredSessions() {
  const sessions = await listSessions();

  for (const [id, session] of Object.entries(sessions)) {
    const expirableConnectionStatuses = [
      SESSION_STATUS.CREATED,
      SESSION_STATUS.WAITING_QR,
      SESSION_STATUS.WAITING_PAIR_CODE,
      SESSION_STATUS.WAITING_SCAN
    ];

    const connectionExpired =
      session.expiresAt &&
      isExpired(session.expiresAt) &&
      expirableConnectionStatuses.includes(session.status);

    const downloadExpired =
      session.downloadExpiresAt &&
      isExpired(session.downloadExpiresAt);

    if (connectionExpired) {
      await finalizeSession(id, SESSION_STATUS.EXPIRED, "Sessão expirada.");
      continue;
    }

    if (downloadExpired) {
      await removeSessionFiles(id);
      await updateSession(id, {
        status: SESSION_STATUS.CLEANED,
        error: null,
        qrDataUrl: null,
        pairCode: null,
        zipPath: null,
        downloadTokenHash: null,
        downloadUrl: null,
        downloadName: null
      });
    }
  }
}

export function startCleanupJob() {
  const interval = Math.max(10, env.session.cleanupIntervalSeconds) * 1000;

  cleanupExpiredSessions();

  const timer = setInterval(() => {
    cleanupExpiredSessions();
  }, interval);

  timer.unref?.();
}
