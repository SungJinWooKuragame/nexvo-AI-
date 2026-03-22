import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import chatRoute from "./routes/chat.js";
import bookingRoute from "./routes/booking.js";
import { listBookings } from "./services/store.js";
import { startReminderWorker } from "./services/reminder.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/widget", express.static(path.join(__dirname, "widget")));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "nexvo-bot", timestamp: new Date().toISOString() });
});

app.use("/api/chat", chatRoute);
app.use("/api/book", bookingRoute);
app.use("/api/bookings", bookingRoute);

app.get("/admin/bookings", async (_req, res) => {
  const bookings = await listBookings();
  const rows = bookings
    .map(
      (b) => `
        <tr>
          <td>${b.clientName}</td>
          <td>${b.clientEmail}</td>
          <td>${b.service}</td>
          <td>${b.formattedDate}</td>
          <td>${b.status}</td>
        </tr>
      `
    )
    .join("");

  res.send(`
    <html lang="pt-BR">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Admin Bookings - Nexvo</title>
        <style>
          body{font-family:Arial,sans-serif;background:#0f0f0f;color:#f0f0f0;padding:24px}
          table{width:100%;border-collapse:collapse;background:#161618}
          th,td{border:1px solid #2a2a2e;padding:10px;text-align:left}
          th{background:#1e1e22}
        </style>
      </head>
      <body>
        <h1>Agendamentos via Nex</h1>
        <p>Total: ${bookings.length}</p>
        <table>
          <thead>
            <tr><th>Cliente</th><th>Email</th><th>Servico</th><th>Data/Hora</th><th>Status</th></tr>
          </thead>
          <tbody>${rows || "<tr><td colspan='5'>Nenhum agendamento ainda.</td></tr>"}</tbody>
        </table>
      </body>
    </html>
  `);
});

app.get("/", (_req, res) => {
  res.redirect("/widget/chat.html");
});

app.listen(PORT, () => {
  console.log(`[nexvo-bot] online em http://localhost:${PORT}`);
  startReminderWorker();
});
