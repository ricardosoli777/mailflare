# Envio de marketing

## Como funciona
- A cada minuto o agendamento do Worker envia um lote de até 10 mensagens (cerca de 14 mil por dia no máximo). Não usa as filas do e-mail normal.
- Cada mensagem é reservada no banco antes de sair. Falha de resultado incerto fica como `unknown` e **não** é reenviada.
- Antes de cada envio: consentimento, descadastro e bloqueio. Antes de cada lote: disjuntor, verificações do domínio, aquecimento, cota do SES e ritmo por provedor.
- Disjuntor: com pelo menos 50 envios em 7 dias, pausa se devolução permanente ≥ 2% ou reclamação ≥ 0,08%, e avisa por e-mail quem salvou o remetente. Só volta quando alguém clica em retomar.

- Se a AWS colocar a conta em revisão ou pausa (`EnforcementStatus` diferente de `HEALTHY`), nada é enviado.
- Endereços de função (`abuse@`, `postmaster@`, `noc@`, `spam@`, `mailer-daemon@`, `noreply@`) são recusados no cadastro e na importação.
- Com o segredo `CONFIG_ENCRYPTION_KEY`, a chave da AWS fica cifrada no banco.

## Configurar (Marketing → Envio)
1. Salvar o remetente, em um subdomínio só de marketing.
2. Cadastrar a chave da AWS no quadro **Conta Amazon SES**. A chave fica guardada no banco do MailLead e vale também para domínios que usem SES.
3. **Configurar eventos**: cria o *configuration set* `maillead-marketing`, o tópico `maillead-marketing-events` e a inscrição que avisa devoluções e reclamações.
4. Quando todas as verificações estiverem certas, enviar um teste.

## Permissões da chave da AWS
Usuário IAM só para o MailLead, com esta política:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "sts:GetCallerIdentity",
        "ses:GetAccount",
        "ses:SendEmail",
        "ses:GetEmailIdentity",
        "ses:CreateConfigurationSet",
        "ses:CreateConfigurationSetEventDestination",
        "sns:ListTopics",
        "sns:CreateTopic",
        "sns:Subscribe"
      ],
      "Resource": "*"
    }
  ]
}
```

## Testar com o simulador do SES
Cadastre como contatos `success@simulator.amazonses.com`, `bounce@simulator.amazonses.com` e `complaint@simulator.amazonses.com`, ou envie o teste da aba Envio para eles. Os dois últimos devem passar a aparecer como bloqueados.

## Campanhas
- A lista de quem recebe é lida quando a campanha começa, não quando é criada. O conteúdo é congelado na criação.
- Pausar ou cancelar vale inclusive no meio de um lote.
- Aberturas e cliques usam o endereço público do remetente (`/api/marketing/o/…` e `/api/marketing/c/…`). Só redireciona para destinos assinados pelo próprio MailLead. Os números são aproximados.
- Quem recebeu há mais de 180 dias e não abriu nem clicou desde então fica de fora, salvo se marcar o contrário.
- Limite por pessoa: 3 campanhas a cada 7 dias por padrão, ajustável na aba Envio. Quem passa do limite é pulado naquela campanha.
