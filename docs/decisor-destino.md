# Destination decider: self-hosted or European managed service

How the migrator decides where each service goes. The coding agents build the decider from this file. See also `ferramentas.md`, section "Destination planner".

## Principles

1. **The rules decide, the AI explains.** The model never chooses the destination and never invents prices.
2. **Leaseweb first.** If Leaseweb has the managed service, that is the choice. Another European provider only when Leaseweb does not have it.
3. **Only providers headquartered in the EU, with data in the EU.**
4. **Prices only from the table below,** with the date they were seen. If a price is more than 30 days old, the agent says "price to be confirmed".
5. **The owner decides at the end:** "Approve plan" or "Ignore". The "Everything self-hosted" and "Why?" buttons were left out.

## Decider inputs

| Input | Where it comes from |
|---|---|
| Free RAM, vCPU and disk on the destination VM | Leaseweb API (instance type) or `free -h` / `df -h` |
| Services found and data size | `migrador/analisar.ts` |
| Criticality of each service (high, medium, low) | Question to the owner in Telegram; default: database = high |
| Personal data (yes/no) | Question to the owner; default: database = yes |
| Needs high availability (yes/no) | Derived: high criticality → yes |

## Minimum resources for self-hosted (decider reference values)

| Service (AWS) | Open alternative | Minimum RAM | Disk | Notes |
|---|---|---|---|---|
| S3 | MinIO | 1 GB | data × 1.2 | |
| RDS PostgreSQL | PostgreSQL | 1 GB (2 GB recommended) | data × 1.5 | Backups are on us |
| RDS MySQL | MariaDB | 1 GB | data × 1.5 | |
| ElastiCache | Valkey | data in RAM × 1.5 | low | |
| DynamoDB | ScyllaDB (Alternator) | 2 GB | data × 2 | Heavy for small VMs |
| DocumentDB | MongoDB / FerretDB | 1 GB | data × 1.5 | |
| SNS | NATS (next phase) | 256 MB | low | |
| SQS | RabbitMQ | 512 MB | low | |
| MSK (Kafka) | Kafka / Redpanda | 2 GB | high | Rarely worth self-hosting for an SME |
| Secrets Manager | OpenBao | 256 MB | low | Critical: losing this means losing everything |
| ECR | Harbor | 2 GB | images × 1.2 | |
| CloudWatch Logs | Loki + Grafana | 1 GB | logs × retention | |
| Cognito | Keycloak | 1 GB | low | |
| SES | Postal | 1 GB | low | Deliverability is hard when self-hosted |
| Route 53 | PowerDNS | 256 MB | low | |
| ELB | HAProxy / Caddy | 256 MB | low | |
| EKS | k3s | 2 GB | medium | |

These values are the decider's rules of thumb, not measurements. Margin: always leave 25% of the VM's RAM free.

## Rules (in order; the first one that applies wins)

1. **High** criticality and needs high availability → **managed**.
2. **Does not fit** on the VM (RAM or disk below the minimum, with the 25% margin) → **managed**.
3. Personal data and the owner has no backups → **managed** (managed backups and encryption).
4. Everything else → **self-hosted on the Leaseweb VM**.

To choose the managed service:

1. Does Leaseweb have it managed? → Leaseweb.
2. Otherwise → the cheapest in the table that meets the requirements (high availability, EU region).
3. Tie → the one with the region closest to the customer.

## Price table (seen on 20/11/2026)

Prices exclude VAT. "To be confirmed" = the service exists but we did not find a published price. The decider only shows prices with a date; the "to be confirmed" ones appear as "price to be confirmed".

### What Leaseweb has (preferred choice)

| Service | Leaseweb product | Price | Source |
|---|---|---|---|
| VM | Public Cloud LSW.C3.LARGE (2 vCPU, 3 GB) | € 0.0395/h, € 26.02/month | leaseweb.com/products-services/cloud/public-cloud/pricing |
| VM | Public Cloud LSW.M3.LARGE (2 vCPU, 7 GB) | € 0.0447/h, € 29.44/month | same |
| VM | Public Cloud LSW.R3.LARGE (2 vCPU, 15.25 GB) | € 0.0555/h, € 36.49/month | same |
| Disk | Network SSD (up to 5K IOPS) | € 0.0800/GB/month | same |
| Traffic | 1 TB/month free, shared; inbound free | — | same |
| Objects (S3) | Object Storage on demand | € 0.01733/GB/month (0 to 50 TB) | leaseweb.com/en/products-services/object-storage |
| Objects (S3) | Object Storage with commitment (from 500 GB) | € 0.01485/GB/month | leaseweb.com/object-storage |
| Load balancer (ELB) | Load balancer as a service (HAProxy), runs on an instance | Price of the chosen instance | kb.leaseweb.com (load balancer of Public Cloud) |
| Kubernetes (EKS) | Managed Kubernetes | Management at no extra cost; base € 21.60/month; vCPU € 0.0038/h, RAM € 0.0019/GB/h | leaseweb.com/en/configure/vc/product/entityKey/KUBERNETES/2001 |
| CDN (CloudFront) | Leaseweb CDN | To be confirmed with Leaseweb (third-party listings give about $0.01/GB; old pay-as-you-go plan at € 49/month with 2 TB) | Confirm with Leaseweb |
| DDoS (Shield) | DDoS IP Protection Standard | Included at no extra cost on all services | kb.leaseweb.com (DDoS IP Protection) |
| DDoS (Shield Advanced) | DDoS IP Protection Advanced / Customized / Always-on | Advanced: small fee per IP (amount not published); the others on request | europeanpurpose.com/category/ddos-protection-services |
| WAF | Leaseweb Cyber Security (WAF) | To be confirmed with Leaseweb | leaseweb.us (Cyber Security brochure) |
| Backups (AWS Backup) | Acronis Backup (Public Cloud, VPS, dedicated) | 25 GB € 3.75/month · 100 GB € 10.00/month · 500 GB € 41.25/month · 1000 GB € 81.75/month | leaseweb.com/add-ons/backup/acronis |
| Managed databases | **Not found** on Public Cloud | — | Confirm with Leaseweb on the day |

### European managed services when Leaseweb does not have them

| Service (AWS) | Provider | Plan | Price | Source |
|---|---|---|---|---|
| RDS PostgreSQL / MySQL | Scaleway | DB-DEV-S (2 vCPU, 2 GB) | € 0.0156/h (about € 11/month) | scaleway.com/en/pricing/managed-databases-pricing |
| RDS PostgreSQL | UpCloud | 1 node, 2 GB, 25 GB, 24 h backups | € 30/month | upcloud.com/docs/products/managed-postgresql/pricing |
| RDS PostgreSQL | OVHcloud | Essential db1-7 (2 vCPU, 7 GB, 50 GB) | $0.17/h | sparecores.com/database/ovh/postgresql-essential-db1-7 |
| DB backups | Scaleway | Backups/snapshots | € 0.03/GB/month | scaleway.com (managed databases pricing) |
| ElastiCache (Redis) | Scaleway | RED1-MICRO (2 vCPU, 2 GB) | from € 0.048/h | scaleway.com/fr/tarifs/managed-databases |
| DocumentDB (MongoDB) | Scaleway | MGDB-PLAY2-NANO (2 vCPU, 4 GB) | € 0.1077/h + storage | scaleway.com/en/pricing/managed-databases-pricing |
| SQS | Scaleway | Queues (SQS-compatible) | € 0.01/GB | scaleway.com/en/pricing/managed-databases-pricing |
| SNS (NATS) | Scaleway | NATS | € 0.01/GB; persistence about € 0.14/GB/month | same |
| MSK (Kafka) | OVHcloud / Scaleway | Managed Kafka | To be confirmed | ovhcloud.com (choosing right database); scaleway.com |
| CloudWatch Logs | Scaleway | Cockpit, custom logs | € 0.35/GB ingested | scaleway.com/en/pricing/managed-services |
| SES | Scaleway | Transactional Email (per recipient) | To be confirmed | scaleway.com/transactional-email-tem |
| Secrets Manager | Scaleway | Secret Manager | To be confirmed | scaleway.com/en/docs/secret-manager/faq |
| ECR | Scaleway | Container Registry (you pay for what is stored; inbound free) | To be confirmed | scaleway.com/en/pricing/containers |
| ELB | OVHcloud | Load Balancer | $6.94/month | pricingsaas.com/companies/ovhcloud.publiccloud |
| CloudFront (CDN) | **Bunny.net** (Slovenia) | Standard, Europe and North America | $0.01/GB; minimum $1/month | bunny.net/pricing |
| CloudFront (CDN) | Gcore (Luxembourg) | Free: 1 TB/month included | € 0; overage € 0.030/GB | whtop.com/plans/gcore.com/119338 |
| CloudFront (CDN) | Gcore (Luxembourg) | Start: 1.5 TB included | € 35/month; overage € 0.023/GB | whtop.com/plans/gcore.com/88673 |
| Route 53 (DNS) | Bunny.net | Bunny DNS | Included (free) | bitdoze.com/bunny-net-review |
| S3 + CDN (static files) | Bunny.net | Bunny Storage, 1 region | $0.01/GB/month | bitdoze.com/bunny-net-review |
| Lambda | Scaleway | Serverless Functions | € 0.15 per 1M requests after 1M free; € 0.50 per 100k GB-s after 400k GB-s free | scaleway.com/en/pricing/serverless |
| Fargate / App Runner | Scaleway | Serverless Containers | Memory € 0.10 per 100k GB-s; vCPU € 1.0 per 100k vCPU-s (with free tier) | scaleway.com/fr/tarifs/serverless |
| Cognito | Clever Cloud (France) | Keycloak as a Service | from € 47/month | clever-cloud.com (Keycloak as a Service PDF, Jul/2026) |
| Cognito | Cloud-IAM (France) | Managed Keycloak; free up to 100 users (no SLA, hosted on AWS) | Paid plans to be confirmed | europeanpurpose.com/tool/cloud-iam |
| OpenSearch (search and logs) | OVHcloud | Managed OpenSearch, billed by usage (includes IOPS, backups and traffic) | To be confirmed | ovhcloud.com/en-in/public-cloud/opensearch |
| OpenSearch Dashboards | OVHcloud | Dedicated dashboards (Logs Data Platform) | € 4.99/instance/month | ovhcloud.com/en-ie/identity-security-operations/pricing |
| Secrets Manager / KMS | OVHcloud | Secret Manager and KMS | Keys at about £0.05/key/month (UK); secrets to be confirmed in the EU region | ovhcloud.com/en-gb/identity-security-operations/pricing |
| AWS Backup | IONOS (Germany) | Backup Service (Acronis) | $0.082/GB/30 days + $2/device for extras | cloud.ionos.com/storage/backup |
| IoT Core | Scaleway | IoT Hub Shared: 10 devices, 50,000 messages/month | Free | scaleway.com/en/pricing/managed-services |
| IoT Core | Scaleway | IoT Hub Dedicated: 2M messages/month | € 0.02/hour; overage € 0.735/million | same |
| WAF | Bunny.net | Bunny Shield | To be confirmed | bitdoze.com/bunny-net-review |
| S3 (comparison) | Exoscale | Object Storage Standard | € 0.0184/GB/month | exoscale.com/object-storage/classes |
| S3 (comparison) | OVHcloud | Object Storage Standard | $8.3/TiB/month | pricingsaas.com/companies/ovhcloud.publiccloud |

### How the decider uses this

- A service that **Leaseweb offers managed** (objects, Kubernetes, load balancer) → Leaseweb.
- A service that Leaseweb **does not offer managed** (databases, Redis, queues, logs, email, secrets):
  - not critical and fits on the VM → **self-hosted on Leaseweb** (resource table above);
  - critical or does not fit → **the cheapest European managed service in this table**, with the price and the date.
- Price "to be confirmed" → show the provider, say "price to be confirmed" and do no maths.
- **DDoS:** Leaseweb's Standard protection is already included; there is nothing to migrate or pay for up front. Upgrading is only recommended if the customer is a frequent target.
- **Backups:** Leaseweb has Acronis built in, so it is the first choice. It is also the answer to the rule "personal data without backups → managed": a self-hosted Postgres with Leaseweb Acronis backups can stay self-hosted.
- **IoT:** only appears if the app uses AWS IoT. Start on Scaleway's free plan and move to dedicated beyond 10 devices.
- **CDN:** Leaseweb has a CDN, so it is the first choice; if the price is not confirmed, show Bunny.net as a priced European alternative.
- **Identity (Cognito):** self-hosted Keycloak only if someone will maintain it; otherwise a European managed Keycloak. Careful: Cloud-IAM's free plan runs on AWS, so it does not work for sovereignty.

## Telegram message (template)

> **Migrator:** Your VM has {ram} GB of free RAM. {self_services} stay on it. The {name} database is critical and holds personal data: I propose {provider} {plan}, about €{price}/month (price seen on {date}). Why: {rule}. [Approve plan] [Ignore]

`{rule}` is the text of the winning rule, a fixed sentence per rule (`REGRAS` in `code/migrador/tradutor/destino/decidir.ts`).

## Level

- **B:** recommendation with rules and a Telegram message.
- **C:** create the managed services through each provider's API; prices updated automatically.
