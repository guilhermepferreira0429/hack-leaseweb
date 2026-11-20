# Documentation

The public documentation is in English. The team's working notes from the event are also here; most are in
Portuguese and were written for the team, not for a reader coming to the project for the first time.

## Start here

1. [`../README.md`](../README.md): the project overview, quickstart, safety rules and repository map.
2. [`ARCHITECTURE.md`](ARCHITECTURE.md): the orchestrator and the agent bus, the AWS → Leaseweb translation rules,
   the detection and response sequence, the certificate and the audit log.
3. [`RUNBOOK.md`](RUNBOOK.md): reproduce the demo step by step, with the Telegram messages and the checks.
4. [`install.md`](install.md): full setup from zero — brain VM, victim VM on Leaseweb, Telegram bots, EU LLM and
   the problems we hit.
5. [`leaseweb-api.md`](leaseweb-api.md) and [`research/leaseweb-api.md`](research/leaseweb-api.md): the endpoints
   we use and what we measured against the real API.
6. [`research/`](research/README.md): the research behind the service mapping, the detection rules and the numbers
   with sources.
7. [`media/SHOTLIST.md`](media/SHOTLIST.md): the project's screenshots, with the exact paths used in the
   docs.
8. [`../CONTRIBUTING.md`](../CONTRIBUTING.md): how to run, change and test the repository.

## Team working notes

Written during the event, in Portuguese unless noted. These are the source for the public docs above.

| File                                                 | What it covers                                         |
| ---------------------------------------------------- | ------------------------------------------------------ |
| [`plano.md`](plano.md)                               | What we build, priorities, cuts and safeguards.        |
| [`execucao.md`](execucao.md)                         | Who does what, and the day's schedule.                 |
| [`arquitetura.md`](arquitetura.md)                   | Machines, containers, ports and folder layout.         |
| [`interfaces.md`](interfaces.md)                     | The contracts between the modules.                     |
| [`ideias-wow.md`](ideias-wow.md)                     | The features that make the demo, by level.             |
| [`ferramentas.md`](ferramentas.md)                   | The tool catalogue, by level.                          |
| [`agentes-telegram.md`](agentes-telegram.md)         | Talking to the four agents in Telegram.                |
| [`telegram.md`](telegram.md)                         | Bots, group, commands, permissions and the smoke test. |
| [`riscos.md`](riscos.md)                             | Risks and mitigations.                                 |
| [`decisor-destino.md`](decisor-destino.md)           | Destination rules and dated prices.                    |
| [`perguntas-juri.md`](perguntas-juri.md)             | Hard questions and short answers.                      |
| [`painel-web.md`](painel-web.md)                     | The dashboard screens and their purpose.               |
| [`certificado-migracao.md`](certificado-migracao.md) | The certificate fields and rules.                      |

`agentes/`:

- [`README.md`](agentes/README.md): the rules for agent messages (fixed text first, only measured facts, never
  promise an action).
- [`vozes.md`](agentes/vozes.md): each agent's persona and rules (`code/shared/voz.ts`).
- [`mensagens-demo.md`](agentes/mensagens-demo.md): the text of each demo step, the buttons and the "thinking"
  line (`code/shared/mensagens.ts`).
- [`checkup-12h.md`](agentes/checkup-12h.md): the first end-to-end run and the public repo for the PRs.
- [`roteiro-dia.md`](agentes/roteiro-dia.md): what to switch on and check during the day.

`research/` (in English, gathered during the event):

- [`README.md`](research/README.md): the research index.
- [`aws-to-leaseweb-mapping.md`](research/aws-to-leaseweb-mapping.md): what the translator does with each AWS
  service (`code/migrador/tradutor/`).
- [`leaseweb-api.md`](research/leaseweb-api.md): the Leaseweb API checked against the official SDK.
- [`detection-and-response.md`](research/detection-and-response.md): detecting and responding during the migration.
- [`stats-and-sources.md`](research/stats-and-sources.md): the numbers and sources used in the README.
