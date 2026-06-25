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
    qr: '<svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h6v6H4V4Zm2 2v2h2V6H6Zm8-2h6v6h-6V4Zm2 2v2h2V6h-2ZM4 14h6v6H4v-6Zm2 2v2h2v-2H6Zm9-2h2v2h-2v-2Zm2 2h3v2h-2v2h-2v-3h1v-1Zm-4 1h2v3h-2v-3Zm6-4h1v2h-3v-2h2Zm-6 0h2v2h-2v-2Z"></path></svg>',
    pair: '<svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm0 3v14h10V5H7Zm3 11h4a1 1 0 1 1 0 2h-4a1 1 0 1 1 0-2Zm2-9a3 3 0 0 1 3 3c0 1.3-.84 2.4-2 2.82V14h-2v-2.9h1a1.1 1.1 0 1 0-1.1-1.1h-2A3.1 3.1 0 0 1 12 7Z"></path></svg>'
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

function resetConnection() {
  closeEvents();
  stopCountdown();

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
  } catch {
    // não bloquear navegação
  }

  resetConnection();
  navigate("escolha");
}

function renderHome() {
  setStatus("Pronto para iniciar");

  view.innerHTML = `
    <div class="hero-layout">
      <div class="hero-card">
        <h1>Conecte seu bot de forma simples com a Nexus Connections.</h1>
        <p>
          Escolha o tipo de conexão, conecte no WhatsApp e baixe sua sessão
          pronta para usar no seu projeto.
        </p>

        <div class="cta-row">
          <button class="primary-btn" id="goChoiceBtn" type="button">Começar</button>
        </div>
      </div>

      <div class="hero-side">
        <div class="info-card">
          <h3>Como funciona</h3>
          <p>
            Escolha entre QR Code ou código por número. Depois conecte pelo
            WhatsApp e siga para o download.
          </p>
        </div>

        <div class="info-card">
          <h3>Open source</h3>
          <p>
            O projeto Nexus Connections é aberto e pode ser adaptado, estudado
            e evoluído conforme a sua necessidade.
          </p>
        </div>

        <div class="info-card uptime-card">
          <h3>Uptime</h3>
          <strong id="uptimeLive">${formatUptime(getLiveUptimeSeconds())}</strong>
          <p>Tempo desde a última inicialização do servidor.</p>
        </div>
      </div>
    </div>
  `;

  document.querySelector("#goChoiceBtn").addEventListener("click", () => navigate("escolha"));
}

function renderChoice() {
  setStatus("Escolha como deseja conectar");

  view.innerHTML = `
    <div class="route-head">
      <button class="icon-control" id="backHomeBtn" type="button" aria-label="Voltar para o início">${icon("back")}</button>
      <div>
        <h2>Escolha de conexão</h2>
        <p class="helper-text">Selecione a opção que deseja usar para conectar.</p>
      </div>
    </div>

    <div class="choice-grid">
      <button class="choice-card ${state.method === "qr" ? "active" : ""}" id="pickQrBtn" type="button">
        <span class="choice-icon">${icon("qr")}</span>
        <strong>QR Code</strong>
        <small>Escaneie o código pelo WhatsApp em outro aparelho.</small>
      </button>

      <button class="choice-card ${state.method === "pair" ? "active" : ""}" id="pickPairBtn" type="button">
        <span class="choice-icon">${icon("pair")}</span>
        <strong>Código por número</strong>
        <small>Receba um código e conecte usando o seu número.</small>
      </button>
    </div>

    <div class="panel-card spacer-top">
      <h3>${state.method === "qr" ? "QR Code selecionado" : "Código por número selecionado"}</h3>
      <p>
        ${state.method === "qr"
          ? "Ao continuar, o QR Code será gerado e mostrado na próxima etapa."
          : "Digite seu número com código do país para gerar o código de conexão."}
      </p>

      ${state.method === "pair" ? `
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

      <div class="cta-row">
        <button class="primary-btn" id="continueBtn" type="button">Continuar</button>
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

  if (state.creating) {
    setStatus("Criando conexão...", "wait");

    view.innerHTML = `
      <div class="route-head">
        <button class="icon-control" id="cancelBackBtn" type="button" aria-label="Cancelar e voltar">${icon("close")}</button>
        <div>
          <h2>Conectar</h2>
          <p class="helper-text">Preparando a sua conexão...</p>
        </div>
      </div>

      <div class="connect-box">
        <h3>Aguarde</h3>
        <p>A Nexus Connections está iniciando a sua conexão agora.</p>
      </div>
    `;

    document.querySelector("#cancelBackBtn").addEventListener("click", cancelAndBack);
    return;
  }

  if (!session) {
    setStatus("Preparando conexão...", "wait");

    view.innerHTML = `
      <div class="route-head">
        <button class="icon-control" id="cancelBackBtn" type="button" aria-label="Cancelar e voltar">${icon("close")}</button>
        <div>
          <h2>Conectar</h2>
          <p class="helper-text">Aguardando informações da conexão.</p>
        </div>
      </div>

      <div class="connect-box">
        <h3>Aguarde</h3>
        <p>Estamos preparando a próxima etapa.</p>
      </div>
    `;

    document.querySelector("#cancelBackBtn").addEventListener("click", cancelAndBack);
    return;
  }

  let content = "";

  if (session.status === "waiting_qr" && session.qrDataUrl) {
    setStatus("QR Code pronto", "wait");

    content = `
      <div class="connect-box">
        <div class="qr-layout">
          <img class="qr-image" src="${session.qrDataUrl}" alt="QR Code para conexão">
          <div>
            <h3>Escaneie o QR Code</h3>
            <p>
              Abra o WhatsApp, vá em aparelhos conectados e use a opção para conectar.
            </p>
            <span class="countdown-chip">Expira em <span id="connectCountdown">00:00</span></span>
          </div>
        </div>
      </div>
    `;
  } else if (session.status === "waiting_pair_code" && session.pairCode) {
    setStatus("Código pronto", "wait");

    content = `
      <div class="connect-box">
        <h3>Digite este código no WhatsApp</h3>
        <div class="spacer-top">
          <span class="code-chip">${escapeHtml(session.pairCode)}</span>
        </div>
        <p class="spacer-top">
          Abra o WhatsApp, entre em aparelhos conectados e use a opção de conectar com número.
        </p>
        <span class="countdown-chip">Expira em <span id="connectCountdown">00:00</span></span>
      </div>
    `;
  } else if (session.status === "connected") {
    setStatus("Conectado com sucesso");

    content = `
      <div class="connect-box">
        <h3>Conectado com sucesso</h3>
        <p>Agora estamos preparando a sua sessão para download.</p>
      </div>
    `;
  } else if (session.status === "packing") {
    setStatus("Gerando sessão...", "wait");

    content = `
      <div class="connect-box">
        <h3>Gerando sua sessão</h3>
        <p>Aguarde enquanto a Nexus Connections prepara o arquivo para download.</p>
      </div>
    `;
  } else if (session.status === "expired") {
    setStatus("Conexão expirada", "danger");

    content = `
      <div class="connect-box">
        <h3>Conexão expirada</h3>
        <p>Essa tentativa expirou. Volte e gere uma nova conexão.</p>
      </div>
    `;
  } else if (session.status === "failed") {
    setStatus("Falha na conexão", "danger");

    content = `
      <div class="connect-box">
        <h3>Não foi possível concluir</h3>
        <p>${escapeHtml(session.error || "Tente novamente.")}</p>
      </div>
    `;
  } else {
    setStatus("Aguardando...", "wait");

    content = `
      <div class="connect-box">
        <h3>Aguarde</h3>
        <p>Estamos esperando a próxima atualização da conexão.</p>
      </div>
    `;
  }

  view.innerHTML = `
    <div class="route-head">
      <button class="icon-control" id="cancelBackBtn" type="button" aria-label="Cancelar e voltar">${icon("close")}</button>
      <div>
        <h2>Conectar</h2>
        <p class="helper-text">Use esta etapa para concluir a conexão escolhida.</p>
      </div>
    </div>

    ${content}
  `;

  document.querySelector("#cancelBackBtn").addEventListener("click", cancelAndBack);

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
    <div class="route-head">
      <button class="icon-control" id="backChoiceBtn" type="button" aria-label="Voltar">${icon("back")}</button>
      <div>
        <h2>Download</h2>
        <p class="helper-text">Baixe sua sessão e volte quando quiser gerar outra.</p>
      </div>
    </div>

    <div class="download-box">
      <h3>Baixar sessão</h3>
      <p>
        Sua sessão está pronta para download.
      </p>

      ${session?.downloadUrl ? `
        <div class="cta-row">
          <a class="primary-btn download-link" href="${escapeHtml(session.downloadUrl)}" download>Baixar sessão</a>
        </div>
      ` : `
        <p>O link de download ainda não apareceu.</p>
      `}

      ${typeof session?.downloadExpiresIn === "number" ? `
        <span class="countdown-chip">Disponível por <span id="downloadCountdown">00:00</span></span>
      ` : ""}
    </div>
  `;

  document.querySelector("#backChoiceBtn").addEventListener("click", () => {
    resetConnection();
    navigate("escolha");
  });

  if (session?.downloadUrl && !state.downloadTriggered) {
    state.downloadTriggered = true;

    setTimeout(() => {
      const link = document.createElement("a");
      link.href = session.downloadUrl;
      link.download = session.downloadName || "session.zip";
      document.body.appendChild(link);
      link.click();
      link.remove();
    }, 500);
  }

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
