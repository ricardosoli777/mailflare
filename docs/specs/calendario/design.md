# Calendário do MailLead: design

[Requisitos](requisitos.md) · **design** · [tarefas](tarefas.md)

## Encaixe na arquitetura atual

Mesmo Worker, mesmo banco D1 (com PostgreSQL e MySQL), mesma fila e mesmo cron. Nada de serviço novo obrigatório. Regras do `CLAUDE.md` valem: toda mudança de esquema tem migração nos três dialetos; binding só por `getEnv()`; tipos e funções puras em arquivos `*-types.d.ts` e `*-utils.ts`.

```
src/app/(calendar)/…           telas internas (menu próprio)
src/app/book, src/app/c        páginas públicas
src/app/api/booking, …/public  APIs internas e públicas
src/lib/booking/               regras: vagas, reserva, ciclo, mensagens
src/lib/booking/payments/      contrato de pagamento + stripe, hotmart, ticto
src/lib/integrations/          conexões OAuth + google, microsoft, zoom, caldav, ics
src/lib/messaging/sms/         contrato de SMS + provedor
```

## Idioma e fontes

- Hoje `DEFAULT_LOCALE` significa duas coisas: o idioma padrão e o catálogo embutido que serve de reserva (inglês). Separar em `DEFAULT_LOCALE = "pt-BR"` e `FALLBACK_LOCALE = "en"`, sem aumentar o Worker (o catálogo `pt-BR` continua como arquivo estático) e atualizar `tests/i18n.test.mjs` e `docs/localization.md`.
- Textos fixos em inglês no servidor (título do evento da reserva, confirmação padrão, páginas públicas) passam pelo tradutor.
- Fontes por `next/font` em `src/app/layout.tsx`, expostas por variáveis CSS; trocar de fonte fica em um lugar só. Proposta: **Inter** no texto e **Plus Jakarta Sans** nos títulos, com amostra antes de fechar.

## Dados

Tabelas existentes (`calendar_events`, `booking_events`, `booking_confirmation_templates`) continuam. Novas, por onda:

| Tabela | Guarda |
|---|---|
| `calendars` | calendários do usuário (nome, cor, visível, bloqueia) |
| `availability_schedules`, `availability_overrides` | agendas salvas, datas específicas, folgas |
| `booking_rules` | antecedência, janela, folgas, limites (1 por tipo) |
| `booking_questions` | perguntas do tipo |
| `bookings` | a reserva como entidade: estado, cliente, respostas, token, eventos criados |
| `booking_guests` | clientes e histórico |
| `booking_messages` | modelos e fila de envios com chave única |
| `booking_pages`, `booking_reviews` | páginas e avaliações |
| `integration_connections` | contas conectadas, tokens cifrados |
| `external_busy` | cache de horários ocupados externos |
| `payments`, `coupons`, `booking_packages` | cobranças, cupons, saldo de pacotes |
| `teams`, `team_members`, `polls`, `poll_votes` | equipes e enquetes |

Colunas novas em tabelas existentes são opcionais: sem a migração aplicada o app continua funcionando como antes (padrão `isMissingTableError` / `isMissingColumnError`). `calendar_events` tem gatilhos de DAV: coluna nova exige recriar os gatilhos (`tests/dav-change-log.test.mjs` cobra). Backup e restauração incluem as tabelas novas; caches e filas derivadas ficam de fora.

## Estados da reserva

```
iniciada ─► aguardando_pagamento ─► aguardando_aprovação ─► confirmada ─► concluída
   │                │ (expira)               │ (recusada)        ├─► cancelada
   └────────────────┴─► expirada             └─► recusada        ├─► remarcada ─► confirmada
                                                                 └─► ausente
```

Cada transição é um UPDATE condicional (só anda se o estado anterior ainda for o esperado) e dispara um evento interno, consumido por mensagens, calendário externo, vídeo, Marketing e webhooks.

## Vagas sem duplicidade

Cálculo puro (`availableBookingSlots`) recebe: agenda, regras, eventos locais, ocupados externos e reservas pendentes. A gravação continua em uma única instrução condicional, como hoje em `createBookedCalendarEvents`, estendida para vagas de grupo, folgas e seguradas de pagamento. Hoje essa instrução só confere eventos sem repetição: a onda 3 cobre os recorrentes na mesma garantia.

## Mensagens

Ao confirmar, o app grava os envios futuros em `booking_messages` com chave única (reserva, modelo, momento). O cron de 1 minuto pega os vencidos com UPDATE condicional e envia pela fila. Cancelar ou remarcar apaga os pendentes. E-mail usa o envio do app e respeita a lista de supressão; mensagens da reserva são transacionais, sem rastreio por padrão.

## Integrações

- Um contrato por tipo: `CalendarProvider` (ocupados, criar, atualizar, excluir), `MeetingProvider` (link), `PaymentProvider` (iniciar, interpretar aviso, reembolsar), `SmsProvider` (enviar, situação). Adicionar provedor não mexe no fluxo de reserva.
- OAuth com `state` de uso único e PKCE onde houver. Tokens cifrados com a chave `CONFIG_ENCRYPTION_KEY`; nunca voltam à tela nem aos logs.
- **Stripe:** Checkout hospedado ou elementos do Stripe; confirmação só por webhook com assinatura. Pix depende de a conta Stripe estar habilitada: conferir antes da onda 6.
- **Hotmart:** o cliente é levado ao checkout do produto; a confirmação vem pelo webhook, casada pela referência da reserva. Conferir na documentação o que a Hotmart permite repassar antes de implementar.
- **Google:** pedir o menor escopo possível. Com o app em modo de teste o Google expira o acesso em poucos dias, então publicar em produção antes de depender dele.
- Antes de cada integração, ler a documentação oficial atual do provedor.

### Campos por provedor (conferir de novo na onda)

| Provedor | Campos | Aviso recebido | Documentação |
|---|---|---|---|
| Stripe | chave secreta (de preferência restrita), segredo do webhook (`whsec_`) | cabeçalho `Stripe-Signature` sobre o corpo bruto; Pix só confirma em `checkout.session.async_payment_succeeded` | https://docs.stripe.com/webhooks |
| Hotmart | `client_id`, `client_secret`, token Basic, `hottok` | cabeçalho `X-HOTMART-HOTTOK` | https://developers.hotmart.com/docs/en/2.0.0/webhook/purchase-webhook/ |
| Ticto | token do webhook 2.0; `client_id` e `client_secret` se usarmos a API | campo `token` no corpo; pago = `status: authorized` | https://xavier.ticto.dev/docs/v2 |
| Google | ID e segredo do cliente OAuth | OAuth | documentação da Google Calendar API |
| Microsoft | ID do locatário, ID e segredo do aplicativo | OAuth | Microsoft Graph |
| Zoom | ID e segredo do aplicativo | OAuth | Zoom App Marketplace |
| Pixels e analytics | identificador de cada um | não se aplica | de cada provedor |

Ticto e Hotmart autenticam o aviso por um segredo fixo, sem assinatura do corpo. Por isso: comparação em tempo constante, conferência de produto, oferta e valor contra a reserva, idempotência pela transação e, quando a API permitir, consulta da transação antes de confirmar. A documentação da Ticto não descreve reenvio; o app precisa de conferência manual da reserva pendente. Falta confirmar como levar a referência da reserva até o checkout e de volta (Ticto: `url_params`/`sck`; Hotmart: `sck`/`xcod`).

## Incorporação em outros sites

Hoje `src/lib/security/headers.ts` envia `frame-ancestors 'self'` e `X-Frame-Options: SAMEORIGIN`. Criar a rota `/embed/…`, única com cabeçalhos próprios (`frame-ancestors` com os domínios do dono, ou todos, e sem `X-Frame-Options`). Ela não usa cookie de sessão nem expõe nada além do agendamento. Um script pequeno ajusta a altura por `postMessage`. Pagamento que não pode rodar em iframe abre em nova aba.

## Segurança

- Endpoints públicos com limite de tentativas, Turnstile, validação de tamanho e tipo. Como todo envio cria contato de marketing, a proteção contra robôs entra na mesma tarefa dessa ligação.
- Links de cancelar/remarcar com token aleatório, guardado como hash, com validade.
- Webhooks recebidos: assinatura, tolerância de relógio, idempotência por identificador do evento.
- Webhooks enviados: o mesmo mecanismo que já existe para e-mail.
- Endereços informados pelo usuário (ICS, CalDAV, redirecionamento): só HTTPS e sem alcançar rede interna.
- Descrições formatadas e textos de clientes são higienizados antes de exibir.
- Pixels de medição só carregam após consentimento; a política de segurança de conteúdo é aberta apenas para os domínios ligados.

## Bloqueios herdados

A edição de vários anfitriões hoje exige licença do projeto original. O projeto é AGPL, que permite modificar; a onda 1 remove essa trava **somente no agendamento** (P1). As demais travas de licença do app ficam como estão até decisão do dono.

## Domínio próprio

Como no rastreio de aberturas: o dono anexa o domínio ao Worker no painel Cloudflare e o app apenas o reconhece. Um host de página pública não dá acesso ao painel.
