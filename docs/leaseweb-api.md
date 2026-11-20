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

## Notas do teste com curl (preencher às 09:30)

- Remover regra: método, caminho, corpo: …
- Criar regra: método, caminho, corpo: …
- Instâncias e RAM disponíveis: …
- VM da organização: recursos, IP, aparece na API (sim/não), papel decidido: …
