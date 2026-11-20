# Agent tool catalogue

The full vision, as if there were unlimited time. Each row has a level:

- **A:** in today's demo.
- **B:** goes in if integration no. 2 passes ahead of time.
- **C:** stays on the "what comes next" slide and for after the hackathon.

Rule: nothing at level B or C starts before all of level A works end to end.

## Migrator: from AWS to open alternatives on Leaseweb

| AWS service | Open alternative on Leaseweb | How we prove it stayed the same | Level |
| --- | --- | --- | --- |
| S3 | MinIO | Same object count and checksums; the app tests pass | **A** |
| RDS PostgreSQL | PostgreSQL | `pg_dump`/`pg_restore`; row count and checksum per table | **B** |
| SQS | RabbitMQ | Messages sent = messages received; the app tests pass | **B** |
| ElastiCache Redis | Valkey | Same keys and TTLs, by sampling | **B** |
| Secrets Manager / Parameter Store | OpenBao | Secrets migrated without ever appearing as plain text in the log; the app starts | **B** |
| RDS MySQL | MariaDB | Counts and checksums per table | C |
| DynamoDB | ScyllaDB (Alternator, compatible API) | Item count and sampling | C |
| SNS | NATS (next phase) | Subscriptions and message delivery | C |
| SES | Postal | Test email to one of our mailboxes | C |
| ECR | Harbor | Images with the same digest | C |
| CloudWatch Logs | Loki + Grafana | Logs arrive and are searchable | C |
| Cognito | Keycloak | Test login with a migrated user | C |
| Lambda | OpenFaaS | The same function gives the same answer | C |
| Route 53 | PowerDNS | Records answer the same (`dig`) | C |
| CloudFront | Caddy / Varnish in front of MinIO | The same file with the same hash | C |
| EKS | k3s | Manifests apply and pods become ready | C |

For each service the migrator always follows the same 5 steps: **analyse** (finds the service in the code and configuration), **propose** (a plan in plain language, approved in Telegram), **provision** (creates the destination on Leaseweb), **copy** (data, with proof) and **verify** (same tests before and after). One "translation" table per service; adding a service means adding an entry.

The "AWS" source is simulated with LocalStack, which emulates S3, SQS, SNS, DynamoDB, Secrets Manager and others.

## Destination planner (part of the migrator)

Before migrating, the migrator decides **where each service goes**, and explains why in Telegram:

- **Self-hosted on a Leaseweb VM:** when the machine has the resources and the service is not critical.
- **Paid European managed service:** when there is not enough RAM or disk, or the service is critical and needs high availability and managed backups.
- **Leaseweb first:** if Leaseweb has the managed service, that is the choice. Another European provider only when Leaseweb does not have it.

Example message: "Your VM has 8 GB of RAM. MinIO and RabbitMQ stay on it. The orders database is critical: I propose a European managed Postgres, with daily backups. Estimated cost: …. [Approve plan] [Ignore]"

How it decides:

1. Fixed rules in the code (RAM and disk needed per service, criticality set by the owner, personal data or not). The rules decide.
2. The AI only explains the decision in plain language and answers the owner's questions. It does not invent prices: it only uses the ones in the table in the code, with the date they were seen.

| Piece | Level |
| --- | --- |
| Recommend the destination of each service with rules + an AI explanation in Telegram | **B** |
| The owner approves the plan ("Approve plan") or ignores it. The "Everything self-hosted" and "Why?" buttons were left out | **B** |
| Create and configure the managed services through the European providers' APIs | C |
| Compare up-to-date costs across providers | C |

## Code migrator (part of the migrator)

Migrating the infrastructure without changing the code leaves the app pointing at AWS. The migrator also changes the code, and delivers the change as a **pull request** that the owner approves in Telegram.

| Case | What changes in the code | Difficulty | Level |
| --- | --- | --- | --- |
| S3 → MinIO / Leaseweb Object Storage | Configuration only: `endpoint`, credentials and `forcePathStyle` in the S3 client. The rest of the code stays the same (compatible API) | Low | **A** |
| Environment variables and `.env` | Swaps AWS URLs and service names for the new ones; secrets never go into the PR | Low | **A** |
| RDS Postgres → Postgres | Only the connection string | Low | **B** |
| SQS → RabbitMQ | Swaps the queue configuration: `FILA_TIPO=rabbitmq` and `RABBITMQ_URL`; the SQS keys are no longer needed | Medium | **B** |
| DynamoDB → ScyllaDB Alternator | Only the endpoint (compatible API) | Low | C |
| Lambda → Serverless Functions / container | Repackage the function | High | C |

How it works:

1. **Find:** searches the code for AWS clients (`@aws-sdk/*`, `boto3`, `AWS_*` variables) and the configuration.
2. **Propose:** the AI writes the change; fixed rules check that only the expected files and lines change.
3. **Prove:** run the app tests with the new code against the new destination. If they fail, the PR is not proposed.
4. **Approve:** the Migrator sends in Telegram "PR with 3 files changed, tests passing. [Approve PR] [Ignore]". "Approve PR" merges into the app repo; `/undo` opens a PR that reverts it. Only with `MIGRADOR_PR=real`; by default it is a dry run.
5. **Links up with the defence:** if the issue found by the attacker comes from the configuration (for example, an open rule in the Terraform), the defence closes it through the API and the migrator opens the PR that fixes the cause, so it does not come back on the next deploy. Done: the PR opens in the public repo `hack-leaseweb-exemplo-app`, branch `migracao/leaseweb-<hora>`, and fixes the Terraform rule.

Rule: code only changes through a PR. There is never a direct push to the main branch.

## Attacker: only against our machines (allowlist)

| Tool | What it looks for | Level |
| --- | --- | --- |
| TCP connection to sensitive ports | Databases, Redis, Elasticsearch, RDP open to the whole Internet | **A** |
| SSH passwords, limited | SSH login with a weak password: at most 5 attempts per round, a single target from the allowlist, only with `/attack`; stops at the first successful login and moves on to the other tools | **B** |
| Reading the security groups through the API | Rules with `0.0.0.0/0` or `::/0` | **A** |
| Public MinIO bucket | Anonymous read policy after the migration | **B** |
| Default credentials | Postgres, Redis, MinIO and dashboards with the factory password (login attempt only, no data touched) | **B** |
| Exposed secrets | Keys in the code and in environment variables (gitleaks or trufflehog on the sample app repo) | B |
| TLS and HTTP headers | Weak certificates, HTTP without TLS, missing security headers | B |
| Versions with known CVEs | Compare service versions with known CVEs (nuclei with non-intrusive templates) | C |
| SSH | Password login enabled, root allowed | C |

Nothing destructive. Only targets in `ALVOS_PERMITIDOS`; any other is refused and logged.

## Defence: closed list of actions, each with its inverse

| Action | Inverse | Level |
| --- | --- | --- |
| Remove a security group rule | Recreate the rule | **A** |
| Restrict the rule's source to one of our IPs or networks | Restore the previous source | **B** |
| Snapshot the machine before touching it | Restore the snapshot | **B** |
| Make the bucket private | Restore the previous policy | **B** |
| Replace the default password with a strong one (stored in OpenBao) | Restore the previous one | B |
| Rotate an exposed key | Restore the previous one for a short window | C |
| Disable SSH password login | Enable it again | C |
| Enable fail2ban on the machine | Disable it | C |

The AI explains and proposes. The action always comes from this table; the model never writes commands.
