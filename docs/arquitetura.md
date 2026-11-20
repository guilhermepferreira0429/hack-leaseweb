# Architecture (lab layout)

Public overview: [`ARCHITECTURE.md`](ARCHITECTURE.md). This file is the team's lab layout.

## Machines (Leaseweb, EU region)

| VM          | Purpose                                                                     | Setup                                                                                                                                                        |
| ----------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **cérebro** ("brain") | Runs the service (agents + dashboard), LocalStack and the demo MinIO | SSH by key only and only from our IP; dashboard port open to our IP only                                                                                     |
| **vítima** ("victim") | The demo's flaw                                                      | Security group with `5432/tcp` open to `0.0.0.0/0` and a harmless listener (`nc -lk 5432`) so that `nmap` shows `open` before and `filtered` after |
| **isco** ("honeypot") | The number that opens the pitch                                      | Turned on in the morning. SSH by key only, port 22 open to everyone, no real service                                                                         |

## Split: the owner's server and the cloud provider

These are two different layers. They do not mix.

1. **The VM is the SME owner's server (self-hosted).** It runs the app and the open services that replace AWS:
   MinIO (S3), PostgreSQL (RDS), RabbitMQ (SQS), OpenBao (Secrets Manager) and Valkey (ElastiCache). In the demo
   they run in containers. The migrator copies the data there, the attacker tests that machine and the defence
   protects it. It is the same VM an owner would have at Leaseweb, Hostinger, OVHcloud or anywhere else.
2. **The Leaseweb API is the provider.** It only handles what surrounds the machine: instances and the firewall
   (security groups and rules). The defence closes ports through it and the translator turns the AWS
   configuration into it. It is one provider among several: Hostinger, OVHcloud, Hetzner or Scaleway would each
   have their own adapter, with the same operations.

| Layer           | In the demo                                                                     | At a real customer               |
| --------------- | ------------------------------------------------------------------------------- | -------------------------------- |
| Owner's server  | VM with the containers (MinIO, PostgreSQL, RabbitMQ, OpenBao, Valkey) and the app | The SME's VPS or server          |
| Provider        | Leaseweb API: instances and firewall                                            | Leaseweb, Hostinger, OVHcloud, … |
| Source "AWS"    | LocalStack (plus a Redis standing in for ElastiCache)                           | The customer's AWS account       |

Rules for the code:

- Everything that talks to the provider API lives in `code/shared/leaseweb.ts` (`listarSecurityGroups`,
  `listarRegras`, `removerRegra`, `criarRegra`, …). The defence, the orchestrator and the chief use these functions
  and never call the API directly. Another provider would be another file with the same functions.
- What runs inside the VM (services, data, the app and its tests) does not depend on the provider: the migrator and
  `verificar()` are the same on any of them.
- Today only the Leaseweb adapter exists. Hostinger and OVHcloud are for the "what comes next" slide. The pitch does
  not claim they already work.

## The organisers' VM (check at 09:30, Enio Carlos, 10 min)

The organisers give each team one Linux VM, switched off at the end of the event. Before creating other machines, check:

1. **Resources:** `nproc`, `free -h`, `df -h`, `cat /etc/os-release`. Can it run Node, Docker, LocalStack and MinIO together?
2. **Network:** public IP, Internet egress (`curl -I https://api.telegram.org`), open ports.
3. **Docker:** installed or installable.
4. **The most important one:** does it show up in the Leaseweb API with our key (`GET /instances`), and can we change its security group?

Decision:

| Result                          | Role of the VM                                                                                                        |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Shows up in the API, has resources | **Victim** (saves a machine), or brain and victim at the same time                                                 |
| Does not show up in the API     | **Brain** (agents, LocalStack, MinIO). The victim is created in our account, because the demo depends on closing the port through the API |
| Underpowered                    | **Honeypot** only                                                                                                     |

Record the result in [`leaseweb-api.md`](leaseweb-api.md), in the notes.

## Containers (Enio Carlos sets them up, everyone uses them)

All on the **brain**, in separate containers, defined in `env/docker-compose.yml`:

| Container          | Stands in for                                               | Port (127.0.0.1 only) |
| ------------------ | ----------------------------------------------------------- | --------------------- |
| `localstack`       | Simulated "AWS": S3, SQS, Secrets Manager and SSM (the source) | 4566               |
| `postgres`         | Database of `exemplo-app` (stands in for RDS, the source)   | 5433                  |
| `postgres-destino` | RDS destination at Leaseweb                                 | 5434                  |
| `minio`            | S3 destination at Leaseweb                                  | 9000 and console 9001 |
| `rabbitmq`         | SQS queue destination at Leaseweb                           | 5672 and console 15672 |
| `redis-origem`     | Stands in for ElastiCache Redis (the source)                | 6380                  |
| `valkey`           | ElastiCache destination at Leaseweb                         | 6381                  |
| `openbao`          | Secrets destination (Secrets Manager and SSM) at Leaseweb   | 8200                  |

```bash
# on the brain, at the repo root, with .env filled in
npm run infra:up      # starts the 8 containers
docker compose -f env/docker-compose.yml ps
npm run infra:down    # stops them
```

- Everything is bound to `127.0.0.1` only: the brain exposes nothing by mistake.
- The **victim is always another VM**, with its own security group: its port is the one the attacker finds and the defence closes through the API. It cannot be the brain, because a connection from a machine to itself does not go through the security group.
- If the organisers' VM is spare, it can host `localstack` (the "AWS"), to show the move from one machine to another.
- In the pitch: "we simulated AWS with LocalStack".

## Flow

```
            ┌──────────────── brain ─────────────────┐
 "AWS"      │                                        │
 LocalStack │  migrator ──► MinIO / Postgres /       │
 + Redis    │     │   RabbitMQ / OpenBao / Valkey    │
            │     │ plan + "Approve plan" ───────────────► Telegram (owner)
            │     ▼ done                             │        │ Approve / Close
            │  attacker ──► TCP connect to ALVOS only ────► victim
            │     │ findings                         │        │
            │     ▼                                  │        │
            │  defence ──► LLM (TensorX/sference)    │        │
            │     │ explanation + "Close?" ───────────────────┘
            │     ▼ approved                         │
            │  Leaseweb API: remove rule, re-read    │
            │  nmap: filtered · auditoria.jsonl      │
            │  migrator ──► PR that fixes the cause  │
            │  dashboard: timeline + Undo            │
            └────────────────────────────────────────┘
```

A single Node process on the brain: an orchestrator calls the modules and the dashboard reads the state and the audit log. Simple to run and to show.

The agents talk to each other over an internal bus (`shared/bus.ts`). Telegram is only the stage: each agent has its own bot and posts its line in the "Direção" group. See [`agentes-telegram.md`](agentes-telegram.md).

## Folders

```
code/
  shared/      tipos.ts, bus.ts, leaseweb.ts, llm.ts, telegram.ts, auditoria.ts, estado.ts,
               voz.ts (agent voices), mensagens.ts (fixed demo texts), relatorio.ts
  chefe/       resumo.ts, certificado.ts (coordinates, summarises and writes the certificate)
  migrador/    analisar.ts, migrar-dados.ts (S3), migrar-postgres.ts, migrar-fila.ts,
               migrar-segredos.ts, migrar-cache.ts, verificar.ts
    tradutor/  Terraform -> Leaseweb plan, destination decider, Terraform fix
    codigo/    finds the AWS usages in the app and opens the PR that fixes the cause
  atacante/    alvos.ts, reconhecimento.ts (TCP connect), index.ts (SSH password step),
               credenciais.ts, segredos.ts, extras.ts
  defesa/      detetar.ts, explicar.ts, aprovar.ts, corrigir.ts, desfazer.ts, modo-noite.ts,
               verificar-porta.ts (nmap)
  painel/      servidor.ts (/, /isco, /estado.json), linha-tempo.ts, certificado.ts
  exemplo-app/ small app that uses AWS services, with sample data and tests
  index.ts     orchestrator entry point (wires the modules); orquestrador.ts (the logic)
```

## Sensitive ports

High severity: 22 SSH, 23 Telnet, 445 SMB, 1433 SQL Server, 3306 MySQL, 3389 RDP, 5432 PostgreSQL, 5984 CouchDB, 6379 Redis, 9200 Elasticsearch, 27017 MongoDB. Any other port open to the whole Internet: medium.

## AI

- OpenAI-compatible API client, configured through `.env` (`LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`), for TensorX or sference, both in the EU.
- At most 3 sentences and 600 characters, plain English: what is open, what an attacker could do, what happens if the owner approves.
- 20 s timeout. If it fails, a fixed text per service. The demo never waits for the AI.
