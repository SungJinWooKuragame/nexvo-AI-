import express from "express";
import { v4 as uuidv4 } from "uuid";
import { createCalendarEvent, findClientEvents, rescheduleEvent, cancelEvent } from "../services/calendar.js";
import {
  sendTeamEmail, sendClientConfirmationEmail,
  sendRescheduleTeamEmail, sendRescheduleClientEmail,
  sendCancelTeamEmail, sendCancelClientEmail
} from "../services/email.js";
import {
  sendTeamWhatsAppNotification,
  sendRescheduleTeamWhatsApp,
  sendCancelTeamWhatsApp
} from "../services/whatsapp.js";
import {
  addBooking,
  canCreateBooking,
  getBookingById,
  getSession,
  increaseBookingCounter,
  listBookings,
  setSession
} from "../services/store.js";

const router = express.Router();

function formatDate(dateISO) {
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: process.env.TIMEZONE || "America/Sao_Paulo"
  }).format(new Date(dateISO));
}

function toICS(booking) {
  const dtStart = booking.startISO.replace(/[-:]/g, "").split(".")[0] + "Z";
  const dtEnd = booking.endISO.replace(/[-:]/g, "").split(".")[0] + "Z";
  const now = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//NEXVO//NEX BOT//PT-BR",
    "BEGIN:VEVENT",
    `UID:${booking.id}@nexvo.agency`,
    `DTSTAMP:${now}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:Reuniao Nexvo - ${booking.clientName}`,
    `DESCRIPTION:Servico: ${booking.service}\\nMeet: ${booking.meetLink}`,
    `LOCATION:${booking.meetLink}`,
    "END:VEVENT",
    "END:VCALENDAR"
  ].join("\r\n");
}

router.post("/", async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) {
      return res.status(400).json({ ok: false, error: "sessionId e obrigatorio." });
    }

    const session = getSession(sessionId);
    if (!session || !session.selectedSlot || !session.contact?.email) {
      return res.status(400).json({ ok: false, error: "Sessao incompleta para agendamento." });
    }

    const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";
    if (!canCreateBooking(String(ip))) {
      return res.status(429).json({
        ok: false,
        error: "Limite diario atingido para este IP (maximo de 3 agendamentos por dia)."
      });
    }

    const event = await createCalendarEvent({
      clientName: session.contact.name,
      clientEmail: session.contact.email,
      whatsapp: session.contact.whatsapp,
      service: session.serviceLabel,
      briefingSummary: session.briefingSummary,
      startISO: session.selectedSlot.start,
      endISO: session.selectedSlot.end
    });

    const booking = {
      id: uuidv4(),
      sessionId,
      clientName: session.contact.name,
      clientEmail: session.contact.email,
      whatsapp: session.contact.whatsapp,
      company: session.contact.company || "",
      service: session.serviceLabel,
      briefingSummary: session.briefingSummary,
      startISO: session.selectedSlot.start,
      endISO: session.selectedSlot.end,
      formattedDate: formatDate(session.selectedSlot.start),
      meetLink: event.meetLink,
      calendarLink: event.htmlLink,
      createdAt: new Date().toISOString(),
      status: "confirmed",
      reminderSent: false
    };

    await addBooking(booking);
    increaseBookingCounter(String(ip));

    const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
    const payload = {
      ...booking,
      icsLink: `${baseUrl}/api/bookings/${booking.id}/ics`,
      rebookLink: `${baseUrl}/widget/chat.html?rebook=${booking.id}`
    };

    const notifyResults = await Promise.allSettled([
      sendTeamWhatsAppNotification(payload),
      sendTeamEmail(payload),
      sendClientConfirmationEmail(payload)
    ]);

    notifyResults.forEach((r, i) => {
      if (r.status === "rejected") {
        const channel = ["whatsapp_team", "email_team", "email_client"][i] || `channel_${i}`;
        console.warn(`[booking] falha ao notificar ${channel}:`, r.reason?.message || r.reason);
      }
    });

    session.stage = "confirmed";
    setSession(sessionId, session);

    return res.json({
      ok: true,
      stage: "confirmed",
      message: `Reuniao confirmada para ${booking.formattedDate}. Enviamos os detalhes para seu email.`,
      booking
    });
  } catch (err) {
    console.error("[booking] erro:", err.message);
    return res.status(500).json({
      ok: false,
      error: "Nao foi possivel concluir o agendamento.",
      details: err.message
    });
  }
});

router.get("/", async (_req, res) => {
  const bookings = await listBookings();
  return res.json({ ok: true, bookings });
});

// ─── Buscar eventos pelo email ou WhatsApp do cliente ──────────────────────
router.get("/find", async (req, res) => {
  try {
    const identifier = String(req.query.identifier || "").trim();
    if (!identifier) return res.status(400).json({ ok: false, error: "identifier obrigatorio." });
    const events = await findClientEvents(identifier);
    return res.json({ ok: true, events });
  } catch (err) {
    console.error("[booking/find] erro:", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── Reagendar evento (eventId vem da sessão) ────────────────────────────
router.patch("/reschedule", async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).json({ ok: false, error: "sessionId obrigatorio." });

    const session = getSession(sessionId);
    if (!session?.selectedSlot || !session?.rescheduleData) {
      return res.status(400).json({ ok: false, error: "Sessao incompleta para reagendamento." });
    }

    const { clientName, clientEmail, whatsapp, service, oldFormattedDate, eventId } = session.rescheduleData;
    if (!eventId) return res.status(400).json({ ok: false, error: "eventId nao encontrado na sessao." });
    const newStartISO = session.selectedSlot.start;
    const newEndISO = session.selectedSlot.end;
    const newFormattedDate = formatDate(newStartISO);

    const updated = await rescheduleEvent(eventId, newStartISO, newEndISO, oldFormattedDate);

    const payload = {
      clientName, clientEmail, whatsapp, service,
      oldFormattedDate,
      newFormattedDate,
      meetLink: updated.meetLink,
      icsLink: `${process.env.BASE_URL || "http://localhost:3000"}/api/bookings/reschedule-ics?start=${encodeURIComponent(newStartISO)}&end=${encodeURIComponent(newEndISO)}&name=${encodeURIComponent(clientName)}`
    };

    const notifyResults = await Promise.allSettled([
      sendRescheduleTeamWhatsApp(payload),
      sendRescheduleTeamEmail(payload),
      sendRescheduleClientEmail(payload)
    ]);

    notifyResults.forEach((r, i) => {
      if (r.status === "rejected") {
        const channel = ["whatsapp_team", "email_team", "email_client"][i] || `channel_${i}`;
        console.warn(`[booking/reschedule] falha ao notificar ${channel}:`, r.reason?.message || r.reason);
      }
    });

    session.stage = "confirmed";
    setSession(sessionId, session);

    return res.json({
      ok: true,
      stage: "confirmed",
      message: `Reuniao remarcada para ${newFormattedDate}. Enviamos a confirmacao por email.`,
      newFormattedDate
    });
  } catch (err) {
    console.error("[booking/reschedule] erro:", err.message);
    return res.status(500).json({ ok: false, error: "Nao foi possivel reagendar.", details: err.message });
  }
});

// ─── Cancelar evento (eventId vem da sessão) ─────────────────────────────
router.delete("/cancel", async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).json({ ok: false, error: "sessionId obrigatorio." });

    const session = getSession(sessionId);
    if (!session?.rescheduleData) {
      return res.status(400).json({ ok: false, error: "Sessao incompleta para cancelamento." });
    }

    const { clientName, clientEmail, whatsapp, service, oldFormattedDate, eventId } = session.rescheduleData;
    if (!eventId) return res.status(400).json({ ok: false, error: "eventId nao encontrado na sessao." });

    await cancelEvent(eventId);

    const payload = { clientName, clientEmail, whatsapp, service, formattedDate: oldFormattedDate };

    const notifyResults = await Promise.allSettled([
      sendCancelTeamWhatsApp(payload),
      sendCancelTeamEmail(payload),
      sendCancelClientEmail(payload)
    ]);

    notifyResults.forEach((r, i) => {
      if (r.status === "rejected") {
        const channel = ["whatsapp_team", "email_team", "email_client"][i] || `channel_${i}`;
        console.warn(`[booking/cancel] falha ao notificar ${channel}:`, r.reason?.message || r.reason);
      }
    });

    session.stage = "service";
    setSession(sessionId, session);

    return res.json({
      ok: true,
      stage: "cancelled",
      message: "Sua reuniao foi cancelada com sucesso. Voce recebera um email de confirmacao. Se mudar de ideia, e so me chamar aqui!"
    });
  } catch (err) {
    console.error("[booking/cancel] erro:", err.message);
    return res.status(500).json({ ok: false, error: "Nao foi possivel cancelar.", details: err.message });
  }
});

router.get("/:id/ics", async (req, res) => {
  const booking = await getBookingById(req.params.id);
  if (!booking) return res.status(404).send("Agendamento nao encontrado.");

  const ics = toICS(booking);
  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="nexvo-${booking.id}.ics"`);
  return res.send(ics);
});

export default router;
