# ⭐ docs/agentes: a voz e as mensagens dos agentes (IMPORTANTE)

Esta pasta define **o que cada agente diz**, no Telegram e no painel. O código lê daqui; quem mexe nas mensagens mexe aqui primeiro.

| Ficheiro | Para quê | Onde entra no código |
|---|---|---|
| `vozes.md` | Persona e regras de cada agente (prompts de sistema) | `code/shared/voz.ts` (`PERSONAS`, `REGRAS`) e `code/shared/llm.ts` |
| `mensagens-demo.md` | Texto fixo de cada passo da demo, com botões e variáveis | `code/orquestrador.ts`, `code/shared/telegram.ts`, painel (linha "a pensar") |
| `checkup-12h.md` | Primeira demo de ponta a ponta às 12:00 e repo público dos PR | Ninguém: é para as pessoas |
| `roteiro-dia.md` | O que ligar e verificar das 15:00 às 15:45 | Ninguém: é para as pessoas |

Regras que valem para tudo:

1. **O texto fixo é a base; a IA só melhora.** Cada mensagem da demo existe em texto fixo. A IA pode reescrever a explicação (máximo 3 frases, 600 caracteres, timeout 20 s); se falhar ou demorar, sai o texto fixo. A demo nunca espera pelo modelo.
2. **Só factos medidos.** As variáveis `{...}` vêm do estado e da auditoria. Nunca da IA.
3. **Nenhuma mensagem promete uma ação.** As ações só acontecem pelos botões.
4. **Português de Portugal, para quem não é técnico.** No pitch fala-se inglês; no Telegram o dono é português.
