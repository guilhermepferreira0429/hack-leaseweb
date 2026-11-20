# Migrate without being exposed

Built from scratch at the Leaseweb InfraHack hackathon (20 November 2026).

## The problem

Leaving a hyperscaler is mostly a data and confidence problem: will my app still work, and is my data intact? There is a second, quieter risk. During a rushed migration, new VMs often come up with databases and admin ports reachable from the whole internet. Small companies don't lack alerts; nobody reads them. The product is the fix, not the alert.

## How it works

Agents run on the Leaseweb Public Cloud and talk to the owner in a Telegram group, one bot per agent:

1. **Migrator**: reads a sample app that uses AWS services, simulated locally with LocalStack and containers. It proposes open alternatives on Leaseweb and, after a single "Aprovar plano" tap from the owner, migrates five services live, each with proof (counts and checksums): S3 → MinIO, RDS Postgres → PostgreSQL, SQS → RabbitMQ, Secrets Manager/SSM → OpenBao and ElastiCache Redis → Valkey. DynamoDB, SNS and CloudWatch Logs stay in the plan only (next phase). It runs the same tests before and after.
2. **Attacker**: as soon as the new infrastructure is up, it checks **our own VMs only** with short TCP connections to the sensitive ports. It looks for open ports, exposed services and factory-default credentials, and has a limited SSH password step (at most 20 attempts, one allowlisted target, only on `/atacar`). Targets come from a closed IP allowlist; anything else is refused. nmap is only used by the defender to confirm a port is closed.
3. **Defender**: combines the attacker's findings with security group rules read from the Leaseweb API. An EU-hosted LLM (OpenAI-compatible API, e.g. TensorX or sference) explains each finding in three plain sentences. The defender then asks the owner in Telegram. Once approved, it removes only the offending firewall rule through the Leaseweb API, re-reads to confirm, and stores the inverse in a JSONL audit log. `/desfazer` restores it.
4. **Chief**: coordinates and sums up with real numbers.

After the defence, the migrator also fixes the cause in the code: it opens a pull request on the sample app's public repo (`hack-leaseweb-exemplo-app`, branch `migracao/leaseweb-<time>`) that points the app at Leaseweb and corrects the Terraform rule that left the database open. The owner merges it with "Aprovar PR" in Telegram; `/desfazer` opens a revert PR. The real PR only happens with `MIGRADOR_PR=real` and a token in an environment variable; otherwise it is a dry run.

Agents talk to each other over an internal bus; Telegram is the stage. A small dashboard shows the timeline: **migrate → attack → approve → close**.

See [`docs/`](docs/README.md), starting with [`docs/plano.md`](docs/plano.md) and [`docs/arquitetura.md`](docs/arquitetura.md).

## Build and run

Requirements: Node.js 22+, npm 10+, Docker, nmap.

```bash
npm install
cp env/.env.example .env          # fill in your own keys; .env is git-ignored
npm run typecheck
npm test

npm run infra:up                  # 8 containers on 127.0.0.1: LocalStack, Postgres (source and target),
                                  # MinIO, RabbitMQ, Redis (source), Valkey, OpenBao

npm run demo                      # prepares the demo, then starts the orchestrator
npm run dev                       # orchestrator: all agents + dashboard in one process
npm run dev -- --consola --uma-vez  # rehearsal: the terminal plays Telegram, exits after one cycle
npm run dev -- --sem-migrador     # cuts: --sem-migrador, --sem-atacante, --sem-fila, --sem-segredos, --sem-cache

# run a single piece while developing
npm run dev:painel                # dashboard on :3000 (/, /isco, /estado.json)
npm run dev:migrador
npm run dev:atacante -- <ip>      # refused unless the IP is in ALVOS_PERMITIDOS
npm run dev:defesa
npm run dev:exemplo
```

## Safety

- **The AI only writes text.** Actions come from a closed list in code (`remover_regra`, `migrar`, `aprovar_pr`); model output is never executed.
- **Nothing runs without a human.** Every change needs an approval tap from the owner (`TELEGRAM_DONO_ID`) or a listed approver (`TELEGRAM_APROVADORES`); everyone else is ignored. The one exception is night mode: if the owner does not answer about a critical finding in time, the defender applies a temporary, reversible fix (the port only for known IPs), and only for critical findings.
- **Every action stores its inverse** in `auditoria.jsonl`, so it can always be undone.
- **Smallest possible change.** The defender removes a single rule and re-reads to confirm. It never swaps a whole security group, because that would replace every rule.
- **The attacker is fenced.** It touches only literal IPs listed in `ALVOS_PERMITIDOS` and refuses anything else. It does no exploitation and no writes. Its SSH password step is capped at 20 attempts against one allowlisted target and stops at the first login.
- **No secrets in the repo.** All keys live in `.env`, which is git-ignored.
- **If the LLM fails** (no provider, error, or more than 20 s), a backup provider is tried. If that fails too, a fixed explanation per finding type is used, so the demo never waits on the AI.
- **Data stays in the EU**: Leaseweb EU region and EU LLM providers.

## Repository layout

```
code/
  index.ts      orchestrator (single Node process)
  shared/       types, bus, Leaseweb client, LLM client, Telegram, audit log, state
  chefe/        chief agent: summaries
  migrador/     analyse, migrate 5 services with proof, verify; tradutor/ (Terraform -> Leaseweb plan,
                destination decider, Terraform fix); codigo/ (pull request on the app's repo)
  atacante/     TCP recon, limited SSH password step, target allowlist
  defesa/       detect, explain, approve, fix, undo
  painel/       HTTP dashboard: /, /isco, /estado.json
  exemplo-app/  sample app using AWS services, with seed data and tests
docs/           plan, architecture, interfaces, demo, pitch, risks
env/            .env.example, docker-compose.yml
```

## License

[Apache License 2.0](LICENSE)
