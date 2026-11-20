# Arquitetura

Public, English overview: [`ARCHITECTURE.md`](ARCHITECTURE.md). This file is the team's lab layout.

## Máquinas (Leaseweb, região UE)

| VM          | Para quê                                                           | Configuração                                                                                                                                    |
| ----------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **cérebro** | Corre o serviço (agentes + painel), o LocalStack e o MinIO da demo | SSH só por chave e só do nosso IP; porta do painel aberta ao nosso IP                                                                           |
| **vítima**  | A falha da demo                                                    | Security group com `5432/tcp` aberto a `0.0.0.0/0` e um escutador inofensivo (`nc -lk 5432`) para o `nmap` dar `open` antes e `filtered` depois |
| **isco**    | O número da abertura do pitch                                      | Ligado de manhã. SSH só por chave, porta 22 aberta a todos, nenhum serviço real                                                                 |

## Divisão: o servidor do dono e o fornecedor de cloud

São duas camadas diferentes. Não se misturam.

1. **A VM é o servidor do dono da PME (self-hosted).** É lá que correm a app e os serviços abertos que substituem
   a AWS: MinIO (S3), PostgreSQL (RDS), RabbitMQ (SQS), OpenBao (Secrets Manager) e Valkey (ElastiCache). Na demo
   correm em contentores. O migrador copia os dados para lá, o atacante testa essa máquina e a defesa protege-a.
   É a mesma VM que um dono teria na Leaseweb, na Hostinger, na OVHcloud ou noutro sítio.
2. **A API da Leaseweb é o fornecedor (provider).** Só trata do que está à volta da máquina: as instâncias e a
   firewall (security groups e regras). A defesa fecha portas por ela e o tradutor traduz a configuração da AWS
   para ela. É um fornecedor entre vários: Hostinger, OVHcloud, Hetzner ou Scaleway teriam o seu próprio
   adaptador, com as mesmas operações.

| Camada           | Na demo                                                                      | Num cliente real                 |
| ---------------- | ---------------------------------------------------------------------------- | -------------------------------- |
| Servidor do dono | VM com os contentores (MinIO, PostgreSQL, RabbitMQ, OpenBao, Valkey) e a app | O VPS ou servidor da PME         |
| Fornecedor       | API da Leaseweb: instâncias e firewall                                       | Leaseweb, Hostinger, OVHcloud, … |
| "AWS" de origem  | LocalStack (e um Redis a fazer de ElastiCache)                               | A conta AWS do cliente           |

Regras para o código:

- Tudo o que fala com a API do fornecedor fica em `code/shared/leaseweb.ts` (`listarSecurityGroups`,
  `listarRegras`, `removerRegra`, `criarRegra`, …). A defesa, o orquestrador e o chefe usam estas funções e não
  chamam a API diretamente. Outro fornecedor seria outro ficheiro com as mesmas funções.
- O que corre dentro da VM (serviços, dados, a app e os testes dela) não depende do fornecedor: o migrador e o
  `verificar()` são iguais em qualquer um.
- Hoje só existe o adaptador da Leaseweb. Hostinger e OVHcloud ficam para o slide "o que vem a seguir". No pitch
  não se diz que já funcionam.

## VM da organização (analisar às 09:30, Enio Carlos, 10 min)

A organização dá uma VM Linux por equipa, desligada no fim do evento. Antes de criar outras máquinas, ver:

1. **Recursos:** `nproc`, `free -h`, `df -h`, `cat /etc/os-release`. Aguenta Node, Docker, LocalStack e MinIO juntos?
2. **Rede:** IP público, saída para a Internet (`curl -I https://api.telegram.org`), portas abertas.
3. **Docker:** instalado ou instalável.
4. **A mais importante:** aparece na API da Leaseweb com a nossa chave (`GET /instances`) e dá para mexer no security group dela?

Decisão:

| Resultado                     | Papel da VM                                                                                                                 |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Aparece na API e tem recursos | **Vítima** (poupa uma máquina), ou cérebro e vítima ao mesmo tempo                                                          |
| Não aparece na API            | **Cérebro** (agentes, LocalStack, MinIO). A vítima cria-se na nossa conta, porque a demo depende de fechar a porta pela API |
| É fraca                       | Só **isco**                                                                                                                 |

Registar o resultado em `leaseweb-api.md`, nas notas.

## Contentores (Enio Carlos monta, todos usam)

Tudo no **cérebro**, em contentores separados, definidos em `env/docker-compose.yml`:

| Contentor          | Faz de                                                    | Porta (só 127.0.0.1) |
| ------------------ | --------------------------------------------------------- | -------------------- |
| `localstack`       | "AWS" simulada: S3, SQS, Secrets Manager e SSM (a origem) | 4566                 |
| `postgres`         | Base de dados da `exemplo-app` (faz de RDS, a origem)     | 5433                 |
| `postgres-destino` | Destino do RDS na Leaseweb                                | 5434                 |
| `minio`            | Destino do S3 na Leaseweb                                 | 9000 e consola 9001  |
| `rabbitmq`         | Destino da fila SQS na Leaseweb                           | 5672 e consola 15672 |
| `redis-origem`     | Faz de ElastiCache Redis (a origem)                       | 6380                 |
| `valkey`           | Destino do ElastiCache na Leaseweb                        | 6381                 |
| `openbao`          | Destino dos segredos (Secrets Manager e SSM) na Leaseweb  | 8200                 |

```bash
# no cérebro, na raiz do repo, com o .env preenchido
npm run infra:up      # sobe os 8 contentores
docker compose -f env/docker-compose.yml ps
npm run infra:down    # desliga
```

- Tudo ligado só a `127.0.0.1`: o cérebro não expõe nada por engano.
- A **vítima é sempre outra VM**, com o seu próprio security group: é a porta dela que o atacante encontra e a defesa fecha pela API. Não pode ser o cérebro, porque uma ligação da própria máquina a si mesma não passa pelo security group.
- Se a VM da organização sobrar, pode ficar com o `localstack` (a "AWS"), para se ver a passagem de uma máquina para outra.
- No pitch: "simulámos a AWS com o LocalStack".

## Fluxo

```
            ┌─────────────── cérebro ───────────────┐
 "AWS"      │                                       │
 LocalStack │  migrador ──► MinIO / Postgres /       │
 + Redis    │     │   RabbitMQ / OpenBao / Valkey      │
            │     │ plano + "Approve plan" ──────────────► Telegram (dono)
            │     ▼ concluído                        │        │ Approve / Close
            │  atacante ──► ligação TCP só aos ALVOS ────► vítima
            │     │ achados                          │        │
            │     ▼                                  │        │
            │  defesa ──► LLM (TensorX/sference)     │        │
            │     │ explicação + "Close?" ────────────────────┘
            │     ▼ aprovado                         │
            │  API Leaseweb: remove regra, volta a ler │
            │  nmap: filtered · auditoria.jsonl      │
            │  migrador ──► PR que corrige a causa   │
            │  painel: linha do tempo + Desfazer     │
            └───────────────────────────────────────┘
```

Um só processo Node no cérebro: um orquestrador chama os módulos e o painel lê o estado e a auditoria. Simples de pôr a correr e de mostrar.

Os agentes falam entre si por um bus interno (`shared/bus.ts`). O Telegram é só o palco: cada agente tem o seu bot e publica a sua fala no grupo "Direção". Ver `agentes-telegram.md`.

## Pastas

```
code/
  shared/      tipos.ts, bus.ts, leaseweb.ts, llm.ts, telegram.ts, auditoria.ts, estado.ts,
               voz.ts (voz dos agentes), mensagens.ts (textos fixos da demo), relatorio.ts
  chefe/       resumo.ts, certificado.ts (coordena, resume e escreve o certificado)
  migrador/    analisar.ts, migrar-dados.ts (S3), migrar-postgres.ts, migrar-fila.ts,
               migrar-segredos.ts, migrar-cache.ts, verificar.ts
    tradutor/  Terraform -> plano Leaseweb, decisor de destino, correção do Terraform
    codigo/    encontra os usos da AWS na app e abre o PR que corrige a causa
  atacante/    alvos.ts, reconhecimento.ts (ligação TCP), index.ts (passo de senhas SSH),
               credenciais.ts, segredos.ts, extras.ts
  defesa/      detetar.ts, explicar.ts, aprovar.ts, corrigir.ts, desfazer.ts, modo-noite.ts,
               verificar-porta.ts (nmap)
  painel/      servidor.ts (/, /isco, /estado.json), linha-tempo.ts, certificado.ts
  exemplo-app/ app pequena que usa serviços da AWS, com dados de exemplo e testes
  index.ts     orquestrador (liga os módulos); orquestrador.ts (a lógica)
```

## Portas sensíveis

Severidade alta: 22 SSH, 23 Telnet, 445 SMB, 1433 SQL Server, 3306 MySQL, 3389 RDP, 5432 PostgreSQL, 5984 CouchDB, 6379 Redis, 9200 Elasticsearch, 27017 MongoDB. Qualquer outra porta aberta a toda a Internet: média.

## IA

- Cliente compatível com a API da OpenAI, configurável por `.env` (`LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`), para TensorX ou sference, ambos na UE.
- Máximo 3 frases e 600 caracteres, inglês simples: o que está aberto, o que um atacante podia fazer, o que acontece se o dono aprovar.
- Timeout de 20 s. Se falhar, texto fixo por serviço. A demo nunca espera pela IA.
