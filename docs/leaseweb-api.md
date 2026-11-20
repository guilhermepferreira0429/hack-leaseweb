# API da Leaseweb (Public Cloud v1)

- **Base:** `https://api.leaseweb.com/publicCloud/v1`
- **Autenticação:** cabeçalho `X-LSW-Auth: <chave>` (gera-se no Customer Portal).
- **Instâncias:** `GET /instances`; grupos de uma instância: `GET /instances/{instanceId}/securityGroups`.
- **Security groups:** `GET /securityGroups`, `GET /securityGroups/{securityGroupId}`.
- **Regras:** `GET /securityGroups/{securityGroupId}/firewallRules`. Cada regra tem `protocol`, `source` (CIDR), `startPort`, `endPort`, `icmpType`, `icmpCode`, `state`.
- **Remover regras:** `securityGroupId` no caminho e corpo `{ "rules": ["<uuid>"] }`. Confirmar método e caminho com `curl` às 09:30.
- **Atenção:** associar um security group a uma instância **substitui** as regras. Remove-se a regra; nunca se troca o grupo inteiro.
- Confirmar se a conta usa a Public Cloud nova ou a antiga.

Documentação:
- https://developer.leaseweb.com/api-docs/publiccloud_v1.html
- https://kb.leaseweb.com/products/public-cloud/managing-firewall-of-public-cloud
- https://kb.leaseweb.com/kb/public-cloud/security-groups/

## Confirmado na documentação (20/11, 09:58)

| O quê | Método e caminho | Notas |
|---|---|---|
| Listar instâncias | `GET /instances` | Filtro opcional `?securityGroupIds=<uuid>,<uuid>` |
| Grupos de uma instância | `GET /instances/{instanceId}/securityGroups` | `limit`, `offset` |
| Listar security groups | `GET /securityGroups` | `limit`, `offset`, `state` |
| Detalhe de um grupo | `GET /securityGroups/{securityGroupId}` | |
| Listar regras | `GET /securityGroups/{securityGroupId}/firewallRules` | `limit`, `offset` |
| Remover regras | **método e caminho por confirmar com curl** | Corpo: `{ "rules": ["<uuid>"] }` (obrigatório) |
| Criar regras | **por confirmar com curl** | Corpo não visto na doc; testar com os campos da regra |
| Listar snapshots | `GET /instances/{instanceId}/snapshots` | |
| Criar snapshot | **método por confirmar** em `/instances/{instanceId}/snapshots` | Corpo `{ "name": "..." }`. A instância tem de estar a correr. **Só 1 snapshot por instância** |
| Repor snapshot | `PUT /instances/{instanceId}/snapshots/{snapshotId}` | |
| Apagar snapshot | `DELETE /instances/{instanceId}/snapshots/{snapshotId}` | |
| Associar / desassociar grupo | **por confirmar** | Corpo `{ "securityGroupIds": [...] }`. **Não usar na demo:** substitui as regras |

Para o snapshot antes de mexer (`ideias-wow` e `ferramentas`, nível B): como só há 1 por instância, apagar o anterior antes de criar outro.

## Notas do teste com a chave real (20/11, 11:00–11:30, Enio)

- **Chave:** funciona com `X-LSW-Auth`. **As regras trazem `id`** (o risco da documentação não se confirmou).
- **Remover regra:** `POST /securityGroups/{id}/revokeFirewallRules` com `{"rules":["<uuid>"]}` → 202. A regra fica em `DELETING`.
- **Criar regra:** `POST /securityGroups/{id}/authorizeFirewallRules` com `{"rules":[{protocol,startPort,endPort,source}]}` → 202; `CREATING` → `ACTIVE` em ~7 s.
- **Tempos medidos** (nmap do cérebro de 1,5 em 1,5 s):
  - revoke → porta `filtered` em **~3 s**; mas a API lista a regra em `DELETING` durante **~39 s**.
  - authorize → porta `open` em ~4 s; `ACTIVE` na API em ~7 s.
  - Por isso a defesa confirma o fecho **de fora** (regra em `DELETING` + nmap já não chega à porta) e só espera pela API se não houver nmap.
- **Regra "todas as portas":** vem como protocolo `ALL` (ou número, ex.: 47 GRE, 50/51 IPsec) e portas 1–65535.
- **Conta do evento:** começou **sem instâncias** (a VM da organização não é desta conta: fica só como cérebro).
  Tinha um só security group, **"Default", aberto a tudo** (ALL, 0.0.0.0/0 e ::/0). Bom exemplo para o pitch; a defesa não lhe mexe.
- **Lançar instância** (`POST /instances`):
  - a conta **só aceita a região `eu-central-1` (Frankfurt)**;
  - `contractType: "HOURLY"`, `billingFrequency: 1`, `rootDiskStorageType: "CENTRAL"`, `securityGroupIds` aceite no lançamento;
  - **não aceita `sshKey` e `userData` juntos**; com `userData` (cloud-init em base64) a chave não ficou instalada;
  - com `sshKey`, **a chave vai para o `root`** (não para `ubuntu`).
  - Mais barata: `lsw.c3.large` (2 vCPU, 3 GB) a €0,0348/hora.
- **Vítima:** `npm run lsw:vitima -- criar | estado | destruir | destruir-vm` (`code/defesa/vitima.ts`). IP e ids no `.env`, não aqui.
- **VM da organização** (analisada às 09:47): IP público por NAT (IP e instance-id no `.env`, `VM_ORG_*`, não no repo).
  Ubuntu 26.04.1, 32 vCPU, 125 GB RAM, 93 GB disco. Saída para Telegram e api.leaseweb.com OK. `ufw` inativo; `sudo` sem password.
  Instalado: Docker 29.1 + Compose 2.40, Node 22.21, nmap 7.98, jq. SSH aceita password (ver riscos).
  **Não aparece na API** com a chave do evento. Papel: **cérebro** (e fonte do contador do isco). Localização por confirmar com a organização.
