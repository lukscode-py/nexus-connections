import express from "express";
import fs from "node:fs/promises";
import { env } from "../../config/env.js";
import { SESSION_STATUS } from "../../sessions/session-state.js";
import {
  createSession,
  countActiveSessions,
  getSession,
  removeSessionFiles,
  updateSession
} from "../../sessions/session-store.js";
import { publicSession } from "../../sessions/session-public.js";
import {
  canStartQueuedTicket,
  cleanupExpiredQueue,
  createQueueTicket,
  getQueueStats,
  getQueueTicket,
  removeQueueTicket
} from "../../sessions/queue-store.js";
import {
  subscribeSessionEvents,
  writeSse
} from "../../sessions/session-events.js";
import {
  startBaileysSession,
  stopBaileysSession
} from "../../sessions/baileys-manager.js";
import {
  checkFastAttempts,
  checkPhoneAttempts,
  getClientIp
} from "../../security/rate-guard.js";
import { hashValue } from "../../utils/ids.js";
import {
  isValidInternationalPhone,
  maskPhone,
  normalizePhone
} from "../../utils/phone.js";

export const apiRouter = express.Router();

function publicConfig() {
  return {
    name: env.app.name,
    shortName: env.app.shortName,
    creator: env.app.creator,
    github: env.app.github,
    channel: env.app.channel,
    qrExpiresSeconds: env.session.qrExpiresSeconds,
    pairExpiresSeconds: env.session.pairExpiresSeconds,
    downloadExpiresSeconds: env.session.downloadExpiresSeconds,
    queue: {
      enabled: env.queue.enabled,
      pollSeconds: env.queue.pollSeconds,
      maxGlobal: env.queue.maxGlobal,
      maxPerIp: env.queue.maxPerIp,
      expiresSeconds: env.queue.expiresSeconds,
      maxGlobalActive: env.session.maxGlobalActive,
      maxActivePerIp: env.session.maxActivePerIp
    }
  };
}

function clientHash(req) {
  return hashValue(getClientIp(req));
}


async function startRealSession({ method, ipHash, phone = null, phoneMasked = null }) {
  const session = await createSession({
    method,
    ipHash,
    phoneMasked
  });

  startBaileysSession({
    session,
    phone
  }).catch(async () => {
    await updateSession(session.id, {
      status: SESSION_STATUS.FAILED,
      error: "Falha ao iniciar conexão."
    });
  });

  return session;
}

function sessionStartPayload(session, message = "Conexão temporária criada.") {
  return {
    ok: true,
    queued: false,
    sessionId: session.id,
    status: session.status,
    eventUrl: `/api/sessions/${session.id}/events`,
    message
  };
}

async function getAllowedSession(req, res) {
  const session = await getSession(req.params.sessionId);

  if (!session) {
    res.status(404).json({
      ok: false,
      code: "session_not_found",
      message: "Sessão não encontrada ou já removida."
    });
    return null;
  }

  if (session.ipHash !== clientHash(req)) {
    res.status(403).json({
      ok: false,
      code: "session_denied",
      message: "Essa sessão pertence a outro acesso."
    });
    return null;
  }

  return session;
}

apiRouter.get("/health", (req, res) => {
  res.json({
    ok: true,
    name: env.app.name,
    mode: env.nodeEnv,
    time: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime())
  });
});

apiRouter.get("/config", (req, res) => {
  res.json(publicConfig());
});

apiRouter.post("/sessions/start", async (req, res, next) => {
  try {
    const method = String(req.body?.method || "").toLowerCase();

    if (!["qr", "pair"].includes(method)) {
      return res.status(400).json({
        ok: false,
        code: "invalid_method",
        message: "Escolha QR Code ou código por número."
      });
    }

    const fast = await checkFastAttempts(req);

    if (!fast.allowed) {
      return res.status(429).json({
        ok: false,
        code: "too_many_attempts",
        message: "Muitas tentativas em pouco tempo. Tente novamente mais tarde.",
        retryAfterSeconds: fast.retryAfterSeconds
      });
    }

    const ipHash = clientHash(req);
    let phone = null;
    let phoneMasked = null;

    if (method === "pair") {
      phone = normalizePhone(req.body?.phone);

      if (!isValidInternationalPhone(phone)) {
        return res.status(400).json({
          ok: false,
          code: "invalid_phone",
          message: "Digite o número com código do país. Exemplo: +55 74 99999-9999."
        });
      }

      const phoneRate = await checkPhoneAttempts(phone);

      if (!phoneRate.allowed) {
        return res.status(429).json({
          ok: false,
          code: "phone_rate_limited",
          message: "Esse número recebeu muitas tentativas. Tente novamente mais tarde.",
          retryAfterSeconds: phoneRate.retryAfterSeconds
        });
      }

      phoneMasked = maskPhone(phone);
    }

    await cleanupExpiredQueue();

    const active = await countActiveSessions(ipHash);
    const queueStats = await getQueueStats(ipHash);
    const hasWaitingQueue = queueStats.global.waiting > 0;
    const noGlobalSlot = active.global >= env.session.maxGlobalActive;
    const noIpSlot = active.byIp >= env.session.maxActivePerIp;
    const shouldQueue = env.queue.enabled && (hasWaitingQueue || noGlobalSlot || noIpSlot);

    if (shouldQueue) {
      if (queueStats.global.waiting >= env.queue.maxGlobal) {
        return res.status(429).json({
          ok: false,
          queued: false,
          code: "queue_global_full",
          message: "A fila global está cheia. Tente novamente em alguns instantes.",
          queue: queueStats
        });
      }

      if (queueStats.ip.waiting >= env.queue.maxPerIp) {
        return res.status(429).json({
          ok: false,
          queued: false,
          code: "queue_ip_full",
          message: "A fila deste acesso está cheia. Aguarde uma tentativa expirar.",
          queue: queueStats
        });
      }

      const ticket = await createQueueTicket({
        method,
        ipHash,
        phone,
        phoneMasked
      });

      const stats = await getQueueStats(ipHash, ticket.id);

      return res.status(202).json({
        ok: true,
        queued: true,
        ticketId: ticket.id,
        pollUrl: `/api/queue/${ticket.id}/status`,
        queue: stats,
        message: "Você entrou na fila de conexão."
      });
    }

    if (noIpSlot) {
      return res.status(429).json({
        ok: false,
        code: "active_session_exists",
        message: "Já existe uma conexão em andamento neste acesso. Aguarde finalizar ou expirar."
      });
    }

    if (noGlobalSlot) {
      return res.status(503).json({
        ok: false,
        code: "server_busy",
        message: "Muitas conexões acontecendo agora. Tente novamente em alguns minutos."
      });
    }

    const session = await startRealSession({
      method,
      ipHash,
      phone,
      phoneMasked
    });

    res.status(201).json(sessionStartPayload(session));
  } catch (error) {
    next(error);
  }
});

apiRouter.get("/queue/:ticketId/status", async (req, res, next) => {
  try {
    const ipHash = clientHash(req);
    const ticket = await getQueueTicket(req.params.ticketId);

    if (!ticket || ticket.ipHash !== ipHash) {
      return res.status(404).json({
        ok: false,
        queued: false,
        code: "queue_not_found",
        message: "Sua fila expirou ou não foi encontrada."
      });
    }

    const { allowed, stats } = await canStartQueuedTicket(ticket, ipHash);

    if (!allowed) {
      return res.json({
        ok: true,
        queued: true,
        ticketId: ticket.id,
        queue: stats,
        pollSeconds: env.queue.pollSeconds,
        message: "Você ainda está na fila."
      });
    }

    await removeQueueTicket(ticket.id);

    const session = await startRealSession({
      method: ticket.method,
      ipHash,
      phone: ticket.phone,
      phoneMasked: ticket.phoneMasked
    });

    res.json(sessionStartPayload(session, "Sua vaga foi liberada."));
  } catch (error) {
    next(error);
  }
});

apiRouter.delete("/queue/:ticketId", async (req, res) => {
  const ipHash = clientHash(req);
  const ticket = await getQueueTicket(req.params.ticketId);

  if (ticket && ticket.ipHash === ipHash) {
    await removeQueueTicket(ticket.id);
  }

  res.json({
    ok: true
  });
});

apiRouter.get("/sessions/:sessionId/events", async (req, res) => {
  const session = await getSession(req.params.sessionId);

  if (!session || session.ipHash !== clientHash(req)) {
    res.status(404).end();
    return;
  }

  subscribeSessionEvents(req, res, session.id);

  writeSse(res, "snapshot", publicSession(session));
});

apiRouter.get("/sessions/:sessionId/status", async (req, res) => {
  const session = await getAllowedSession(req, res);
  if (!session) return;

  res.json({
    ok: true,
    session: publicSession(session)
  });
});

apiRouter.post("/sessions/:sessionId/cancel", async (req, res) => {
  const session = await getAllowedSession(req, res);
  if (!session) return;

  const cleaned = await stopBaileysSession(session.id);

  res.json({
    ok: true,
    session: publicSession(cleaned)
  });
});

apiRouter.get("/sessions/:sessionId/download", async (req, res) => {
  const session = await getAllowedSession(req, res);
  if (!session) return;

  const token = String(req.query.token || "");
  const validToken = token && session.downloadTokenHash === hashValue(token);

  if (!validToken) {
    return res.status(403).json({
      ok: false,
      code: "invalid_download",
      message: "Link de download inválido ou expirado."
    });
  }

  if (session.status !== SESSION_STATUS.READY_DOWNLOAD || !session.zipPath) {
    return res.status(409).json({
      ok: false,
      code: "download_not_ready",
      message: "A sessão ainda não está pronta para download."
    });
  }

  try {
    await fs.access(session.zipPath);
  } catch {
    return res.status(404).json({
      ok: false,
      code: "zip_not_found",
      message: "Arquivo temporário não encontrado. Gere uma nova sessão."
    });
  }

  if (session.downloadExpiresAt && session.downloadExpiresAt < Date.now()) {
    await removeSessionFiles(session.id);
    await updateSession(session.id, {
      status: SESSION_STATUS.CLEANED,
      error: null,
      qrDataUrl: null,
      pairCode: null,
      zipPath: null,
      downloadTokenHash: null,
      downloadUrl: null,
      downloadName: null
    });

    return res.status(410).json({
      ok: false,
      code: "download_expired",
      message: "Link de download expirado. Gere uma nova sessão."
    });
  }

  res.download(session.zipPath, session.downloadName || "session.zip");
});
