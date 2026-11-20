# Savings vs AWS (sample app, prices from 20/11/2026)

Scenario: the sample app (app + PostgreSQL + Redis + S3 with 100 GB + SQS + 5 secrets), on-demand, a single zone, Frankfurt region (eu-central-1). No disk storage and no outbound traffic on either side.

| Service | AWS (Frankfurt) | $/month | Leaseweb | €/month |
|---|---|---|---|---|
| App | EC2 t3.medium, $0.048/h | 35.04 | one LSW.M3.LARGE VM (2 vCPU, 7 GB) with everything self-hosted | 29.44 |
| PostgreSQL | RDS db.t4g.small, $0.037/h | 27.01 | on the VM | 0 |
| Redis | ElastiCache cache.t4g.micro, $0.016/h (us-east-1 price; Frankfurt is the same or more expensive) | 11.68 | Valkey on the VM | 0 |
| Files | S3 Standard 100 GB, $0.0245/GB | 2.45 | Object Storage 100 GB, €0.01733/GB | 1.73 |
| Queue | SQS, first million requests free | 0 | RabbitMQ on the VM | 0 |
| Secrets | Secrets Manager, 5 × $0.40 | 2.00 | OpenBao on the VM | 0 |
| Backups | (included in RDS) | — | Acronis 25 GB | 3.75 |
| **Total** | | **≈ $78** | | **≈ €35** |

**Reading:** about **55% less** per month. The calculation uses $1 = €1, which favours AWS (the euro is worth more than the dollar), so the real saving is larger.

**With RDS Multi-AZ** ($0.074/h, $54/month) AWS goes up to about $105/month.

**Caveats for the pitch:**
- This is our sample app, not a real customer. Say "for this sample app".
- Self-hosted means someone operates the database (updates, high availability). That is the work the agents do.
- Outbound traffic: AWS charges $0.09/GB after 100 GB free per month. We left the Leaseweb figure out of the calculation because it is not confirmed.

**Sources:** RDS db.t4g.small Frankfurt (sparecores.com); ElastiCache cache.t4g.micro (instances.vantage.sh); EC2 t3.medium eu-central-1 (doit.com); S3 Frankfurt (upstash.com); Leaseweb in `docs/decisor-destino.md`.
