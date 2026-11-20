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

## Notas do teste com curl (preencher às 09:30)

- Remover regra: método, caminho, corpo: …
- Criar regra: método, caminho, corpo: …
- Instâncias e RAM disponíveis: …
- VM da organização (analisada às 09:47): IP público por NAT (IP e instance-id no `.env`, `VM_ORG_*`, não no repo).
  Ubuntu 26.04.1, 32 vCPU, 125 GB RAM, 93 GB disco. Saída para Telegram e api.leaseweb.com OK. Só a 22 a escutar; `ufw` inativo; `sudo` sem password.
  Instalado: Docker 29.1 + Compose 2.40, Node 22.21, nmap 7.98, jq. SSH aceita password (ver riscos: desligar ou mudar a password).
  Aparece na API: **por confirmar** (falta `LSW_API_KEY`). Papel decidido: **cérebro** (aguenta tudo); se aparecer na API, também pode ser a vítima.
