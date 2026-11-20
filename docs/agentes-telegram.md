# Talking to the agents on Telegram

The owner is not talking to a system: they are talking to a team. Each agent has its own bot and personality, and the agents talk to each other in front of the owner.

## The bots

| Bot          | Role                                                | Talks about                                         |
| ------------ | --------------------------------------------------- | --------------------------------------------------- |
| **Chief**    | Coordinates; summarises; asks the owner the final question | Overall status, pending decisions             |
| **Migrator** | Plans and runs the migration                        | Services found, plan, progress, proof               |
| **Attacker** | Tests the new infrastructure                        | What it found, and how severe it is                 |
| **Defense**  | Explains and fixes                                  | Risk in plain English, proposed action, confirmation |

## Three ways to talk

1. **The "Direção" group** with the owner and the 4 bots. Here the agents talk to each other and the owner sees the whole chain.
2. **A private chat with each bot.** The owner opens the Migrator and talks only about the migration, or the Defense and talks only about security.
3. **In the group, with a mention.** `@defesa_bot what is open right now?` gets an answer from that agent only.

## Sample group conversation (the demo)

> **Migrator:** Where should the data go? I recommend Leaseweb, with managed services where it makes sense. [Recommended] [Self-hosted] [Why?]
> _(owner picks Recommended)_
> **Migrator:** I found 5 AWS services in the app: S3, RDS Postgres, SQS, Secrets Manager and ElastiCache. I propose MinIO, PostgreSQL, RabbitMQ, OpenBao and Valkey on Leaseweb. DynamoDB, SNS and Logs are left for the next phase. [Approve plan] [Ignore]
> _(owner approves)_
> **Migrator:** All 5 services moved, each with proof: equal counts and checksums, tests passing on both sides. @attacker, the new infrastructure is live.
> **Attacker:** Got it. The new database answers anyone on the Internet, port 5432. High severity. @defense
> **Defense:** The database with your customers' data is open to the whole Internet. Anyone can try to get in. I propose closing outside access and leaving only your app. [Close] [Ignore]
> _(owner taps Close)_
> **Defense:** Closed at 14:02 and confirmed: port filtered. I stored how to roll it back. @attacker, can you confirm?
> **Attacker:** Confirmed. I can no longer reach it.
> **Chief:** Migration finished and secure. 1 issue found and closed in 40 seconds. Nothing left the EU.

The numbers in this example are illustrative. The demo uses the real values of the day.

## Is this possible on Telegram? Yes, with one caveat

- **Telegram bots do not receive messages from other bots.** So the conversation between agents **does not go through Telegram**: it goes through our orchestrator (an internal bus). Telegram is the stage: each agent posts its line in the group with its own bot.
- A single Node process manages the 4 tokens. When one agent "talks" to another, the orchestrator delivers the message internally and each bot posts its part in the group, with 1 to 2 seconds between lines so they are easy to read.
- For the bots to read what the owner writes in the group: turn off each bot's **privacy mode** in BotFather (`/setprivacy` → Disable), or use mentions and commands.
- Only orders and buttons from `TELEGRAM_DONO_ID` (or `TELEGRAM_APROVADORES`) are accepted. Everything else is ignored.
- The buttons (Recommended, Self-hosted, Why?, Approve plan, Close, Approve PR, Ignore) are an `inline_keyboard`; the answer arrives as a `callback_query` on the bot that asked.

## Levels

- **A:** a single bot (Defense) asking for approval. The minimum for the demo.
- **B:** the 4 bots in the group, with the conversation between agents staged by the orchestrator.
- **B:** a private chat with each bot, with AI answers in the role of each agent.
- **C:** the Chief runs a weekly meeting: summary, costs and at most 3 decisions.
