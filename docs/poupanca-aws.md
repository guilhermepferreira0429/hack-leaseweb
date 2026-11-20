# Poupança vs AWS (app de exemplo, preços de 20/11/2026)

Cenário: a app de exemplo (app + PostgreSQL + Redis + S3 com 100 GB + SQS + 5 segredos), on-demand, uma zona, região Frankfurt (eu-central-1). Sem armazenamento de disco nem tráfego de saída em nenhum dos lados.

| Serviço | AWS (Frankfurt) | $/mês | Leaseweb | €/mês |
|---|---|---|---|---|
| App | EC2 t3.medium, $0,048/h | 35,04 | uma VM LSW.M3.LARGE (2 vCPU, 7 GB) com tudo self-hosted | 29,44 |
| PostgreSQL | RDS db.t4g.small, $0,037/h | 27,01 | na VM | 0 |
| Redis | ElastiCache cache.t4g.micro, $0,016/h (preço de us-east-1, Frankfurt é igual ou mais caro) | 11,68 | Valkey na VM | 0 |
| Ficheiros | S3 Standard 100 GB, $0,0245/GB | 2,45 | Object Storage 100 GB, €0,01733/GB | 1,73 |
| Fila | SQS, 1.º milhão de pedidos grátis | 0 | RabbitMQ na VM | 0 |
| Segredos | Secrets Manager, 5 × $0,40 | 2,00 | OpenBao na VM | 0 |
| Backups | (incluídos no RDS) | — | Acronis 25 GB | 3,75 |
| **Total** | | **≈ $78** | | **≈ €35** |

**Leitura:** cerca de **55% menos** por mês. Conta feita com $1 = €1, o que favorece a AWS (o euro vale mais do que o dólar), por isso a poupança real é maior.

**Com RDS Multi-AZ** ($0,074/h, $54/mês) a AWS sobe para cerca de $105/mês.

**Cuidados para o pitch:**
- É a nossa app de exemplo, não um cliente real. Dizer "for this sample app".
- Self-hosted quer dizer que alguém opera a base de dados (atualizações, alta disponibilidade). É o trabalho que os agentes fazem.
- Tráfego de saída: a AWS cobra $0,09/GB depois de 100 GB grátis por mês. Não pusemos o da Leaseweb na conta porque não está confirmado.

**Fontes:** RDS db.t4g.small Frankfurt (sparecores.com); ElastiCache cache.t4g.micro (instances.vantage.sh); EC2 t3.medium eu-central-1 (doit.com); S3 Frankfurt (upstash.com); Leaseweb em `docs/decisor-destino.md`.
