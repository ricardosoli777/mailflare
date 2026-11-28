# Captura de contatos

Tudo em **Marketing → Captura**. Os contatos entram na lista escolhida, com o registro de como aceitaram; não é preciso autorizar um por um.

## Formulários
- Cada lista criada ganha um formulário. No editor: campos extras (até 8, com "obrigatório"), texto do botão, texto de aceite, etiquetas e confirmação por e-mail.
- Duas formas de usar: o código HTML colado na sua página, ou o link da página pronta (`/api/marketing/f/<id>`).
- O código é uma cópia. Depois de mudar os campos, copie e cole de novo.
- Nome do campo no HTML: `campo.<nome do campo em minúsculas>`. As respostas ficam no contato. Um envio posterior só acrescenta o que faltava; não troca o que já existe.

## Confirmação dupla (padrão)
- A pessoa recebe um e-mail e precisa clicar no botão da página que abre. Sem isso não vira contato. O link vale 7 dias.
- Usa o mesmo remetente do marketing: precisa de **Envio** configurado e para quando o disjuntor abre.
- Limites: uma confirmação por endereço por hora e 200 por dia. Essas mensagens não contam no aquecimento.
- Quem tinha saído e confirma um pedido novo volta, só para a lista do formulário. Endereço com devolução permanente ou reclamação não volta.

## Proteção contra robôs
Campo escondido, limite por IP e, quando `TURNSTILE_SECRET_KEY` e `NEXT_PUBLIC_TURNSTILE_SITE_KEY` existem, o Turnstile. Com Turnstile ligado, quem envia pelo código colado em outro site termina o cadastro na página do MailLead, onde está a verificação.

## API
Chaves próprias do marketing (`mk_…`), mostradas uma única vez. Não dão acesso ao e-mail.

- `POST /api/marketing/v1/contacts` — `{"email","name","listId","tags":[],"fields":{},"consent":{"source","text","date"}}`. O `consent` é obrigatório.
- `POST /api/marketing/v1/unsubscribe` — `{"email"}`. Bloqueia o endereço mesmo que ainda não seja contato.

## Webhook de entrada
`POST /api/marketing/hooks/<id>` com `{"email","name","fields":{}}` e o cabeçalho `X-MailLead-Signature` (HMAC-SHA256 do corpo, em hexadecimal, com o segredo do webhook).

Plataformas de venda costumam enviar o próprio formato e a própria assinatura. Cada uma precisa de um adaptador, ainda não feito; para ligar uma delas, é preciso saber qual é.

API e webhook nunca desfazem um descadastro ou bloqueio.

## Ainda não feito
- Iniciar um fluxo a partir da entrada (parte do I3) depende da onda 6.
- Um telefone capturado não é autorização de WhatsApp (onda 7).

Apagar um contato libera o endereço para novo cadastro. Descadastro, devolução e reclamação continuam bloqueando.
