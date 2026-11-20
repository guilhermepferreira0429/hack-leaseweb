# Arquitetura

## Máquinas (Leaseweb, região UE)

| VM | Para quê | Configuração |
|---|---|---|
| **cérebro** | Corre o serviço (agentes + painel), o LocalStack e o MinIO da demo | SSH só por chave e só do nosso IP; porta do painel aberta ao nosso IP |
| **vítima** | A falha da demo | Security group com `5432/tcp` aberto a `0.0.0.0/0` e um escutador inofensivo (`nc -lk 5432`) para o `nmap` dar `open` antes e `filtered` depois |
| **isco** | O número da abertura do pitch | Ligado de manhã. SSH só por chave, porta 22 aberta a todos, nenhum serviço real |

## VM da organização (analisar às 09:30, Enio Carlos, 10 min)

A organização dá uma VM Linux por equipa, desligada no fim do evento. Antes de criar outras máquinas, ver:

1. **Recursos:** `nproc`, `free -h`, `df -h`, `cat /etc/os-release`. Aguenta Node, Docker, LocalStack e MinIO juntos?
2. **Rede:** IP público, saída para a Internet (`curl -I https://api.telegram.org`), portas abertas.
3. **Docker:** instalado ou instalável.
4. **A mais importante:** aparece na API da Leaseweb com a nossa chave (`GET /instances`) e dá para mexer no security group dela?

Decisão:

| Resultado | Papel da VM |
|---|---|
| Aparece na API e tem recursos | **Vítima** (poupa uma máquina), ou cérebro e vítima ao mesmo tempo |
| Não aparece na API | **Cérebro** (agentes, LocalStack, MinIO). A vítima cria-se na nossa conta, porque a demo depende de fechar a porta pela API |
| É fraca | Só **isco** |

Registar o resultado em `leaseweb-api.md`, nas notas.

## Contentores (Enio Carlos monta, todos usam)

Tudo no **cérebro**, em contentores separados, definidos em `env/docker-compose.yml`:

| Contentor | Faz de | Porta (só 127.0.0.1) |
|---|---|---|
| `localstack` | "AWS" simulada: S3 e SQS (a origem) | 4566 |
| `postgres` | Base de dados da `exemplo-app` (faz de RDS) | 5433 |
| `minio` | Destino do S3 na Leaseweb | 9000 e consola 9001 |

```bash
# no cérebro, na raiz do repo, com o .env preenchido
npm run infra:up      # sobe os 3 contentores
docker compose -f env/docker-compose.yml ps
npm run infra:down    # desliga
```

- Tudo ligado só a `127.0.0.1`: o cérebro não expõe nada por engano.
- A **vítima é sempre outra VM**, com o seu próprio security group: é a porta dela que o atacante encontra e a defesa fecha pela API. Não pode ser o cérebro, porque um `nmap` da própria máquina a si mesma não passa pelo security group.
- Se a VM da organização sobrar, pode ficar com o `localstack` (a "AWS"), para se ver a passagem de uma máquina para outra.
- No pitch: "simulámos a AWS com o LocalStack".

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

Os agentes falam entre si por um bus interno (`shared/bus.ts`). O Telegram é só o palco: cada agente tem o seu bot e publica a sua fala no grupo "Direção". Ver `agentes-telegram.md`.

## Pastas

```
code/
  shared/      tipos.ts, bus.ts, leaseweb.ts, llm.ts, telegram.ts, auditoria.ts, estado.ts
  chefe/       resumo.ts (coordena e resume)
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
