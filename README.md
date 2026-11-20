# Migrate without being exposed

Built from scratch at the Leaseweb InfraHack hackathon (20 November 2026).

## The problem

Leaving a hyperscaler is mostly a data and confidence problem: will my app still work, and is my data intact? There is a second, quieter risk. During a rushed migration, new VMs often come up with databases and admin ports reachable from the whole internet. Small companies don't lack alerts; nobody reads them. The product is the fix, not the alert.

## How it works

Agents run on the Leaseweb Public Cloud and talk to the owner in a Telegram group, one bot per agent:

1. **Migrator**: reads a sample app that uses AWS S3, Postgres (RDS) and SQS, simulated locally with LocalStack. It proposes open alternatives on Leaseweb and, once the owner approves, copies S3 to MinIO with SHA-256 checksum verification. It runs the same tests before and after.
2. **Attacker**: as soon as the new infrastructure is up, it runs non-destructive reconnaissance with nmap against **our own VMs only**. It looks for open ports, exposed services and factory-default credentials. Targets come from a closed IP allowlist; anything else is refused.
3. **Defender**: combines the attacker's findings with security group rules read from the Leaseweb API. An EU-hosted LLM (OpenAI-compatible API, e.g. TensorX or sference) explains each finding in three plain sentences. The defender then asks the owner in Telegram. Once approved, it removes only the offending firewall rule through the Leaseweb API, re-reads to confirm, and stores the inverse in a JSONL audit log. `/desfazer` restores it.
4. **Chief**: coordinates and sums up with real numbers.

Agents talk to each other over an internal bus; Telegram is the stage. A small dashboard shows the timeline: **migrate → attack → approve → close**.

See [`docs/`](docs/README.md), starting with [`docs/plano.md`](docs/plano.md) and [`docs/arquitetura.md`](docs/arquitetura.md).

## Build and run

Requirements: Node.js 22+, npm 10+, Docker, nmap.

```bash
npm install
cp env/.env.example .env          # fill in your own keys; .env is git-ignored
npm run typecheck
npm test

npm run infra:up                  # LocalStack (S3, SQS), Postgres, MinIO on 127.0.0.1

npm run dev                       # orchestrator: all agents + dashboard in one process

# run a single piece while developing
npm run dev:painel                # dashboard on :3000 (/, /isco, /estado.json)
npm run dev:migrador
npm run dev:atacante -- <ip>      # refused unless the IP is in ALVOS_PERMITIDOS
npm run dev:defesa
npm run dev:exemplo
```

## Safety

- **The AI only writes text.** Actions come from a closed list in code (`remover_regra`, `migrar`); model output is never executed.
- **Nothing runs without a human.** Every change needs an approval tap from the owner's Telegram account (`TELEGRAM_DONO_ID`); everyone else is ignored.
- **Every action stores its inverse** in `auditoria.jsonl`, so it can always be undone.
- **Smallest possible change.** The defender removes a single rule and re-reads to confirm. It never swaps a whole security group, because that would replace every rule.
- **The attacker is fenced.** It scans only literal IPs listed in `ALVOS_PERMITIDOS` and refuses anything else. It does no exploitation, no writes and no brute force.
- **No secrets in the repo.** All keys live in `.env`, which is git-ignored.
- **If the LLM fails** (no provider, error, or more than 20 s), a backup provider is tried. If that fails too, a fixed explanation per finding type is used, so the demo never waits on the AI.
- **Data stays in the EU**: Leaseweb EU region and EU LLM providers.

## Repository layout

```
code/
  index.ts      orchestrator (single Node process)
  shared/       types, bus, Leaseweb client, LLM client, Telegram, audit log, state
  chefe/        chief agent: summaries
  migrador/     analyse, migrate S3 -> MinIO, verify (tests before and after)
  atacante/     nmap recon, target allowlist
  defesa/       detect, explain, approve, fix, undo
  painel/       HTTP dashboard: /, /isco, /estado.json
  exemplo-app/  sample app using S3, Postgres and SQS, with tests
docs/           plan, architecture, interfaces, demo, pitch, risks
env/            .env.example, docker-compose.yml
```

## License

[Apache License 2.0](LICENSE)
