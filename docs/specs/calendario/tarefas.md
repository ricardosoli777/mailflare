# Calendário do MailLead: ondas e ciclo

[Requisitos](requisitos.md) · [design](design.md) · **tarefas**

## Ciclo de cada tarefa

```
1. Ler o requisito e escrever o teste do aceite
2. Implementar o mínimo
3. Verificar: node --test tests/*.test.mjs · npm run lint · tsc nos arquivos tocados · npm run build
   └─ falhou? voltar ao passo 2
4. Commit na main, push, migrações (se houver) e npm run deploy
5. Conferir em produção, no navegador, claro, escuro e celular
   └─ falhou? voltar ao passo 2
6. Marcar a caixa aqui e anotar o que mudou
```

## Fim de cada onda

- Todos os aceites da onda conferidos em produção.
- Sem erro novo de teste ou lint em relação à base (hoje há falhas conhecidas no lint, registradas no início da onda 1).
- Textos novos em `pt-BR` e inglês nos catálogos.
- Relato curto ao dono com o que testar. **A próxima onda começa com o retorno dele.**

Se a mesma tarefa falhar três voltas no ciclo, parar e levar o problema ao dono.

## Ondas

### Onda 1: base (R1, P1, P2)
- [x] 1.1 `pt-BR` como idioma padrão, com inglês como reserva
- [x] 1.2 Textos fixos em inglês do calendário, da página pública e dos e-mails de reunião traduzidos (faltam mensagens de erro de algumas APIs internas)
- [x] 1.3 Fontes novas no app e nas páginas públicas: Plus Jakarta Sans nos títulos, Inter no texto (escolha do dono). E-mails seguem com fonte padrão dos leitores de e-mail
- [x] 1.4 Menu da seção Calendário (entregue na onda 2; cada item novo aparece quando a função dele funcionar)
- [x] 1.5 Vários anfitriões sem exigir licença (só administrador; limite técnico de 20 por reunião)

### Onda 2: visual novo (R2, R3, R4.1, R13.1)
- [x] 2.1 Desenho das telas: o dono decidiu seguir as capturas de referência, sem rodada de desenho próprio
- [x] 2.1b Moldura nova: menu lateral, painel com cabeçalho, sai a coluna de próximos eventos
- [ ] 2.2 Calendário: disponíveis pintados, faixa útil, dias fechados, lista, resumo
- [ ] 2.3 Vários calendários
- [x] 2.4 Cartões de tipos de reunião (busca, Todos/Ativos/Inativos, interruptor, link, abrir, compartilhar, duplicar)
- [ ] 2.5 Página pública com mês e horários lado a lado
- [ ] 2.6 Painel inicial (com os números que já existem)
- [ ] 2.7 Código iframe para páginas externas (R17)
- [ ] 2.8 Formulário de agendamento vira contato do Marketing, com aviso e proteção contra robôs (R9.2, R9.5, R9.6)

### Onda 3: disponibilidade e tipos (R4, R5, R6)
- [ ] 3.1 Agendas salvas, datas específicas, folgas e extras
- [ ] 3.2 Antecedência, janela, intervalo, folgas, limites, "parecer ocupado"
- [ ] 3.3 Grupo, convidados, vários locais e durações
- [ ] 3.4 Perguntas próprias
- [ ] 3.5 Compartilhar: uso único, botão e janela flutuante, assinatura, QR code

### Onda 4: ciclo da reserva e mensagens (R7, R8 por e-mail e WhatsApp)
- [ ] 4.1 Reserva como entidade, com estados; tela de reservas e clientes
- [ ] 4.2 Cancelar e remarcar pelo cliente
- [ ] 4.3 Lembretes e mensagens de pós-reunião
- [ ] 4.4 Aprovação, lista de espera, verificação de e-mail, bloqueios
- [ ] 4.5 Agendar pelo cliente
- [ ] 4.6 Exportar e marcar ausência

### Onda 5: Marketing e calendários externos (R9, R10, R11)
- [ ] 5.1 Eventos de reserva iniciam fluxos do Marketing
- [ ] 5.2 Tela de chaves e conexões cifradas (R16); URL ICS e CalDAV bloqueando horários
- [ ] 5.3 Google Calendar e Meet
- [ ] 5.4 Microsoft Outlook e Teams
- [ ] 5.5 Zoom

### Onda 6: pagamentos (R12, R16)
- [ ] 6.1 Contrato de pagamento e segurada de horário
- [ ] 6.2 Stripe: avulso
- [ ] 6.3 Hotmart
- [ ] 6.4a Ticto
- [ ] 6.4 Cupons
- [ ] 6.5 Pacotes, assinatura e adicionais
- [ ] 6.6 Reembolso e taxa de cancelamento

### Onda 7: páginas e SMS (R13, R8.4) — responder Q2 antes
- [ ] 7.1 Editor do modelo "site", várias páginas
- [ ] 7.2 Temas, imagem de fundo, domínio próprio
- [ ] 7.3 Avaliações
- [ ] 7.4 SMS

### Onda 8: equipes, enquetes e automação (R14, R15)
- [ ] 8.1 Equipes e rodízio
- [ ] 8.2 Enquetes de datas
- [ ] 8.3 Pixels e analytics com consentimento
- [ ] 8.4 Webhooks, API e MCP de reservas
- [ ] 8.5 Importar do Calendly

## Cobertura

| Requisito | Onda |
|---|---|
| R1 | 1 |
| R2, R3 | 2 (receita e conversão completam na 6) |
| R4 | 2, 3 |
| R5, R6 | 3 |
| R7 | 4 |
| R8 | 4, 7 |
| R9 | 2, 5 |
| R10, R11 | 5 |
| R12 | 6 |
| R16 | 5, 6, 7, 8 |
| R17 | 2, 3 |
| R13 | 2, 7 |
| R14, R15 | 8 |
