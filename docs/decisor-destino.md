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

| Serviço (AWS) | Alternativa aberta | RAM mínima | Disco | Notas |
|---|---|---|---|---|
| S3 | MinIO | 1 GB | dados × 1,2 | |
| RDS PostgreSQL | PostgreSQL | 1 GB (2 GB recomendado) | dados × 1,5 | Backups por nossa conta |
| RDS MySQL | MariaDB | 1 GB | dados × 1,5 | |
| ElastiCache | Valkey | dados em RAM × 1,5 | baixo | |
| DynamoDB | ScyllaDB (Alternator) | 2 GB | dados × 2 | Pesado para VMs pequenas |
| DocumentDB | MongoDB / FerretDB | 1 GB | dados × 1,5 | |
| SQS / SNS | NATS | 256 MB | baixo | |
| SQS (AMQP) | RabbitMQ | 512 MB | baixo | |
| MSK (Kafka) | Kafka / Redpanda | 2 GB | alto | Raramente vale a pena self-hosted numa PME |
| Secrets Manager | OpenBao | 256 MB | baixo | Crítico: perder isto é perder tudo |
| ECR | Harbor | 2 GB | imagens × 1,2 | |
| CloudWatch Logs | Loki + Grafana | 1 GB | logs × retenção | |
| Cognito | Keycloak | 1 GB | baixo | |
| SES | Postal | 1 GB | baixo | Entregabilidade difícil em self-hosted |
| Route 53 | PowerDNS | 256 MB | baixo | |
| ELB | HAProxy / Caddy | 256 MB | baixo | |
| EKS | k3s | 2 GB | médio | |

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

Preços sem IVA. "A confirmar" = o serviço existe mas não encontrámos o preço publicado. O decisor só mostra preços com data; os "a confirmar" aparecem como "preço a confirmar".

### O que a Leaseweb tem (escolha preferida)

| Serviço | Produto Leaseweb | Preço | Fonte |
|---|---|---|---|
| VM | Public Cloud LSW.C3.LARGE (2 vCPU, 3 GB) | € 0,0395/h, € 26,02/mês | leaseweb.com/products-services/cloud/public-cloud/pricing |
| VM | Public Cloud LSW.M3.LARGE (2 vCPU, 7 GB) | € 0,0447/h, € 29,44/mês | idem |
| VM | Public Cloud LSW.R3.LARGE (2 vCPU, 15,25 GB) | € 0,0555/h, € 36,49/mês | idem |
| Disco | Network SSD (até 5K IOPS) | € 0,0800/GB/mês | idem |
| Tráfego | 1 TB/mês grátis partilhado; entrada grátis | — | idem |
| Objetos (S3) | Object Storage on demand | € 0,01733/GB/mês (0 a 50 TB) | leaseweb.com/en/products-services/object-storage |
| Objetos (S3) | Object Storage com compromisso (desde 500 GB) | € 0,01485/GB/mês | leaseweb.com/object-storage |
| Balanceador (ELB) | Load balancer como serviço (HAProxy), corre numa instância | Preço da instância escolhida | kb.leaseweb.com (load balancer of Public Cloud) |
| Kubernetes (EKS) | Managed Kubernetes | Gestão sem custo extra; base € 21,60/mês; vCPU € 0,0038/h, RAM € 0,0019/GB/h | leaseweb.com/en/configure/vc/product/entityKey/KUBERNETES/2001 |
| CDN (CloudFront) | Leaseweb CDN | A confirmar (listagens de terceiros dão desde cerca de 0,01 $/GB) | Confirmar com a Leaseweb |
| Bases de dados geridas | **Não encontrámos** na Public Cloud | — | Confirmar no dia com a Leaseweb |

### Serviços geridos europeus quando a Leaseweb não tem

| Serviço (AWS) | Fornecedor | Plano | Preço | Fonte |
|---|---|---|---|---|
| RDS PostgreSQL / MySQL | Scaleway | DB-DEV-S (2 vCPU, 2 GB) | € 0,0156/h (cerca de € 11/mês) | scaleway.com/en/pricing/managed-databases-pricing |
| RDS PostgreSQL | UpCloud | 1 nó, 2 GB, 25 GB, backups 24 h | € 30/mês | upcloud.com/docs/products/managed-postgresql/pricing |
| RDS PostgreSQL | OVHcloud | Essential db1-7 (2 vCPU, 7 GB, 50 GB) | 0,17 $/h | sparecores.com/database/ovh/postgresql-essential-db1-7 |
| Backups de BD | Scaleway | Backups/snapshots | € 0,03/GB/mês | scaleway.com (managed databases pricing) |
| ElastiCache (Redis) | Scaleway | RED1-MICRO (2 vCPU, 2 GB) | desde € 0,048/h | scaleway.com/fr/tarifs/managed-databases |
| DocumentDB (MongoDB) | Scaleway | MGDB-PLAY2-NANO (2 vCPU, 4 GB) | € 0,1077/h + armazenamento | scaleway.com/en/pricing/managed-databases-pricing |
| SQS | Scaleway | Queues (SQS compatível) | € 0,01/GB | scaleway.com/en/pricing/managed-databases-pricing |
| SQS / SNS (NATS) | Scaleway | NATS | € 0,01/GB; persistência cerca de € 0,14/GB/mês | idem |
| MSK (Kafka) | OVHcloud / Scaleway | Kafka gerido | A confirmar | ovhcloud.com (choosing right database); scaleway.com |
| CloudWatch Logs | Scaleway | Cockpit, logs custom | € 0,35/GB ingerido | scaleway.com/en/pricing/managed-services |
| SES | Scaleway | Transactional Email (por destinatário) | A confirmar | scaleway.com/transactional-email-tem |
| Secrets Manager | Scaleway | Secret Manager | A confirmar | scaleway.com/en/docs/secret-manager/faq |
| ECR | Scaleway | Container Registry (paga-se o armazenado; entrada grátis) | A confirmar | scaleway.com/en/pricing/containers |
| ELB | OVHcloud | Load Balancer | 6,94 $/mês | pricingsaas.com/companies/ovhcloud.publiccloud |
| S3 (comparação) | Exoscale | Object Storage Standard | € 0,0184/GB/mês | exoscale.com/object-storage/classes |
| S3 (comparação) | OVHcloud | Object Storage Standard | 8,3 $/TiB/mês | pricingsaas.com/companies/ovhcloud.publiccloud |

### Como o decisor usa isto

- Serviço que a **Leaseweb tem gerido** (objetos, Kubernetes, balanceador) → Leaseweb.
- Serviço que a Leaseweb **não tem gerido** (bases de dados, Redis, filas, logs, email, segredos):
  - não crítico e cabe na VM → **self-hosted na Leaseweb** (tabela de recursos acima);
  - crítico ou não cabe → **o gerido europeu mais barato desta tabela**, com o preço e a data.
- Preço "a confirmar" → mostrar o fornecedor, dizer "preço a confirmar" e não fazer contas.

## Mensagem no Telegram (modelo)

> **Migrador:** A tua VM tem {ram} GB de RAM livres. O {serviços_self} ficam nela. A base de dados {nome} é crítica e tem dados pessoais: proponho {fornecedor} {plano}, cerca de € {preço}/mês (preço visto a {data}). Porquê: {regra}. [Aprovar recomendado] [Tudo self-hosted] [Porquê?]

`{regra}` é o texto da regra que ganhou, escrito pela IA em português simples.

## Nível

- **B:** recomendação com regras e mensagem no Telegram.
- **C:** criar os serviços geridos pelas APIs de cada fornecedor; preços atualizados automaticamente.
