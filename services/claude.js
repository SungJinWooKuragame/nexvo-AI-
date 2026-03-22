import { NEX_SYSTEM_PROMPT } from "../prompts/nex-system.js";

function extractJson(text) {
  const trimmed = String(text || "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

export async function generateNexMessage({
  stage,
  userInput,
  session,
  options,
  fallbackMessage,
  action = null
}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      message: fallbackMessage,
      stage,
      options,
      action
    };
  }

  const prompt = [
    "Contexto do atendimento Nexvo:",
    `Stage atual: ${stage}`,
    `Mensagem do cliente: ${userInput || "(sem mensagem)"}`,
    `Servico escolhido: ${session.serviceLabel || "nao definido"}`,
    `Resumo briefing: ${session.briefingSummary || "sem resumo"}`,
    `Dados coletados: nome=${session.contact?.name || ""}, email=${session.contact?.email || ""}, whatsapp=${session.contact?.whatsapp || ""}`,
    `Mensagem base sugerida: ${fallbackMessage}`,
    `Opcoes sugeridas: ${JSON.stringify(options || [])}`,
    `Action sugerida: ${action || "null"}`,
    "Retorne JSON valido seguindo o formato definido."
  ].join("\n");

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514",
      max_tokens: 450,
      system: NEX_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: prompt
        }
      ]
    })
  });

  if (!response.ok) {
    return {
      message: fallbackMessage,
      stage,
      options,
      action
    };
  }

  const data = await response.json();
  const text = data?.content?.[0]?.text || "";
  const parsed = extractJson(text);

  if (!parsed || !parsed.message) {
    return {
      message: fallbackMessage,
      stage,
      options,
      action
    };
  }

  return {
    message: parsed.message,
    stage: parsed.stage || stage,
    options: Array.isArray(parsed.options) ? parsed.options : options,
    action: parsed.action || action
  };
}
