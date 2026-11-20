# Arquitetura

## Máquinas (Leaseweb, região UE)

| VM | Para quê | Configuração |
|---|---|---|
| **cérebro** | Corre o serviço (agentes + painel), o LocalStack e o MinIO da demo | SSH só por chave e só do nosso IP; porta do painel aberta ao nosso IP |
| **vítima** | A falha da demo | Security group com `5432/tcp` aberto a `0.0.0.0/0` e um escutador inofensivo (`nc -lk 5432`) para o `nmap` dar `open` antes e `filtered` depois |
| **isco** | O número da abertura do pitch | Ligado de manhã. SSH só por chave, porta 22 aberta a todos, nenhum serviço real |

Se a conta Leaseweb falhar, a VM que a organização dá serve de cérebro.

## Fluxo

```
            ┌─────────────── cérebro ───────────────┐
 "AWS"      │                                       │
 LocalStack │  migrador ──► MinIO / Postgres         │
 (S3,SQS)   │     │ plano + "aprovar?" ─────────────────► Telegram (dono)
            │     ▼ concluído                        │        │ Aprovar / Fechar
            │  atacante ──► nmap só aos ALVOS ───────────► vítima
            │     │ achados                          │        │
            │     ▼                                  │        │
            │  defesa ──► LLM (TensorX/sference)     │        │
            │     │ explicação + "Fechar?" ───────────────────┘
            │     ▼ aprovado                         │
            │  API Leaseweb: remove regra, volta a ler │
            │  nmap: filtered · auditoria.jsonl      │
            │  painel: linha do tempo + Desfazer     │
            └───────────────────────────────────────┘
```

Um só processo Node no cérebro: um orquestrador chama os módulos e o painel lê o estado e a auditoria. Simples de pôr a correr e de mostrar.

## Pastas

```
code/
  shared/      tipos.ts, leaseweb.ts, llm.ts, telegram.ts, auditoria.ts, estado.ts
  migrador/    analisar.ts, migrar-dados.ts, verificar.ts
  atacante/    alvos.ts, reconhecimento.ts
  defesa/      detetar.ts, explicar.ts, aprovar.ts, corrigir.ts, desfazer.ts
  painel/      servidor.ts (/, /isco, /estado.json)
  exemplo-app/ app pequena com S3, Postgres e fila, com testes
  index.ts     orquestrador
```

## Portas sensíveis

Severidade alta: 22 SSH, 23 Telnet, 445 SMB, 1433 SQL Server, 3306 MySQL, 3389 RDP, 5432 PostgreSQL, 5984 CouchDB, 6379 Redis, 9200 Elasticsearch, 27017 MongoDB. Qualquer outra porta aberta a toda a Internet: média.

## IA

- Cliente compatível com a API da OpenAI, configurável por `.env` (`LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`), para TensorX ou sference, ambos na UE.
- Máximo 3 frases e 600 caracteres, português simples: o que está aberto, o que um atacante podia fazer, o que acontece se o dono aprovar.
- Timeout de 20 s. Se falhar, texto fixo por serviço. A demo nunca espera pela IA.
