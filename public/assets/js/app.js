const root = document.documentElement;
const view = document.querySelector("#view");
const statusPanel = document.querySelector("#statusPanel");
const themeToggle = document.querySelector("#themeToggle");
const themeMenu = document.querySelector("#themeMenu");
const themeButtons = [...document.querySelectorAll("[data-set-theme]")];

const state = {
  method: "qr",
  phone: "",
  sessionId: null,
  eventUrl: null,
  session: null,
  eventSource: null,
  countdownTimer: null,
  queueTimer: null,
  queueTicketId: null,
  queue: null,
  creating: false,
  downloadTriggered: false,
  uptimeBaseSeconds: 0,
  uptimeFetchedAt: 0
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function onlyDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function icon(name) {
  const icons = {
    back: '<svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M14.7 5.3a1 1 0 0 1 0 1.4L10.41 11H19a1 1 0 1 1 0 2h-8.59l4.3 4.3a1 1 0 0 1-1.42 1.4l-6-6a1 1 0 0 1 0-1.4l6-6a1 1 0 0 1 1.41 0Z"></path></svg>',
    close: '<svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M6.7 5.3a1 1 0 0 0-1.4 1.4L10.59 12l-5.3 5.3a1 1 0 1 0 1.42 1.4L12 13.41l5.3 5.3a1 1 0 0 0 1.4-1.42L13.41 12l5.3-5.3a1 1 0 0 0-1.42-1.4L12 10.59 6.7 5.3Z"></path></svg>',
    qr: '<svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h7v7H4V4Zm2 2v3h3V6H6Zm7-2h7v7h-7V4Zm2 2v3h3V6h-3ZM4 13h7v7H4v-7Zm2 2v3h3v-3H6Zm9-2h2v2h-2v-2Zm2 2h3v2h-2v3h-3v-2h1v-2h1v-1Zm-4 2h2v3h-2v-3Zm6-4h1v2h-3v-2h2Z"></path></svg>',
    pair: '<svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 2h8a3 3 0 0 1 3 3v14a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V5a3 3 0 0 1 3-3Zm0 3v14h8V5H8Zm2 11h4a1 1 0 1 1 0 2h-4a1 1 0 1 1 0-2Zm2-9a3 3 0 0 1 3 3c0 1.2-.7 2.24-1.72 2.72-.2.1-.28.18-.28.4V14h-2v-.88c0-1.08.6-1.72 1.38-2.08A1.13 1.13 0 0 0 13 10a1 1 0 0 0-2 0H9a3 3 0 0 1 3-3Z"></path></svg>',
    bolt: '<svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2 4 14h7l-1 8 10-13h-7l1-7Z"></path></svg>',
    shield: '<svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 4.5 5v6.2c0 4.7 3.1 8.9 7.5 10.8 4.4-1.9 7.5-6.1 7.5-10.8V5L12 2Zm3.7 7.7-4.4 4.4-2-2 1.4-1.4.6.6 3-3 1.4 1.4Z"></path></svg>',
    download: '<svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M11 3h2v9l3.3-3.3 1.4 1.4L12 15.8l-5.7-5.7 1.4-1.4L11 12V3ZM5 19h14v2H5v-2Z"></path></svg>',
    copy: '<svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 7a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3h-1v1a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-6a3 3 0 0 1 3-3h1V7Zm3-1a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-6ZM7 10a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-1h-3a3 3 0 0 1-3-3v-3H7Z"></path></svg>',
    check: '<svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="m9.2 16.2-3.4-3.4-1.4 1.4 4.8 4.8L20 8.2l-1.4-1.4-9.4 9.4Z"></path></svg>'
  };

  return icons[name] || "";
}

function formatUptime(seconds) {
  let remaining = Math.max(0, Math.floor(Number(seconds) || 0));

  const month = 30 * 24 * 60 * 60;
  const week = 7 * 24 * 60 * 60;
  const day = 24 * 60 * 60;
  const hour = 60 * 60;
  const minute = 60;

  const months = Math.floor(remaining / month);
  remaining %= month;

  const weeks = Math.floor(remaining / week);
  remaining %= week;

  const days = Math.floor(remaining / day);
  remaining %= day;

  const hours = Math.floor(remaining / hour);
  remaining %= hour;

  const minutes = Math.floor(remaining / minute);
  const secondsLeft = remaining % minute;

  const parts = [
    `${months} meses`,
    `${weeks} semanas`,
    `${days} dias`,
    `${hours} horas`,
    `${minutes} min`,
    `${secondsLeft} seg`
  ];

  return parts.join(", ");
}

function getLiveUptimeSeconds() {
  if (!state.uptimeFetchedAt) return 0;
  return state.uptimeBaseSeconds + Math.floor((Date.now() - state.uptimeFetchedAt) / 1000);
}

function updateUptimeDisplay() {
  const target = document.querySelector("#uptimeLive");
  if (!target) return;
  target.textContent = formatUptime(getLiveUptimeSeconds());
}

async function refreshUptime() {
  try {
    const response = await fetch("/api/health");
    const data = await response.json();

    if (response.ok && data?.ok) {
      state.uptimeBaseSeconds = Number(data.uptimeSeconds) || 0;
      state.uptimeFetchedAt = Date.now();
    }
  } catch {
    state.uptimeBaseSeconds = 0;
    state.uptimeFetchedAt = 0;
  }

  updateUptimeDisplay();
}

function setTheme(theme) {
  const value = ["system", "light", "dark"].includes(theme) ? theme : "system";
  root.dataset.theme = value;
  localStorage.setItem("nc-theme", value);

  for (const button of themeButtons) {
    button.classList.toggle("active", button.dataset.setTheme === value);
  }
}

function setStatus(text, type = "default") {
  const dotClass = type === "danger"
    ? "status-dot danger"
    : type === "wait"
      ? "status-dot wait"
      : "status-dot";

  statusPanel.innerHTML = `<span class="${dotClass}"></span><span>${escapeHtml(text)}</span>`;
}

function formatPhoneLikeWhatsApp(value) {
  const digits = onlyDigits(value).slice(0, 15);

  if (!digits) return "";

  if (digits.startsWith("55")) {
    const ddi = digits.slice(0, 2);
    const ddd = digits.slice(2, 4);
    const first = digits.slice(4, 9);
    const second = digits.slice(9, 13);

    let output = `+${ddi}`;
    if (ddd) output += ` ${ddd}`;
    if (first) output += ` ${first}`;
    if (second) output += `-${second}`;
    return output;
  }

  return `+${digits}`;
}

function currentRoute() {
  const hash = window.location.hash.replace("#", "").trim();
  return ["inicio", "escolha", "conectar", "download"].includes(hash) ? hash : "inicio";
}

function navigate(route) {
  window.location.hash = route;
}

function stopCountdown() {
  if (state.countdownTimer) {
    clearInterval(state.countdownTimer);
    state.countdownTimer = null;
  }
}

function startCountdown(seconds, targetId) {
  stopCountdown();

  let remaining = Math.max(0, Number(seconds) || 0);

  function renderCountdown() {
    const target = document.querySelector(`#${targetId}`);
    if (!target) return;

    const mm = String(Math.floor(remaining / 60)).padStart(2, "0");
    const ss = String(remaining % 60).padStart(2, "0");
    target.textContent = `${mm}:${ss}`;

    if (remaining <= 0) {
      stopCountdown();
      return;
    }

    remaining -= 1;
  }

  renderCountdown();
  state.countdownTimer = setInterval(renderCountdown, 1000);
}

function closeEvents() {
  if (state.eventSource) {
    state.eventSource.close();
    state.eventSource = null;
  }
}

function clearQueuePolling() {
  if (state.queueTimer) {
    clearInterval(state.queueTimer);
    state.queueTimer = null;
  }
}

function resetConnection() {
  closeEvents();
  stopCountdown();
  clearQueuePolling();

  state.queueTicketId = null;
  state.queue = null;
  state.sessionId = null;
  state.eventUrl = null;
  state.session = null;
  state.creating = false;
  state.downloadTriggered = false;
}

async function cancelAndBack() {
  const sessionId = state.sessionId;

  try {
    if (sessionId) {
      await fetch(`/api/sessions/${sessionId}/cancel`, {
        method: "POST"
      });
    }

    if (state.queueTicketId) {
      await fetch(`/api/queue/${state.queueTicketId}`, {
        method: "DELETE"
      });
    }
  } catch {
    // não bloquear navegação
  }

  resetConnection();
  navigate("escolha");
}

function renderHome() {
  setStatus("Pronto para iniciar");

  view.innerHTML = `
    <div class="hero-pro">
      <div class="hero-main">
        <span class="eyebrow">Nexus Connections</span>
        <h1>Gere sessões do WhatsApp de forma simples, rápida e segura.</h1>
        <p>
          Escolha QR Code ou Pair Code, conecte no WhatsApp e baixe o arquivo
          de sessão direto pelo site.
        </p>

        <div class="hero-actions">
          <button class="primary-btn big" id="goChoiceBtn" type="button">
            ${icon("bolt")}
            Iniciar conexão
          </button>
          <span class="mini-note">Modo atual: sessão temporária com download expiráveis.</span>
        </div>
      </div>

      <div class="hero-console">
        <div class="console-top">
          <span></span><span></span><span></span>
        </div>
        <div class="console-line">
          <small>status</small>
          <strong>online</strong>
        </div>
        <div class="console-line">
          <small>uptime</small>
          <strong id="uptimeLive">${formatUptime(getLiveUptimeSeconds())}</strong>
        </div>
        <div class="console-line">
          <small>export</small>
          <strong>zip session</strong>
        </div>
      </div>
    </div>

    <div class="feature-grid">
      <div class="feature-card">
        <span class="feature-icon">${icon("qr")}</span>
        <strong>QR Code</strong>
        <p>Conecte escaneando o código no WhatsApp.</p>
      </div>

      <div class="feature-card">
        <span class="feature-icon">${icon("pair")}</span>
        <strong>Pair Code</strong>
        <p>Use um número para gerar código de pareamento.</p>
      </div>

      <div class="feature-card">
        <span class="feature-icon">${icon("shield")}</span>
        <strong>Download seguro</strong>
        <p>Crie suas sessões de forma simples e com segurança.</p>
      </div>
    </div>
  `;

  document.querySelector("#goChoiceBtn").addEventListener("click", () => navigate("escolha"));
}

function renderChoice() {
  setStatus("Escolha como deseja conectar");

  const isQr = state.method === "qr";

  view.innerHTML = `
    <div class="route-head compact">
      <button class="icon-control" id="backHomeBtn" type="button" aria-label="Voltar para o início">${icon("back")}</button>
      <div>
        <span class="eyebrow">Método de conexão</span>
        <h2>Escolha o modo de pareamento</h2>
        <p class="helper-text">Você pode alternar entre QR Code e Pair Code antes de iniciar.</p>
      </div>
    </div>

    <div class="method-tabs" role="tablist" aria-label="Métodos de conexão">
      <button class="method-tab ${isQr ? "active" : ""}" id="pickQrBtn" type="button">
        ${icon("qr")}
        <span>
          <strong>QR Code</strong>
          <small>Escanear com o WhatsApp</small>
        </span>
      </button>

      <button class="method-tab ${!isQr ? "active" : ""}" id="pickPairBtn" type="button">
        ${icon("pair")}
        <span>
          <strong>Pair Code</strong>
          <small>Gerar código pelo número</small>
        </span>
      </button>
    </div>

    <div class="notice-card">
      <strong>Aviso de compatibilidade</strong>
      <p>
        Alguns bots podem não ser compatíveis com sessões geradas por este método.
        Isso depende da base do próprio bot e não pode ser corrigido pela aplicação.
        Se o seu bot não conectar mesmo seguindo todos os passos, verifique a compatibilidade
        da sua base antes de considerar erro no sistema.
      </p>
    </div>

    <div class="setup-card">
      <div class="setup-preview">
        <div class="preview-device">
          <div class="preview-screen">
            <span class="preview-icon">${isQr ? icon("qr") : icon("pair")}</span>
          </div>
        </div>
      </div>

      <div class="setup-content">
        <span class="eyebrow">${isQr ? "QR Code selecionado" : "Pair Code selecionado"}</span>
        <h3>${isQr ? "Conectar escaneando o QR" : "Conectar com código por número"}</h3>
        <p>
          ${isQr
            ? "Ao continuar, o site vai gerar um QR Code temporário para conectar sua sessão."
            : "Digite o número com código do país. O site vai gerar um código para usar no WhatsApp."}
        </p>

        ${!isQr ? `
          <div class="form-block">
            <label for="phoneInput">Número do WhatsApp</label>
            <input
              id="phoneInput"
              class="text-input"
              inputmode="tel"
              autocomplete="tel"
              placeholder="+55 74 99999-9999"
              value="${escapeHtml(state.phone)}"
            >
          </div>
        ` : ""}

        <button class="primary-btn full" id="continueBtn" type="button">
          ${isQr ? icon("qr") : icon("pair")}
          Continuar
        </button>
      </div>
    </div>
  `;

  document.querySelector("#backHomeBtn").addEventListener("click", () => navigate("inicio"));

  document.querySelector("#pickQrBtn").addEventListener("click", () => {
    state.method = "qr";
    renderChoice();
  });

  document.querySelector("#pickPairBtn").addEventListener("click", () => {
    state.method = "pair";
    renderChoice();
  });

  const phoneInput = document.querySelector("#phoneInput");
  if (phoneInput) {
    phoneInput.addEventListener("input", () => {
      state.phone = formatPhoneLikeWhatsApp(phoneInput.value);
      phoneInput.value = state.phone;
    });
  }

  document.querySelector("#continueBtn").addEventListener("click", async () => {
    if (state.method === "pair") {
      const digits = onlyDigits(state.phone);

      if (digits.length < 10) {
        setStatus("Digite um número válido", "danger");
        return;
      }
    }

    await startSessionRequest();
  });
}


function queueMetricHtml(label, data) {
  const current = Number(data?.current || 0);
  const limit = Number(data?.limit || 0);
  const position = Number(data?.position || 0);
  const active = Number(data?.active || 0);
  const waiting = Number(data?.waiting || 0);

  return `
    <div class="queue-metric">
      <span>${escapeHtml(label)}</span>
      <strong>${current}/${limit}</strong>
      <small>posição ${position || "-"} • ativos ${active} • aguardando ${waiting}</small>
    </div>
  `;
}

function applyQueuePayload(data) {
  state.creating = false;
  state.queueTicketId = data.ticketId || state.queueTicketId;
  state.queue = data.queue || state.queue;
  render();
}

function startSessionFromQueue(data) {
  clearQueuePolling();
  state.creating = false;
  state.queue = null;
  state.queueTicketId = null;
  state.sessionId = data.sessionId;
  state.eventUrl = data.eventUrl;
  state.downloadTriggered = false;
  openEvents(data.eventUrl);
  render();
}

async function pollQueueTicket() {
  if (!state.queueTicketId) return;

  try {
    const response = await fetch(`/api/queue/${state.queueTicketId}/status`);
    const data = await response.json();

    if (!response.ok || !data.ok) {
      clearQueuePolling();
      state.creating = false;
      state.queue = null;
      state.queueTicketId = null;
      state.session = {
        status: "failed",
        error: data.message || "Sua fila expirou. Tente iniciar novamente."
      };
      render();
      return;
    }

    if (data.queued) {
      applyQueuePayload(data);
      return;
    }

    if (data.sessionId && data.eventUrl) {
      startSessionFromQueue(data);
    }
  } catch {
    setStatus("Aguardando fila...", "wait");
  }
}

function startQueuePolling() {
  clearQueuePolling();
  pollQueueTicket();

  state.queueTimer = setInterval(() => {
    pollQueueTicket();
  }, 2000);
}


async function startSessionRequest() {
  if (state.creating) return;

  state.creating = true;
  state.session = null;
  state.sessionId = null;
  state.eventUrl = null;
  state.downloadTriggered = false;

  navigate("conectar");
  render();

  try {
    const payload = state.method === "pair"
      ? { method: state.method, phone: onlyDigits(state.phone) }
      : { method: state.method };

    const response = await fetch("/api/sessions/start", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok || !data.ok) {
      state.creating = false;
      state.session = {
        status: "failed",
        error: data.message || "Não foi possível iniciar a conexão."
      };
      render();
      return;
    }

    if (data.queued) {
      state.creating = false;
      state.queueTicketId = data.ticketId;
      state.queue = data.queue;
      startQueuePolling();
      render();
      return;
    }

    state.creating = false;
    state.sessionId = data.sessionId;
    state.eventUrl = data.eventUrl;
    openEvents(data.eventUrl);
    render();
  } catch {
    state.creating = false;
    state.session = {
      status: "failed",
      error: "Erro de conexão. Tente novamente."
    };
    render();
  }
}

function applySession(session) {
  state.session = session;

  if (session?.status === "ready_download") {
    closeEvents();
    navigate("download");
  }

  render();
}

function openEvents(url) {
  closeEvents();

  const source = new EventSource(url);
  state.eventSource = source;

  source.addEventListener("snapshot", (event) => {
    applySession(JSON.parse(event.data));
  });

  source.addEventListener("qr", (event) => {
    applySession(JSON.parse(event.data));
  });

  source.addEventListener("pair_code", (event) => {
    applySession(JSON.parse(event.data));
  });

  source.addEventListener("connected", (event) => {
    applySession(JSON.parse(event.data));
  });

  source.addEventListener("packing", (event) => {
    applySession(JSON.parse(event.data));
  });

  source.addEventListener("zip_ready", (event) => {
    applySession(JSON.parse(event.data));
  });

  source.addEventListener("expired", (event) => {
    applySession(JSON.parse(event.data));
  });

  source.addEventListener("failed", (event) => {
    applySession(JSON.parse(event.data));
  });

  source.addEventListener("cleaned", (event) => {
    applySession(JSON.parse(event.data));
  });

  source.onerror = () => {
    setStatus("Aguardando resposta...", "wait");
  };
}

function renderConnect() {
  const session = state.session;

  if (state.queue) {
    const queue = state.queue;
    const remaining = Number(queue?.ticket?.remainingSeconds || 0);

    setStatus("Você está na fila", "wait");

    view.innerHTML = `
      <div class="route-head compact">
        <button class="icon-control" id="cancelBackBtn" type="button" aria-label="Cancelar e voltar">${icon("close")}</button>
        <div>
          <span class="eyebrow">Fila de conexão</span>
          <h2>Aguardando vaga disponível</h2>
          <p class="helper-text">A conexão será iniciada automaticamente quando chegar sua vez.</p>
        </div>
      </div>

      <div class="state-card queue-box">
        <div class="loader-ring" aria-hidden="true"></div>
        <h3>Você está na fila</h3>
        <p>Não feche esta página. A tentativa sai da fila automaticamente ao expirar.</p>

        <div class="queue-grid">
          ${queueMetricHtml("Fila global", queue.global)}
          ${queueMetricHtml("Fila por IP", queue.ip)}
        </div>

        <span class="countdown-chip">Sai da fila em <span id="queueCountdown">00:00</span></span>
      </div>
    `;

    document.querySelector("#cancelBackBtn").addEventListener("click", cancelAndBack);
    startCountdown(remaining, "queueCountdown");
    return;
  }

  if (state.creating) {
    setStatus("Criando conexão...", "wait");

    view.innerHTML = `
      <div class="route-head compact">
        <button class="icon-control" id="cancelBackBtn" type="button" aria-label="Cancelar e voltar">${icon("close")}</button>
        <div>
          <span class="eyebrow">Preparando</span>
          <h2>Iniciando conexão</h2>
          <p class="helper-text">Aguarde enquanto abrimos uma sessão temporária.</p>
        </div>
      </div>

      <div class="state-card">
        <div class="loader-ring" aria-hidden="true"></div>
        <h3>Preparando ambiente</h3>
        <p>A Nexus Connections está criando sua conexão agora.</p>
      </div>
    `;

    document.querySelector("#cancelBackBtn").addEventListener("click", cancelAndBack);
    return;
  }

  if (!session) {
    setStatus("Preparando conexão...", "wait");

    view.innerHTML = `
      <div class="route-head compact">
        <button class="icon-control" id="cancelBackBtn" type="button" aria-label="Cancelar e voltar">${icon("close")}</button>
        <div>
          <span class="eyebrow">Conectar</span>
          <h2>Aguardando dados</h2>
          <p class="helper-text">Estamos preparando a próxima etapa.</p>
        </div>
      </div>

      <div class="state-card">
        <div class="loader-ring" aria-hidden="true"></div>
        <h3>Aguarde</h3>
        <p>Recebendo informações da conexão.</p>
      </div>
    `;

    document.querySelector("#cancelBackBtn").addEventListener("click", cancelAndBack);
    return;
  }

  let content = "";

  if (session.status === "waiting_qr" && session.qrDataUrl) {
    setStatus("QR Code pronto", "wait");

    content = `
      <div class="qr-card">
        <div class="qr-frame">
          <img class="qr-image" src="${session.qrDataUrl}" alt="QR Code para conexão">
        </div>

        <div class="qr-info">
          <span class="eyebrow">Escaneie para conectar</span>
          <h3>QR Code temporário</h3>
          <p>Abra o WhatsApp, vá em aparelhos conectados e escaneie este código.</p>
          <span class="countdown-chip">Expira em <span id="connectCountdown">00:00</span></span>
        </div>
      </div>
    `;
  } else if (session.status === "waiting_pair_code" && session.pairCode) {
    setStatus("Código pronto", "wait");

    content = `
      <div class="pair-card">
        <span class="eyebrow">Pair Code</span>
        <h3>Digite este código no WhatsApp</h3>

        <div class="pair-code-wrap">
          <strong class="pair-code">${escapeHtml(session.pairCode)}</strong>
          <button class="secondary-btn iconed" id="copyPairBtn" type="button">
            ${icon("copy")}
            Copiar
          </button>
        </div>

        <p>Abra o WhatsApp, entre em aparelhos conectados e escolha conectar com número.</p>
        <span class="countdown-chip">Expira em <span id="connectCountdown">00:00</span></span>
      </div>
    `;
  } else if (session.status === "connected") {
    setStatus("Conectado com sucesso");

    content = `
      <div class="state-card success">
        <span class="state-icon">${icon("check")}</span>
        <h3>Conectado com sucesso</h3>
        <p>Estamos salvando e preparando sua sessão para download.</p>
      </div>
    `;
  } else if (session.status === "packing") {
    setStatus("Gerando sessão...", "wait");

    content = `
      <div class="state-card">
        <div class="loader-ring" aria-hidden="true"></div>
        <h3>Gerando arquivo</h3>
        <p>Aguarde enquanto a sessão é compactada em ZIP.</p>
      </div>
    `;
  } else if (session.status === "expired") {
    setStatus("Conexão expirada", "danger");

    content = `
      <div class="state-card danger">
        <h3>Conexão expirada</h3>
        <p>Essa tentativa expirou. Volte e gere uma nova conexão.</p>
      </div>
    `;
  } else if (session.status === "failed") {
    setStatus("Falha na conexão", "danger");

    content = `
      <div class="state-card danger">
        <h3>Não foi possível concluir</h3>
        <p>${escapeHtml(session.error || "Tente novamente.")}</p>
      </div>
    `;
  } else {
    setStatus("Aguardando...", "wait");

    content = `
      <div class="state-card">
        <div class="loader-ring" aria-hidden="true"></div>
        <h3>Aguardando atualização</h3>
        <p>Estamos esperando a próxima resposta da conexão.</p>
      </div>
    `;
  }

  view.innerHTML = `
    <div class="route-head compact">
      <button class="icon-control" id="cancelBackBtn" type="button" aria-label="Cancelar e voltar">${icon("close")}</button>
      <div>
        <span class="eyebrow">Conexão em andamento</span>
        <h2>${state.method === "qr" ? "QR Code" : "Pair Code"}</h2>
        <p class="helper-text">Conclua a etapa no WhatsApp para gerar sua sessão.</p>
      </div>
    </div>

    ${content}
  `;

  document.querySelector("#cancelBackBtn").addEventListener("click", cancelAndBack);

  const copyPairBtn = document.querySelector("#copyPairBtn");
  if (copyPairBtn && session?.pairCode) {
    copyPairBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(session.pairCode);
        setStatus("Código copiado");
      } catch {
        setStatus("Não foi possível copiar automaticamente", "danger");
      }
    });
  }

  if (
    (session.status === "waiting_qr" || session.status === "waiting_pair_code") &&
    typeof session.expiresIn === "number"
  ) {
    startCountdown(session.expiresIn, "connectCountdown");
  } else {
    stopCountdown();
  }
}

function renderDownload() {
  const session = state.session;

  setStatus("Sessão pronta");

  view.innerHTML = `
    <div class="route-head compact">
      <button class="icon-control" id="backChoiceBtn" type="button" aria-label="Voltar">${icon("back")}</button>
      <div>
        <span class="eyebrow">Download</span>
        <h2>Sessão pronta</h2>
        <p class="helper-text">Baixe o ZIP e guarde em local seguro.</p>
      </div>
    </div>

    <div class="download-card">
      <span class="download-icon">${icon("download")}</span>
      <h3>Arquivo gerado com sucesso</h3>
      <p>Sua sessão temporária já está pronta para download.</p>

      ${session?.downloadUrl ? `
        <a class="primary-btn big download-link" href="${escapeHtml(session.downloadUrl)}" download>
          ${icon("download")}
          Baixar sessão
        </a>
      ` : `
        <p>O link de download ainda não apareceu.</p>
      `}

      <div class="tutorial-card">
        <strong>Como usar a sessão</strong>
        <p>
          Extraia o arquivo ZIP dentro da pasta de sessão do seu bot.
          Depois confira se os arquivos extraídos ficaram no mesmo local onde o bot
          carrega a sessão antes de iniciar.
        </p>
      </div>

      ${typeof session?.downloadExpiresIn === "number" ? `
        <span class="countdown-chip">Disponível por <span id="downloadCountdown">00:00</span></span>
      ` : ""}
    </div>
  `;

  document.querySelector("#backChoiceBtn").addEventListener("click", () => {
    resetConnection();
    navigate("escolha");
  });

  if (typeof session?.downloadExpiresIn === "number") {
    startCountdown(session.downloadExpiresIn, "downloadCountdown");
  } else {
    stopCountdown();
  }
}

function render() {
  const route = currentRoute();

  if (route === "inicio") {
    renderHome();
    return;
  }

  if (route === "escolha") {
    renderChoice();
    return;
  }

  if (route === "conectar") {
    renderConnect();
    return;
  }

  if (route === "download") {
    renderDownload();
    return;
  }

  renderHome();
}

function closeThemeMenu() {
  themeMenu.hidden = true;
  themeToggle.setAttribute("aria-expanded", "false");
}

function openThemeMenu() {
  themeMenu.hidden = false;
  themeToggle.setAttribute("aria-expanded", "true");
}

themeToggle.addEventListener("click", (event) => {
  event.stopPropagation();

  if (themeMenu.hidden) {
    openThemeMenu();
  } else {
    closeThemeMenu();
  }
});

document.addEventListener("click", (event) => {
  if (!themeMenu.contains(event.target) && !themeToggle.contains(event.target)) {
    closeThemeMenu();
  }
});

for (const button of themeButtons) {
  button.addEventListener("click", () => {
    setTheme(button.dataset.setTheme);
    closeThemeMenu();
  });
}

window.addEventListener("hashchange", render);

setTheme(localStorage.getItem("nc-theme") || "system");
refreshUptime();
setInterval(refreshUptime, 60000);
setInterval(updateUptimeDisplay, 1000);

if (!window.location.hash) {
  navigate("inicio");
} else {
  render();
}
