# Telegram: approve everything from Telegram

See also `agentes-telegram.md`: 4 bots (chief, migrator, attacker, defense), all in the "Direção" group, so the jury sees the chain migrator → attacker → defense → chief. With `TELEGRAM_ATACANTE_PRIVADO=sim`, the attacker talks to the owner only in a private chat.

Long polling, no webhook: no domain or public HTTPS needed.

## Setup (David, 09:30, about 15 min)

1. In Telegram, talk to `@BotFather` → `/newbot` four times (chief, migrator, attacker, defense) → store the tokens in `TELEGRAM_TOKEN_*`. For the chief, migrator and defense bots, `/setprivacy` → Disable (they must read the group). The **attacker does not read the group** (it only posts), so its privacy mode can stay on.
   Create the "Direção" group and add **the 4 bots and the owner**. The owner also sends `/start` to the attacker bot in a private chat (for `TELEGRAM_ATACANTE_PRIVADO=sim` mode).
2. The demo "owner" sends `/start` to the bot.
3. `curl https://api.telegram.org/bot<TOKEN>/getUpdates` → copy the group's `chat.id` into `TELEGRAM_GRUPO_ID` and the owner's `from.id` into `TELEGRAM_DONO_ID`.
4. Test with buttons:

```bash
curl -s https://api.telegram.org/bot$TELEGRAM_TOKEN_DEFESA/sendMessage \
  -H 'Content-Type: application/json' \
  -d '{"chat_id":'$TELEGRAM_GRUPO_ID',"text":"Test","reply_markup":{"inline_keyboard":[[{"text":"Approve","callback_data":"aprovar:teste"},{"text":"Ignore","callback_data":"ignorar:teste"}]]}}'
```

## Smoke test (3 minutes, with the 4 bots)

`npm run telegram:smoke` reads `env/.env` (or `.env` at the root) and tests every bot that has a token. Keys it needs:

| Key                       | What to set                                                                                   | Required                       |
| ------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------ |
| `TELEGRAM_TOKEN_DEFESA`   | defense bot token (BotFather). Without it, the first `TELEGRAM_TOKEN_*` found is used          | yes (one token is enough)      |
| `TELEGRAM_TOKEN_CHEFE`    | chief bot token; the test checks it like the others                                          | recommended (all 4 for the demo) |
| `TELEGRAM_TOKEN_MIGRADOR` | migrator bot token                                                                            | recommended (all 4 for the demo) |
| `TELEGRAM_TOKEN_ATACANTE` | attacker bot token                                                                            | recommended (all 4 for the demo) |
| `TELEGRAM_GRUPO_ID`       | `chat.id` of the "Direção" group (negative, usually `-100…`)                                  | yes                            |
| `TELEGRAM_APROVADORES`    | `from.id` of whoever may approve, comma-separated                                             | yes, or `TELEGRAM_DONO_ID`     |
| `TELEGRAM_DONO_ID`        | the owner's `from.id`; used when `TELEGRAM_APROVADORES` is empty                              | see above                      |

Quick setup:

1. `@BotFather` → `/newbot` → name `Defesa`, username ending in `bot` → copy the token into `TELEGRAM_TOKEN_DEFESA` in `env/.env`. Repeat for chief, migrator and attacker (`TELEGRAM_TOKEN_CHEFE`, `TELEGRAM_TOKEN_MIGRADOR`, `TELEGRAM_TOKEN_ATACANTE`). For chief, migrator and defense: `/setprivacy` → pick the bot → `Disable`. The attacker does not read the group; its privacy mode can stay on.
2. Create the "Direção" group, add **the 4 bots** and the owner. Post any message in the group.
3. `curl -s https://api.telegram.org/bot<TOKEN>/getUpdates`: the group's `message.chat.id` goes into `TELEGRAM_GRUPO_ID` and the owner's `message.from.id` into `TELEGRAM_APROVADORES`. Empty response: post in the group again and repeat.
4. `npm run telegram:smoke` and, when the `>>>` prompt asks you to press Approve plan or Ignore, press it on the phone with the approver's account (120 s).

The test prints PASS/FAIL for: (config) all 4 tokens present, (a) `getMe` on each bot, one message from each bot in the group and `getUpdates` without a 409 per bot, (b) a request with the buttons for its action type (Approve plan / Ignore for the migration), (c) rejection of an ID outside the list (simulated, no network) and a real tap by the approver, (d) `editMessageReplyMarkup` removing the buttons, (e) a sample report with Undo buttons in the group, (f) real taps on the report's Undo buttons (waits 60 s, all of them answer). It does not touch `auditoria.jsonl` or any infrastructure. The token is never printed.

In steps (c)/tap and (f), press with an approver's account when the `>>>` prompt appears. The buttons (Approve plan, Close, Ignore, Undo) only answer while the test is running: once it exits, polling stops and a tap gets no answer (in the demo the orchestrator is always running).

If it fails:

- `getUpdates: Conflict`: another process (the orchestrator, another laptop) is polling the same bot. Stop the other one.
- `chat not found`: `TELEGRAM_GRUPO_ID` is wrong, or the bot (the smoke test says which) is not in the group. All 4 bots must be in the group; with `TELEGRAM_ATACANTE_PRIVADO=sim`, the attacker needs a private chat with the owner (open the bot and send `/start`).
- (c) "nobody pressed in time": the `from.id` of whoever pressed is not in `TELEGRAM_APROVADORES` (it shows in the log as `callback_query de <id>`).

## Behaviour

- The first question is where the data goes: the migrator's recommendation arrives with three buttons, **Recommended** / **Self-hosted** / **Why?** (`callback_data` = `escolha:<value>`). **Why?** explains the rules, the budget and the Leaseweb API calls that would be made (simulated only). The commands `/recomendado`, `/selfhosted` and `/why` still work; without buttons (console mode) the text lists the commands.
- Each request arrives with a title, an explanation and the buttons for its action type: **Approve plan** / **Ignore** for the migration, **Close** / **Ignore** for the defense and **Approve PR** / **Ignore** for the PR (texts in `shared/mensagens.ts`). `callback_data` = `aprovar:<pedidoId>` or `ignorar:<pedidoId>`.
- On a tap: `answerCallbackQuery`, then the message is edited with the result ("Closed and confirmed at 14:02").
- Only orders and buttons from `TELEGRAM_APROVADORES` (by default `TELEGRAM_DONO_ID`) are accepted. Everyone else is ignored.
- The incident report (`shared/relatorio.ts`) carries one **Undo <step>** button per completed step: `callback_data` = `desfazer:<pedidoId>`, delivered through `telegram.aoDesfazer`.
- Bots do not receive messages from other bots: the conversation between agents goes through the internal bus and each bot only posts its own part.
- Commands: `/status` (what is pending and done), `/undo <pedidoId>` and `/attack [ip]` (below). The old Portuguese aliases `/estado`, `/desfazer` and `/atacar` still work.
- Mirror the phone screen during the pitch (or use Telegram Desktop on the presentation laptop).

## `/attack [ip]`: the attacker's sequence

`/attack` in the group (or in a private chat with the attacker bot) starts the sequence; the attacker reports each step in the group
(or privately, with `TELEGRAM_ATACANTE_PRIVADO=sim`). Without `ip`, it uses the first target in `ALVOS_PERMITIDOS`.
When the migration plan is approved, the attacker starts on its own, in parallel with the copy, **in rounds**: it announces
what it found (reconnaissance, SSH, extras) and the defense detects it and asks for approval before the next attempt.

1. `⚔️ Attack started against <target>`
2. `👁️ Recon: …`: TCP connections to the 13 sensitive ports in `PORTAS_ALVO` (SSH, databases,
   Redis, Elasticsearch, RDP, …); `ATACANTE_IGNORAR_PORTAS` removes ports. Only to the allowed target.
3. `✅/❌ SSH: …`: limited password guessing: at most 5 attempts, an 800 ms pause, stops at the
   first successful login. The password is never posted; only the user name and the number of attempts.
4. `🧪 Extras: …`: only with `ATACANTE_EXTRAS=1`: TLS/headers, default credentials, public bucket and
   secrets in the sample app's code. All read-only.
5. `✅ Attack finished`

Safeguards (not optional):

- **Allowlist:** only IPs in `ALVOS_PERMITIDOS`. Empty list → `allowlist empty, attack refused`. A target outside the
  list → `target refused (not in allowlist): <target>` and it is never contacted. The guard (`garantirPermitido`) runs again before every connection,
  not just once at the start.
- **One at a time:** while an attack is running, another `/attack` answers `attack already running`.
- **Permission:** only `TELEGRAM_DONO_ID` or `TELEGRAM_APROVADORES`; any other `from.id` gets `No permission.`
- **Nothing destructive:** no sudo, no persistence and no writes on the target; `auth.log` proves the attempts.

To rehearse without Telegram: `npm run dev:atacante -- <ip>` (reconnaissance), `-- --ssh <ip>` (brute force),
`-- --extras <ip>` (level B) or `-- --segredos [folder]`.
