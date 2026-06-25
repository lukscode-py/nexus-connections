import { env } from "../config/env.js";
import { readStore, updateStore } from "../storage/json-store.js";
import { createId } from "../utils/ids.js";
import { now, secondsFromNow, toIso } from "../utils/time.js";
import { countActiveSessions } from "./session-store.js";

const STORE = "queue";

function isWaiting(ticket) {
  return ticket?.status === "waiting" && (!ticket.expiresAt || ticket.expiresAt > now());
}

function sortTickets(tickets) {
  return [...tickets].sort((a, b) => {
    const byTime = String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
    if (byTime !== 0) return byTime;
    return String(a.id).localeCompare(String(b.id));
  });
}

export async function listQueueTickets() {
  return readStore(STORE, {});
}

export async function cleanupExpiredQueue() {
  await updateStore(STORE, {}, async (queue) => {
    for (const [id, ticket] of Object.entries(queue)) {
      if (!isWaiting(ticket)) {
        delete queue[id];
      }
    }

    return queue;
  });
}

export async function createQueueTicket({ method, ipHash, phone = null, phoneMasked = null }) {
  await cleanupExpiredQueue();

  const id = createId(10);
  const ticket = {
    id,
    method,
    ipHash,
    phone,
    phoneMasked,
    status: "waiting",
    createdAt: toIso(),
    updatedAt: toIso(),
    expiresAt: secondsFromNow(env.queue.expiresSeconds)
  };

  await updateStore(STORE, {}, async (queue) => {
    queue[id] = ticket;
    return queue;
  });

  return ticket;
}

export async function getQueueTicket(ticketId) {
  await cleanupExpiredQueue();

  const queue = await listQueueTickets();
  return queue[ticketId] || null;
}

export async function removeQueueTicket(ticketId) {
  await updateStore(STORE, {}, async (queue) => {
    delete queue[ticketId];
    return queue;
  });
}

export async function getQueueStats(ipHash = null, ticketId = null) {
  await cleanupExpiredQueue();

  const queue = await listQueueTickets();
  const waiting = sortTickets(Object.values(queue).filter(isWaiting));
  const ipWaiting = ipHash
    ? waiting.filter((ticket) => ticket.ipHash === ipHash)
    : [];

  const ticket = ticketId
    ? waiting.find((item) => item.id === ticketId) || null
    : null;

  const globalIndex = ticket
    ? waiting.findIndex((item) => item.id === ticket.id)
    : -1;

  const ipIndex = ticket && ipHash
    ? ipWaiting.findIndex((item) => item.id === ticket.id)
    : -1;

  const active = await countActiveSessions(ipHash);

  const globalPosition = globalIndex >= 0 ? globalIndex + 1 : 0;
  const ipPosition = ipIndex >= 0 ? ipIndex + 1 : 0;

  return {
    enabled: env.queue.enabled,
    active,
    ticket: ticket ? {
      id: ticket.id,
      method: ticket.method,
      createdAt: ticket.createdAt,
      expiresAt: ticket.expiresAt,
      remainingSeconds: ticket.expiresAt
        ? Math.max(0, Math.ceil((ticket.expiresAt - now()) / 1000))
        : 0
    } : null,
    global: {
      active: active.global,
      waiting: waiting.length,
      position: globalPosition,
      current: active.global + globalPosition,
      limit: env.queue.maxGlobal,
      activeLimit: env.session.maxGlobalActive
    },
    ip: {
      active: active.byIp,
      waiting: ipWaiting.length,
      position: ipPosition,
      current: active.byIp + ipPosition,
      limit: env.queue.maxPerIp,
      activeLimit: env.session.maxActivePerIp
    }
  };
}

export async function canStartQueuedTicket(ticket, ipHash) {
  const stats = await getQueueStats(ipHash, ticket?.id);

  return {
    allowed:
      Boolean(ticket) &&
      stats.global.position === 1 &&
      stats.ip.position === 1 &&
      stats.active.global < env.session.maxGlobalActive &&
      stats.active.byIp < env.session.maxActivePerIp,
    stats
  };
}
