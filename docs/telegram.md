# Telegram: aprovar tudo pelo Telegram

Ver também `agentes-telegram.md`: 4 bots (chefe, migrador, atacante, defesa) num grupo "Direção".

Long polling, sem webhook: não precisa de domínio nem HTTPS público.

## Montagem (Carlos, 09:30, cerca de 15 min)

1. No Telegram, falar com `@BotFather` → `/newbot` quatro vezes (chefe, migrador, atacante, defesa) → guardar os tokens em `TELEGRAM_TOKEN_*`. Em cada um, `/setprivacy` → Disable.
   Criar o grupo "Direção", adicionar os 4 bots e o dono.
2. O "dono" da demo envia `/start` ao bot.
3. `curl https://api.telegram.org/bot<TOKEN>/getUpdates` → copiar o `chat.id` do grupo para `TELEGRAM_GRUPO_ID` e o `from.id` do dono para `TELEGRAM_DONO_ID`.
4. Teste com botões:

```bash
curl -s https://api.telegram.org/bot$TELEGRAM_TOKEN_DEFESA/sendMessage \
  -H 'Content-Type: application/json' \
  -d '{"chat_id":'$TELEGRAM_GRUPO_ID',"text":"Teste","reply_markup":{"inline_keyboard":[[{"text":"Aprovar","callback_data":"aprovar:teste"},{"text":"Ignorar","callback_data":"ignorar:teste"}]]}}'
```

## Teste de fumo (2 minutos, assim que houver um token)

`npm run telegram:smoke` lê `env/.env` (ou `.env` na raiz). Chaves de que precisa:

| Chave                   | O que pôr                                                                                | Obrigatória                |
| ----------------------- | ---------------------------------------------------------------------------------------- | -------------------------- |
| `TELEGRAM_TOKEN_DEFESA` | token do bot da defesa (BotFather). Sem ele usa o primeiro `TELEGRAM_TOKEN_*` que houver | sim (um token basta)       |
| `TELEGRAM_GRUPO_ID`     | `chat.id` do grupo "Direção" (negativo, normalmente `-100…`)                             | sim                        |
| `TELEGRAM_APROVADORES`  | `from.id` de quem pode aprovar, separados por vírgula                                    | sim, ou `TELEGRAM_DONO_ID` |
| `TELEGRAM_DONO_ID`      | `from.id` do dono; usado se `TELEGRAM_APROVADORES` estiver vazio                         | ver acima                  |

Montagem rápida:

1. `@BotFather` → `/newbot` → nome `Defesa`, username a acabar em `bot` → copiar o token para `TELEGRAM_TOKEN_DEFESA` em `env/.env`. Repetir para chefe, migrador e atacante quando houver tempo; o teste só precisa de um. Em cada bot: `/setprivacy` → escolher o bot → `Disable`.
2. Criar o grupo "Direção", adicionar o(s) bot(s) e o dono. Escrever qualquer mensagem no grupo.
3. `curl -s https://api.telegram.org/bot<TOKEN>/getUpdates`: o `message.chat.id` do grupo vai para `TELEGRAM_GRUPO_ID` e o `message.from.id` do dono vai para `TELEGRAM_APROVADORES`. Resposta vazia: escrever outra vez no grupo e repetir.
4. `npm run telegram:smoke` e, quando aparecer `>>> Carrega em Aprovar plano ou em Ignorar`, carregar no telemóvel com a conta do aprovador (120 s).

O teste imprime PASS/FAIL para: (a) long polling, (b) pedido com os botões do tipo de ação (Aprovar plano / Ignorar na migração), (c) recusa a um ID fora da lista (simulada, sem rede) e toque real do aprovador, (d) `editMessageReplyMarkup` a tirar os botões, (e) relatório de exemplo com Desfazer no grupo, (f) toques reais nos botões Desfazer do relatório (espera 60 s, todos respondem). Não mexe em `auditoria.jsonl` nem em infraestrutura. O token nunca é impresso.

Nos passos (c)/toque e (f), carregar com a conta de um aprovador quando aparecer o `>>>`. Os botões (Aprovar plano, Fechar, Ignorar, Desfazer) só respondem enquanto o teste corre: depois de sair, o polling para e um toque fica sem resposta (na demo o orquestrador está sempre a correr).

Se falhar:

- `getUpdates: Conflict`: outro processo (o orquestrador, outro portátil) está a fazer polling ao mesmo bot. Parar o outro.
- `chat not found`: o `TELEGRAM_GRUPO_ID` está errado ou o bot não está no grupo.
- (c) "ninguém carregou a tempo": o `from.id` de quem carregou não está em `TELEGRAM_APROVADORES` (aparece no log como `callback_query de <id>`).

## Comportamento

- Cada pedido chega com título, explicação e os botões do tipo de ação: **Aprovar plano** / **Ignorar** na migração e **Fechar** / **Ignorar** na defesa (textos de `shared/mensagens.ts`). `callback_data` = `aprovar:<pedidoId>` ou `ignorar:<pedidoId>`.
- Ao carregar: `answerCallbackQuery` e editar a mensagem com o resultado ("Fechado e confirmado às 14:02").
- Só aceita ordens e botões de `TELEGRAM_APROVADORES` (por defeito o `TELEGRAM_DONO_ID`). Ignora os outros.
- O relatório do incidente (`shared/relatorio.ts`) leva um botão **Desfazer <passo>** por passo feito: `callback_data` = `desfazer:<pedidoId>`, chega por `telegram.aoDesfazer`.
- Os bots não recebem mensagens de outros bots: a conversa entre agentes passa pelo bus interno e cada bot só publica a sua parte.
- Comandos: `/estado` (o que está pendente e feito), `/desfazer <pedidoId>`.
- Espelhar o ecrã do telemóvel no pitch (ou Telegram Desktop no portátil da apresentação).
