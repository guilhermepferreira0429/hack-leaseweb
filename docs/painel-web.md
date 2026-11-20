# Web interface (dashboard)

Telegram is where the owner decides; the dashboard is where the jury **sees** what is happening. It runs on the brain, served by `painel/`, and is projected during the demo next to the mirrored phone.

Design in `docs/material/design/web.pen` ("Demo screen v2"). Owner: Enio Carlos (with the orchestrator's timings).

## One screen (`/`), in English

1. **Top: exposure clock.** Big: "Time exposed 38 s", counting live until the port closes; then it freezes and turns green ("CLOSED 14:02:10"). Next to it: "meanwhile the honeypot got X attempts". This is the number for the end of the pitch. When the run ends, **"Cycle complete ✓"** appears with the time.
2. **Residency bar.** Where the data came from (AWS, source cloud) and where it lives now (`LOCAL_DADOS`, e.g. Leaseweb Amsterdam), with "✓ Data stays in the EU" when the destination is in the EU.
3. **Three columns**, each with its own scroll that follows the newest item (unless you scrolled up):
   - **Agent chain:** one step per event, in each agent's colour: Migrator (blue), Attacker (red), Defense (green), Chief (grey), Code (purple). Time, agent, short sentence, the button the owner pressed in Telegram and its result. On top, the "THINKING NOW" line. New steps fade in one by one. It is the same conversation as the "Direção" group, in large type.
   - **Services:** one card per migration step (S3 → MinIO, RDS PostgreSQL → PostgreSQL, SQS → RabbitMQ, Secrets Manager → OpenBao, ElastiCache → Valkey) with QUEUED / MIGRATING / DONE / FAILED and the measured proof (files, rows, messages, secrets, keys · sha256 ✓). Below, the **victim VM** card: the port goes from OPEN to CLOSED, with the exposure window.
   - **Live logs:** the audit log as a log, in English and with no IPs. The MIGRATOR / ATTACKER / DEFENSE / CODE / ALL tabs filter it: by default they follow the active agent; one click pins a tab. The Code variant shows the PR's files and the PR card.
4. **Footer:** the **Simple / Technical** toggle (Simple swaps jargon for everyday words, remembered in the browser), **⤓ Download report (PDF)** (`/relatorio.pdf`: migration certificate and incidents on A4), **↺ Undo last action**, **▶ Start** and **⟲ Reset**.

## Other routes

- **`/isco`:** only the honeypot's attempt counter and distinct IPs, for the opening of the pitch (`?json` for the numbers).
- **`/certificado`:** the migration certificate, ready to print.
- **`/palco`:** a single screen for the jury with large numbers.
- **`/estado.json`:** requests and audit log so the page can refresh itself. Public view (request from outside the machine): only a version hash and a count, with no IPs or security group ids.
- `/v1` (the old timeline) and `/relatorio.html` were removed; the report is the PDF.

## Buttons and access

- By default it listens only on `127.0.0.1` (`PAINEL_HOST`); view it through an SSH tunnel. Opening it to the outside is deliberate: `PAINEL_HOST=0.0.0.0`.
- The buttons (Undo, Start, Reset) and the token only appear in the **local view** (127.0.0.1 or SSH tunnel). From outside, the page is view-only.
- `POST /desfazer`, `POST /iniciar` and `POST /limpar` require `PAINEL_TOKEN` and an `Origin` equal to the `Host`. With an empty `PAINEL_TOKEN`, the buttons do not exist and the routes refuse. Start runs one run at a time; Reset stops the run, archives the cycle's audit log, restores the app repo and reopens the victim's 5432 on purpose. All of it goes into the audit log.

## Rules

- Refreshes by itself when `estado.json` changes (checked every 2 seconds).
- Large type: it has to be readable on a projector from the back of the room. Checked at 1920×1080 and 1536×864.
- Dark background, few colours: only the agents' colours, plus green and red for state.
- No invented numbers: everything comes from `estado.json` and `auditoria.jsonl`.
