import path from "node:path";
import fs from "node:fs/promises";
import { env } from "../config/env.js";
import { readStore, writeStore, updateStore } from "../storage/json-store.js";
import { createId } from "../utils/ids.js";
import { secondsFromNow, now, toIso } from "../utils/time.js";
import { SESSION_STATUS } from "./session-state.js";

const STORE = "sessions";

export async function ensureSessionDirs() {
  await fs.mkdir(env.paths.tmpDir, { recursive: true });
}

export async function listSessions() {
  return readStore(STORE, {});
}

export async function saveSessions(sessions) {
  await writeStore(STORE, sessions);
}

export async function createSession({ method, ipHash, phoneMasked = null }) {
  await ensureSessionDirs();

  const sessionId = createId(12);
  const sessionDir = path.join(env.paths.tmpDir, sessionId);
  const authDir = path.join(sessionDir, "auth");

  await fs.mkdir(authDir, { recursive: true });

  const expiresSeconds = method === "pair"
    ? env.session.pairExpiresSeconds
    : env.session.qrExpiresSeconds;

  const session = {
    id: sessionId,
    method,
    ipHash,
    phoneMasked,
    status: SESSION_STATUS.CREATED,
    createdAt: toIso(),
    updatedAt: toIso(),
    expiresAt: secondsFromNow(expiresSeconds),
    downloadExpiresAt: 0,
    sessionDir,
    authDir,
    zipPath: null,
    downloadTokenHash: null,
    downloadUrl: null,
    downloadName: null,
    qrDataUrl: null,
    pairCode: null,
    error: null
  };

  await updateStore(STORE, {}, async (sessions) => {
    sessions[sessionId] = session;
    return sessions;
  });

  return session;
}

export async function updateSession(sessionId, patch) {
  let saved = null;

  await updateStore(STORE, {}, async (sessions) => {
    const current = sessions[sessionId];

    if (!current) {
      return sessions;
    }

    saved = {
      ...current,
      ...patch,
      updatedAt: toIso()
    };

    sessions[sessionId] = saved;
    return sessions;
  });

  return saved;
}

export async function getSession(sessionId) {
  const sessions = await listSessions();
  return sessions[sessionId] || null;
}

export async function removeSessionFiles(sessionId) {
  const session = await getSession(sessionId);

  if (!session?.sessionDir) return;

  await fs.rm(session.sessionDir, {
    recursive: true,
    force: true
  });
}

export async function finalizeSession(sessionId, status, error = null) {
  await removeSessionFiles(sessionId);

  return updateSession(sessionId, {
    status,
    error,
    qrDataUrl: null,
    pairCode: null,
    zipPath: null,
    downloadTokenHash: null,
    downloadUrl: null,
    downloadName: null
  });
}

export async function countActiveSessions(ipHash = null) {
  const sessions = await listSessions();
  const activeStatuses = new Set([
    SESSION_STATUS.CREATED,
    SESSION_STATUS.WAITING_QR,
    SESSION_STATUS.WAITING_PAIR_CODE,
    SESSION_STATUS.WAITING_SCAN,
    SESSION_STATUS.CONNECTED,
    SESSION_STATUS.PACKING
  ]);

  let global = 0;
  let byIp = 0;

  for (const session of Object.values(sessions)) {
    if (!activeStatuses.has(session.status)) continue;
    if (session.expiresAt && session.expiresAt < now()) continue;

    global += 1;

    if (ipHash && session.ipHash === ipHash) {
      byIp += 1;
    }
  }

  return {
    global,
    byIp
  };
}
