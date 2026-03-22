(function () {
  const API_BASE = window.NEXVO_BOT_BASE_URL || window.location.origin;
  const SESSION_KEY = "nexvo_bot_session_id";

  function injectCss() {
    if (document.getElementById("nex-widget-css")) return;
    const link = document.createElement("link");
    link.id = "nex-widget-css";
    link.rel = "stylesheet";
    link.href = `${API_BASE}/widget/chat.css`;
    document.head.appendChild(link);
  }

  function createMarkup() {
    const inlineMode = window.NEXVO_WIDGET_MODE === "inline";
    const root = document.createElement("div");
    root.className = inlineMode ? "nex-widget nex-inline-root" : "nex-widget";
    root.innerHTML = `
      <button class="nex-toggle" type="button">Falar com a Equipe</button>
      <section class="nex-panel" aria-label="Chat Nex">
        <header class="nex-header">
          <div>
            <div class="nex-title">Nex - Assistente Nexvo</div>
            <small style="color:#888894">Seg a Sex, 9h as 18h (Brasilia)</small>
          </div>
          <button class="nex-close" type="button">x</button>
        </header>
        <main class="nex-messages"></main>
        <footer class="nex-footer">
          <div class="nex-typing">Nex esta digitando...</div>
          <div class="nex-chips"></div>
          <div class="nex-input-row">
            <input class="nex-input" placeholder="Digite sua mensagem" />
            <button class="nex-send" type="button">Enviar</button>
          </div>
        </footer>
      </section>
    `;

    if (inlineMode) {
      const target = document.getElementById("nex-inline-chat");
      (target || document.body).appendChild(root);
    } else {
      document.body.appendChild(root);
    }

    return root;
  }

  function getSessionId() {
    let id = localStorage.getItem(SESSION_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(SESSION_KEY, id);
    }
    return id;
  }

  function addMessage(messagesEl, text, role) {
    const div = document.createElement("div");
    div.className = `nex-msg ${role}`;
    div.textContent = text;
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function renderChips(chipsEl, options, onSelect) {
    chipsEl.innerHTML = "";
    (options || []).forEach((option) => {
      const btn = document.createElement("button");
      btn.className = "nex-chip";
      btn.type = "button";
      btn.textContent = option;
      btn.onclick = () => onSelect(option);
      chipsEl.appendChild(btn);
    });
  }

  async function postJson(url, payload) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || "Falha na requisicao");
    }

    return response.json();
  }

  async function init() {
    injectCss();
    const root = createMarkup();

    const toggle = root.querySelector(".nex-toggle");
    const panel = root.querySelector(".nex-panel");
    const close = root.querySelector(".nex-close");
    const messages = root.querySelector(".nex-messages");
    const chips = root.querySelector(".nex-chips");
    const input = root.querySelector(".nex-input");
    const send = root.querySelector(".nex-send");
    const typing = root.querySelector(".nex-typing");

    const sessionId = getSessionId();

    function setTyping(show) {
      typing.classList.toggle("show", show);
    }

    async function handleResponse(data) {
      addMessage(messages, data.message, "bot");
      renderChips(chips, data.options || [], async (option) => {
        addMessage(messages, option, "user");
        setTyping(true);
        try {
          const next = await postJson(`${API_BASE}/api/chat`, { sessionId, selectedOption: option });
          await handleResponse(next);
        } catch (err) {
          addMessage(messages, `Erro: ${err.message}`, "bot");
        } finally {
          setTyping(false);
        }
      });

      if (data.action === "create_booking") {
        setTyping(true);
        try {
          const booking = await postJson(`${API_BASE}/api/book`, { sessionId });
          addMessage(messages, booking.message, "bot");
        } catch (err) {
          addMessage(messages, `Nao consegui confirmar: ${err.message}`, "bot");
        } finally {
          setTyping(false);
        }
      }

      if (data.action === "reschedule_booking") {
        setTyping(true);
        try {
          const result = await postJson(`${API_BASE}/api/bookings/reschedule`, { sessionId });
          addMessage(messages, result.message || "Reuniao remarcada com sucesso!", "bot");
        } catch (err) {
          addMessage(messages, `Nao consegui remarcar: ${err.message}`, "bot");
        } finally {
          setTyping(false);
        }
      }

      if (data.action === "cancel_booking") {
        setTyping(true);
        try {
          const result = await postJson(`${API_BASE}/api/bookings/cancel`, { sessionId });
          addMessage(messages, result.message || "Reuniao cancelada com sucesso.", "bot");
        } catch (err) {
          addMessage(messages, `Nao consegui cancelar: ${err.message}`, "bot");
        } finally {
          setTyping(false);
        }
      }
    }

    async function sendMessage() {
      const text = input.value.trim();
      if (!text) return;
      addMessage(messages, text, "user");
      input.value = "";
      chips.innerHTML = "";
      setTyping(true);

      try {
        const data = await postJson(`${API_BASE}/api/chat`, { sessionId, message: text });
        await handleResponse(data);
      } catch (err) {
        addMessage(messages, `Erro: ${err.message}`, "bot");
      } finally {
        setTyping(false);
      }
    }

    send.addEventListener("click", sendMessage);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") sendMessage();
    });

    toggle?.addEventListener("click", async () => {
      panel.classList.toggle("open");
      if (panel.classList.contains("open") && !messages.dataset.started) {
        messages.dataset.started = "1";
        setTyping(true);
        const data = await postJson(`${API_BASE}/api/chat`, { sessionId, message: "" });
        await handleResponse(data);
        setTyping(false);
      }
    });

    close.addEventListener("click", () => panel.classList.remove("open"));

    if (window.NEXVO_WIDGET_MODE === "inline") {
      panel.classList.add("open");
      messages.dataset.started = "1";
      setTyping(true);
      const data = await postJson(`${API_BASE}/api/chat`, { sessionId, message: "" });
      await handleResponse(data);
      setTyping(false);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
