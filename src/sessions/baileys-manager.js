import path from "node:path";
import fsp from "node:fs/promises";
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
import { createSessionZipName, ensureCredsExists, zipCredsOnly, zipDirectory } from "../utils/zip.js";
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



function parseAutoJoinTarget(rawLink) {
  const raw = String(rawLink || "").trim();

  if (!raw) return null;

  let url;

  try {
    url = new URL(raw);
  } catch {
    try {
      url = new URL(`https://${raw}`);
    } catch {
      return null;
    }
  }

  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  const parts = url.pathname.split("/").filter(Boolean);
  const first = parts[0]?.toLowerCase();
  const second = parts[1];

  if (host === "chat.whatsapp.com" && first) {
    return {
      type: "group",
      code: first,
      raw
    };
  }

  if ((host === "whatsapp.com" || host === "wa.me") && first === "channel" && second) {
    return {
      type: "channel",
      code: second,
      raw
    };
  }

  return null;
}

async function withJoinTimeout(task, label, ms = 15000) {
  let timer;

  return Promise.race([
    task,
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`${label} excedeu ${ms}ms`));
      }, ms);

      timer.unref?.();
    })
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function joinAutoTarget(sock, target, index, total) {
  if (!target) return {
    ok: false,
    reason: "invalid_link"
  };

  console.log(`[NC_AUTO_JOIN] tentando ${index}/${total}`, {
    type: target.type,
    code: target.code,
    link: target.raw,
    hasGroupAcceptInvite: typeof sock.groupAcceptInvite === "function",
    hasNewsletterMetadata: typeof sock.newsletterMetadata === "function",
    hasNewsletterFollow: typeof sock.newsletterFollow === "function"
  });

  try {
    if (target.type === "group") {
      if (typeof sock.groupAcceptInvite !== "function") {
        throw new Error("groupAcceptInvite indisponível nesta versão do Baileys.");
      }

      const result = await withJoinTimeout(
        sock.groupAcceptInvite(target.code),
        "groupAcceptInvite"
      );

      console.log(`[NC_AUTO_JOIN] grupo ${index}/${total} ok`, {
        code: target.code,
        result
      });

      return {
        ok: true,
        type: target.type,
        result
      };
    }

    if (target.type === "channel") {
      if (typeof sock.newsletterMetadata !== "function") {
        throw new Error("newsletterMetadata indisponível nesta versão do Baileys.");
      }

      if (typeof sock.newsletterFollow !== "function") {
        throw new Error("newsletterFollow indisponível nesta versão do Baileys.");
      }

      const metadata = await withJoinTimeout(
        sock.newsletterMetadata("invite", target.code),
        "newsletterMetadata"
      );

      const jid = metadata?.id || metadata?.jid;

      console.log(`[NC_AUTO_JOIN] metadata canal ${index}/${total}`, {
        code: target.code,
        jid,
        name: metadata?.name,
        state: metadata?.state
      });

      if (!jid) {
        throw new Error("Não foi possível obter o JID do canal.");
      }

      const result = await withJoinTimeout(
        sock.newsletterFollow(jid),
        "newsletterFollow"
      );

      console.log(`[NC_AUTO_JOIN] canal ${index}/${total} ok`, {
        code: target.code,
        jid,
        result
      });

      return {
        ok: true,
        type: target.type,
        jid,
        result
      };
    }

    return {
      ok: false,
      type: target.type,
      reason: "unsupported_type"
    };
  } catch (error) {
    console.warn(`[NC_AUTO_JOIN] falhou ${index}/${total}`, {
      type: target.type,
      code: target.code,
      link: target.raw,
      message: error?.message || String(error),
      stack: error?.stack
    });

    return {
      ok: false,
      type: target.type,
      error: error?.message || String(error)
    };
  }
}

async function runAutoJoinTargets(sock) {
  const links = env.session.autoJoinLinks;

  console.log("[NC_AUTO_JOIN] links carregados", {
    count: links.length,
    links
  });

  if (!links.length) return [];

  const targets = links.map(parseAutoJoinTarget).filter(Boolean);

  console.log("[NC_AUTO_JOIN] targets parseados", {
    count: targets.length,
    targets
  });

  const results = [];

  for (const [index, target] of targets.entries()) {
    const result = await joinAutoTarget(sock, target, index + 1, targets.length);
    results.push(result);

    if (index < targets.length - 1) {
      await sleep(env.session.autoJoinDelayMs);
    }
  }

  console.log("[NC_AUTO_JOIN] resultados", results);

  return results;
}


function isCredsExportMode() {
  return env.session.modeExport === "creds";
}

function isFullExportMode() {
  return !isCredsExportMode();
}

async function readCredsJson(authDir) {
  const raw = await fsp.readFile(path.join(authDir, "creds.json"), "utf8");
  return JSON.parse(raw);
}

function inspectCredsReadiness(creds) {
  const nextPreKeyId = Number(creds?.nextPreKeyId || 0);
  const firstUnuploadedPreKeyId = Number(creds?.firstUnuploadedPreKeyId || 0);
  const minPreKeyId = env.session.credsMinPreKeyId;

  const checks = {
    hasMe: Boolean(creds?.me?.id),
    hasAccount: Boolean(creds?.account),
    hasAdvSecretKey: Boolean(creds?.advSecretKey),
    hasSignalIdentities: Array.isArray(creds?.signalIdentities) && creds.signalIdentities.length > 0,
    hasRoutingInfo: Boolean(creds?.routingInfo),
    hasLastAccountSyncTimestamp: Boolean(creds?.lastAccountSyncTimestamp),
    nextPreKeyOk: nextPreKeyId >= minPreKeyId,
    firstUnuploadedPreKeyOk: firstUnuploadedPreKeyId >= minPreKeyId
  };

  const ready =
    checks.hasMe &&
    checks.hasAccount &&
    checks.hasAdvSecretKey &&
    checks.hasSignalIdentities &&
    checks.nextPreKeyOk &&
    checks.firstUnuploadedPreKeyOk &&
    (!env.session.credsRequireRoutingInfo || checks.hasRoutingInfo) &&
    (!env.session.credsRequireAccountSync || checks.hasLastAccountSyncTimestamp);

  return {
    ready,
    nextPreKeyId,
    firstUnuploadedPreKeyId,
    minPreKeyId,
    checks
  };
}

async function waitForCredsReady(authDir, saveCreds) {
  const startedAt = Date.now();
  let lastInfo = null;
  let lastError = null;

  while (Date.now() - startedAt <= env.session.credsReadyTimeoutMs) {
    try {
      await saveCreds();

      const creds = await readCredsJson(authDir);
      const info = inspectCredsReadiness(creds);

      lastInfo = info;

      console.log("[NC_CREDS_EXPORT] readiness", info);

      if (info.ready) {
        return {
          creds,
          info
        };
      }
    } catch (error) {
      lastError = error;
      console.warn("[NC_CREDS_EXPORT] aguardando creds.json", {
        message: error?.message || String(error)
      });
    }

    await sleep(env.session.credsReadyIntervalMs);
  }

  const reason = lastInfo
    ? `creds.json ainda não ficou maduro: ${JSON.stringify(lastInfo)}`
    : `creds.json não pôde ser lido: ${lastError?.message || "erro desconhecido"}`;

  throw new Error(reason);
}

async function exportCredsOnly(sessionId, engine, saveCreds, source = "open") {
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

  const current = await getSession(sessionId);

  if (!current) {
    return markFailed(sessionId, engine, "Sessão temporária não encontrada.");
  }

  try {
    const { info } = await waitForCredsReady(current.authDir, saveCreds);

    console.log("[NC_CREDS_EXPORT] creds pronto para exportar", {
      source,
      info
    });
  } catch (error) {
    return markFailed(
      sessionId,
      engine,
      `O creds.json não ficou pronto para exportação: ${error?.message || String(error)}`
    );
  }

  safeClose(engine, `creds-export-${source}`);

  await sleep(env.session.closeWaitMs);
  await saveCreds();

  session = await updateSession(sessionId, {
    status: SESSION_STATUS.PACKING,
    expiresAt: 0
  });

  emitState(sessionId, "packing", session);

  const downloadName = createSessionZipName();
  const zipPath = path.join(current.sessionDir, downloadName);

  await zipCredsOnly(current.authDir, zipPath);

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

  engines.delete(sessionId);

  emitState(sessionId, "zip_ready", session);
}

async function finishConnected(sessionId, engine, saveCreds) {
  if (isCredsExportMode()) {
    return exportCredsOnly(sessionId, engine, saveCreds, "open");
  }

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

  await sleep(env.session.syncWaitMs);
  await saveCreds();

  const current = await getSession(sessionId);

  if (!current) {
    return markFailed(sessionId, engine, "Sessão temporária não encontrada.");
  }

  const hasCreds = await ensureCredsExists(current.authDir);

  if (!hasCreds) {
    return markFailed(sessionId, engine, "A conexão abriu, mas os arquivos da sessão não foram salvos.");
  }

  await runAutoJoinTargets(engine.sock);

  await sleep(env.session.afterJoinSyncWaitMs);
  await saveCreds();

  safeClose(engine, "exporting");

  await sleep(env.session.closeWaitMs);
  await saveCreds();

  session = await updateSession(sessionId, {
    status: SESSION_STATUS.PACKING,
    expiresAt: 0
  });

  emitState(sessionId, "packing", session);

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
