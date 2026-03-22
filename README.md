# Nexvo Bot - Nex (Assistente de Atendimento)

Assistente inteligente para qualificar leads e agendar reunioes da Nexvo com:

- Chat com personalidade da marca (pt-BR)
- Qualificacao por etapas (servico, briefing, dados)
- Consulta de slots no Google Calendar (5 dias uteis)
- Confirmacao automatica com criacao de evento + Google Meet
- Notificacao para equipe via WhatsApp e Email
- Email de confirmacao para cliente com link ICS
- Reagendamento via reabertura do chat
- Lembrete automatico (24h antes)
- Painel simples de agendamentos em /admin/bookings
- Limite de 3 agendamentos por IP/dia

## Estrutura

nexvo-bot/
- server.js
- .env
- .env.example
- package.json
- services/
  - calendar.js
  - email.js
  - whatsapp.js
  - claude.js
  - reminder.js
  - store.js
- prompts/
  - nex-system.js
- routes/
  - chat.js
  - booking.js
- widget/
  - chat.html
  - chat.css
  - chat.js
- data/
  - bookings.json (gerado automaticamente)

## Como rodar

1. Entrar na pasta do projeto
2. Instalar dependencias
3. Configurar variaveis no .env
4. Ativar Google Calendar API e credenciais da Service Account
5. Configurar WhatsApp (Z-API/Evolution)
6. Iniciar servidor

Comandos:

```bash
cd nexvo-bot
npm install
npm start
```

Servidor local:

- Widget standalone: http://localhost:3000/widget/chat.html
- Healthcheck: http://localhost:3000/health
- Admin de agendamentos: http://localhost:3000/admin/bookings

## Endpoints

- POST /api/chat
  - Body: { sessionId, message } ou { sessionId, selectedOption }
- POST /api/book
  - Body: { sessionId }
- GET /api/bookings
- GET /api/bookings/:id/ics

## Embed no site Nexvo

Adicionar no fim do body:

```html
<script>
  window.NEXVO_BOT_BASE_URL = "https://seu-servidor.com";
</script>
<script src="https://seu-servidor.com/widget/chat.js"></script>
```

Para abrir com botao customizado:

- Pode manter o botao flutuante padrao do widget.
- Se quiser ligar ao CTA "Falar com a Equipe", basta manter o script e orientar o fluxo para abertura manual do painel (customizacao simples no chat.js).

## Fluxo do atendimento

1. Recepcao
2. Escolha/descoberta de servico
3. Briefing rapido (uma pergunta por vez)
4. Coleta de nome, email e WhatsApp
5. Busca de horarios disponiveis (Google Calendar)
6. Confirmacao
7. Criacao de evento + Meet
8. Notificacao imediata (WhatsApp + email equipe + email cliente)

## Variaveis obrigatorias

- GOOGLE_CLIENT_EMAIL
- GOOGLE_PRIVATE_KEY
- GOOGLE_CALENDAR_ID
- EMAIL_USER
- EMAIL_APP_PASSWORD
- ZAPI_INSTANCE_ID
- ZAPI_TOKEN
- ZAPI_CLIENT_TOKEN (quando sua instancia exigir Client-Token)
- WHATSAPP_NUMBER
- ANTHROPIC_API_KEY

Para testes locais sem Google Calendar configurado, use:

- MOCK_CALENDAR=true

Isso habilita slots simulados apenas para desenvolvimento.

## Observacoes

- Horario de atendimento considerado: segunda a sexta, 9h as 18h (America/Sao_Paulo)
- Slots exibidos: maximo de 4 opcoes
- Duracao de reuniao: 1 hora
- Bookings persistidos em data/bookings.json
