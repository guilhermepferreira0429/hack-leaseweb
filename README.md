# Migrate without being exposed

Built from scratch at the Leaseweb InfraHack hackathon (20 November 2026).

## The problem

Leaving a hyperscaler is mostly a data and confidence problem: will my app still work, and is my data intact? There is a second, quieter risk. During a rushed migration, new VMs often come up with databases, object stores and admin consoles reachable from the whole internet. Most teams find out when someone else does.

## How it works

Three agents run on the Leaseweb Public Cloud:

1. **Migrator**: reads a sample app that uses AWS S3, RDS Postgres and SQS (simulated locally with LocalStack). It proposes open alternatives on a Leaseweb VM (MinIO, Postgres, RabbitMQ), copies the data with SHA-256 checksum verification, and runs the same test suite before and after.
2. **Attacker**: as soon as the new infrastructure is up, it runs non-destructive reconnaissance against **our own VMs only**. It checks for open ports, exposed services and factory-default credentials, then reports findings. Targets come from a closed IP allowlist; anything else is refused.
3. **Defender**: combines the attacker's findings with the security group rules read from the Leaseweb API. An EU-hosted LLM (OpenAI-compatible API, e.g. TensorX or sference) explains each finding in three plain sentences. The defender then asks for approval on WhatsApp (Telegram as fallback). Once approved, it removes only the offending firewall rule through the Leaseweb API, re-reads to confirm, and stores the inverse in a JSONL audit log. One tap on **Undo** restores the rule.

A small dashboard shows the timeline: **migrate → attack → approve → close**.

See [`docs/architecture.md`](docs/architecture.md) for the diagram and full flow.

## Build and run

Requirements: Node.js 22+, npm 10+, Docker (for the simulated AWS source).

```bash
npm install
cp env/.env.example env/.env      # fill in your own keys; env/.env is git-ignored
npm run typecheck
npm test

npm run origem:up                 # LocalStack (S3, SQS) + Postgres acting as RDS

npm run dev:painel                # dashboard + webhook on :8080
npm run dev:migrador              # migrate the sample app
npm run dev:atacante              # recon against ALVOS_PERMITIDOS only
npm run dev:defesa                # detect, explain, request approval
```

VM layout (`cerebro`, `vitima`, `isco`) and environment variables: [`env/README.md`](env/README.md).

## Safety

- **The AI only writes text.** The LLM produces a three-sentence explanation. Actions come from a closed list in code (`remover-regra`, `repor-regra`); model output is never executed.
- **Nothing runs without a human.** Every change needs an approval tap from an allowlisted WhatsApp number or Telegram chat. Webhooks are signature-checked.
- **Every action stores its inverse** in `auditoria.jsonl` before it is applied, so Undo is always possible.
- **Smallest possible change.** The defender removes a single rule, only in security groups we manage, then re-reads to confirm.
- **The attacker is fenced.** It contacts only literal IPs listed in `ALVOS_PERMITIDOS` and refuses and logs anything else. It does no exploitation, no writes and no brute force (one attempt per well-known default credential).
- **No secrets in the repo.** All keys live in `env/.env`, which is git-ignored.
- **If the LLM fails** (no provider configured, error, or more than 20 s), a fixed explanation per finding type is used, and the approval flow still works.

## Repository layout

```
code/
  shared/       common types, Leaseweb client, LLM client, audit log
  migrador/     analyse, copy data, verify (tests before and after)
  atacante/     recon, target allowlist
  defesa/       detect, explain, approve, fix, undo
  painel/       HTTP server: /, /isco, /webhook
  exemplo-app/  sample app using S3, Postgres and SQS, with tests
docs/           architecture, demo script, plan
env/            .env.example, docker-compose files, VM notes
```

## License

[Apache License 2.0](LICENSE)
