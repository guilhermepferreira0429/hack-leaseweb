# Detection and response during the migration

Scenario: during the migration window someone gets in. The agent detects it, contains it, fixes the cause,
finishes the migration and reports what happened. **Only our own VMs are attacked.**

## The attack (scripted, from our own "attacker" VM)

- Target: the migrated VM, with a user `deploy`, a weak password and `PasswordAuthentication yes`
  "left on for the migration" (a realistic mistake).
- Attack: SSH password guessing with a short wordlist (e.g. `hydra -l deploy -P list.txt ssh://<ip>`), then
  login, drop a file, try `sudo`.
- MITRE ATT&CK: T1110.001 (Brute Force: Password Guessing) → T1078 (Valid Accounts).
- Tell the organisers before running it on stage. Do not attack from the venue network.

## Detection (from `/var/log/auth.log`, Ubuntu)

Lines to parse:

```
Failed password for deploy from 198.51.100.7 port 52114 ssh2
Failed password for invalid user admin from 198.51.100.7 port 52120 ssh2
Invalid user admin from 198.51.100.7 port 52120
Accepted password for deploy from 198.51.100.7 port 52190 ssh2
```

Rules (simple, explainable, no ML needed):

| Signal | Rule | Severity |
|---|---|---|
| Brute force | ≥ 10 `Failed`/`Invalid user` from one IP in 60 s | medium |
| **Compromise** | brute force from IP X, then `Accepted` from the same IP X within 10 min | **critical** |
| Root login | `Accepted ... for root` from outside the admin IP | high |

Evidence to collect right after a compromise:
`who`, `last -n 20`, `ps -u deploy -o pid,cmd`, `find /home/deploy /tmp -newer <login time>`,
`sudo -l -U deploy`, `grep deploy /var/log/auth.log`.

## Response (automatic, reversible, closed list)

| Step | Action | Undo |
|---|---|---|
| 1 | Drop the attacker IP on the VM: `nft add rule inet filter input ip saddr X drop` (instant) | delete the rule |
| 2 | End the attacker's sessions: `loginctl terminate-user deploy` or `pkill -KILL -u deploy` | — (logged as non-reversible) |
| 3 | Lock the account: `usermod -L deploy` and `chage -E0 deploy` | `usermod -U`, `chage -E -1` |
| 4 | Turn off password SSH: `PasswordAuthentication no`, reload sshd | restore the previous line |
| 5 | Leaseweb: `authorize` 22 from the admin IP, wait `ACTIVE`, then `revoke` 22 from `0.0.0.0/0` | re-authorize the saved rule |
| 6 | Quarantine dropped files (move to `/var/quarantine` with hash) | move back |
| 7 | Resume the migration with the fixed settings | — |

Principles that answer "what if the AI gets it wrong?":
- The model **chooses from this list**; it never writes shell commands.
- Every action is logged with its undo; the report has an Undo button.
- Destructive or irreversible steps beyond this list need a human tap.

## The report (what the owner receives)

Plain language, short, with numbers we measured:

> 15:02 — Someone got into the new server as "deploy" after 340 failed attempts from 198.51.100.7.
> In 41 s I: blocked that address, ended the session, locked the account, turned off password logins and
> closed SSH to the internet (only your office IP can connect). I quarantined 1 file they left.
> The migration finished at 15:04. Nothing else changed. Undo any step here: <link>

Channel: Telegram bot (`sendMessage` with `reply_markup.inline_keyboard` for Undo/Approve; answers arrive as
`callback_query`; verify the `X-Telegram-Bot-Api-Secret-Token` header on the webhook, or use long polling with
`getUpdates` so no public URL is needed). Only chat IDs on the approvers list can press buttons. The same text
is shown on the demo page.
