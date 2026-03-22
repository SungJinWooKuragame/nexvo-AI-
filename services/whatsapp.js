import axios from "axios";

function buildTeamMessage(payload) {
  return [
    "✅ NOVO AGENDAMENTO - NEXVO",
    `Cliente: ${payload.clientName}`,
    `Email: ${payload.clientEmail}`,
    `WhatsApp: ${payload.whatsapp}`,
    `Servico: ${payload.service}`,
    `Data/Hora: ${payload.formattedDate}`,
    "Status: Reuniao criada com sucesso no Google Calendar",
    `Google Meet: ${payload.meetLink || "sera enviado no convite"}`,
    "Briefing:",
    payload.briefingSummary,
    "Agendado automaticamente pelo Nex"
  ].join("\n");
}

function buildReminderMessage(payload) {
  return [
    "Lembrete de reuniao - Nexvo",
    `Cliente: ${payload.clientName}`,
    `Quando: ${payload.formattedDate}`,
    `Meet: ${payload.meetLink || "consulte o convite no calendario"}`
  ].join("\n");
}

async function sendZapiText(phone, message) {
  const instanceId = process.env.ZAPI_INSTANCE_ID;
  const token = process.env.ZAPI_TOKEN;
  if (!instanceId || !token) {
    throw new Error("Z-API nao configurada: ZAPI_INSTANCE_ID e ZAPI_TOKEN sao obrigatorios.");
  }

  const url = `https://api.z-api.io/instances/${instanceId}/token/${token}/send-text`;
  const clientToken = process.env.ZAPI_CLIENT_TOKEN;
  const headers = clientToken ? { "Client-Token": clientToken } : undefined;

  await axios.post(
    url,
    {
      phone,
      message
    },
    {
      headers
    }
  );
}

export async function sendTeamWhatsAppNotification(payload) {
  const teamNumber = process.env.WHATSAPP_NUMBER || "5511962507663";
  const message = buildTeamMessage(payload);
  await sendZapiText(teamNumber, message);
}

export async function sendRescheduleTeamWhatsApp(payload) {
  const teamNumber = process.env.WHATSAPP_NUMBER || "5511962507663";
  const msg = [
    "\uD83D\uDD04 *REUNIAO REAGENDADA — NEXVO*",
    "",
    `\uD83D\uDC64 *Cliente:* ${payload.clientName}`,
    `\uD83D\uDCF1 *WhatsApp:* ${payload.whatsapp}`,
    `\uD83C\uDFAF *Servico:* ${payload.service}`,
    "",
    `\u274C *Era:* ${payload.oldFormattedDate}`,
    `\u2705 *Agora:* ${payload.newFormattedDate}`,
    `\uD83D\uDD17 *Meet:* ${payload.meetLink || "consulte o convite"}`,
    "",
    "_Alterado pelo cliente via IA Nex_"
  ].join("\n");
  await sendZapiText(teamNumber, msg);
}

export async function sendCancelTeamWhatsApp(payload) {
  const teamNumber = process.env.WHATSAPP_NUMBER || "5511962507663";
  const msg = [
    "\u274C *REUNIAO CANCELADA — NEXVO*",
    "",
    `\uD83D\uDC64 *Cliente:* ${payload.clientName}`,
    `\uD83D\uDCF1 *WhatsApp:* ${payload.whatsapp}`,
    `\uD83C\uDFAF *Servico:* ${payload.service}`,
    `\uD83D\uDCC5 *Era:* ${payload.formattedDate}`,
    "",
    "_Cancelado pelo cliente via IA Nex_"
  ].join("\n");
  await sendZapiText(teamNumber, msg);
}

export async function sendReminderWhatsApp(payload) {
  const teamNumber = process.env.WHATSAPP_NUMBER || "5511962507663";
  const clientPhone = String(payload.whatsapp || "").replace(/\D/g, "");
  const message = buildReminderMessage(payload);

  await Promise.allSettled([
    sendZapiText(teamNumber, message),
    clientPhone ? sendZapiText(clientPhone, message) : Promise.resolve()
  ]);
}
