import path from "node:path";
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState
} from "@whiskeysockets/baileys";
import pino from "pino";
import QRCode from "qrcode";
import { env } from "../config/env.js";
import { createToken, hashValue } from "../utils/ids.js";
import { now, secondsFromNow } from "../utils/time.js";
import { sleep } from "../utils/sleep.js";
import { createSessionZipName, ensureCredsExists, zipDirectory } from "../utils/zip.js";
import { SESSION_STATUS } from "./session-state.js";
import { emitSessionEvent } from "./session-events.js";
import {
  finalizeSession,
  getSession,
  removeSessionFiles,
  updateSession
} from "./session-store.js";
import { publicSession } from "./session-public.js";

const logger = pino({
  level: "silent"
});

const engines = new Map();

function readableError(error) {
  if (!error) return "Erro desconhecido.";

  const statusCode = error?.output?.statusCode || error?.statusCode;
  const message = error?.message || String(error);

  if (statusCode) {
    return `${message} | statusCode=${statusCode}`;
  }

  return message;
}

function logBaileysError(label, error) {
  console.error(`[NC_BAILEYS_ERROR] ${label}:`, {
    message: error?.message,
    statusCode: error?.output?.statusCode || error?.statusCode,
    stack: error?.stack
  });
}

function safeClose(engine, reason = "closed") {
  engine.stopped = true;

  if (engine.pairTimer) {
    clearTimeout(engine.pairTimer);
    engine.pairTimer = null;
  }

  try {
    engine.sock?.end?.(new Error(reason));
  } catch {}

  try {
    engine.sock?.ws?.close?.();
  } catch {}
}

function emitState(sessionId, event, session) {
  emitSessionEvent(sessionId, event, publicSession(session));
}

async function markFailed(sessionId, engine, message) {
  safeClose(engine, message);
  engines.delete(sessionId);

  const session = await finalizeSession(sessionId, SESSION_STATUS.FAILED, message);
  emitState(sessionId, "failed", session);
}

async function markExpired(sessionId, engine) {
  const current = await getSession(sessionId);

  const cannotExpireNow = [
    SESSION_STATUS.CONNECTED,
    SESSION_STATUS.PACKING,
    SESSION_STATUS.READY_DOWNLOAD,
    SESSION_STATUS.CLEANED,
    SESSION_STATUS.FAILED
  ].includes(current?.status);

  if (cannotExpireNow) {
    if (engine?.timer) {
      clearTimeout(engine.timer);
      engine.timer = null;
    }

    return;
  }

  safeClose(engine, "expired");
  engines.delete(sessionId);

  const session = await finalizeSession(sessionId, SESSION_STATUS.EXPIRED, "Conexão expirada. Gere uma nova tentativa.");
  emitState(sessionId, "expired", session);
}

async function finishConnected(sessionId, engine, saveCreds) {
  if (engine.exported) return;

  engine.exported = true;

  if (engine.timer) {
    clearTimeout(engine.timer);
    engine.timer = null;
  }

  if (engine.pairTimer) {
    clearTimeout(engine.pairTimer);
    engine.pairTimer = null;
  }

  let session = await updateSession(sessionId, {
    status: SESSION_STATUS.CONNECTED,
    expiresAt: 0,
    error: null
  });

  emitState(sessionId, "connected", session);

  session = await updateSession(sessionId, {
    status: SESSION_STATUS.PACKING,
    expiresAt: 0
  });

  emitState(sessionId, "packing", session);

  await sleep(1500);
  await saveCreds();

  const current = await getSession(sessionId);

  if (!current) {
    return markFailed(sessionId, engine, "Sessão temporária não encontrada.");
  }

  const hasCreds = await ensureCredsExists(current.authDir);

  if (!hasCreds) {
    return markFailed(sessionId, engine, "A conexão abriu, mas os arquivos da sessão não foram salvos.");
  }

  const downloadName = createSessionZipName();
  const zipPath = path.join(current.sessionDir, downloadName);

  await zipDirectory(current.authDir, zipPath);

  const token = createToken(32);
  const downloadUrl = `/api/sessions/${sessionId}/download?token=${encodeURIComponent(token)}`;

  session = await updateSession(sessionId, {
    status: SESSION_STATUS.READY_DOWNLOAD,
    zipPath,
    downloadName,
    downloadTokenHash: hashValue(token),
    downloadUrl,
    downloadExpiresAt: secondsFromNow(env.session.downloadExpiresSeconds),
    qrDataUrl: null,
    pairCode: null,
    error: null
  });

  safeClose(engine, "exported");
  engines.delete(sessionId);

  emitState(sessionId, "zip_ready", session);
}

async function requestPairCode(sessionId, engine, sock, saveCreds, attempt = 0) {
  if (engine.stopped || engine.exported || engine.pairRequested) return;

  const session = await getSession(sessionId);
  if (!session || session.method !== "pair" || !engine.phone) return;

  if (now() >= session.expiresAt) {
    await markExpired(sessionId, engine);
    return;
  }

  if (sock.authState.creds.registered) {
    await saveCreds();
    return;
  }

  try {
    engine.pairRequested = true;

    const code = await sock.requestPairingCode(engine.phone);
    const prettyCode = String(code).match(/.{1,4}/g)?.join("-") || String(code);

    const updated = await updateSession(sessionId, {
      status: SESSION_STATUS.WAITING_PAIR_CODE,
      pairCode: prettyCode,
      qrDataUrl: null,
      error: null
    });

    emitState(sessionId, "pair_code", updated);
  } catch (error) {
    engine.pairRequested = false;

    const message = readableError(error);
    const isClosed = /closed/i.test(message) || error?.output?.statusCode === 428 || error?.statusCode === 428;

    if (isClosed && attempt < 3 && !engine.stopped && !engine.exported) {
      await sleep(900);
      return requestPairCode(sessionId, engine, sock, saveCreds, attempt + 1);
    }

    logBaileysError("requestPairingCode", error);

    const finalMessage = env.isProduction
      ? "Não foi possível gerar o código. Tente novamente."
      : `Não foi possível gerar o código: ${message}`;

    await markFailed(sessionId, engine, finalMessage);
  }
}

async function openSocket(sessionId, engine, attempt = 0) {
  const session = await getSession(sessionId);

  if (!session) {
    engines.delete(sessionId);
    return;
  }

  if (now() >= session.expiresAt) {
    return markExpired(sessionId, engine);
  }

  const { state, saveCreds } = await useMultiFileAuthState(session.authDir);
  const versionInfo = await fetchLatestBaileysVersion().catch(() => null);

  const socketOptions = {
    auth: state,
    printQRInTerminal: false,
    logger,
    browser: Browsers.ubuntu("Chrome"),
    markOnlineOnConnect: false,
    syncFullHistory: false,
    generateHighQualityLinkPreview: false
  };

  if (versionInfo?.version) {
    socketOptions.version = versionInfo.version;
  }

  const sock = makeWASocket(socketOptions);

  engine.sock = sock;

  sock.ev.on("creds.update", saveCreds);

  if (session.method === "pair" && engine.phone && !sock.authState.creds.registered) {
    engine.pairTimer = setTimeout(() => {
      requestPairCode(sessionId, engine, sock, saveCreds).catch((error) => {
        logBaileysError("requestPairCode.timer", error);
      });
    }, 1400);

    engine.pairTimer.unref?.();
  }

  sock.ev.on("connection.update", async (update) => {
    try {
      const { connection, lastDisconnect, qr } = update;

      if (connection) {
        engine.connection = connection;
      }

      if (qr && session.method === "qr") {
        const qrDataUrl = await QRCode.toDataURL(qr, {
          margin: 1,
          width: 320
        });

        const updated = await updateSession(sessionId, {
          status: SESSION_STATUS.WAITING_QR,
          qrDataUrl,
          error: null
        });

        emitState(sessionId, "qr", updated);
      }

      if (connection === "open") {
        await finishConnected(sessionId, engine, saveCreds);
        return;
      }

      if (connection === "close") {
        if (engine.stopped || engine.exported) return;

        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const loggedOut = statusCode === DisconnectReason.loggedOut;
        const canReconnect = !loggedOut && attempt < 2 && now() < session.expiresAt;

        if (canReconnect) {
          await sleep(700);
          await openSocket(sessionId, engine, attempt + 1);
          return;
        }

        await markFailed(sessionId, engine, "Não foi possível concluir a conexão. Gere uma nova tentativa.");
      }
    } catch (error) {
      logBaileysError("connection.update", error);

      const message = env.isProduction
        ? "Erro ao processar a conexão."
        : `Erro ao processar a conexão: ${readableError(error)}`;

      await markFailed(sessionId, engine, message);
    }
  });
}

export async function startBaileysSession({ session, phone = null }) {
  if (engines.has(session.id)) {
    return;
  }

  const engine = {
    sock: null,
    stopped: false,
    exported: false,
    pairRequested: false,
    pairTimer: null,
    connection: "created",
    phone,
    timer: null
  };

  engines.set(session.id, engine);

  const ttl = Math.max(1000, session.expiresAt - now());

  engine.timer = setTimeout(() => {
    markExpired(session.id, engine);
  }, ttl);

  engine.timer.unref?.();

  try {
    await openSocket(session.id, engine);
  } catch (error) {
    logBaileysError("openSocket", error);

    const message = env.isProduction
      ? "Falha ao iniciar conexão."
      : `Falha ao iniciar conexão: ${readableError(error)}`;

    await markFailed(session.id, engine, message);
  }
}

export async function stopBaileysSession(sessionId, reason = "Cancelado pelo usuário.") {
  const engine = engines.get(sessionId);

  if (engine) {
    clearTimeout(engine.timer);
    safeClose(engine, reason);
    engines.delete(sessionId);
  }

  await removeSessionFiles(sessionId);

  const session = await updateSession(sessionId, {
    status: SESSION_STATUS.CLEANED,
    error: reason,
    qrDataUrl: null,
    pairCode: null,
    zipPath: null,
    downloadTokenHash: null,
    downloadUrl: null,
    downloadName: null
  });

  emitState(sessionId, "cleaned", session);

  return session;
}
