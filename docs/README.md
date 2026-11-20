# docs

**⭐ Importante: `agentes/`** (vozes, mensagens da demo e roteiro do dia). Ler antes de mexer no que os agentes dizem.

Ordem de leitura:

1. `plano.md`: o que fazemos, prioridades, cortes e salvaguardas.
2. `execucao.md`: quem faz o quê e o horário.
3. `arquitetura.md`: máquinas, fluxo e pastas.
4. `interfaces.md`: contratos entre as peças.
5. `ideias-wow.md`: **ideias para impressionar o júri** (júri a aprovar, relógio de exposição, certificado, modo noite, PR que corrige a causa).
6. `ferramentas.md`: catálogo de ferramentas por níveis.
7. `agentes-telegram.md`: falar com os agentes no Telegram.
8. `leaseweb-api.md` e `telegram.md`: integrações (API da Leaseweb, bots e grupo do Telegram).
9. `demo.md`: o guião da demo. O plano do pitch está em `notas-equipa/pitch.md` (interno).
10. `riscos.md`.
11. `decisor-destino.md`: regras e preços para o migrador decidir self-hosted ou gerido europeu.
12. `perguntas-juri.md`: perguntas difíceis e respostas de 20 segundos, para treinar.
13. `painel-web.md`: o ecrã da demo. Desenhos em `material/design/` (`pitching.pen`, `web.pen`).
14. `certificado-migracao.md`: o certificado que o Chefe envia e o painel mostra no fim.

`agentes/`:

- `README.md`: regras das mensagens (texto fixo primeiro, só factos medidos, nada promete ações).
- `vozes.md`: persona e regras de cada agente (`code/shared/voz.ts`).
- `mensagens-demo.md`: texto de cada passo da demo, botões e linha "a pensar" (`code/shared/mensagens.ts`).
- `checkup-12h.md`: primeira demo de ponta a ponta e repo público dos PR.
- `roteiro-dia.md`: o que ligar e verificar das 15:00 às 15:45.

`research/` (em inglês, pesquisa do dia):

- `README.md`: índice da pesquisa.
- `aws-to-leaseweb-mapping.md`: o que o tradutor faz com cada serviço AWS (`code/migrador/tradutor/`).
- `leaseweb-api.md`: a API da Leaseweb verificada contra o SDK oficial.
- `detection-and-response.md`: detetar e responder durante a migração.
- `stats-and-sources.md`: números e fontes para o pitch.
