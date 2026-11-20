# Installation guide

How to set everything up from zero: a developer machine, the "brain" VM that runs the demo, the victim VM on
Leaseweb, the Telegram bots, the EU LLM and (optionally) the GitHub pull request. Each step ends with a check.

Written from the real setup of 20 November 2026; the "Problems we hit" section lists what went wrong that day.

| Piece | What it is | Where it runs |
|---|---|---|
| **Brain** | All agents in one Node process, the dashboard, and the simulated AWS (containers) | Any Ubuntu VM with a public IP (we used the organisers' VM) |
| **Victim** | The new Leaseweb VM whose database port is left open on purpose; the defender closes it | Leaseweb Public Cloud, created by our script through the API |
| **Owner** | Approves in Telegram | A phone |

Never commit `.env`. Every secret below goes only there.

---

## 1. Developer machine (optional)

Requirements: Node.js 22+, npm 10+. Docker and nmap only if you want to run the demo locally.

No sudo? Node can live in your home folder:

```bash
V=v22.21.1; mkdir -p ~/.local/node && cd ~/.local/node
curl -fsSLO https://nodejs.org/dist/$V/node-$V-linux-x64.tar.xz
curl -fsSL https://nodejs.org/dist/$V/SHASUMS256.txt | grep "node-$V-linux-x64.tar.xz" | sha256sum -c
tar xf node-$V-linux-x64.tar.xz --strip-components=1 && rm node-$V-linux-x64.tar.xz
echo 'export PATH="$HOME/.local/node/bin:$PATH"' >> ~/.bashrc
```

Then, from the repo:

```bash
npm install
npm run typecheck && npm test        # check: 0 type errors, all tests pass
```

## 2. The brain VM (Ubuntu 24.04 or newer)

```bash
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-v2 nmap jq git
sudo usermod -aG docker "$USER"      # log out and in again
# Node 22: as in section 1, or extract the tarball to /usr/local with sudo
git clone https://github.com/guilhermepferreira0429/hack-leaseweb.git && cd hack-leaseweb
npm install
cp env/.env.example .env && chmod 600 .env
```

Fill the local service passwords in `.env` with random values (`openssl rand -hex 16`):
`POSTGRES_PASSWORD`, `MINIO_ACCESS_KEY`/`MINIO_SECRET_KEY`, `POSTGRES_DESTINO_PASSWORD`, `RABBITMQ_USER`/`RABBITMQ_PASSWORD`,
`REDIS_ORIGEM_PASSWORD`, `VALKEY_PASSWORD`, `OPENBAO_TOKEN`, and put the same passwords inside the matching
`DATABASE_URL`, `DATABASE_URL_DESTINO`, `RABBITMQ_URL`, `REDIS_ORIGEM_URL` and `VALKEY_URL`.

```bash
npm run infra:up                     # check: docker ps shows the containers, all on 127.0.0.1 only
bash env/preparar-demo.sh            # check: "Pronto: origem cheia, destino vazio."
```

Hardening (do it before the event, after every teammate has a key on the VM):

```bash
ssh-copy-id -i ~/.ssh/id_ed25519.pub ubuntu@<brain>      # from each laptop
echo "PasswordAuthentication no" | sudo tee /etc/ssh/sshd_config.d/00-no-password.conf
sudo systemctl restart ssh           # keep a second SSH session open until you confirm you can log in
```

## 3. Leaseweb: API key and the victim VM

1. Get an API key (Customer Portal, or from the organisers) and put it in `.env` as `LSW_API_KEY`.
2. Read-only check:
   ```bash
   npm run lsw:diagnostico           # check: "Chave OK" and the security groups with their rules
   ```
3. Create the victim (costs money while it exists: `lsw.c3.large`, about €0.035/hour):
   ```bash
   VITIMA_ADMIN_IPS=<brain public IP>,<your public IP> npm run lsw:vitima -- criar
   ```
   It creates a security group `vitima` (SSH only from those IPs, **5432 open to 0.0.0.0/0**, the flaw for the demo),
   launches the VM in `eu-central-1` (Frankfurt) with your SSH public key, and installs a harmless listener on 5432
   (`env/vitima-5432.service`, a `nc -lk`, not a real database). It prints three lines for `.env`:
   ```
   LSW_SG_GERIDOS=<victim group id>        # the ONLY group the defender may touch. Never the "Default" group.
   LSW_IP_SG=<victim IP>=<victim group id>
   ALVOS_PERMITIDOS=<victim IP>            # the ONLY IP the attacker may touch
   ```
4. Check from the brain: `nmap -Pn -p 5432 <victim IP>` → `open`.

Other commands: `npm run lsw:vitima -- estado` (show), `reabrir` (reopen 5432 between rehearsals, runs on the brain),
`destruir-vm` (VM only), `destruir` (VM and group). `npm run lsw:ensaio -- <group> <rule> <ip>` closes and restores one
real rule with nmap before and after, without Telegram. `npm run lsw:falsa` starts a fake Leaseweb API on
`127.0.0.1:4010` for rehearsals without a key.

## 4. Telegram

Details in [`telegram.md`](telegram.md). In short:

1. `@BotFather` → `/newbot` four times (chief, migrator, attacker, defence) → `TELEGRAM_TOKEN_CHEFE`, `_MIGRADOR`,
   `_ATACANTE`, `_DEFESA`. For each bot: `/setprivacy` → **Disable** (do it before adding the bot to the group).
2. Create the group "Direção", add the 4 bots and the owner, write any message in the group.
3. `curl -s https://api.telegram.org/bot<TOKEN>/getUpdates` → `chat.id` of the group → `TELEGRAM_GRUPO_ID`;
   `from.id` of the owner → `TELEGRAM_DONO_ID` (and `TELEGRAM_APROVADORES` for anyone else allowed to approve).
4. Optional, for the jury QR on `/isco` and `/palco`: group invite link → `TELEGRAM_CONVITE_URL`.
5. Check: `npm run telegram:smoke` and tap the button on the phone. Read-only check of one bot:
   ```bash
   T=<token>; curl -s "https://api.telegram.org/bot$T/getChatMember?chat_id=<group id>&user_id=${T%%:*}"   # "member"
   ```

Only one process may read a bot's updates at a time: stop any rehearsal before starting the demo (see problems below).
If a bot is missing, its agent speaks through another bot with its name as a prefix.

## 5. EU LLM

`LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` (OpenAI-compatible, e.g. TensorX or sference), optional backup `LLM_*_2`.
Without any provider the defender uses a fixed explanation per finding type; the demo never waits more than 20 s.

## 6. Optional extras

| Feature | `.env` |
|---|---|
| Certificate says where the data is | `LOCAL_DADOS="Leaseweb, Frankfurt (DE)"` (only what is true) |
| Honeypot counter (`/isco`) | `ISCO_HOST=local` if the dashboard runs on the honeypot, else its IP and `ISCO_SSH_USER`; `ISCO_IGNORAR_IPS` = team IPs |
| Undo button on the dashboard | `PAINEL_TOKEN=$(openssl rand -hex 16)` |
| Night mode | `MODO_NOITE_MINUTOS=1`, `MODO_NOITE_IPS=<known IPs>` |
| Real pull request on the app's repo | `MIGRADOR_PR=real`, `MIGRADOR_PR_REPO=<owner/name>`, `GITHUB_TOKEN_EXEMPLO` (fine-grained, that repo only, Contents + Pull requests write). Reset between rehearsals: `bash env/repor-repo-app.sh --sim` |
| Hide ports only open to us | `ATACANTE_IGNORAR_PORTAS=22` |

## 7. Run

Rehearsal (the terminal plays Telegram, exits after one cycle):

```bash
bash env/preparar-demo.sh && npm run lsw:vitima -- reabrir
npm run dev -- --consola --uma-vez
```

Live demo (real Telegram): `npm run demo` (prepares, then starts), or `npm run dev -- --uma-vez`.

The dashboard listens on `127.0.0.1:3000` only. From the presenting laptop:

```bash
ssh -L 3000:localhost:3000 ubuntu@<brain>
```

| Screen | Use |
|---|---|
| `http://localhost:3000/palco` | **The jury screen**: one page, English, phases, the port, the exposure clock, AI text and human approval, proof |
| `http://localhost:3000/isco` | Opening of the pitch: honeypot login attempts, QR for the jury |
| `http://localhost:3000/certificado` | Migration certificate (printable) |
| `http://localhost:3000/` | Engineering view for rehearsals |

Between runs: `bash env/preparar-demo.sh` (source full, target empty) and `npm run lsw:vitima -- reabrir`.

## 8. Problems we hit (and the fix)

| Symptom | Cause | Fix |
|---|---|---|
| `pull access denied for minio/minio` | MinIO left Docker Hub | Compose uses `cgr.dev/chainguard/minio`, pinned by digest |
| `POST /instances → 400 region` | The event account only accepts `eu-central-1` | `VITIMA_REGIAO` defaults to it |
| `400: cannot provide both user data and an SSH key` | API limit | The script sends only `sshKey` and installs the rest over SSH |
| `Permission denied` as `ubuntu` on the victim | Leaseweb puts the key on `root` | Script uses `root` (`VITIMA_SSH_USER`) |
| Close takes ~40 s, exposure clock too high | After a revoke the API keeps listing the rule (as ACTIVE) for 9–40 s, although the firewall closes in ~3 s | The defender confirms from outside: two nmap reads in a row with the port no longer open |
| "Couldn't close" but the port was closed | A network blip on a read after the revoke | Reads retry 3 times; writes retry only if the connection never opened |
| `409 Conflict` / approvals going nowhere | Two processes reading the same bot (e.g. a rehearsal and the demo) | One run at a time; stop rehearsals (also on teammates' laptops) |
| Dashboard reachable from outside | `PAINEL_HOST=` empty was taken as "all interfaces" | Fixed; empty now means `127.0.0.1` |
| `spawn gh ENOENT` | GitHub CLI missing on the brain | Install `gh` or leave `MIGRADOR_PR` empty (dry run) |
| `git pull` refused on the brain | `npm install` changed `package-lock.json` | `git checkout package-lock.json && git pull` |
| Port already closed before the demo | Someone else's rehearsal against the same victim | `npm run lsw:vitima -- reabrir`; agree who runs |

## 9. After the event

```bash
npm run lsw:vitima -- destruir       # stop paying for the victim
```

Then rotate everything that was shared during the day: the Leaseweb API key, the four bot tokens (`@BotFather` →
`/revoke`), the LLM keys, the GitHub token and the brain VM password.
