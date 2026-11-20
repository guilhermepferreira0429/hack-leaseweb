# Media shot list

The screenshots and the demo video are **in development**: the docs already reference their final paths, so
capturing a shot means dropping the file into `docs/media/` with the name below. Nothing else has to change.

Everything here is captured from a real run of this repository. No mock-ups, no invented numbers, no staged
screens with a different UI.

## Rules for every shot

- Capture from the real demo environment, at the same commit that is on `main`.
- **Redact before committing:** public IPs, Leaseweb instance and security-group IDs, Telegram chat IDs and user
  IDs, bot tokens, the group invite link and its QR code. Blur or crop; do not paint over with a colour that
  leaves the text readable.
- No secrets of any kind: no API keys, no passwords, no `OPENBAO_TOKEN`, no `GITHUB_TOKEN_EXEMPLO`.
- No personal data: no names, phone numbers or Telegram handles of people outside the team.
- PNG for UI and diagrams, MP4 (H.264, 1080p) for video. Keep the dark theme; do not recolour the dashboard.
- If a number is on screen, it must be the number the audit log recorded for that run. If it was not measured,
  leave the `—` / "not measured" as the dashboard shows it.
- Update this file when a shot is captured: change `in development` to the capture date and add who captured it.

## Placeholders already referenced in the docs

All rows below are **in development** until captured.

| File                              | Must show                                                                                                                                                                                                                                              | Used in                        | Suggested section and caption               | Notes                                                                                                                                                                             |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/media/telegram-group.png`   | The Telegram group "Direção" during the incident: the Migrator's plan, the Attacker's finding, the Defender's `Close` request, the confirmation after the close and the Attacker confirming it can no longer reach the port. Four bots plus the owner. | `README.md`                    | "What it is", next to the opening paragraph | Portrait phone screenshot is fine. Crop to the incident chain; the certificate message can be a separate shot. Redact the owner's name and chat ID. Do not include the invite QR. |
| `docs/media/painel-timeline.png`  | The engineering view at `http://127.0.0.1:3000/`: agent timeline, the exposure clock, the proofs (objects, rows, checksums, tests) and the **Undo** button.                                                                                            | `README.md`, `docs/RUNBOOK.md` | README "Dashboard"; runbook step 6          | Capture after the port is closed and confirmed, so the clock is stopped and Undo is visible. Redact the victim IP and security-group IDs.                                         |
| `docs/media/certificate.png`      | The printable page at `/certificado`: certificate ID (`CERT-YYYYMMDD-HHMM`), where each service landed, counts and checksums, what was found and closed, who approved it, exposure time and the stored inverse.                                        | `README.md`                    | "How it works", after step 7                | Use a run where every checksum matched. Redact IPs and IDs. The "not a formal certification" footer must stay visible.                                                            |
| `docs/media/demo-poster.png`      | The poster frame for the demo video: the dashboard and the Telegram group side by side, at the moment the port is closed.                                                                                                                              | `README.md`                    | Top of the page, linked to `demo.mp4`       | 16:9, 1920×1080. Also used as the video thumbnail.                                                                                                                                |
| `docs/media/demo.mp4`             | A 60–90 s screen recording of one full cycle: `Approve plan` → five services with proof → attack → `Close` → confirmation → certificate. Real Telegram, real Leaseweb API, real timings.                                                               | `README.md`                    | Link under the poster frame                 | 1080p, H.264, no music. Add English captions for the four approval moments. Cut only idle waiting; never splice different runs.                                                   |
| `docs/media/attack-detection.png` | The attack-to-detection moment: the Attacker's `Recon: 1 open port: 5432` message next to the Defender's explanation and `Close` request, or a two-panel composite with `nmap` showing `open` before and `filtered` after.                             | `docs/RUNBOOK.md`              | Step 5                                      | If using a composite, label both panels with the time of the same run. Redact the target IP.                                                                                      |
| `docs/media/painel-palco.png`     | The jury screen at `/palco`: the four phases (migrate, attack, approve, close), the port state, the exposure clock and the proof line in large type.                                                                                                   | `docs/RUNBOOK.md`              | Step 3                                      | Capture from the projector or at 1920×1080. This is the screen the room sees; keep the English labels.                                                                            |

## Useful extra shots (not embedded yet)

| File                          | Must show                                                                    | Where it would go                                                           | Notes                                                                         |
| ----------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `docs/media/architecture.png` | The architecture diagram exported from the Mermaid block in `README.md`.     | Slide deck, and as a fallback image if a renderer does not support Mermaid. | Re-export after every diagram change. Keep the same node names as the README. |
| `docs/media/owner-phone.png`  | The owner's phone with the incident report and one **Undo** button per step. | Slide deck or the "How it works" section, if the video does not cover it.   | Redact the phone's status bar and the Telegram account details.               |
| `docs/media/repo-map.png`     | A visual map of `code/` (agents, shared, panel) and `docs/`.                 | Slide deck, or "Repository layout" in the README.                           | Optional; the text tree in the README stays the source of truth.              |

## Capture checklist

1. Reset the demo (`bash env/preparar-demo.sh`, `npm run lsw:vitima -- reabrir`) and run one clean cycle.
2. Capture the Telegram group, the dashboard and the certificate from that same run.
3. Redact IPs, IDs, tokens, handles and QR codes.
4. Save under the exact filenames above in `docs/media/`.
5. Change the row status here and remove the "in development" note from the caption in the doc that embeds it.
6. After capture, run a link check: every `![...](...)` in the docs must resolve to a file in `docs/media/`.
