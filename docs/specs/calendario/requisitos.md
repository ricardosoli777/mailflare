# Calendário do MailLead: requisitos

Documentos: **requisitos** (o quê) · [design](design.md) (como) · [tarefas](tarefas.md) (ondas e ciclo).
Estado: proposto em 2026-11-28, aguardando aprovação.

## Objetivo

Trazer para a seção **Calendário** do MailLead um sistema de agendamento completo, no nível das melhores ferramentas do mercado, já ligado ao e-mail e ao Marketing do próprio app. Visual próprio do MailLead: usamos as ideias, não copiamos telas, textos ou marca de terceiros.

## Princípios

- **P1. Sem bloqueio por plano.** Nenhuma função do calendário depende de licença ou plano. Tipos de reunião, calendários, páginas, cupons e anfitriões não têm limite imposto pelo app. Os limites que sobram são os dos serviços externos (Cloudflare, Amazon SES, provedor de SMS), que o app mostra quando atinge.
- **P2. Português do Brasil primeiro.** `pt-BR` é o idioma padrão do app inteiro. Os outros idiomas continuam disponíveis.
- **P3. E-mail pelo próprio app.** E-mails transacionais e de marketing saem pelo MailLead.
- **P4. Marketing só com consentimento.** Agendar não inscreve ninguém. Vira contato de marketing apenas quem marcar o consentimento. Sem disparo para listas frias.
- **P5. Credenciais são do dono.** Chaves de integrações são digitadas pelo administrador na tela do app, guardadas cifradas e nunca exibidas de volta.
- **P6. Repositório público.** Nenhum dado pessoal, chave ou captura de tela de terceiros entra no repositório.

## O que já existe

Calendário com mês, semana e dia, recorrência, convites por e-mail, CalDAV, importação e assinatura ICS, lembrete por push ao dono; tipos de reunião com duração, local, descrição, cor, dias, faixas de horário e vários anfitriões; página pública; confirmação por e-mail personalizável; Marketing com contatos, listas, formulários, campanhas, fluxos e WhatsApp.

## Requisitos

Formato: **QUANDO** acontece algo, **O SISTEMA DEVE** fazer algo. "Aceite" é como conferimos.

### R1. Base visual e idioma
- R1.1 O app abre em `pt-BR` para quem nunca escolheu idioma. Datas, horas e moeda seguem o idioma e o fuso escolhidos.
- R1.2 Tipografia nova em todo o app, nas páginas públicas e nos e-mails (com fonte de reserva segura nos e-mails).
- R1.3 Menu próprio da seção Calendário: Início, Reservas, Tipos de reunião, Calendário, Clientes, Disponibilidade, Página pública, E-mails, Equipes, Enquetes, Configurações.
- Aceite: nenhum texto em inglês nas telas do calendário e nas páginas públicas em `pt-BR`; claro e escuro legíveis; funciona no celular (400 px).

### R2. Calendário
- R2.1 Visões de dia, semana, mês e lista.
- R2.2 Horários disponíveis pintados, faixa útil em destaque, dias fechados marcados e resumo de horas abertas.
- R2.3 Vários calendários por usuário, sem limite, com nome, cor, mostrar/ocultar e "bloqueia agendamento".
- R2.4 Fuso horário, formato 12/24 h e início da semana configuráveis.

### R3. Início (painel)
- R3.1 Reservas no período, receita, visitas à página, conversão, próximas reuniões, link para copiar e passos de configuração pendentes.

### R4. Tipos de reunião
- R4.1 Cartões com ligar/desligar, copiar link, abrir, duplicar, compartilhar e excluir.
- R4.2 Individual ou em grupo (vagas por horário); convidados extras opcionais.
- R4.3 Vários locais para o cliente escolher: Google Meet, Zoom, Teams, telefone, WhatsApp, presencial, texto livre.
- R4.4 Descrição formatada, imagem de capa, cor, ocultar da página.
- R4.5 Várias durações opcionais para o mesmo tipo.
- R4.6 Compartilhar: link, link de uso único, e-mail, redes, incorporar no site (embutido, botão ou pop-up), assinatura de e-mail, QR code.

### R5. Disponibilidade
- R5.1 Agendas de horários salvas e reutilizáveis; um tipo usa uma agenda salva ou horários próprios.
- R5.2 Semanal ou por datas específicas, várias janelas por dia, folgas e férias, horários extras.
- R5.3 Por tipo: antecedência mínima, janela máxima, intervalo entre inícios, folga antes e depois, limite por dia/semana/mês, limite por cliente, "parecer ocupado" (esconder parte dos horários).
- Aceite: nunca há duas reservas no mesmo horário além das vagas, mesmo com pedidos simultâneos; horário de verão e fusos diferentes testados.

### R6. Perguntas ao cliente
- R6.1 Perguntas próprias: texto curto e longo, escolha única e múltipla, caixa de marcar, telefone, número; obrigatórias ou não; ordenáveis.
- R6.2 Respostas visíveis na reserva, exportáveis e utilizáveis como campos do contato.

### R7. Ciclo da reserva
- R7.1 O cliente recebe confirmação com arquivo de calendário e um link seguro para **cancelar** ou **remarcar**, respeitando prazo e regras do tipo.
- R7.2 Aprovação manual opcional antes de confirmar.
- R7.3 Lista de espera quando não há horário; aviso quando abrir vaga.
- R7.4 Verificação do e-mail por código (opcional), bloqueio por e-mail, domínio ou telefone, proteção contra robôs.
- R7.5 Redirecionar após agendar, com os dados necessários na URL apenas se o dono ligar.
- R7.6 Tela de reservas: próximas, passadas, canceladas, aguardando aprovação; busca; exportar CSV; marcar ausência.
- R7.7 **Agendar pelo cliente:** o dono escolhe o horário e envia um convite com prazo de validade.

### R8. Mensagens
- R8.1 Confirmação, cancelamento, remarcação, lembrete (padrão 1 dia e 1 hora antes) e mensagens de pós-reunião, com marcadores e editor.
- R8.2 Responder-para e cópia à equipe por tipo.
- R8.3 Canais: e-mail (MailLead), WhatsApp (o já conectado) e SMS.
- R8.4 SMS sem limite imposto pelo app, usando um provedor contratado pelo dono. **Cada SMS é cobrado pelo provedor.** Só vai para quem informou o telefone e aceitou.
- Aceite: nenhum lembrete duplicado; reserva cancelada não recebe lembrete; falha de envio fica registrada e visível.

### R9. Ligação com o Marketing
- R9.1 Toda reserva gera um **cliente** no calendário com histórico.
- R9.2 Com consentimento marcado, vira contato do Marketing, com lista e etiquetas escolhidas no tipo.
- R9.3 Eventos de reserva (criada, cancelada, remarcada, paga, ausente, concluída) podem iniciar fluxos.
- R9.4 Importar clientes e convidar a agendar, apenas contatos que já têm relação e consentimento.

### R10. Calendários externos
- R10.1 Conectar Google, Microsoft, Apple/CalDAV e URL ICS, várias contas.
- R10.2 Horários ocupados externos bloqueiam o agendamento.
- R10.3 A reserva é criada, atualizada e removida no calendário externo escolhido.
- Aceite: se a conexão cair, o dono é avisado e o tipo segue a política escolhida (pausar ou aceitar).

### R11. Videochamada
- R11.1 Google Meet, Zoom e Microsoft Teams: link gerado por reserva, atualizado na remarcação e removido no cancelamento.

### R12. Pagamentos
- R12.1 Provedores conectáveis: **Stripe** (cobrança dentro do fluxo), **Hotmart** (checkout da Hotmart com confirmação automática) e outros pelo mesmo contrato.
- R12.2 Reunião avulsa paga, pacote de sessões, assinatura e adicionais.
- R12.3 Cupons: percentual, valor fixo ou grátis; por tipo; validade; limite total e por pessoa.
- R12.4 O horário fica reservado por tempo limitado durante o pagamento e volta a ficar livre se falhar.
- R12.5 Reembolso e taxa de cancelamento tardio conforme a regra do tipo, com ação confirmada pelo dono.
- R12.6 O MailLead não cobra taxa própria e **não guarda dados de cartão**.
- Aceite: reserva só é confirmada por aviso assinado do provedor; aviso repetido não duplica.

### R13. Páginas públicas
- R13.1 Página simples com foto, descrição, preço, mês e horários lado a lado, no fuso do visitante.
- R13.2 Modelo "site": capa, apresentação, números, tipos de reunião, depoimentos, perguntas frequentes e chamada final, com editor.
- R13.3 Quantas páginas quiser, com endereço próprio; temas, cores, fontes, imagem de fundo e domínio próprio.
- R13.4 Avaliações pós-reunião, publicadas só depois de aprovadas.

### R14. Equipes e enquetes
- R14.1 Equipes com tipos compartilhados: todos juntos, qualquer um disponível ou rodízio.
- R14.2 Enquete de datas: o dono propõe horários, os convidados votam, o escolhido vira reunião.

### R15. Medição e automação
- R15.1 Google Analytics, Google Tag Manager, TikTok Pixel e Meta Pixel por página, carregados conforme o consentimento do visitante.
- R15.2 Webhooks assinados e API para reservas, utilizáveis pelo Zapier, Make e n8n; ferramentas MCP.
- R15.3 Importar tipos, reservas e contatos de outra ferramenta (Calendly).

## Fora do escopo

- Programa de indicação e planos comerciais de outras ferramentas.
- Disparo em massa para quem não se cadastrou.
- Armazenar cartão.
- Qualquer mudança em servidores e instâncias de outros projetos.

## Depende do dono (o app não faz sozinho)

| Item | Para quê | Custo |
|---|---|---|
| Projeto no Google Cloud com tela de consentimento | Google Calendar e Meet | sem custo para uso próprio; pode exigir verificação do Google |
| App no Microsoft Entra | Outlook e Teams | sem custo |
| App no Zoom Marketplace | Zoom | depende do plano Zoom |
| Conta e chaves no Stripe | cobrança | taxas do Stripe |
| Produto e webhook na Hotmart | cobrança | taxas da Hotmart |
| Provedor de SMS | SMS | por mensagem |
| Domínio próprio no Cloudflare | página com seu endereço | o do domínio |

## Em aberto

- **Q1.** "TikTok" nas formas de pagamento: é o **pixel do TikTok** (medição, já em R15.1) ou a plataforma de pagamento **Ticto**?
- **Q2.** Qual provedor de SMS (definir antes da onda 7).
