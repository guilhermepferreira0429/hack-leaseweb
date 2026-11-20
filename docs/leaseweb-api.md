# Leaseweb API (Public Cloud v1)

- **Base:** `https://api.leaseweb.com/publicCloud/v1`
- **Authentication:** header `X-LSW-Auth: <key>` (generated in the Customer Portal).
- **Instances:** `GET /instances`; an instance's groups: `GET /instances/{instanceId}/securityGroups`.
- **Security groups:** `GET /securityGroups`, `GET /securityGroups/{securityGroupId}`.
- **Rules:** `GET /securityGroups/{securityGroupId}/firewallRules`. Each rule has `protocol`, `source` (CIDR), `startPort`, `endPort`, `icmpType`, `icmpCode`, `state`.
- **Removing rules:** `securityGroupId` in the path and body `{ "rules": ["<uuid>"] }`. Confirm method and path with `curl` at 09:30.
- **Warning:** attaching a security group to an instance **replaces** the rules. We remove the rule; we never swap the whole group.
- Check whether the account uses the new or the old Public Cloud.

Documentation:
- https://developer.leaseweb.com/api-docs/publiccloud_v1.html
- https://kb.leaseweb.com/products/public-cloud/managing-firewall-of-public-cloud
- https://kb.leaseweb.com/kb/public-cloud/security-groups/

## Confirmed in the documentation (20/11, 09:58)

| What | Method and path | Notes |
|---|---|---|
| List instances | `GET /instances` | Optional filter `?securityGroupIds=<uuid>,<uuid>` |
| An instance's groups | `GET /instances/{instanceId}/securityGroups` | `limit`, `offset` |
| List security groups | `GET /securityGroups` | `limit`, `offset`, `state` |
| Group details | `GET /securityGroups/{securityGroupId}` | |
| List rules | `GET /securityGroups/{securityGroupId}/firewallRules` | `limit`, `offset` |
| Remove rules | **method and path to confirm with curl** | Body: `{ "rules": ["<uuid>"] }` (required) |
| Create rules | **to confirm with curl** | Body not shown in the docs; test with the rule fields |
| List snapshots | `GET /instances/{instanceId}/snapshots` | |
| Create snapshot | **method to confirm** on `/instances/{instanceId}/snapshots` | Body `{ "name": "..." }`. The instance must be running. **Only 1 snapshot per instance** |
| Restore snapshot | `PUT /instances/{instanceId}/snapshots/{snapshotId}` | |
| Delete snapshot | `DELETE /instances/{instanceId}/snapshots/{snapshotId}` | |
| Attach / detach group | **to confirm** | Body `{ "securityGroupIds": [...] }`. **Do not use in the demo:** it replaces the rules |

For the snapshot before making changes (`ideias-wow` and `ferramentas`, level B): since there is only 1 per instance, delete the previous one before creating another.

## Notes from the test with the real key (20/11, 11:00–11:30, Enio)

- **Key:** works with `X-LSW-Auth`. **Rules come with an `id`** (the risk from the documentation did not materialise).
- **Remove a rule:** `POST /securityGroups/{id}/revokeFirewallRules` with `{"rules":["<uuid>"]}` → 202. The rule goes to `DELETING`.
- **Create a rule:** `POST /securityGroups/{id}/authorizeFirewallRules` with `{"rules":[{protocol,startPort,endPort,source}]}` → 202; `CREATING` → `ACTIVE` in ~7 s.
- **Measured times** (nmap from the brain every 1.5 s):
  - revoke → port `filtered` in **~3 s**; but the API lists the rule as `DELETING` for **~39 s**.
  - authorize → port `open` in ~4 s; `ACTIVE` in the API in ~7 s.
  - So the defence confirms the close **from outside** (rule in `DELETING` + nmap no longer reaches the port) and only waits for the API when there is no nmap.
- **"All ports" rule:** comes as protocol `ALL` (or a number, e.g. 47 GRE, 50/51 IPsec) and ports 1–65535.
- **Event account:** started **with no instances** (the organisers' VM is not in this account: it is used only as the brain).
  It had a single security group, **"Default", open to everything** (ALL, 0.0.0.0/0 and ::/0). A good example for the pitch; the defence does not touch it.
- **Launching an instance** (`POST /instances`):
  - the account **only accepts the `eu-central-1` (Frankfurt) region**;
  - `contractType: "HOURLY"`, `billingFrequency: 1`, `rootDiskStorageType: "CENTRAL"`, `securityGroupIds` accepted at launch;
  - **does not accept `sshKey` and `userData` together**; with `userData` (base64 cloud-init) the key was not installed;
  - with `sshKey`, **the key goes to `root`** (not to `ubuntu`).
  - Cheapest: `lsw.c3.large` (2 vCPU, 3 GB) at €0.0348/hour.
- **Victim:** `npm run lsw:vitima -- criar | estado | destruir | destruir-vm` (`code/defesa/vitima.ts`). IP and ids live in `.env`, not here.
- **Organisers' VM** (checked at 09:47): public IP through NAT (IP and instance-id in `.env`, `VM_ORG_*`, not in the repo).
  Ubuntu 26.04.1, 32 vCPU, 125 GB RAM, 93 GB disk. Egress to Telegram and api.leaseweb.com OK. `ufw` inactive; `sudo` without a password.
  Installed: Docker 29.1 + Compose 2.40, Node 22.21, nmap 7.98, jq. SSH accepts passwords (see risks).
  **Does not show up in the API** with the event key. Role: **brain** (and source of the honeypot counter). Location to be confirmed with the organisers.
