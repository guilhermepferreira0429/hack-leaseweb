# Demo runbook

A neutral, step-by-step way to reproduce the demo end to end. This is the operational script: what to reset, what
to run, and what should appear in Telegram and on the dashboard. It is not a speaking script.

The demo runs on an Ubuntu VM (the brain). The same `npm run` commands work from PowerShell on Windows; the two
shell scripts need `bash` (Git Bash or WSL).

## Before the first run

| Check                  | How                                                                                                                                                                           |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dependencies installed | `npm install` and `npm run typecheck` pass.                                                                                                                                   |
| `.env` filled          | `LSW_API_KEY`, the four `TELEGRAM_TOKEN_*`, `TELEGRAM_GRUPO_ID`, `TELEGRAM_DONO_ID`, `ALVOS_PERMITIDOS`, `LSW_SG_GERIDOS` and the LLM keys are set. No values are committed.  |
| Four bots in the group | The group "Direção" has the Chief, Migrator, Attacker and Defender bots plus the owner. Privacy mode: disabled for Chief, Migrator and Defender. The Attacker only publishes. |
| Victim VM exists       | `npm run lsw:vitima -- estado` shows the VM and its security group.                                                                                                           |
| Victim port open       | `npm run lsw:vitima -- reabrir` re-opens `5432/tcp` to the world.                                                                                                             |
| Containers up          | `npm run infra:up` and `docker compose -f env/docker-compose.yml ps` show eight `running` containers.                                                                         |
| No stale orchestrator  | On the brain, `pgrep -af "code/index.ts"` prints nothing. Two processes on the same bots cause `409 Conflict` and stolen approvals.                                           |
| `nmap` installed       | `nmap --version` works; otherwise the Defender confirms from the API instead of from outside.                                                                                 |

## 1. Reset and prepare the data

```powershell
npm run infra:up
npm run seed:limpar-destino -- --sim   # empties the target only
npm run seed                          # deterministic data on the simulated AWS side
npm run seed:comparar                 # must report 10/10
```

Or run the preparation script, which checks `.env`, starts the containers and runs the same three steps:

```bash
bash env/preparar-demo.sh
```

The source ends full and the target empty. If you ran a previous cycle, reset the app repository first:

```bash
bash env/repor-repo-app.sh --sim
```

## 2. Start the orchestrator

```powershell
npm run dev
```

The dashboard starts on `http://127.0.0.1:3000`. From another machine, open an SSH tunnel to the brain and use
`http://localhost:3000`:

```bash
ssh -L 3000:localhost:3000 ubuntu@<brain>
```

`npm run demo` does the same after preparing the data. For a rehearsal without Telegram, use:

```powershell
npm run dev -- --consola --uma-vez
```

The terminal plays the group and prints each agent's line; approve with `s`. The process exits at the end of the
cycle.

## 3. Approve the plan

In the group, the Chief opens the cycle:

> **Chief:** Good morning. We are moving the `<app>` app from AWS to Leaseweb, safely. I will report at every step.

The Migrator reads the app and posts an opening line:

> **Migrator:** I found 5 AWS services in the app: S3, PostgreSQL, SQS, Secrets Manager, ElastiCache. I ask for one OK
> for the whole plan and go one step at a time, with proof at each step.

The Terraform translation and the destination recommendation (free memory, prices with their date, the reason for
each choice) arrive just before the approval request. The request itself carries the plan and the note that a pull
request will be prepared, with the buttons **Approve plan** and **Ignore**.

If you want everything self-hosted instead of the recommendation, send `/selfhosted` before approving; send
`/recomendado` to go back. The choice is recorded in the audit log.

Tap **Approve plan**. The Chief confirms:

> **Chief:** Plan approved by the owner at `<time>`. @migrador, go ahead.

The approval covers the five copy steps; they are not asked one by one. The dashboard moves to the migration
phase.

![The jury screen at /palco](docs/media/painel-palco.png)

_The `/palco` screen during a run. **In development** — screenshot to be captured._

## 4. Watch the migration

The Migrator copies S3 → MinIO, RDS Postgres → PostgreSQL, SQS → RabbitMQ, Secrets Manager/SSM → OpenBao and
ElastiCache Redis → Valkey. Each step writes its proof to the audit log. At the end, one message summarises:

> **Migrator:** `<n>` files copied to MinIO, checksums match. Database: `<n>` tables and `<n>` rows copied to
> PostgreSQL, checksums match. … App tests passing on both sides. @atacante, the new infrastructure is live. Your
> turn.

The exact counts depend on the run. A checksum mismatch is printed as `checksums DIFFER`; the migration then
continues but the certificate warns that it is not complete.

The dashboard shows one line per agent, the proofs and the exposure clock, which starts at `infra-no-ar`. The
`/palco` screen shows the phase and the port.

## 5. The attack and the detection

The attack starts in parallel with the copy and runs in rounds. The usual order in the group is:

> **Attacker:** ⚔️ Attack started against `<victim-ip>`
>
> **Attacker:** 👁️ Recon: 1 open port(s): 5432
>
> **Attacker:** Received. It answers anyone on the Internet: PostgreSQL on port 5432 (`<victim-ip>`). Severity high.
> @defesa

The Defender correlates this with the security-group rule read from the Leaseweb API and posts a request:

> **Defender:** PostgreSQL open to the whole internet
>
> The database with the company data is open to the whole Internet. Someone outside could try to guess the
> password and get in. I propose closing outside access and allowing only your app. I keep a way to undo it.
>
> [Close] [Ignore]

The first two sentences may be rewritten by the EU LLM; the proposal is fixed text. If the LLM fails, the fixed
explanation is used.

The Attacker waits for the decision between rounds. That is why the SSH step usually appears after the close.

![The attack and the detection](docs/media/attack-detection.png)

_The attack-to-detection moment. **In development** — screenshot to be captured._

## 6. Close and verify

Tap **Close**. The Defender:

1. reads the rule again and records the inverse in `auditoria.jsonl` **before** changing anything;
2. revokes only that rule through the Leaseweb API;
3. confirms from outside with `nmap` that the port no longer answers;
4. posts the result:

> **Defender:** Closed and confirmed at `<time>`: PostgreSQL open to the whole internet. To roll back:
> `/undo <id>`
>
> **Defender:** @atacante, I closed "PostgreSQL open to the whole internet" at `<time>` and stored how to undo it.
> Can you confirm?

The Attacker re-checks the port and confirms:

> **Attacker:** Confirmed. I can no longer reach it.

On the dashboard, the exposure clock stops, the proof panel shows the close and **Undo last action** becomes
available. `/certificado` already has the close in section 3.

If the close cannot be confirmed, the Defender says so and nothing is marked as done. Do not approve a second
time; check the dashboard and the API state.

![The dashboard after the close](docs/media/painel-timeline.png)

_The engineering view at `/` after the close: stopped clock, proofs and Undo. **In development** — screenshot to
be captured._

## 7. Check the attack continued safely

After the decision, the Attacker continues its sequence:

> **Attacker:** 🔓 SSH: trying a short list of weak passwords…
>
> **Attacker:** ❌ SSH: no entry after `<n>` attempt(s)

Depending on the weak-password list and the victim's configuration, the line can instead be
`✅ SSH: got in as <user> after <n> attempt(s)`. The step is bounded and stops at the first login; it does not run
sudo, write to the target or persist anything.

With `ATACANTE_EXTRAS=1`, it also posts a `🧪 Extras:` line and a `🧪 Secrets in code:` count. All of it is
read-only. The password is never posted; only the user and the number of attempts appear.

The cycle ends with:

> **Attacker:** ✅ Attack finished

## 8. Fix the cause in the code

The code agent scans the sample app, changes only the configuration and opens a pull request:

> **Migrator:** Code: I opened a pull request with `<n>` files (`<files>`) so the app uses Leaseweb, with tests
> passing and no secrets (`<url>`). The main branch only changes when you merge. I also fixed the configuration
> that left the database open, so it does not come back on the next deploy.

With a real PR, the next message has **Approve PR** and **Ignore**. Tap **Approve PR**; the Migrator merges and
posts:

> **Migrator:** PR #`<n>` approved and merged into the app repo main branch at `<time>`. To undo: `/undo <id>`

`/undo <id>` opens a pull request that reverts the merge; it does not push to `main`. In a dry run
(`MIGRADOR_PR` not set to `real`), the diff stays on the server and there is no **Approve PR** button.

## 9. Certificate and report

At the end, the Chief posts the summary with measured numbers and the certificate:

> **Chief:** MIGRATION CERTIFICATE · CERT-`<YYYYMMDD-HHMM>`
>
> 1. WHERE THE DATA IS
> 2. PROOF NOTHING WAS LOST
> 3. SECURITY AFTER THE MIGRATION
> 4. HOW TO UNDO

The same certificate is at `http://127.0.0.1:3000/certificado`, and the full report is attached as a PDF named
`CERT-<YYYYMMDD-HHMM>.pdf` and available at `/relatorio.pdf`. Missing values print `not measured`; a checksum
mismatch is printed as a warning.

## 10. Independent checks

Do these outside the agents, from the brain:

```powershell
npm run seed:comparar -- --destino     # 10/10 on the target
npm run lsw:nmap -- <victim-ip> 5432   # filtered after the close
```

In Telegram, send `/status` to see pending and finished requests. The audit log is at the repository root:

```powershell
Get-Content auditoria.jsonl -Tail 20
```

It is git-ignored because it contains the real targets and timestamps of the run.

## 11. Reset between runs

```powershell
bash env/repor-repo-app.sh --sim
npm run lsw:vitima -- reabrir
npm run seed:limpar-destino -- --sim
bash env/preparar-demo.sh
```

Stop the orchestrator before starting the next one. A leftover process keeps the Telegram long polling and the
next run will fight for the same updates.

## Troubleshooting

| Symptom                                 | Cause and fix                                                                                                                             |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `409 Conflict` or buttons not answering | Two processes are polling the same bots. Stop the rehearsal or the other laptop: `pgrep -af "code/index.ts"`.                             |
| `chat not found`                        | The bot is not in the group, or `TELEGRAM_GRUPO_ID` is wrong. The smoke test names the failing bot.                                       |
| The Attacker finds nothing              | `5432` is already closed. Run `npm run lsw:vitima -- reabrir` and check `ALVOS_PERMITIDOS`.                                               |
| The Attacker refuses the target         | The IP is not a literal address in `ALVOS_PERMITIDOS`, or the list is empty. The refusal is the guard working.                            |
| `LSW_SG_GERIDOS is empty`               | The Defender refuses to guess which groups it may touch. Set the victim's group only.                                                     |
| No LLM answer                           | Expected fallback: the fixed text is used after the timeout. Check `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`.                            |
| The close takes ~40 s in the panel      | The API keeps listing the revoked rule; the Defender confirms from outside in about 3 s. Trust the `filtered` result, not the list.       |
| `EADDRINUSE` on port 3000               | Another panel is running. The orchestrator continues without a second panel; stop the other one or set `PORT`.                            |
| The PR is not real                      | `MIGRADOR_PR` is not `real`, or the token/repo is missing. The dry run is intentional and the message says the diff stayed on the server. |
| The certificate says `not measured`     | A field was not measured in that run. Do not fill it by hand; rerun the missing step.                                                     |

## What the run does not do

- It does not attack the bait VM. In the demo, the bait is only read through `auth.log` for the `/isco` counter.
- It does not exploit a service, run sudo, write to the target or persist anything.
- It does not copy AWS credentials, secrets in the Terraform or `0.0.0.0/0` rules on sensitive ports.
- It does not remove a security group or replace its rules; it revokes one rule and re-reads.
- It does not change the app's `main` branch without the **Approve PR** tap, and it never force-pushes.
