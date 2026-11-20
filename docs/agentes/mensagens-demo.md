# Demo messages, step by step

Same text as `code/shared/mensagens.ts` (in English since 13:05). For each step: who speaks, the **thinking** line (dashboard), the **message** (Telegram, "Direção" group), the **buttons** and the **terminal** (what the dashboard shows running). The `{...}` variables come from the state and the audit log. A missing value is written as "not measured"; a yes/no is written as ✓ / ✗.

## 0. Opening (before the demo)

- **Chief** · thinking: "Getting the team ready."
- Message: `Good morning. We are moving the {app} app from AWS to Leaseweb, safely. I will report at every step.`

## 1. Decide where to migrate

- **Migrator** · thinking: "Reading the app and deciding where each service goes."
- Terminal: `analisar exemplo-app` → list of services found.
- Message (one line per service):
  ```
  I found {n_servicos} AWS services in the app: {lista_servicos}.
  Proposal:
  · {servico} → {destino} ({self-hosted or managed})
  The VM has {ram_livre} GB free. {motivo_regra}
  ```
- Buttons: `Approve plan` · `Ignore` (a single "Approve plan" for the 5 services)

## 2. Confirmation

- **Chief** · thinking: "Waiting for approval."
- After the tap: `Plan approved by {quem} at {hora}. @migrador, go ahead.`
- **Note:** this is where the jury can approve (QR code on the honeypot screen).

## 3. Migrate

- **Migrator** · thinking: "Copying the data and comparing checksums."
- Terminal: `migrar s3 → minio` · count going up · `checksum ✓` (and the same for each of the 5 services)
- Message:
  ```
  Migration complete.
  · Files: {n_objetos} copied · checksum {ok_s3}
  · Database: {n_linhas} rows · checksum {ok_bd}
  · App tests: before {ok_antes} · after {ok_depois}
  The new infrastructure is live. @atacante, your turn.
  ```

## 4. Attack

- **Attacker** · thinking: "Checking what our machines show to the outside."
- Terminal: `TCP connection to ports {portas} of {ip_vitima}` → `5432 open`
- Message:
  ```
  I found the new database open to the whole Internet (port {porta}).
  Severity: {gravidade}. Anyone can try to get in.
  @defesa
  ```

## 5. Defend

- **Defender** · thinking: "Explaining the risk and preparing a reversible fix."
- Message (the AI may rewrite the first 2 sentences; if it fails, this text stays):
  ```
  The database with the company data is open to the whole Internet.
  Someone outside could try to guess the password and get in.
  I propose closing outside access and allowing only your app. I keep a way to undo it.
  ```
- Buttons: `Close` · `Ignore`
- Terminal after the tap: `leaseweb: remove rule {regra_id} from group {sg}` → `state: ACTIVE` → `nmap: filtered` (the defender's check from outside; without the victim's IP it waits for the API)
- Message after:
  ```
  Closed at {hora_fecho} and confirmed. Time exposed: {segundos} s.
  Undo saved: /desfazer {pedido_id}
  @atacante, please confirm.
  ```
- **Attacker:** `Confirmed. I can no longer reach it.`

## 6. Migrate the code

- **Migrator** · thinking: "Fixing the code to point at Leaseweb and close the cause."
- Terminal: `find AWS usages` → `{n_ficheiros} files` → `tests ✓` → `PR #{numero}`
- Message:
  ```
  I opened PR #{numero}: {n_ficheiros} files changed, tests passing.
  · The app now uses Leaseweb instead of AWS.
  · I fixed the configuration that left the database open, so it does not come back on the next deploy.
  ```
- Buttons: `Approve PR` · `Ignore`. "Approve PR" merges in the app's repo and `/desfazer` opens a PR that reverts it. Only with `MIGRADOR_PR=real`; in a rehearsal the PR is simulated and there is no button.

## 7. Check everything

- **Chief** · thinking: "Checking that everything is up."
- Terminal: `app tests` ✓ · `attacker: new check` → nothing open
- Message: `Final check: tests ✓, nothing exposed ✓, data identical ✓.`

## 8. Report

- **Chief** · thinking: "Writing the certificate from the audit log."
- Message: the certificate from `docs/certificado-migracao.md`, followed by:
  ```
  In {minutos} min we moved from AWS to Leaseweb, closed {n_falhas} issue(s) and fixed the cause in the code. Nothing left the EU.
  ```

## Useful fixed answers

- The owner asks something not in the state: `I don't have that information. Type /estado to see the current status.`
- Request ignored: `OK, leaving it as it is. Your decision not to close it is logged.`
- API error: `Leaseweb did not answer in time. I changed nothing. I will try again.`
