# Telegram: aprovar tudo pelo Telegram

Ver também `agentes-telegram.md`: 4 bots (chefe, migrador, atacante, defesa), todos no grupo "Direção": o júri vê a cadeia migrador → atacante → defesa → chefe. Com `TELEGRAM_ATACANTE_PRIVADO=sim`, o atacante passa a falar só em privado com o dono.

Long polling, sem webhook: não precisa de domínio nem HTTPS público.

## Montagem (David, 09:30, cerca de 15 min)

1. No Telegram, falar com `@BotFather` → `/newbot` quatro vezes (chefe, migrador, atacante, defesa) → guardar os tokens em `TELEGRAM_TOKEN_*`. No chefe, migrador e defesa, `/setprivacy` → Disable (têm de ler o grupo). O **atacante não lê o grupo** (só publica): o privacy dele pode ficar ligado.
   Criar o grupo "Direção" e adicionar **os 4 bots e o dono**. O dono manda também `/start` em privado ao bot atacante (para o modo `TELEGRAM_ATACANTE_PRIVADO=sim`).
2. O "dono" da demo envia `/start` ao bot.
3. `curl https://api.telegram.org/bot<TOKEN>/getUpdates` → copiar o `chat.id` do grupo para `TELEGRAM_GRUPO_ID` e o `from.id` do dono para `TELEGRAM_DONO_ID`.
4. Teste com botões:

```bash
curl -s https://api.telegram.org/bot$TELEGRAM_TOKEN_DEFESA/sendMessage \
  -H 'Content-Type: application/json' \
  -d '{"chat_id":'$TELEGRAM_GRUPO_ID',"text":"Teste","reply_markup":{"inline_keyboard":[[{"text":"Aprovar","callback_data":"aprovar:teste"},{"text":"Ignorar","callback_data":"ignorar:teste"}]]}}'
```

## Teste de fumo (3 minutos, com os 4 bots)

`npm run telegram:smoke` lê `env/.env` (ou `.env` na raiz) e testa todos os bots que tiverem token. Chaves de que precisa:

| Chave                     | O que pôr                                                                                | Obrigatória                |
| ------------------------- | ---------------------------------------------------------------------------------------- | -------------------------- |
| `TELEGRAM_TOKEN_DEFESA`   | token do bot da defesa (BotFather). Sem ele usa o primeiro `TELEGRAM_TOKEN_*` que houver | sim (um token basta)       |
| `TELEGRAM_TOKEN_CHEFE`    | token do bot do chefe; o teste valida-o como aos restantes                               | recomendado (os 4 na demo) |
| `TELEGRAM_TOKEN_MIGRADOR` | token do bot do migrador                                                                 | recomendado (os 4 na demo) |
| `TELEGRAM_TOKEN_ATACANTE` | token do bot do atacante                                                                 | recomendado (os 4 na demo) |
| `TELEGRAM_GRUPO_ID`       | `chat.id` do grupo "Direção" (negativo, normalmente `-100…`)                             | sim                        |
| `TELEGRAM_APROVADORES`    | `from.id` de quem pode aprovar, separados por vírgula                                    | sim, ou `TELEGRAM_DONO_ID` |
| `TELEGRAM_DONO_ID`        | `from.id` do dono; usado se `TELEGRAM_APROVADORES` estiver vazio                         | ver acima                  |

Montagem rápida:

1. `@BotFather` → `/newbot` → nome `Defesa`, username a acabar em `bot` → copiar o token para `TELEGRAM_TOKEN_DEFESA` em `env/.env`. Repetir para chefe, migrador e atacante (`TELEGRAM_TOKEN_CHEFE`, `TELEGRAM_TOKEN_MIGRADOR`, `TELEGRAM_TOKEN_ATACANTE`). No chefe, migrador e defesa: `/setprivacy` → escolher o bot → `Disable`. O atacante não lê o grupo; o privacy dele pode ficar ligado.
2. Criar o grupo "Direção", adicionar **os 4 bots** e o dono. Escrever qualquer mensagem no grupo.
3. `curl -s https://api.telegram.org/bot<TOKEN>/getUpdates`: o `message.chat.id` do grupo vai para `TELEGRAM_GRUPO_ID` e o `message.from.id` do dono vai para `TELEGRAM_APROVADORES`. Resposta vazia: escrever outra vez no grupo e repetir.
4. `npm run telegram:smoke` e, quando aparecer `>>> Carrega em Aprovar plano ou em Ignorar`, carregar no telemóvel com a conta do aprovador (120 s).

O teste imprime PASS/FAIL para: (config) os 4 tokens presentes, (a) `getMe` em cada bot, uma fala de cada bot no grupo e `getUpdates` sem 409 por bot, (b) pedido com os botões do tipo de ação (Aprovar plano / Ignorar na migração), (c) recusa a um ID fora da lista (simulada, sem rede) e toque real do aprovador, (d) `editMessageReplyMarkup` a tirar os botões, (e) relatório de exemplo com Desfazer no grupo, (f) toques reais nos botões Desfazer do relatório (espera 60 s, todos respondem). Não mexe em `auditoria.jsonl` nem em infraestrutura. O token nunca é impresso.

Nos passos (c)/toque e (f), carregar com a conta de um aprovador quando aparecer o `>>>`. Os botões (Aprovar plano, Fechar, Ignorar, Desfazer) só respondem enquanto o teste corre: depois de sair, o polling para e um toque fica sem resposta (na demo o orquestrador está sempre a correr).

Se falhar:

- `getUpdates: Conflict`: outro processo (o orquestrador, outro portátil) está a fazer polling ao mesmo bot. Parar o outro.
- `chat not found`: o `TELEGRAM_GRUPO_ID` está errado, ou o bot (o smoke diz qual) não está no grupo. Os 4 bots têm de estar no grupo; com `TELEGRAM_ATACANTE_PRIVADO=sim`, o atacante precisa de conversa privada com o dono (abrir o bot e mandar `/start`).
- (c) "ninguém carregou a tempo": o `from.id` de quem carregou não está em `TELEGRAM_APROVADORES` (aparece no log como `callback_query de <id>`).

## Comportamento

- Cada pedido chega com título, explicação e os botões do tipo de ação: **Approve plan** / **Ignore** na migração, **Close** / **Ignore** na defesa e **Approve PR** / **Ignore** no PR (textos de `shared/mensagens.ts`). `callback_data` = `aprovar:<pedidoId>` ou `ignorar:<pedidoId>`.
- Ao carregar: `answerCallbackQuery` e editar a mensagem com o resultado ("Fechado e confirmado às 14:02").
- Só aceita ordens e botões de `TELEGRAM_APROVADORES` (por defeito o `TELEGRAM_DONO_ID`). Ignora os outros.
- O relatório do incidente (`shared/relatorio.ts`) leva um botão **Desfazer <passo>** por passo feito: `callback_data` = `desfazer:<pedidoId>`, chega por `telegram.aoDesfazer`.
- Os bots não recebem mensagens de outros bots: a conversa entre agentes passa pelo bus interno e cada bot só publica a sua parte.
- Comandos: `/estado` (o que está pendente e feito), `/desfazer <pedidoId>` e `/atacar [ip]` (abaixo).
- Espelhar o ecrã do telemóvel no pitch (ou Telegram Desktop no portátil da apresentação).

## `/atacar [ip]`: a sequência do atacante

`/atacar` no grupo (ou em privado ao bot do atacante) arranca a sequência; o atacante relata os passos no grupo
(ou em privado, com `TELEGRAM_ATACANTE_PRIVADO=sim`). Sem `ip`, usa o primeiro alvo de `ALVOS_PERMITIDOS`.
Ao aprovar o plano de migração, o atacante arranca sozinho, em paralelo com a cópia, **em rondas**: anuncia o
que encontrou (reconhecimento, SSH, extras) e a defesa deteta e pede aprovação antes da tentativa seguinte.

1. `⚔️ Ataque iniciado contra <alvo>`
2. `👁️ Reconhecimento: …` — ligações TCP às 13 portas sensíveis de `PORTAS_ALVO` (SSH, bases de dados,
   Redis, Elasticsearch, RDP, …); `ATACANTE_IGNORAR_PORTAS` tira portas. Só ao alvo permitido.
3. `✅/❌ SSH: …` — adivinhação de palavra-passe limitada: no máximo 5 tentativas, pausa de 800 ms, para na
   primeira entrada. A palavra-passe nunca é publicada; só o utilizador e o número de tentativas.
4. `🧪 Extras: …` — só com `ATACANTE_EXTRAS=1`: TLS/cabeçalhos, credenciais de fábrica, bucket público e
   segredos no código da app de exemplo. Tudo de leitura.
5. `✅ Ataque terminado`

Travas (não são opcionais):

- **Allowlist:** só IPs de `ALVOS_PERMITIDOS`. Lista vazia → `allowlist vazia, ataque recusado`. Alvo fora da
  lista → `alvo recusado (fora da allowlist): <alvo>` e nunca é contactado. A guarda (`garantirPermitido`)
  repete-se antes de cada ligação, não é uma verificação única no início.
- **Um de cada vez:** com um ataque a decorrer, outro `/atacar` responde `ataque já em curso`.
- **Permissão:** só `TELEGRAM_DONO_ID` ou `TELEGRAM_APROVADORES`; qualquer outro `from.id` recebe `sem permissão`.
- **Nada destrutivo:** sem sudo, sem persistência e sem escrever no alvo; o `auth.log` prova as tentativas.

Para ensaiar sem Telegram: `npm run dev:atacante -- <ip>` (reconhecimento), `-- --ssh <ip>` (força bruta),
`-- --extras <ip>` (nível B) ou `-- --segredos [pasta]`.
