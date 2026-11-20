# Leaseweb Public Cloud API — what we use and how

Verified on 2026-11-20 against the official Go SDK
([leaseweb/leaseweb-go-sdk](https://github.com/leaseweb/leaseweb-go-sdk), `publiccloud/`, last commit 2026-11-05)
and the public reference ([publiccloud_v1](https://developer.leaseweb.com/api-docs/publiccloud_v1.html)).

## Basics

- Base URL: `https://api.leaseweb.com/publicCloud/v1`
- Auth header: `X-LSW-Auth: <API key>` (key generated in the Customer Portal)
- Instances have **one public IPv4** each; extra IPv4s cannot be added.

## Endpoints we need

| What | Method + path | Body |
|---|---|---|
| List regions | `GET /regions` | — |
| List instance types | `GET /instanceTypes?region=<region>` | — |
| List images | `GET /images` | — |
| Launch instance | `POST /instances` | see below |
| List instances | `GET /instances` (filter `securityGroupIds`) | — |
| Instance's security groups | `GET /instances/{instanceId}/securityGroups` | — |
| Attach security groups | `POST /instances/{instanceId}/attachSecurityGroups` | `{"securityGroupIds": ["<uuid>"]}` |
| Detach security groups | `POST /instances/{instanceId}/detachSecurityGroups` | `{"securityGroupIds": ["<uuid>"]}` |
| List security groups | `GET /securityGroups` | — |
| Create security group | `POST /securityGroups` | `{"name": "..."}` |
| Get / rename / delete group | `GET` / `PUT` / `DELETE /securityGroups/{securityGroupId}` | `PUT`: `{"name": "..."}` |
| List firewall rules | `GET /securityGroups/{securityGroupId}/firewallRules` | — |
| **Add rules** | `POST /securityGroups/{securityGroupId}/authorizeFirewallRules` | see below |
| **Remove rules** | `POST /securityGroups/{securityGroupId}/revokeFirewallRules` | `{"rules": ["<rule uuid>", ...]}` |

### Launch body (example from the reference)

```json
{
  "region": "eu-west-3",
  "type": "lsw.m3.large",
  "imageId": "UBUNTU_20_04_64BIT",
  "contractType": "MONTHLY",
  "contractTerm": 12,
  "billingFrequency": 1,
  "rootDiskSize": 50,
  "rootDiskStorageType": "CENTRAL",
  "reference": "my-webserver"
}
```

Required: `region`, `type`, `imageId`, `contractType`, `rootDiskSize`, `rootDiskStorageType`.
For the hackathon use hourly billing (check the accepted `contractType` value with the API).

### Add rules body

```json
{
  "rules": [
    { "protocol": "TCP", "startPort": 22, "endPort": 22, "source": "203.0.113.10/32" }
  ]
}
```

Rule fields: `protocol`, `startPort`/`endPort` (TCP/UDP), `icmpType`/`icmpCode` (ICMP), `source` (CIDR).
There is **no direction field**: rules are inbound allow rules.

### States (async)

- Rule: `CREATING` → `ACTIVE` (or `FAILED`), `DELETING` while being removed.
- Group: `CREATING`, `ACTIVE`, `SYNCING`, `FAILED`.

Changes are **not instant**: poll `GET .../firewallRules` until the state is `ACTIVE` or the rule is gone,
and only then report "closed".

## Gotchas (test these first)

1. **Rule IDs.** `revokeFirewallRules` takes rule UUIDs, but the SDK's rule model has no `id` field.
   Check the raw JSON of `GET .../firewallRules` for an `id`. If there is none, the fallback is:
   create a new locked-down group, attach it, detach the old one (see 2).
2. **Attaching groups may need a stop/start.** Leaseweb's own blog says that to change the groups of a running
   instance you "stop the instance, update the groups, and start it back up"
   ([blog](https://blog.leaseweb.com/2025/12/02/introducing-security-groups-in-public-cloud/)).
   So the response must edit **rules** (authorize/revoke), not swap **groups**. Attaching a group also replaces
   any instance-level firewall rules ([KB](https://kb.leaseweb.com/kb/public-cloud/security-groups/)).
3. **Order matters when locking down SSH.** First `authorize` your admin IP on 22, wait for `ACTIVE`, **then**
   `revoke` the `0.0.0.0/0` rule. The other order locks you out.
4. **Rule changes take seconds.** For instant containment, also drop the attacker IP on the VM itself (nftables).
   The security-group change is the permanent fix.

## AWS-compatible EC2 API (beta)

Leaseweb has an EC2-compatible wrapper built "to make the migration easy for the users to switch from the AWS EC2
to the Leaseweb Public Cloud APIs" ([reference](https://developer.leaseweb.com/api-docs/awsec2wrapper_v1.html)).

- Endpoint: `https://api.leaseweb.com/aws/ec2/`; works with `aws ec2 ... --endpoint-url <url>` and boto3.
- Documented actions (9): `DescribeInstances`, `RunInstances`, `StartInstances`, `StopInstances`,
  `RebootInstances`, `CreateLoadBalancer`, `DescribeLoadBalancers`, `RegisterTargets`, `CreateListener`.
- **No security-group actions documented.** Use the REST API above for firewall rules.
- `RunInstances` requires `InstanceType`, `ImageId`, `Placement`. Examples use `lsw.m3.large`, `UBUNTU_22_04_64BIT`
  and placement `eu-west-3`.

Pitch angle: the same boto3 code can describe the AWS side and launch on the Leaseweb side by switching the
endpoint. Only the firewall goes through the native API.

## Regions and types

- The new Public Cloud is in the Netherlands with availability zones `eu-west-3-az1` and `eu-west-3-az2` (AMS-01,
  AMS-02); other regions are "coming soon" ([KB](https://kb.leaseweb.com/kb/public-cloud-new/public-cloud-platform-comparison/)).
- The classic Public Cloud lists AMS-01, FRA-01, LON-01, MTL-02, WDC-02, SFO-12, TYO-11, SIN-01, LAX-12
  ([pricing](https://www.leaseweb.com/en/products-services/cloud/public-cloud/pricing)).
- Type names mirror AWS with an `lsw.` prefix, e.g. `lsw.m5.large` = 2 vCPU / 8 GB (€34.04/month in NL pricing).
  Always confirm with `GET /instanceTypes?region=...`.

## curl cheat-sheet

```bash
export LSW="https://api.leaseweb.com/publicCloud/v1"; export K="X-LSW-Auth: $LEASEWEB_API_KEY"
curl -s -H "$K" "$LSW/securityGroups" | jq
curl -s -H "$K" "$LSW/securityGroups/$SG/firewallRules" | jq            # look for an "id" per rule
curl -s -H "$K" -H 'Content-Type: application/json' -X POST "$LSW/securityGroups/$SG/authorizeFirewallRules" \
  -d '{"rules":[{"protocol":"TCP","startPort":22,"endPort":22,"source":"203.0.113.10/32"}]}'
curl -s -H "$K" -H 'Content-Type: application/json' -X POST "$LSW/securityGroups/$SG/revokeFirewallRules" \
  -d '{"rules":["<rule-uuid>"]}'
```
