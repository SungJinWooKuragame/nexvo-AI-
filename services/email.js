import nodemailer from "nodemailer";

function getTransport() {
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_APP_PASSWORD;

  if (!user || !pass) {
    throw new Error("Email nao configurado: EMAIL_USER e EMAIL_APP_PASSWORD sao obrigatorios.");
  }

  return nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass }
  });
}

function buildTeamHtml(payload) {
  const waDigits = String(payload.whatsapp || "").replace(/\D/g, "");
  return `
    <div style="font-family:Arial,sans-serif;background:#0f0f0f;color:#f0f0f0;padding:24px;">
      <div style="max-width:640px;margin:0 auto;border:1px solid #2a2a2e;border-radius:8px;background:#161618;padding:20px;">
        <h2 style="margin:0 0 12px;">Novo Agendamento - Nexvo</h2>
        <p><strong>Cliente:</strong> ${payload.clientName}</p>
        <p><strong>Email:</strong> ${payload.clientEmail}</p>
        <p><strong>WhatsApp:</strong> ${payload.whatsapp}</p>
        <p><strong>Servico:</strong> ${payload.service}</p>
        <p><strong>Data/Hora:</strong> ${payload.formattedDate}</p>
        <p><strong>Briefing:</strong><br>${payload.briefingSummary}</p>
        <div style="margin-top:16px;display:flex;gap:10px;flex-wrap:wrap;">
          <a href="${payload.calendarLink}" style="background:#1e1e22;border:1px solid #8b5cf6;color:#f0f0f0;padding:10px 14px;text-decoration:none;border-radius:6px;">Abrir no Google Calendar</a>
          <a href="https://wa.me/55${waDigits}" style="background:#1e1e22;border:1px solid #2a2a2e;color:#f0f0f0;padding:10px 14px;text-decoration:none;border-radius:6px;">Responder no WhatsApp</a>
        </div>
      </div>
    </div>
  `;
}

function buildClientHtml(payload) {
  return `
    <div style="font-family:Arial,sans-serif;background:#0f0f0f;color:#f0f0f0;padding:24px;">
      <div style="max-width:640px;margin:0 auto;border:1px solid #2a2a2e;border-radius:8px;background:#161618;padding:20px;">
        <h2 style="margin:0 0 12px;">Reuniao confirmada com a Nexvo</h2>
        <p>Oi, ${payload.clientName}. Sua reuniao foi confirmada:</p>
        <p><strong>Quando:</strong> ${payload.formattedDate}</p>
        <p><strong>Link Google Meet:</strong> <a style="color:#8b5cf6" href="${payload.meetLink}">${payload.meetLink}</a></p>
        <p>O que esperar: vamos entender seu contexto, alinhar objetivos e definir os proximos passos de execucao.</p>
        <div style="margin-top:16px;display:flex;gap:10px;flex-wrap:wrap;">
          <a href="${payload.icsLink}" style="background:#1e1e22;border:1px solid #8b5cf6;color:#f0f0f0;padding:10px 14px;text-decoration:none;border-radius:6px;">Adicionar ao meu calendario</a>
          <a href="${payload.rebookLink}" style="background:#1e1e22;border:1px solid #2a2a2e;color:#f0f0f0;padding:10px 14px;text-decoration:none;border-radius:6px;">Precisa reagendar?</a>
        </div>
        <p style="color:#888894;margin-top:18px;">Nexvo Agency - Design, Motion e Desenvolvimento.</p>
      </div>
    </div>
  `;
}

export async function sendTeamEmail(payload) {
  const transporter = getTransport();
  const subject = `Novo Agendamento | ${payload.clientName} | ${payload.service} | ${payload.formattedDate}`;

  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: "nexvoagencia@gmail.com",
    subject,
    html: buildTeamHtml(payload)
  });
}

export async function sendClientConfirmationEmail(payload) {
  const transporter = getTransport();
  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: payload.clientEmail,
    subject: "Reuniao confirmada com a Nexvo",
    html: buildClientHtml(payload)
  });
}

// ─── Reagendamento ──────────────────────────────────────────────────────────
export async function sendRescheduleTeamEmail(payload) {
  const transporter = getTransport();
  const waDigits = String(payload.whatsapp || "").replace(/\D/g, "");
  const html = `
    <div style="font-family:Arial,sans-serif;background:#0f0f0f;color:#f0f0f0;padding:24px;">
      <div style="max-width:640px;margin:0 auto;border:1px solid #2a2a2e;border-radius:8px;background:#161618;padding:20px;">
        <h2 style="margin:0 0 12px;">&#x1F504; Reuniao Reagendada — Nexvo</h2>
        <p><strong>Cliente:</strong> ${payload.clientName}</p>
        <p><strong>WhatsApp:</strong> ${payload.whatsapp}</p>
        <p><strong>Servico:</strong> ${payload.service}</p>
        <div style="margin:16px 0;padding:14px;background:#1e1e22;border-radius:6px;border-left:3px solid #ef4444;">
          <p style="margin:0;"><strong>&#x274C; Era:</strong> ${payload.oldFormattedDate}</p>
        </div>
        <div style="margin:16px 0;padding:14px;background:#1e1e22;border-radius:6px;border-left:3px solid #22c55e;">
          <p style="margin:0;"><strong>&#x2705; Agora:</strong> ${payload.newFormattedDate}</p>
        </div>
        <a href="https://wa.me/55${waDigits}" style="background:#1e1e22;border:1px solid #2a2a2e;color:#f0f0f0;padding:10px 14px;text-decoration:none;border-radius:6px;display:inline-block;margin-top:12px;">Responder no WhatsApp</a>
      </div>
    </div>
  `;
  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: "nexvoagencia@gmail.com",
    subject: `&#x1F504; Reuniao Reagendada | ${payload.clientName} | ${payload.newFormattedDate}`,
    html
  });
}

export async function sendRescheduleClientEmail(payload) {
  const transporter = getTransport();
  const html = `
    <div style="font-family:Arial,sans-serif;background:#0f0f0f;color:#f0f0f0;padding:24px;">
      <div style="max-width:640px;margin:0 auto;border:1px solid #2a2a2e;border-radius:8px;background:#161618;padding:20px;">
        <h2 style="margin:0 0 12px;">&#x2705; Reuniao remarcada com a Nexvo</h2>
        <p>Oi, ${payload.clientName}. Sua reuniao foi remarcada com sucesso:</p>
        <div style="margin:16px 0;padding:14px;background:#1e1e22;border-radius:6px;border-left:3px solid #ef4444;">
          <p style="margin:0;"><strong>&#x274C; Era:</strong> ${payload.oldFormattedDate}</p>
        </div>
        <div style="margin:16px 0;padding:14px;background:#1e1e22;border-radius:6px;border-left:3px solid #22c55e;">
          <p style="margin:0;"><strong>&#x2705; Agora:</strong> ${payload.newFormattedDate}</p>
        </div>
        <p><strong>Link Google Meet:</strong> <a style="color:#8b5cf6" href="${payload.meetLink}">${payload.meetLink || "sera enviado no convite"}</a></p>
        <div style="margin-top:16px;">
          <a href="${payload.icsLink}" style="background:#1e1e22;border:1px solid #8b5cf6;color:#f0f0f0;padding:10px 14px;text-decoration:none;border-radius:6px;display:inline-block;">Adicionar ao meu calendario</a>
        </div>
        <p style="color:#888894;margin-top:18px;">Nexvo Agency - Design, Motion e Desenvolvimento.</p>
      </div>
    </div>
  `;
  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: payload.clientEmail,
    subject: "&#x2705; Reuniao remarcada com a Nexvo",
    html
  });
}

// ─── Cancelamento ───────────────────────────────────────────────────────────
export async function sendCancelTeamEmail(payload) {
  const transporter = getTransport();
  const waDigits = String(payload.whatsapp || "").replace(/\D/g, "");
  const html = `
    <div style="font-family:Arial,sans-serif;background:#0f0f0f;color:#f0f0f0;padding:24px;">
      <div style="max-width:640px;margin:0 auto;border:1px solid #2a2a2e;border-radius:8px;background:#161618;padding:20px;">
        <h2 style="margin:0 0 12px;">&#x274C; Reuniao Cancelada — Nexvo</h2>
        <p><strong>Cliente:</strong> ${payload.clientName}</p>
        <p><strong>Email:</strong> ${payload.clientEmail}</p>
        <p><strong>WhatsApp:</strong> ${payload.whatsapp}</p>
        <p><strong>Servico:</strong> ${payload.service}</p>
        <p><strong>Era:</strong> ${payload.formattedDate}</p>
        <a href="https://wa.me/55${waDigits}" style="background:#1e1e22;border:1px solid #ef4444;color:#f0f0f0;padding:10px 14px;text-decoration:none;border-radius:6px;display:inline-block;margin-top:12px;">Entrar em contato com o cliente</a>
      </div>
    </div>
  `;
  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: "nexvoagencia@gmail.com",
    subject: `&#x274C; Reuniao Cancelada | ${payload.clientName} | ${payload.formattedDate}`,
    html
  });
}

export async function sendCancelClientEmail(payload) {
  const transporter = getTransport();
  const rebookUrl = `${process.env.BASE_URL || "http://localhost:3000"}/widget/chat.html`;
  const html = `
    <div style="font-family:Arial,sans-serif;background:#0f0f0f;color:#f0f0f0;padding:24px;">
      <div style="max-width:640px;margin:0 auto;border:1px solid #2a2a2e;border-radius:8px;background:#161618;padding:20px;">
        <h2 style="margin:0 0 12px;">Reuniao cancelada — Nexvo</h2>
        <p>Oi, ${payload.clientName}. Confirmamos o cancelamento da sua reuniao agendada para <strong>${payload.formattedDate}</strong>.</p>
        <p style="margin-top:12px;">Lamentamos nao poder conversar dessa vez. Quando quiser retomar, e so voltar aqui.</p>
        <a href="${rebookUrl}" style="background:#1e1e22;border:1px solid #8b5cf6;color:#f0f0f0;padding:10px 14px;text-decoration:none;border-radius:6px;display:inline-block;margin-top:16px;">Agendar nova reuniao</a>
        <p style="color:#888894;margin-top:18px;">Nexvo Agency - Design, Motion e Desenvolvimento.</p>
      </div>
    </div>
  `;
  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: payload.clientEmail,
    subject: "Reuniao cancelada — Nexvo",
    html
  });
}

export async function sendReminderEmails(payload) {
  const transporter = getTransport();
  const subject = `Lembrete de reuniao | ${payload.clientName} | ${payload.formattedDate}`;
  const html = `<p>Este e um lembrete da reuniao Nexvo agendada para <strong>${payload.formattedDate}</strong>.</p><p>Meet: <a href="${payload.meetLink}">${payload.meetLink}</a></p>`;

  await Promise.allSettled([
    transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: "nexvoagencia@gmail.com",
      subject,
      html
    }),
    transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: payload.clientEmail,
      subject,
      html
    })
  ]);
}
