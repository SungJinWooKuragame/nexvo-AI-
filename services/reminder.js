import { listBookings, markReminderSent } from "./store.js";
import { sendReminderEmails } from "./email.js";
import { sendReminderWhatsApp } from "./whatsapp.js";

function formatDate(dateISO) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: process.env.TIMEZONE || "America/Sao_Paulo"
  }).format(new Date(dateISO));
}

export function startReminderWorker() {
  const intervalMs = 5 * 60 * 1000;

  setInterval(async () => {
    try {
      const bookings = await listBookings();
      const now = Date.now();

      for (const booking of bookings) {
        if (booking.reminderSent) continue;

        const start = new Date(booking.startISO).getTime();
        const diffHours = (start - now) / (1000 * 60 * 60);

        if (diffHours <= 24 && diffHours >= 23.5) {
          const payload = {
            clientName: booking.clientName,
            clientEmail: booking.clientEmail,
            whatsapp: booking.whatsapp,
            formattedDate: formatDate(booking.startISO),
            meetLink: booking.meetLink
          };

          await Promise.allSettled([
            sendReminderEmails(payload),
            sendReminderWhatsApp(payload)
          ]);

          await markReminderSent(booking.id);
        }
      }
    } catch (err) {
      console.error("[reminder-worker] erro:", err.message);
    }
  }, intervalMs);
}
