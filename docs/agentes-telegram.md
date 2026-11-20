# Falar com os agentes no Telegram

O dono não fala com um sistema: fala com uma equipa. Cada agente tem o seu bot e a sua personalidade, e os agentes falam entre si à frente do dono.

## Os bots

| Bot | Papel | Fala sobre |
|---|---|---|
| **Chefe** | Coordena; resume; faz a pergunta final ao dono | Estado geral, decisões pendentes |
| **Migrador** | Planeia e executa a migração | Serviços encontrados, plano, progresso, provas |
| **Atacante** | Testa a infraestrutura nova | O que encontrou, com que gravidade |
| **Defesa** | Explica e corrige | Risco em português simples, ação proposta, confirmação |

## Três formas de falar

1. **Grupo "Direção"** com o dono e os 4 bots. Aqui os agentes conversam entre si e o dono vê a cadeia toda.
2. **Conversa privada com cada bot.** O dono abre o Migrador e fala só de migração, ou o Defesa e fala só de segurança.
3. **No grupo, com menção.** `@defesa_bot o que está aberto agora?` responde só esse agente.

## Exemplo da conversa no grupo (a demo)

> **Migrador:** Encontrei 5 serviços AWS na app: S3, RDS Postgres, SQS, Secrets Manager e ElastiCache. Proponho MinIO, PostgreSQL, RabbitMQ, OpenBao e Valkey na Leaseweb. DynamoDB, SNS e Logs ficam para a fase seguinte. [Aprovar plano] [Ignorar]
> *(dono aprova)*
> **Migrador:** Os 5 serviços passaram, cada um com prova: contagens e checksums iguais, testes a passar dos dois lados. @atacante, a infraestrutura nova está no ar.
> **Atacante:** Recebido. A base de dados nova responde a qualquer pessoa na Internet, porta 5432. Gravidade alta. @defesa
> **Defesa:** A base de dados com os dados dos clientes está aberta a toda a Internet. Qualquer pessoa pode tentar entrar. Proponho fechar o acesso de fora e deixar só a vossa app. [Fechar] [Ignorar]
> *(dono carrega Fechar)*
> **Defesa:** Fechado às 14:02 e confirmado: porta filtrada. Guardei como voltar atrás. @atacante, podes confirmar?
> **Atacante:** Confirmo. Já não chego lá.
> **Chefe:** Migração concluída e segura. 1 falha encontrada e fechada em 40 segundos. Nada saiu da UE.

Os números deste exemplo são ilustrativos. Na demo usam-se os valores reais do dia.

## É possível no Telegram? Sim, com um cuidado

- **Os bots do Telegram não recebem mensagens de outros bots.** Por isso a conversa entre agentes **não passa pelo Telegram**: passa pelo nosso orquestrador (um bus interno). O Telegram é o palco: cada agente publica a sua fala no grupo com o seu próprio bot.
- Um só processo Node gere os 4 tokens. Quando um agente "fala" com outro, o orquestrador entrega a mensagem internamente e cada bot publica a sua parte no grupo, com 1 a 2 segundos entre falas para se ler bem.
- Para os bots lerem o que o dono escreve no grupo: desligar o **privacy mode** de cada bot no BotFather (`/setprivacy` → Disable) ou usar menções e comandos.
- Só se aceitam ordens e botões vindos do `TELEGRAM_DONO_ID`. Tudo o resto é ignorado.
- Os botões (Aprovar, Fechar, Ignorar) são `inline_keyboard`; a resposta chega por `callback_query` no bot que fez a pergunta.

## Níveis

- **A:** um bot só (Defesa) a pedir aprovação. É o mínimo para a demo.
- **B:** os 4 bots no grupo, com a conversa entre agentes encenada pelo orquestrador.
- **B:** conversa privada com cada bot, com respostas da IA no papel de cada agente.
- **C:** o Chefe faz uma reunião semanal: resumo, custos e no máximo 3 decisões.
