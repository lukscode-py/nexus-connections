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
    downloadExpiresSeconds: env.session.downloadExpiresSeconds
  };
}

function clientHash(req) {
  return hashValue(getClientIp(req));
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
    const active = await countActiveSessions(ipHash);

    if (active.byIp >= env.session.maxActivePerIp) {
      return res.status(429).json({
        ok: false,
        code: "active_session_exists",
        message: "Já existe uma conexão em andamento neste acesso. Aguarde finalizar ou expirar."
      });
    }

    if (active.global >= env.session.maxGlobalActive) {
      return res.status(503).json({
        ok: false,
        code: "server_busy",
        message: "Muitas conexões acontecendo agora. Tente novamente em alguns minutos."
      });
    }

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

    res.status(201).json({
      ok: true,
      sessionId: session.id,
      status: session.status,
      eventUrl: `/api/sessions/${session.id}/events`,
      message: "Conexão temporária criada."
    });
  } catch (error) {
    next(error);
  }
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

  res.download(session.zipPath, session.downloadName || "session.zip", async (error) => {
    if (error) return;

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
  });
});
