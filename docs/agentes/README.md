# ⭐ docs/agentes: what the agents say (IMPORTANT)

This folder defines **what each agent says**, in Telegram and on the dashboard. The code follows it; whoever changes the messages changes them here first.

| File | What for | Where it lives in the code |
|---|---|---|
| `vozes.md` | Persona and rules of each agent (system prompts) | `code/shared/voz.ts` (`PERSONAS`, `REGRAS`) and `code/shared/llm.ts` |
| `mensagens-demo.md` | Fixed text of each demo step, with buttons and variables | `code/shared/mensagens.ts`, used by `code/orquestrador.ts`, `code/shared/telegram.ts` and the dashboard ("thinking" line) |
| `checkup-12h.md` | First end-to-end demo at 12:00 and the public repo for the PRs | Nobody: it is for people |
| `roteiro-dia.md` | What to turn on and check from 15:00 to 15:45 | Nobody: it is for people |

Rules for everything:

1. **Fixed text first; the AI only improves it.** Every demo message exists as fixed text. The AI may rewrite the explanation (at most 3 sentences, 600 characters, 20 s timeout); if it fails or is slow, the fixed text goes out. The demo never waits for the model.
2. **Only measured facts.** The `{...}` variables come from the state and the audit log, never from the AI. A missing value is shown as "not measured".
3. **No message promises an action.** Actions only happen through the buttons.
4. **English, for a non-technical owner.** The demo and the pitch are in English (team decision at 13:05). Commands stay as they are in the code: `/estado`, `/desfazer <id>`, `/atacar`.
