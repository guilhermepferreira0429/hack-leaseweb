# Demo script (about 90 s, inside the 5-minute pitch)

> Neutral public runbook: [`RUNBOOK.md`](RUNBOOK.md). This file is the internal stage script.

1. **Cold open** (no "hi, we are team X"): "This machine, on the Leaseweb cloud, was switched on this morning. Since then it has received **N** login attempts." Show `/isco`.
2. "This app runs on AWS." (LocalStack.) On the dashboard, press **▶ Start** (or run `npm run dev`). In the "Direção" Telegram group, the **Migrator** first asks where the data should go: **Recommended** / **Self-hosted** / **Why?** (**Why?** shows the rules, the budget and the Leaseweb API calls, simulated only). Then it proposes the plan for the 5 services. → **Approve plan** (a single tap).
3. The dashboard shows the 5 services migrated in the **Services** column, each with its proof (equal counts and sha256 checksums) and the tests passing on both sides. The residency bar shows the route: AWS → Leaseweb, with "✓ Data stays in the EU" when the destination is in the EU.
4. The Migrator hands over to the **Attacker** in the group. The Attacker opens TCP connections to the sensitive ports of the new VM, finds the database (5432) open to the whole Internet and calls the **Defense**. The defense check, run from outside with `nmap`, says `open` (without the victim's IP, the defense waits for the Leaseweb API).
5. The **Defense** explains in plain English and proposes **Close**. **A jury member taps it** (they joined through the QR code). The Attacker confirms it can no longer reach the port and the **Chief** sums up.
6. The defense check (`nmap`, from outside) runs again and says `filtered`; the rule is also gone from the Leaseweb API. The dashboard shows the **exposure clock** ("Time exposed N s") and the honeypot attempts during that time. On the dashboard: the agent chain, the live logs, the victim VM card going OPEN → CLOSED, and the **↺ Undo last action** button.
7. **Fix the cause:** the **Migrator** opens a PR on the app's public repo (`hack-leaseweb-exemplo-app`). The PR points the app to Leaseweb and fixes the Terraform rule that opened 5432, so it does not come back on the next deploy. → **Approve PR** merges it; `/undo` opens a PR that reverts it. Only with `MIGRADOR_PR=real`; in a rehearsal the PR is simulated and there is no button.
8. The dashboard shows **"Cycle complete ✓"** with the time. **⤓ Download report (PDF)** gives the migration certificate and the incident report on A4.
9. Close: "Everything you saw was built today and runs on Leaseweb, with AI from European providers. Nothing left the EU. Migrate without being exposed, not even for a minute."

**Numbers:** only the N measured on the day and the ones the demo shows. Do not invent countries or statistics.

**If the demo fails on stage:** "We recorded it at 14:30 just in case" and play the video. No debugging on stage.

**For the jury:** the dashboard has a **Simple / Technical** toggle. Simple swaps jargon for everyday words (for a non-technical owner); Technical shows the real tool names.

## Preparing the brain (before every rehearsal and the demo)

`bash env/preparar-demo.sh`, from the repo root. In this order:

1. Checks `.env`: source and destination Postgres, MinIO, RabbitMQ, redis-origem, Valkey and OpenBao.
2. `infra:up`: LocalStack (S3, SQS, Secrets Manager, SSM), source and destination Postgres, MinIO, RabbitMQ, redis-origem, Valkey and OpenBao, all on `127.0.0.1`.
3. `npm run seed:limpar-destino -- --sim`: empties **only the destination** (seed buckets in MinIO, Valkey, queues in RabbitMQ, seed secrets in OpenBao, the `loja` schema and `public.encomendas` in the destination Postgres), so it does not look full before Approve. Refuses if any destination points to the source.
4. `npm run seed`: fake data of a small business at the source (S3, Postgres, SQS, Secrets Manager and SSM, ElastiCache), always the same. Puts the 50 messages back in SQS after any earlier migration, without duplicates, and restores the app's 20 orders.
5. `npm run seed:comparar`: the source must give 10/10 equal to `esperado.json`.

Steps 3 and 4 touch different sides, so their order does not change the result; what matters is a full source and an empty destination before migrating. One run at a time: never prepare while a rehearsal is half-way through.

Then: `npm run dev -- --consola --uma-vez` (rehearsal) or `npm run dev` (with Telegram). At the end, the independent proof: `npm run seed:comparar -- --destino` (10/10).

From the dashboard (local view only, with `PAINEL_TOKEN`): **▶ Start** starts a run (one at a time) and **⟲ Reset** stops it, archives the cycle's audit log, restores the app repo and reopens the victim's 5432 on purpose. Everything is recorded in the audit log.

Between rehearsals with "Approve PR": `bash env/repor-repo-app.sh --sim` restores the app's public repo to its initial state (closes the PRs, deletes the `migracao/*` branches and moves `main` back to the commit with the 5432 rule open). Without `--sim` it only shows the state. And `npm run lsw:vitima -- reabrir` opens the victim's 5432 again.
DynamoDB, SNS and CloudWatch Logs (`npm run seed:extra`) are only in the plan; do not run them when preparing the demo.
View the dashboard from the laptop: `ssh -L 3000:localhost:3000 ubuntu@<brain>` and open `http://localhost:3000`.

## Counting honeypot attempts

```bash
sudo grep -cE "Invalid user|Failed password|Connection closed by authenticating user|Disconnected from invalid user" /var/log/auth.log
sudo grep -oE "from [0-9.]+" /var/log/auth.log | sort -u | wc -l   # distinct IPs
```
