import express from "express";
import { v4 as uuidv4 } from "uuid";
import { getAvailableSlots, findClientEvents, getAvailableSlotsExcluding } from "../services/calendar.js";
import { generateNexMessage } from "../services/claude.js";
import { getSession, setSession } from "../services/store.js";

const router = express.Router();

const SERVICE_OPTIONS = [
  "🌐 Criacao de Site",
  "🎨 Design Grafico",
  "🎬 Motion Design / Video",
  "🔍 SEO & Marketing",
  "💻 Script / Automacao",
  "❓ Nao sei ainda, quero conversar"
];

const BRIEFING_BY_SERVICE = {
  "Criacao de Site": [
    "Perfeito. Esse site seria do zero ou voce ja tem algo no ar hoje?",
    "Esse projeto e para uma empresa ou projeto pessoal?",
    "Qual prazo voce tem em mente para lancar?"
  ],
  "Design Grafico": [
    "Perfeito. O foco e identidade visual completa ou materiais pontuais?",
    "Voce ja tem referencias de estilo que curte?",
    "Qual o prazo ideal para essa entrega?"
  ],
  "Motion Design / Video": [
    "Perfeito. O conteudo e para redes sociais, campanha ou apresentacao?",
    "Voce ja tem roteiro/material bruto ou precisa de producao completa?",
    "Qual e o prazo de publicacao desse material?"
  ],
  "SEO & Marketing": [
    "Perfeito. Hoje voce ja tem trafego organico ou quer comecar do zero?",
    "Qual seu principal objetivo: leads, vendas ou autoridade?",
    "Em quanto tempo voce quer comecar a ver ganho de resultado?"
  ],
  "Script / Automacao": [
    "Perfeito. Qual processo voce quer automatizar primeiro?",
    "Hoje esse fluxo e manual ou ja existe alguma ferramenta?",
    "Qual impacto voce espera com essa automacao?"
  ],
  Descoberta: [
    "Sem problema. Me conta em uma frase o que voce quer destravar no seu projeto.",
    "Hoje seu maior desafio esta em design, site, video, marketing ou operacao?",
    "Qual e o prazo ideal para comecar?"
  ]
};

// ─── Intent detection ──────────────────────────────────────────────────────
function detectIntent(text) {
  const t = normalize(text);
  if (/(remarcar|reagendar|mudar.*(reuniao|horario)|outro.*(dia|horario)|nao posso no horario|mudei de plano|preciso remarcar|pode ser em outro|trocar.*(dia|horario))/.test(t)) return "reagendar";
  if (/(cancelar|cancela|desmarcar|nao vou mais|nao preciso mais|nao vou comparecer|cancelem|desmarca)/.test(t)) return "cancelar";
  if (/(quando.*(reuniao|horario)|qual horario|ver.*agendamento|minha reuniao|consultar|quero ver|que horas)/.test(t)) return "consultar";
  return null; // null = novo agendamento ou duvida
}

function formatDateFull(isoString) {
  if (!isoString) return "horario nao disponivel";
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "long", day: "2-digit", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit",
    timeZone: process.env.TIMEZONE || "America/Sao_Paulo"
  }).format(new Date(isoString));
}

function tooSoon(isoString, hoursAhead = 2) {
  return (new Date(isoString) - Date.now()) < hoursAhead * 60 * 60 * 1000;
}

function alreadyPassed(isoString) {
  return new Date(isoString) < new Date();
}

function baseSession() {
  return {
    stage: "service",
    serviceLabel: "",
    briefingQuestions: [],
    briefingIndex: 0,
    briefingAnswers: [],
    briefingSummary: "",
    contact: {
      name: "",
      email: "",
      whatsapp: "",
      company: ""
    },
    offeredSlots: [],
    selectedSlot: null,
    history: [],
    // campos para gestão de reuniões existentes
    intent: null,
    foundEvents: [],
    targetEvent: null,
    rescheduleData: null
  };
}

function normalize(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function isHumanHandoff(text) {
  const t = normalize(text);
  return /(falar com humano|atendente|humano|frustr|reclama|nao ajudou)/.test(t);
}

function mapService(input) {
  const t = normalize(input);
  if (t.includes("site")) return "Criacao de Site";
  if (t.includes("design") || t.includes("grafico")) return "Design Grafico";
  if (t.includes("motion") || t.includes("video")) return "Motion Design / Video";
  if (t.includes("seo") || t.includes("marketing")) return "SEO & Marketing";
  if (t.includes("script") || t.includes("automacao")) return "Script / Automacao";
  if (t.includes("nao sei") || t.includes("conversar")) return "Descoberta";
  return "";
}

function formatSlotFull(slot) {
  const date = new Date(slot.start);
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: process.env.TIMEZONE || "America/Sao_Paulo"
  }).format(date);
}

function findSlotByInput(slots, input) {
  const n = normalize(input);
  return slots.find((slot) => normalize(slot.label) === n || normalize(formatSlotFull(slot)) === n || n.includes(normalize(slot.label)));
}

async function loadSlotsSafely(session) {
  const slots = await getAvailableSlots({ maxOptions: 4, businessDays: 5 });
  if (!Array.isArray(slots) || slots.length === 0) {
    throw new Error("Nenhum horario disponivel no momento.");
  }
  session.offeredSlots = slots;
  session.selectedSlot = null;
  return slots;
}

async function respond({ session, sessionId, userInput, message, options = [], action = null, stage, extra = {} }) {
  const llm = await generateNexMessage({
    stage,
    userInput,
    session,
    options,
    fallbackMessage: message,
    action
  });

  return {
    ok: true,
    sessionId,
    stage: llm.stage || stage,
    message: llm.message || message,
    options: Array.isArray(llm.options) ? llm.options : options,
    action: llm.action || action,
    ...extra
  };
}

router.post("/", async (req, res) => {
  try {
    const sessionId = req.body.sessionId || uuidv4();
    const selectedOption = req.body.selectedOption || "";
    const message = req.body.message || "";
    const userInput = (selectedOption || message || "").trim();

    const session = getSession(sessionId) || baseSession();
    setSession(sessionId, session);

    if (isHumanHandoff(userInput)) {
      const reply = await respond({
        session,
        sessionId,
        userInput,
        stage: "service",
        message: "Claro. Te conecto com nosso atendimento humano agora: https://wa.me/5511962507663",
        options: ["Voltar para o Nex"],
        action: null
      });
      return res.json(reply);
    }

    // ─── Identificação de intenção na primeira mensagem real ───────────────
    if (session.history.length === 0 && userInput) {
      const intent = detectIntent(userInput);
      if (intent) {
        session.intent = intent;
        session.stage = "identify";
        session.history.push({ role: "user", content: userInput });
        setSession(sessionId, session);
        return res.json({
          ok: true, sessionId, stage: "identify",
          message: "Para encontrar sua reuniao, me informa seu email ou WhatsApp que voce usou no agendamento.",
          options: [], action: null
        });
      }
    }

    // ─── Identificar cliente e buscar eventos ─────────────────────────────
    if (session.stage === "identify") {
      let events = [];
      try {
        events = await findClientEvents(userInput);
      } catch (err) {
        console.error("[chat/identify] erro:", err.message);
        return res.json({
          ok: true, sessionId, stage: "identify",
          message: "Tive um probleminha ao buscar sua reuniao. Tenta de novo em instantes ou fala direto com a equipe: wa.me/5511962507663",
          options: [], action: null
        });
      }

      if (events.length === 0) {
        session.stage = "service";
        setSession(sessionId, session);
        return res.json({
          ok: true, sessionId, stage: "service",
          message: "Nao encontrei nenhuma reuniao com esses dados. Quer agendar uma agora? Leva so 2 minutinhos!",
          options: ["Sim, quero agendar", ...SERVICE_OPTIONS], action: null
        });
      }

      session.foundEvents = events;
      setSession(sessionId, session);

      if (events.length === 1) {
        const ev = events[0];
        session.targetEvent = ev;
        session.stage = "confirm_event";
        setSession(sessionId, session);
        const intentLabel = { reagendar: "remarcar", cancelar: "cancelar", consultar: "consultar" }[session.intent] || "gerenciar";
        const actionOptions = session.intent === "consultar"
          ? ["Remarcar", "Cancelar reuniao"]
          : session.intent === "reagendar"
            ? ["Confirmar — remarcar essa reuniao", "Nao, e outra reuniao"]
            : ["Confirmar — cancelar essa reuniao", "Prefiro remarcar", "Nao, e outra reuniao"];
        return res.json({
          ok: true, sessionId, stage: "confirm_event",
          message: `Encontrei sua reuniao:\n\n📅 ${formatDateFull(ev.start)}\n🎯 Servico: ${ev.summary?.replace("Reuniao Nexvo - ", "").split(" - ").slice(1).join(" - ") || "consulte o convite"}\n🔗 Meet: ${ev.meetLink || "consulte o convite"}\n\nVoce quer ${intentLabel} essa?`,
          options: actionOptions, action: null
        });
      }

      // multiplos eventos — listar
      session.stage = "confirm_event";
      setSession(sessionId, session);
      const labels = events.map((ev, i) => `${i + 1}. ${formatDateFull(ev.start)}`);
      return res.json({
        ok: true, sessionId, stage: "confirm_event",
        message: "Encontrei mais de uma reuniao. Qual voce quer gerenciar?",
        options: labels, action: null
      });
    }

    // ─── Confirmar qual evento o cliente quer ─────────────────────────────
    if (session.stage === "confirm_event") {
      const t = normalize(userInput);

      // cliente rejeitou / quer agendar novo
      if (t.includes("nao") && t.includes("outra")) {
        session.stage = "identify";
        session.foundEvents = [];
        session.targetEvent = null;
        setSession(sessionId, session);
        return res.json({
          ok: true, sessionId, stage: "identify",
          message: "Tudo bem! Me passa o email ou WhatsApp correto para eu buscar a reuniao certa.",
          options: [], action: null
        });
      }

      // seleção por número (lista múltipla)
      if (!session.targetEvent && session.foundEvents.length > 1) {
        const idx = parseInt(userInput) - 1;
        if (!isNaN(idx) && session.foundEvents[idx]) {
          session.targetEvent = session.foundEvents[idx];
          setSession(sessionId, session);
        } else {
          return res.json({
            ok: true, sessionId, stage: "confirm_event",
            message: "Seleciona o numero da reuniao que voce quer gerenciar:",
            options: session.foundEvents.map((ev, i) => `${i + 1}. ${formatDateFull(ev.start)}`), action: null
          });
        }
      }

      const ev = session.targetEvent;

      // caso consulta
      if (session.intent === "consultar" || t.includes("remarcar") || t.includes("cancelar")) {
        if (t.includes("remarcar") || session.intent === "reagendar") {
          session.intent = "reagendar";
          session.stage = "reschedule_slots";
          setSession(sessionId, session);
          return res.json({
            ok: true, sessionId, stage: "reschedule_slots",
            message: "Vou buscar os horarios disponiveis para remarcar. Tem alguma preferencia de dia ou periodo (manha/tarde)?",
            options: ["Manha (9h-12h)", "Tarde (13h-18h)", "Qualquer horario"], action: null
          });
        }
        if (t.includes("cancelar") || session.intent === "cancelar") {
          session.intent = "cancelar";
          session.stage = "cancel_confirm";
          setSession(sessionId, session);
          if (alreadyPassed(ev.start)) {
            session.stage = "service";
            setSession(sessionId, session);
            return res.json({
              ok: true, sessionId, stage: "service",
              message: "Essa reuniao ja aconteceu! Quer agendar uma nova?",
              options: SERVICE_OPTIONS, action: null
            });
          }
          if (tooSoon(ev.start)) {
            return res.json({
              ok: true, sessionId, stage: "service",
              message: "Sua reuniao comeca em breve! Para cancelamentos de ultima hora, entre em contato diretamente:\n📱 wa.me/5511962507663",
              options: [], action: null
            });
          }
          return res.json({
            ok: true, sessionId, stage: "cancel_confirm",
            message: `Tem certeza que deseja cancelar sua reuniao?\n\n📅 ${formatDateFull(ev.start)}\n\nEssa acao nao pode ser desfeita. Se quiser, posso te ajudar a remarcar para outro horario.`,
            options: ["Sim, cancelar reuniao", "Prefiro remarcar", "Voltar"], action: null
          });
        }
        // so consulta
        const service = ev.summary?.replace("Reuniao Nexvo - ", "").split(" - ").slice(1).join(" - ") || "";
        return res.json({
          ok: true, sessionId, stage: "confirm_event",
          message: `Aqui estao os detalhes da sua reuniao:\n\n📅 Data: ${formatDateFull(ev.start)}\n🎯 Servico: ${service}\n🔗 Meet: ${ev.meetLink || "sem link por enquanto"}\n\nPosso te ajudar com mais alguma coisa?`,
          options: ["Remarcar", "Cancelar reuniao"], action: null
        });
      }

      // confirmou a intenção original
      if (session.intent === "reagendar") {
        session.stage = "reschedule_slots";
        // Salvar dados da sessão para notificações
        session.rescheduleData = {
          clientName: ev.description?.match(/Cliente: ([^\n]+)/)?.[1]?.trim() || "Cliente",
          clientEmail: ev.description?.match(/Email: ([^\n]+)/)?.[1]?.trim() || "",
          whatsapp: ev.description?.match(/WhatsApp: ([^\n]+)/)?.[1]?.trim() || "",
          service: ev.description?.match(/Servico: ([^\n]+)/)?.[1]?.trim() || ev.summary || "",
          oldFormattedDate: formatDateFull(ev.start),
          eventId: ev.eventId
        };
        setSession(sessionId, session);
        return res.json({
          ok: true, sessionId, stage: "reschedule_slots",
          message: "Vou buscar os horarios disponiveis para remarcar. Tem alguma preferencia de dia ou periodo (manha/tarde)?",
          options: ["Manha (9h-12h)", "Tarde (13h-18h)", "Qualquer horario"], action: null
        });
      }

      if (session.intent === "cancelar") {
        session.stage = "cancel_confirm";
        session.rescheduleData = {
          clientName: ev.description?.match(/Cliente: ([^\n]+)/)?.[1]?.trim() || "Cliente",
          clientEmail: ev.description?.match(/Email: ([^\n]+)/)?.[1]?.trim() || "",
          whatsapp: ev.description?.match(/WhatsApp: ([^\n]+)/)?.[1]?.trim() || "",
          service: ev.description?.match(/Servico: ([^\n]+)/)?.[1]?.trim() || ev.summary || "",
          oldFormattedDate: formatDateFull(ev.start),
          eventId: ev.eventId
        };
        setSession(sessionId, session);
        if (alreadyPassed(ev.start)) {
          session.stage = "service";
          setSession(sessionId, session);
          return res.json({ ok: true, sessionId, stage: "service", message: "Essa reuniao ja aconteceu! Quer agendar uma nova?", options: SERVICE_OPTIONS, action: null });
        }
        if (tooSoon(ev.start)) {
          return res.json({ ok: true, sessionId, stage: "service", message: "Sua reuniao comeca em breve! Para cancelamentos de ultima hora: 📱 wa.me/5511962507663", options: [], action: null });
        }
        return res.json({
          ok: true, sessionId, stage: "cancel_confirm",
          message: `Tem certeza que deseja cancelar sua reuniao?\n\n📅 ${formatDateFull(ev.start)}\n\nEssa acao nao pode ser desfeita. Se quiser, posso te ajudar a remarcar para outro horario.`,
          options: ["Sim, cancelar reuniao", "Prefiro remarcar", "Voltar"], action: null
        });
      }
    }

    // ─── Buscar slots para reagendamento ──────────────────────────────────
    if (session.stage === "reschedule_slots") {
      let slots = [];
      try {
        const excludeId = session.rescheduleData?.eventId || session.targetEvent?.eventId;
        slots = excludeId
          ? await getAvailableSlotsExcluding(excludeId, { maxOptions: 5, businessDays: 7 })
          : await getAvailableSlots({ maxOptions: 5, businessDays: 7 });
      } catch (err) {
        return res.json({
          ok: true, sessionId, stage: "reschedule_slots",
          message: "Tive um probleminha ao consultar a agenda. Tenta novamente ou fala com a equipe: wa.me/5511962507663",
          options: ["Tentar novamente"], action: null
        });
      }
      if (!slots.length) {
        return res.json({ ok: true, sessionId, stage: "reschedule_slots", message: "Nao encontrei horarios disponíveis nos proximos dias. Tenta novamente mais tarde.", options: ["Tentar novamente"], action: null });
      }
      session.offeredSlots = slots;
      session.stage = "reschedule_confirm";
      setSession(sessionId, session);
      return res.json({
        ok: true, sessionId, stage: "reschedule_confirm",
        message: "Aqui estao os proximos horarios disponiveis:",
        options: slots.map((s) => s.label), action: "fetch_slots_reschedule"
      });
    }

    // ─── Confirmar novo horário do reagendamento ───────────────────────────
    if (session.stage === "reschedule_confirm") {
      const slot = findSlotByInput(session.offeredSlots || [], userInput);
      if (!slot) {
        return res.json({
          ok: true, sessionId, stage: "reschedule_confirm",
          message: "Nao consegui identificar esse horario. Escolhe uma das opcoes:",
          options: (session.offeredSlots || []).map((s) => s.label), action: "fetch_slots_reschedule"
        });
      }
      session.selectedSlot = slot;
      session.stage = "reschedule_execute";
      const oldLabel = session.rescheduleData?.oldFormattedDate || "horario anterior";
      setSession(sessionId, session);
      return res.json({
        ok: true, sessionId, stage: "reschedule_execute",
        message: `Confirmo a alteracao?\n\n❌ Antes: ${oldLabel}\n✅ Depois: ${formatSlotFull(slot)}`,
        options: ["Confirmar alteracao", "Escolher outro horario"], action: null
      });
    }

    // ─── Executar reagendamento ────────────────────────────────────────────
    if (session.stage === "reschedule_execute") {
      const t = normalize(userInput);
      if (t.includes("outro") || t.includes("trocar")) {
        session.stage = "reschedule_slots";
        setSession(sessionId, session);
        return res.json({ ok: true, sessionId, stage: "reschedule_slots", message: "Claro! Qual preferencia de horario?", options: ["Manha (9h-12h)", "Tarde (13h-18h)", "Qualquer horario"], action: null });
      }
      if (t.includes("confirm")) {
        session.stage = "reschedule_execute";
        setSession(sessionId, session);
        return res.json({
          ok: true, sessionId, stage: "reschedule_execute",
          message: "Perfeito. Estou atualizando sua reuniao no Google Calendar...",
          options: [], action: "reschedule_booking"
        });
      }
      return res.json({
        ok: true, sessionId, stage: "reschedule_execute",
        message: "Confirma a alteracao ou prefere escolher outro horario?",
        options: ["Confirmar alteracao", "Escolher outro horario"], action: null
      });
    }

    // ─── Cancelamento — confirmação de segurança ───────────────────────────
    if (session.stage === "cancel_confirm") {
      const t = normalize(userInput);
      if (t.includes("voltar") || t.includes("nao")) {
        session.stage = "service";
        setSession(sessionId, session);
        return res.json({ ok: true, sessionId, stage: "service", message: "Sem problema! Posso te ajudar com mais alguma coisa?", options: SERVICE_OPTIONS, action: null });
      }
      if (t.includes("remarcar") || t.includes("reagendar")) {
        session.intent = "reagendar";
        session.stage = "reschedule_slots";
        setSession(sessionId, session);
        return res.json({ ok: true, sessionId, stage: "reschedule_slots", message: "Otimo! Vamos remarcar. Qual preferencia de horario?", options: ["Manha (9h-12h)", "Tarde (13h-18h)", "Qualquer horario"], action: null });
      }
      if (t.includes("sim") || t.includes("cancelar")) {
        setSession(sessionId, session);
        return res.json({
          ok: true, sessionId, stage: "cancel_confirm",
          message: "Entendido. Estou cancelando sua reuniao agora...",
          options: [], action: "cancel_booking"
        });
      }
      return res.json({
        ok: true, sessionId, stage: "cancel_confirm",
        message: "Confirma o cancelamento da reuniao?",
        options: ["Sim, cancelar reuniao", "Prefiro remarcar", "Voltar"], action: null
      });
    }

    if (!userInput && session.history.length === 0) {
      const opening = "Ola. Sou o Nex, assistente da Nexvo. Estou aqui para te ajudar a dar o proximo passo no seu projeto. Me conta, o que voce esta precisando?";
      const reply = await respond({
        session,
        sessionId,
        userInput,
        stage: "service",
        message: opening,
        options: SERVICE_OPTIONS,
        action: null
      });
      session.history.push({ role: "assistant", content: reply.message });
      setSession(sessionId, session);
      return res.json(reply);
    }

    if (session.stage === "service") {
      const mapped = mapService(userInput);
      if (!mapped) {
        const reply = await respond({
          session,
          sessionId,
          userInput,
          stage: "service",
          message: "Perfeito. Para eu direcionar certo, me diz qual dessas frentes faz mais sentido para voce:",
          options: SERVICE_OPTIONS,
          action: null
        });
        return res.json(reply);
      }

      session.serviceLabel = mapped === "Descoberta" ? "Nao definido (em descoberta)" : mapped;
      session.briefingQuestions = BRIEFING_BY_SERVICE[mapped] || BRIEFING_BY_SERVICE.Descoberta;
      session.briefingIndex = 0;
      session.briefingAnswers = [];
      session.stage = "briefing";

      const question = session.briefingQuestions[0];
      setSession(sessionId, session);
      return res.json({
        ok: true,
        sessionId,
        stage: "briefing",
        message: question,
        options: [],
        action: null
      });
    }

    if (session.stage === "briefing") {
      session.briefingAnswers.push(userInput);
      session.briefingIndex += 1;

      if (session.briefingIndex < session.briefingQuestions.length) {
        const question = session.briefingQuestions[session.briefingIndex];
        setSession(sessionId, session);
        return res.json({
          ok: true,
          sessionId,
          stage: "briefing",
          message: question,
          options: [],
          action: null
        });
      }

      session.briefingSummary = session.briefingAnswers.join(" | ");
      session.stage = "data_name";
      setSession(sessionId, session);
      return res.json({
        ok: true,
        sessionId,
        stage: "data",
        message: "Otimo. Para eu agendar com nossa equipe, preciso de algumas informacoes. Qual seu nome completo?",
        options: [],
        action: null
      });
    }

    if (session.stage === "data_name") {
      session.contact.name = userInput;
      session.stage = "data_email";
      setSession(sessionId, session);
      return res.json({
        ok: true,
        sessionId,
        stage: "data",
        message: "Perfeito. Qual seu melhor email?",
        options: [],
        action: null
      });
    }

    if (session.stage === "data_email") {
      const isValidEmail = /.+@.+\..+/.test(userInput);
      if (!isValidEmail) {
        return res.json({
          ok: true,
          sessionId,
          stage: "data",
          message: "Pode me passar um email valido? Exemplo: nome@empresa.com",
          options: [],
          action: null
        });
      }
      session.contact.email = userInput;
      session.stage = "data_whatsapp";
      setSession(sessionId, session);
      return res.json({
        ok: true,
        sessionId,
        stage: "data",
        message: "Agora seu WhatsApp com DDD, por favor.",
        options: [],
        action: null
      });
    }

    if (session.stage === "data_whatsapp") {
      const digits = userInput.replace(/\D/g, "");
      if (digits.length < 10) {
        return res.json({
          ok: true,
          sessionId,
          stage: "data",
          message: "Me envia no formato com DDD, por exemplo: 11999998888.",
          options: [],
          action: null
        });
      }
      session.contact.whatsapp = digits;
      session.stage = "data_company";
      setSession(sessionId, session);
      return res.json({
        ok: true,
        sessionId,
        stage: "data",
        message: "Empresa/projeto (opcional). Se preferir, pode responder: sem empresa.",
        options: [],
        action: null
      });
    }

    if (session.stage === "data_company") {
      session.contact.company = normalize(userInput) === "sem empresa" ? "" : userInput;
      try {
        const slots = await loadSlotsSafely(session);
        session.stage = "scheduling";
        setSession(sessionId, session);

        return res.json({
          ok: true,
          sessionId,
          stage: "scheduling",
          message: "Agora vou verificar a disponibilidade da nossa equipe. Aqui estao os proximos horarios disponiveis:",
          options: slots.map((s) => s.label),
          action: "fetch_slots"
        });
      } catch (slotErr) {
        session.stage = "scheduling_error";
        setSession(sessionId, session);
        return res.json({
          ok: true,
          sessionId,
          stage: "scheduling",
          message: "Nao consegui acessar a agenda agora. Quer que eu tente novamente ou prefira falar com nosso atendimento humano?",
          options: ["Tentar novamente", "Falar com humano"],
          action: null
        });
      }
    }

    if (session.stage === "scheduling_error") {
      const inputNormalized = normalize(userInput);
      if (inputNormalized.includes("humano")) {
        return res.json({
          ok: true,
          sessionId,
          stage: "service",
          message: "Perfeito. Te conecto agora com nosso atendimento humano: https://wa.me/5511962507663",
          options: [],
          action: null
        });
      }

      try {
        const slots = await loadSlotsSafely(session);
        session.stage = "scheduling";
        setSession(sessionId, session);
        return res.json({
          ok: true,
          sessionId,
          stage: "scheduling",
          message: "Consegui consultar agora. Aqui estao os horarios disponiveis:",
          options: slots.map((s) => s.label),
          action: "fetch_slots"
        });
      } catch {
        return res.json({
          ok: true,
          sessionId,
          stage: "scheduling",
          message: "A agenda ainda esta indisponivel. Tente novamente em instantes ou fale com nosso humano.",
          options: ["Tentar novamente", "Falar com humano"],
          action: null
        });
      }
    }

    if (session.stage === "scheduling") {
      if (!Array.isArray(session.offeredSlots) || session.offeredSlots.length === 0) {
        try {
          const slots = await loadSlotsSafely(session);
          setSession(sessionId, session);
          return res.json({
            ok: true,
            sessionId,
            stage: "scheduling",
            message: "Atualizei os horarios disponiveis para voce:",
            options: slots.map((s) => s.label),
            action: "fetch_slots"
          });
        } catch {
          session.stage = "scheduling_error";
          setSession(sessionId, session);
          return res.json({
            ok: true,
            sessionId,
            stage: "scheduling",
            message: "A agenda esta indisponivel agora. Quer tentar novamente ou falar com humano?",
            options: ["Tentar novamente", "Falar com humano"],
            action: null
          });
        }
      }

      const slot = findSlotByInput(session.offeredSlots, userInput);
      if (!slot) {
        return res.json({
          ok: true,
          sessionId,
          stage: "scheduling",
          message: "Nao consegui identificar esse horario. Escolhe uma das opcoes abaixo:",
          options: session.offeredSlots.map((s) => s.label),
          action: "fetch_slots"
        });
      }

      session.selectedSlot = slot;
      session.stage = "confirm";
      setSession(sessionId, session);

      return res.json({
        ok: true,
        sessionId,
        stage: "scheduling",
        message: `Perfeito. Vou confirmar sua reuniao:\nData: ${formatSlotFull(slot)}\nCliente: ${session.contact.name}\nEmail: ${session.contact.email}\nWhatsApp: ${session.contact.whatsapp}\nServico: ${session.serviceLabel}\n\nPosso confirmar?`,
        options: ["Confirmar", "Escolher outro horario"],
        action: null
      });
    }

    if (session.stage === "confirm") {
      const answer = normalize(userInput);
      if (answer.includes("outro") || answer.includes("trocar")) {
        try {
          const slots = await loadSlotsSafely(session);
          session.stage = "scheduling";
          setSession(sessionId, session);

          return res.json({
            ok: true,
            sessionId,
            stage: "scheduling",
            message: "Sem problema. Aqui estao novos horarios disponiveis:",
            options: slots.map((s) => s.label),
            action: "fetch_slots"
          });
        } catch {
          session.stage = "scheduling_error";
          setSession(sessionId, session);
          return res.json({
            ok: true,
            sessionId,
            stage: "scheduling",
            message: "Nao consegui atualizar a agenda agora. Quer tentar novamente ou falar com humano?",
            options: ["Tentar novamente", "Falar com humano"],
            action: null
          });
        }
      }

      if (answer.includes("confirm")) {
        setSession(sessionId, session);
        return res.json({
          ok: true,
          sessionId,
          stage: "confirmed",
          message: "Perfeito. Estou confirmando agora no Google Calendar.",
          options: [],
          action: "create_booking"
        });
      }

      return res.json({
        ok: true,
        sessionId,
        stage: "confirm",
        message: "Me confirma com \"Confirmar\" ou, se preferir, escolha outro horario.",
        options: ["Confirmar", "Escolher outro horario"],
        action: null
      });
    }

    return res.json({
      ok: true,
      sessionId,
      stage: "service",
      message: "Vamos recomecar rapidamente. Qual servico voce busca hoje?",
      options: SERVICE_OPTIONS,
      action: null
    });
  } catch (err) {
    console.error("[chat] erro:", err.message);
    return res.status(500).json({
      ok: false,
      error: "Falha ao processar a conversa.",
      details: err.message
    });
  }
});

export default router;
