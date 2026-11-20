# AWS → Leaseweb mapping

What the migration agent can translate automatically, what it must flag, and what it refuses to copy.
The translation is **deterministic** (a table, not the LLM). The LLM explains the plan, the risks and the result.

## Translates automatically

| AWS (Terraform) | Leaseweb | Notes |
|---|---|---|
| `aws_instance` | `POST /instances` | `type`: same family name with `lsw.` prefix (e.g. `m5.large` → `lsw.m5.large`), confirm with `GET /instanceTypes?region=`. If the family is not offered, pick the nearest by vCPU/RAM and say so. |
| `ami` (Ubuntu/Debian) | `imageId` (e.g. `UBUNTU_22_04_64BIT`) | Map by OS + version; custom AMIs cannot be moved this way (flag). |
| `availability_zone` / region in the EU | `region` `eu-west-3` (Amsterdam) | Confirm with `GET /regions`. Non-EU regions: flag as a sovereignty decision. |
| `aws_security_group` | `POST /securityGroups` | One group per AWS group. |
| `ingress { from_port, to_port, protocol, cidr_blocks }` | `authorizeFirewallRules` `{protocol, startPort, endPort, source}` | One Leaseweb rule per CIDR. |
| `egress` | — | Leaseweb rules have no direction field; outbound is not modelled. Flag. |
| `user_data` | cloud-init (supported) | Copy, after scanning it for secrets. |
| `aws_lb` (+ listener) | EC2-compatible `CreateLoadBalancer` / `CreateListener` | Beta; out of scope for the demo. |

## Replaces locked-in managed services with open, self-hosted equivalents

This answers the challenge question "Can we replace some of the hyperscale services by automated alternatives?".

| AWS managed service | Open alternative on Leaseweb | How the agent moves it |
|---|---|---|
| S3 | MinIO (S3 API) on a Leaseweb instance, or Leaseweb Object Storage | Same S3 API, so the app only changes endpoint + keys; objects copied with the S3 API (egress is charged on the AWS side) |
| SQS | RabbitMQ on a Leaseweb instance | Queue recreated; producers/consumers switch client; in-flight messages drained before cut-over |
| RDS (PostgreSQL) | PostgreSQL on a Leaseweb instance | `pg_dump`/`pg_restore` (or logical replication for less downtime) |
| Secrets Manager / SSM Parameter Store | OpenBao on a Leaseweb instance | Copied vault to vault; values never appear in plans, logs or tests |
| ElastiCache (Redis) | Valkey on a Leaseweb instance | Keys copied with their TTL; checked by sampling |

These five migrate live in the demo, with proof for each (counts and checksums) and a single "Aprovar plano" approval.

**Next phase (in the plan only, not migrated today):**

| AWS | Open alternative | Note |
|---|---|---|
| DynamoDB | ScyllaDB (Alternator, DynamoDB-compatible API) | The app changes only the endpoint |
| SNS | NATS | Topics and subscriptions recreated |
| CloudWatch Logs | Loki + Grafana | Logs shipped to the new stack |

## Flags and does not migrate (the agent says why)

| AWS | Why | What the agent says |
|---|---|---|
| IAM users/roles/keys | No equivalent | "I will not copy any credentials. Create new ones on the target." |
| Lambda (and other AWS-only services: API Gateway, Cognito, Step Functions…) | Proprietary services | "This is the lock-in. Needs redesign, not migration." |
| Custom AMIs | Image format | "Rebuild from a base image + cloud-init." |

This is the honest part of the pitch: Leaseweb's own 2026 survey says the hard part is applications built around one
provider's infrastructure. The agent separates "moves today" from "needs redesign".

## Refuses to copy (security gate during migration)

| Found in the AWS config | Action on the target |
|---|---|
| `0.0.0.0/0` on 22, 3389, 5432, 3306, 1433, 27017, 6379, 9200, 445, 23 | Not copied. Replaced by the admin IP (or a temporary rule with an expiry the agent tracks). |
| Hard-coded keys/passwords in `user_data` or tags | Not copied; flagged by name, value never shown. |
| Access keys older than 90 days | Flagged; new credentials on the target. |
| `PasswordAuthentication yes` in user data | Flagged; key-only on the target. |

## Demo input (simulated "AWS" account)

One `main.tf` with: 1 `aws_instance` (`m5.large`, Ubuntu 22.04, `eu-west-1`), 1 `aws_security_group` with
22/80/443/5432 open to `0.0.0.0/0`, `user_data` that installs the app and contains a fake secret.
Expected agent output: launch `lsw.m5.large` in `eu-west-3`, 80/443 open, 22 admin-only, 5432 not exposed,
secret not copied, S3 → MinIO, SQS → RabbitMQ, RDS → PostgreSQL on Leaseweb, IAM/Lambda flagged as
"needs redesign, here is why".
