const clients = new Map();

export function writeSse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
  res.flush?.();
}

export function subscribeSessionEvents(req, res, sessionId) {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const client = { res };
  const list = clients.get(sessionId) || new Set();

  list.add(client);
  clients.set(sessionId, list);

  writeSse(res, "ready", {
    ok: true,
    sessionId
  });

  const ping = setInterval(() => {
    try {
      writeSse(res, "ping", {
        time: Date.now()
      });
    } catch {
      clearInterval(ping);
    }
  }, 25000);

  ping.unref?.();

  req.on("close", () => {
    clearInterval(ping);

    const current = clients.get(sessionId);
    if (!current) return;

    current.delete(client);

    if (current.size === 0) {
      clients.delete(sessionId);
    }
  });
}

export function emitSessionEvent(sessionId, event, data) {
  const list = clients.get(sessionId);
  if (!list || list.size === 0) return;

  for (const client of list) {
    try {
      writeSse(client.res, event, data);
    } catch {
      list.delete(client);
    }
  }

  if (list.size === 0) {
    clients.delete(sessionId);
  }
}
