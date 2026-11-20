# Contributing

This repository was built in one day at Hackathon Portugal 2026 (InfraHack, Leaseweb × Velv). It is a working
demo, not a finished product: the code is organised to be read, run and extended, and the safety rules below are
part of the design, not decoration.

## Run it first

1. Read the [README](README.md) quickstart and copy `env/.env.example` to `.env`.
2. `npm install`, `npm run typecheck`, `npm test`.
3. `npm run infra:up` and `npm run dev` (or `npm run dev -- --consola --uma-vez` for a rehearsal without
   Telegram).

The full setup, including the Leaseweb VM and the four Telegram bots, is in [`docs/install.md`](docs/install.md).
The architecture and the reasons behind the design are in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## How the repository is organised

| Path                   | What belongs there                                                                              |
| ---------------------- | ----------------------------------------------------------------------------------------------- |
| `code/index.ts`        | Composition root: real modules, environment, panel, Telegram.                                   |
| `code/orquestrador.ts` | The cycle and the decisions between agents.                                                     |
| `code/shared/`         | Contracts and shared services: types, bus, Leaseweb client, LLM client, Telegram, audit, state. |
| `code/chefe/`          | Chief: summaries, exposure clock, certificate, PDF report.                                      |
| `code/migrador/`       | Analysis, the five copy steps, verification, Terraform translator, code agent and PRs.          |
| `code/atacante/`       | Allowlist, TCP recon, bounded SSH, read-only extras.                                            |
| `code/defesa/`         | Detection, explanation, approval, the single-rule fix, Undo, night mode, `nmap` verification.   |
| `code/painel/`         | The HTTP dashboard and its routes.                                                              |
| `code/exemplo-app/`    | The sample app, its seed data and its tests.                                                    |
| `docs/`                | Public docs in English; the team's working notes are also here (some in Portuguese).            |
| `env/`                 | `.env.example`, Docker Compose, demo preparation and reset scripts.                             |

## Conventions

- **TypeScript, Node 22+, ES modules, no build step.** Everything runs through `tsx`.
- **Match the file you are editing.** The codebase uses Portuguese identifiers and type names; user-facing text
  (Telegram messages, dashboard, the demo output) is in English. Comments are mixed; do not mass-rename.
- **Shared contracts are contracts.** `docs/interfaces.md` and `code/shared/` are used by every agent. If you must
  change a signature or an exported type, announce it to the team and update the call sites and tests in the same
  change.
- **Keep the dependency direction.** All provider calls go through `code/shared/leaseweb.ts`; agents do not call
  the raw API with `fetch` themselves. Telegram delivery and the bus are injected by the orchestrator, which makes
  the cycle testable with fakes.
- **No new dependency without a reason.** The project deliberately uses the Node standard library, `ssh2` for the
  attacker, the AWS SDK for the source side and small clients for everything else.

## Safety rules that a change must not break

1. **The AI writes text; the code acts.** A model output is never executed. Actions come from the closed list in
   `code/shared/tipos.ts` (`remover_regra`, `migrar`, `aprovar_pr`). A new action needs an approval path (or an
   explicit, narrow exception like night mode), an inverse and an audit event before it can exist.
2. **The attacker stays fenced.** Do not weaken `carregarAllowlist` or `garantirPermitido`. Only literal IPs in
   `ALVOS_PERMITIDOS` may be contacted, the check runs before every connection, and the attack must stay
   non-destructive and bounded. Never target a machine you do not own.
3. **The defender changes one rule at a time.** Revoke the offending rule, re-read, confirm from outside, and
   store the inverse **before** the change. Never attach or detach a security group: that replaces every rule.
4. **Secrets never leave `.env`.** No keys, tokens, passwords or real IPs in code, tests, docs, fixtures, logs or
   commit messages. `auditoria*.jsonl` contains real targets and is git-ignored; do not force-add it.
5. **Nothing is reported if it was not measured.** Missing values are printed as `not measured`. Do not fill a
   demo number by hand.
6. **Stay in the EU.** The target data and the LLM calls are EU-hosted. Do not add a provider or a region that
   breaks that.

## Tests and checks

```powershell
npm run typecheck
npm test
```

- `npm test` runs the Node test runner through `tsx` for every `code/**/*.test.ts`.
- Pure functions (parsers, allowlist, translator, certificate, exposure clock) have unit tests and should keep
  them.
- Integration points are tested with fakes: a fake Leaseweb API, a fake Telegram and a fake LLM. Do not make a
  test depend on the real API, the real bots or the clock.
- For a UI change, also run `npm run dev:painel` and check `/`, `/palco`, `/isco` and `/certificado` at
  1280×800 and 1920×1080.

## Proposing a change

- During the event, the team commits directly to `main` in small commits. External contributions should use a
  branch and a pull request.
- Keep a change focused: one behaviour, its tests and the documentation it invalidates.
- If you change a command, a route, an agent name or a number that appears in the docs, update every doc that
  mentions it. The README, `docs/ARCHITECTURE.md` and `docs/RUNBOOK.md` are the public layer.
- If you add or change a screenshot or a diagram, update [`docs/media/SHOTLIST.md`](docs/media/SHOTLIST.md) and the
  placeholder that points to it.
- In the pull request, say what you changed, how you tested it and which safety rule above is affected (if any).

## Review checklist

- [ ] `npm run typecheck` and `npm test` pass.
- [ ] The change does not widen the allowlist, the closed action list or the LLM's role.
- [ ] Every infrastructure change has an inverse and an audit event.
- [ ] No secret, token, real IP or personal data was added.
- [ ] User-facing text is in English; identifiers match the surrounding code.
- [ ] Every internal link and every `docs/media/` placeholder still resolves.

## License

By contributing, you agree that your contribution is licensed under the [Apache License 2.0](LICENSE). See
[`NOTICE`](NOTICE) for the project attribution.
