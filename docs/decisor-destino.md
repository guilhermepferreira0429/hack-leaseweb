# Decisor de destino: self-hosted ou serviço gerido europeu

Para o migrador decidir onde fica cada serviço. Os agentes de código montam o decisor a partir deste ficheiro. Ver também `ferramentas.md`, secção "Planeador de destino".

## Princípios

1. **As regras decidem, a IA explica.** O modelo nunca escolhe o destino nem inventa preços.
2. **Leaseweb primeiro.** Se a Leaseweb tiver o serviço gerido, é essa a escolha. Outro fornecedor europeu só quando a Leaseweb não o tiver.
3. **Só fornecedores com sede e dados na UE.**
4. **Preços só da tabela abaixo,** com a data em que foram vistos. Se um preço tiver mais de 30 dias, o agente diz "preço a confirmar".
5. **O dono decide no fim:** "recomendado" ou "tudo self-hosted".

## Entradas do decisor

| Entrada | De onde vem |
|---|---|
| RAM, vCPU e disco livres da VM de destino | API da Leaseweb (tipo de instância) ou `free -h` / `df -h` |
| Serviços encontrados e tamanho dos dados | `migrador/analisar.ts` |
| Criticidade de cada serviço (alta, média, baixa) | Pergunta ao dono no Telegram; por defeito, base de dados = alta |
| Dados pessoais (sim/não) | Pergunta ao dono; por defeito, base de dados = sim |
| Precisa de alta disponibilidade (sim/não) | Derivado: criticidade alta → sim |

## Recursos mínimos para self-hosted (valores de referência do decisor)

| Serviço | RAM mínima | Disco | Notas |
|---|---|---|---|
| MinIO | 1 GB | dados × 1,2 | |
| PostgreSQL | 1 GB (2 GB recomendado) | dados × 1,5 | Backups por nossa conta |
| NATS | 256 MB | baixo | |
| RabbitMQ | 512 MB | baixo | |
| Valkey (Redis) | dados em RAM × 1,5 | baixo | |

Estes valores são regras de bolso do decisor, não medições. Margem: deixar sempre 25% da RAM da VM livre.

## Regras (por ordem; a primeira que se aplicar ganha)

1. Criticidade **alta** e precisa de alta disponibilidade → **gerido**.
2. **Não cabe** na VM (RAM ou disco abaixo do mínimo, com a margem de 25%) → **gerido**.
3. Dados pessoais e o dono não tem backups → **gerido** (backups e cifra geridos).
4. Tudo o resto → **self-hosted na VM da Leaseweb**.

Para escolher o gerido:

1. Existe gerido na Leaseweb? → Leaseweb.
2. Senão → o mais barato da tabela que cumpra os requisitos (alta disponibilidade, região UE).
3. Empate → o que tiver região mais perto do cliente.

## Tabela de preços (vista a 20/11/2026)

Preços sem IVA. Confirmar sempre na página do fornecedor antes de mostrar a um cliente real.

### Armazenamento de objetos (S3 compatível)

| Fornecedor | Produto | Preço | Fonte |
|---|---|---|---|
| **Leaseweb** | Object Storage, on demand | € 0,01733/GB/mês (0 a 50 TB) | leaseweb.com/en/products-services/object-storage |
| **Leaseweb** | Object Storage, com compromisso (desde 500 GB) | € 0,01485/GB/mês (até 50 TB) | leaseweb.com/object-storage |
| **Leaseweb** | Tráfego de saída | € 0,0022/GB (0 a 10 TB/mês); entrada grátis | european-alternatives.eu/product/leaseweb-object-storage |
| Exoscale | Object Storage Standard | € 0,0184/GB/mês | exoscale.com/object-storage/classes |

Decisão: **a Leaseweb tem armazenamento de objetos gerido**, por isso o S3 vai para lá (gerido) ou para MinIO na VM (self-hosted).

### PostgreSQL gerido

| Fornecedor | Plano | Preço | Fonte |
|---|---|---|---|
| **Leaseweb** | Não encontrámos PostgreSQL gerido na Public Cloud | — | Confirmar no dia com a Leaseweb |
| Scaleway | DB-DEV-S (2 vCPU, 2 GB) | € 0,0156/hora (cerca de € 11/mês) | scaleway.com/en/pricing/managed-databases-pricing |
| UpCloud | 1 nó, 2 GB, 25 GB, backups 24 h | € 30/mês | upcloud.com/docs/products/managed-postgresql/pricing |
| OVHcloud | Essential db1-7 (2 vCPU, 7 GB, 50 GB) | 0,17 USD/hora | sparecores.com/database/ovh/postgresql-essential-db1-7 |

Decisão: como a Leaseweb não tem PostgreSQL gerido (a confirmar), uma base de dados crítica vai para o gerido europeu mais barato da tabela. **No pitch, dizer "a Leaseweb ainda não tem base de dados gerida; aí recomendamos um parceiro europeu" só se a Leaseweb o confirmar.** Alternativa segura: recomendar PostgreSQL self-hosted na Leaseweb com backups para o Object Storage da Leaseweb.

### Kubernetes gerido

| Fornecedor | Produto | Preço | Fonte |
|---|---|---|---|
| **Leaseweb** | Managed Kubernetes | Gestão sem custo extra; paga-se os nós | leaseweb.com (página Managed Kubernetes) |

### Instâncias para self-hosted

Preço da VM da Leaseweb: **preencher no dia** a partir do portal (tipo de instância usado e preço/hora).

## Mensagem no Telegram (modelo)

> **Migrador:** A tua VM tem {ram} GB de RAM livres. O {serviços_self} ficam nela. A base de dados {nome} é crítica e tem dados pessoais: proponho {fornecedor} {plano}, cerca de € {preço}/mês (preço visto a {data}). Porquê: {regra}. [Aprovar recomendado] [Tudo self-hosted] [Porquê?]

`{regra}` é o texto da regra que ganhou, escrito pela IA em português simples.

## Nível

- **B:** recomendação com regras e mensagem no Telegram.
- **C:** criar os serviços geridos pelas APIs de cada fornecedor; preços atualizados automaticamente.
