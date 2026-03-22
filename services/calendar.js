import { google } from "googleapis";
import { v4 as uuidv4 } from "uuid";

const TZ = process.env.TIMEZONE || "America/Sao_Paulo";

function getCalendarAuth() {
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  const privateKey = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");

  if (!clientEmail || !privateKey) {
    throw new Error("Google Calendar nao configurado: GOOGLE_CLIENT_EMAIL e GOOGLE_PRIVATE_KEY sao obrigatorios.");
  }

  return new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/calendar"]
  });
}

function getCalendarClient() {
  const auth = getCalendarAuth();
  return google.calendar({ version: "v3", auth });
}

function toIso(date) {
  return new Date(date).toISOString();
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function formatSlotLabel(date) {
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TZ
  })
    .format(date)
    .replace(",", "")
    .replace(".", "")
    .replace(" ", " ")
    .replace(/\s+/g, " ")
    .replace(" ", " ")
    .replace(/^(...)/, (m) => m.charAt(0).toUpperCase() + m.slice(1))
    .replace(/(\d{2})\/(\d{2})\s(\d{2}:\d{2})$/, "$1/$2 as $3");
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

// Returns { year, month, day } of a Date in the app timezone (not machine local).
function getDateInTZ(date) {
  const s = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
  const [year, month, day] = s.split("-").map(Number);
  return { year, month, day };
}

// Returns the weekday name ("Monday" … "Sunday") in the app timezone.
function getWeekdayInTZ(date) {
  return new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "long" }).format(date);
}

// Returns a Date representing tzHour:00 on (year-month-day) in the app timezone,
// correctly handling any UTC offset (including DST) without extra libraries.
function tzHourToDate(year, month, day, tzHour) {
  // Use the UTC offset at noon of that day (noon is never ambiguous with DST).
  const noonUTC = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const noonTZHour =
    parseInt(
      new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "2-digit", hour12: false }).format(noonUTC)
    ) % 24;
  // offset = (noonTZHour – 12)  →  utcHour = tzHour – offset
  const utcHour = tzHour - (noonTZHour - 12);
  return new Date(Date.UTC(year, month - 1, day, utcHour, 0, 0));
}

function generateMockSlots({ maxOptions = 4 }) {
  const slots = [];
  const now = new Date();
  const preferredHours = [10, 11, 14, 15, 16];
  let cursor = new Date(now);

  while (slots.length < maxOptions) {
    cursor.setDate(cursor.getDate() + 1);
    if (["Saturday", "Sunday"].includes(getWeekdayInTZ(cursor))) continue;

    const { year, month, day } = getDateInTZ(cursor);
    for (const tzHour of preferredHours) {
      const start = tzHourToDate(year, month, day, tzHour);
      if (start <= now) continue;
      const end = addMinutes(start, 60);
      slots.push({
        id: uuidv4(),
        label: formatSlotLabel(start),
        start: start.toISOString(),
        end: end.toISOString(),
        timeZone: TZ,
        mock: true
      });
      if (slots.length >= maxOptions) break;
    }
  }

  return slots;
}

export async function getAvailableSlots({ maxOptions = 4, businessDays = 5 } = {}) {
  const useMockCalendar = String(process.env.MOCK_CALENDAR || "false").toLowerCase() === "true";
  if (useMockCalendar) {
    return generateMockSlots({ maxOptions });
  }

  const calendar = getCalendarClient();
  const calendarId = process.env.GOOGLE_CALENDAR_ID;
  if (!calendarId) throw new Error("GOOGLE_CALENDAR_ID nao configurado.");

  const now = new Date();
  const endWindow = new Date(now);
  endWindow.setDate(endWindow.getDate() + 10);

  const freebusy = await calendar.freebusy.query({
    requestBody: {
      timeMin: toIso(now),
      timeMax: toIso(endWindow),
      timeZone: TZ,
      items: [{ id: calendarId }]
    }
  });

  const busy = freebusy.data.calendars?.[calendarId]?.busy || [];
  const busyRanges = busy.map((b) => ({
    start: new Date(b.start),
    end: new Date(b.end)
  }));

  const slots = [];
  const usedDates = new Set();
  let dayCursor = new Date(now);
  let safetyLimit = 0;

  while (slots.length < maxOptions && safetyLimit < 60) {
    safetyLimit++;
    dayCursor.setDate(dayCursor.getDate() + 1);
    if (["Saturday", "Sunday"].includes(getWeekdayInTZ(dayCursor))) continue;

    const { year, month, day } = getDateInTZ(dayCursor);
    const dateKey = `${year}-${month}-${day}`;

    if (!usedDates.has(dateKey) && usedDates.size >= businessDays) break;

    for (let tzHour = 9; tzHour < 18; tzHour++) {
      const start = tzHourToDate(year, month, day, tzHour);
      if (start <= now) continue;
      const end = addMinutes(start, 60);

      const occupied = busyRanges.some((range) => overlaps(start, end, range.start, range.end));
      if (occupied) continue;

      usedDates.add(dateKey);
      slots.push({
        id: uuidv4(),
        label: formatSlotLabel(start),
        start: start.toISOString(),
        end: end.toISOString(),
        timeZone: TZ
      });

      if (slots.length >= maxOptions) break;
    }
  }

  return slots;
}

export async function createCalendarEvent({
  clientName,
  clientEmail,
  whatsapp,
  service,
  briefingSummary,
  startISO,
  endISO
}) {
  const useMockCalendar = String(process.env.MOCK_CALENDAR || "false").toLowerCase() === "true";
  if (useMockCalendar) {
    const fakeEventId = uuidv4();
    return {
      eventId: fakeEventId,
      htmlLink: `${process.env.BASE_URL || "http://localhost:3000"}/admin/bookings?mockEvent=${fakeEventId}`,
      meetLink: `https://meet.google.com/mock-${fakeEventId.slice(0, 10)}`,
      startISO,
      endISO,
      mock: true
    };
  }

  const calendar = getCalendarClient();
  const calendarId = process.env.GOOGLE_CALENDAR_ID;

  const event = {
    summary: `Reuniao Nexvo - ${clientName} - ${service}`,
    description: `Cliente: ${clientName}\nEmail: ${clientEmail}\nWhatsApp: ${whatsapp}\nServico: ${service}\nBriefing: ${briefingSummary}\n\nAgendado via IA Nex (site Nexvo)`,
    start: { dateTime: startISO, timeZone: TZ },
    end: { dateTime: endISO, timeZone: TZ },
    attendees: [
      { email: "nexvoagencia@gmail.com" },
      { email: clientEmail }
    ],
    reminders: {
      useDefault: false,
      overrides: [
        { method: "email", minutes: 1440 },
        { method: "popup", minutes: 30 }
      ]
    },
    conferenceData: {
      createRequest: {
        requestId: uuidv4()
      }
    }
  };

  let response;
  try {
    response = await calendar.events.insert({
      calendarId,
      conferenceDataVersion: 1,
      sendUpdates: "all",
      requestBody: event
    });
  } catch (err) {
    // Service accounts in shared calendars may be blocked from adding attendees or Meet links.
    const fallbackEvent = {
      summary: event.summary,
      description: event.description,
      start: event.start,
      end: event.end,
      reminders: event.reminders
    };

    try {
      response = await calendar.events.insert({
        calendarId,
        sendUpdates: "none",
        requestBody: fallbackEvent
      });
      console.warn("[calendar] fallback aplicado: evento criado sem convidados/meet.");
    } catch {
      throw err;
    }
  }

  return {
    eventId: response.data.id,
    htmlLink: response.data.htmlLink,
    meetLink: response.data.hangoutLink || "",
    startISO,
    endISO
  };
}

// ─── Buscar eventos futuros de um cliente ───────────────────────────────────
export async function findClientEvents(identifier) {
  const calendar = getCalendarClient();
  const calendarId = process.env.GOOGLE_CALENDAR_ID;
  const now = new Date();
  const maxTime = new Date(now);
  maxTime.setDate(maxTime.getDate() + 60);

  const res = await calendar.events.list({
    calendarId,
    timeMin: now.toISOString(),
    timeMax: maxTime.toISOString(),
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 50,
    q: "Reuniao Nexvo"
  });

  const items = res.data.items || [];
  const id = String(identifier || "").trim().toLowerCase();

  return items
    .filter((ev) => {
      const desc = String(ev.description || "").toLowerCase();
      const attendees = (ev.attendees || []).map((a) => String(a.email || "").toLowerCase());
      return desc.includes(id) || attendees.some((a) => a === id);
    })
    .map((ev) => ({
      eventId: ev.id,
      summary: ev.summary || "",
      start: ev.start?.dateTime || ev.start?.date || null,
      end: ev.end?.dateTime || ev.end?.date || null,
      meetLink: ev.hangoutLink || "",
      description: ev.description || "",
      htmlLink: ev.htmlLink || ""
    }));
}

// ─── Reagendar evento existente (PATCH) ────────────────────────────────────
export async function rescheduleEvent(eventId, newStartISO, newEndISO, oldLabel) {
  const calendar = getCalendarClient();
  const calendarId = process.env.GOOGLE_CALENDAR_ID;

  // Buscar evento atual para preservar dados
  const current = await calendar.events.get({ calendarId, eventId });
  const oldDesc = current.data.description || "";

  const now = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZone: TZ
  }).format(new Date());

  const appendNote = `\n\n⚠️ REAGENDADO em ${now} via IA Nex\nHorario anterior: ${oldLabel}`;
  const newDescription = oldDesc + appendNote;

  const patchBody = {
    start: { dateTime: newStartISO, timeZone: TZ },
    end: { dateTime: newEndISO, timeZone: TZ },
    description: newDescription
  };

  let response;
  try {
    response = await calendar.events.patch({
      calendarId,
      eventId,
      sendUpdates: "all",
      requestBody: patchBody
    });
  } catch {
    response = await calendar.events.patch({
      calendarId,
      eventId,
      sendUpdates: "none",
      requestBody: patchBody
    });
  }

  return {
    eventId: response.data.id,
    htmlLink: response.data.htmlLink || "",
    meetLink: response.data.hangoutLink || "",
    newStartISO,
    newEndISO
  };
}

// ─── Cancelar evento existente (DELETE) ────────────────────────────────────
export async function cancelEvent(eventId) {
  const calendar = getCalendarClient();
  const calendarId = process.env.GOOGLE_CALENDAR_ID;

  // Buscar dados antes de deletar (precisamos para as notificações)
  const current = await calendar.events.get({ calendarId, eventId });
  const ev = current.data;

  try {
    await calendar.events.delete({ calendarId, eventId, sendUpdates: "all" });
  } catch {
    await calendar.events.delete({ calendarId, eventId, sendUpdates: "none" });
  }

  return {
    eventId: ev.id,
    summary: ev.summary || "",
    start: ev.start?.dateTime || ev.start?.date || null,
    end: ev.end?.dateTime || ev.end?.date || null,
    meetLink: ev.hangoutLink || "",
    description: ev.description || "",
    htmlLink: ev.htmlLink || ""
  };
}

// ─── Slots disponíveis excluindo um evento específico ──────────────────────
export async function getAvailableSlotsExcluding(excludeEventId, { maxOptions = 4, businessDays = 5 } = {}) {
  const calendar = getCalendarClient();
  const calendarId = process.env.GOOGLE_CALENDAR_ID;
  if (!calendarId) throw new Error("GOOGLE_CALENDAR_ID nao configurado.");

  const now = new Date();
  const endWindow = new Date(now);
  endWindow.setDate(endWindow.getDate() + 10);

  const freebusy = await calendar.freebusy.query({
    requestBody: {
      timeMin: toIso(now),
      timeMax: toIso(endWindow),
      timeZone: TZ,
      items: [{ id: calendarId }]
    }
  });

  // Buscar o evento a excluir para remover da lista de busy
  let excludeStart = null;
  let excludeEnd = null;
  try {
    const ev = await calendar.events.get({ calendarId, eventId: excludeEventId });
    excludeStart = ev.data.start?.dateTime ? new Date(ev.data.start.dateTime) : null;
    excludeEnd = ev.data.end?.dateTime ? new Date(ev.data.end.dateTime) : null;
  } catch { /* evento não encontrado — ignora */ }

  const busy = freebusy.data.calendars?.[calendarId]?.busy || [];
  const busyRanges = busy
    .map((b) => ({ start: new Date(b.start), end: new Date(b.end) }))
    .filter((r) => {
      // Excluir o range do próprio evento sendo reagendado
      if (excludeStart && excludeEnd) {
        return !(r.start.getTime() === excludeStart.getTime() && r.end.getTime() === excludeEnd.getTime());
      }
      return true;
    });

  const slots = [];
  const usedDates = new Set();
  let dayCursor = new Date(now);
  let safetyLimit = 0;

  while (slots.length < maxOptions && safetyLimit < 60) {
    safetyLimit++;
    dayCursor.setDate(dayCursor.getDate() + 1);
    if (["Saturday", "Sunday"].includes(getWeekdayInTZ(dayCursor))) continue;

    const { year, month, day } = getDateInTZ(dayCursor);
    const dateKey = `${year}-${month}-${day}`;
    if (!usedDates.has(dateKey) && usedDates.size >= businessDays) break;

    for (let tzHour = 9; tzHour < 18; tzHour++) {
      const start = tzHourToDate(year, month, day, tzHour);
      if (start <= now) continue;
      const end = addMinutes(start, 60);
      const occupied = busyRanges.some((range) => overlaps(start, end, range.start, range.end));
      if (occupied) continue;

      usedDates.add(dateKey);
      slots.push({
        id: uuidv4(),
        label: formatSlotLabel(start),
        start: start.toISOString(),
        end: end.toISOString(),
        timeZone: TZ
      });
      if (slots.length >= maxOptions) break;
    }
  }

  return slots;
}
