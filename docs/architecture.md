# Arquitetura

## Visão geral

```mermaid
flowchart LR
  subgraph Portatil["Portátil (origem simulada)"]
    LS[LocalStack<br/>S3 + SQS]
    RDS[(Postgres<br/>"RDS")]
    APP[exemplo-app]
  end

  subgraph LSW["Leaseweb Public Cloud"]
    subgraph Cerebro["VM cerebro"]
      MIG[migrador]
      ATK[atacante]
      DEF[defesa]
      PAI[painel<br/>/ /isco /webhook]
      AUD[(auditoria.jsonl)]
    end
    subgraph Vitima["VM vitima"]
      MINIO[MinIO]
      PG[(Postgres)]
      RMQ[RabbitMQ]
    end
    ISCO[VM isco]
    API[Public Cloud API v1<br/>security groups]
  end

  LLM[LLM UE<br/>TensorX / sference]
  HUM((Humano<br/>WhatsApp / Telegram))

  APP --> LS & RDS
  MIG -- copia + sha256 --> MINIO & PG & RMQ
  MIG -. lê .-> LS & RDS
  ATK -- só IPs da allowlist --> Vitima & ISCO
  ATK -- achados --> AUD
  DEF -- lê regras --> API
  DEF -- lê achados --> AUD
  DEF -- 3 frases --> LLM
  DEF -- botões --> HUM
  HUM -- clique --> PAI
  PAI -- tratarResposta --> DEF
  DEF -- revoke / authorize (só 1 regra) --> API
  DEF -- inverso --> AUD
  PAI -. linha do tempo .-> AUD
```

## Fluxo: migrar, atacar, aprovar, fechar

1. **Migrar** (`migrador`): `analisar` encontra S3, RDS e SQS na `exemplo-app` e propõe MinIO, Postgres e RabbitMQ. Corre os testes contra a origem, copia os dados com sha256 por objeto, tabela ou mensagem, e corre os mesmos testes contra a Leaseweb.
2. **Atacar** (`atacante`): assim que a vítima sobe, varre só os IPs de `ALVOS_PERMITIDOS`. Procura portas abertas, identifica o serviço e testa uma vez as credenciais de fábrica conhecidas, só em leitura. Cada achado vai para a auditoria. Qualquer alvo fora da lista é recusado e registado.
3. **Aprovar** (`defesa`): `detetar` junta os achados do atacante e os das regras dos security groups (porta sensível aberta a `0.0.0.0/0`) e liga cada achado à regra responsável. `explicar` pede 3 frases ao LLM (com texto fixo de recurso). `proporAcao` cria, sem IA, uma `Acao` de tipo `remover-regra` já com o seu inverso. O pedido segue por WhatsApp (botões Aprovar e Recusar), ou por Telegram como recurso.
4. **Fechar** (`defesa`): o clique chega a `/webhook`, que valida a assinatura e o remetente. Depois, `aplicarAcao`:
   1. regista o inverso;
   2. revoga só essa regra;
   3. volta a ler até confirmar;
   4. regista `confirmado`;
   5. envia o botão **Desfazer**.

   O Desfazer repõe a regra a partir do inverso guardado.

## Estado partilhado

Não há base de dados: `auditoria.jsonl` é append-only e é a única fonte de verdade entre processos. O atacante escreve achados; a defesa lê achados e escreve ações; o painel lê tudo para a linha do tempo; o estado de uma ação reconstrói-se a partir dos eventos.

## Garantias de segurança (onde estão no código)

| Garantia | Onde |
|---|---|
| A IA só escreve texto | `shared/llm.ts` devolve `string`; `defesa/explicar.ts` só produz `Explicacao` |
| Ações de uma lista fechada | `TIPOS_ACAO` em `shared/tipos.ts`, `tipoPermitido` em `defesa/corrigir.ts` |
| Nada corre sem aprovação humana | `aplicarAcao` exige estado `aprovada`; `remetenteAutorizado` em `defesa/aprovar.ts` |
| Cada ação guarda o inverso | `Acao.inverso`, registado antes de aplicar |
| Só security groups nossos | `LSW_SECURITY_GROUPS_GERIDOS`, `garantirGerido` em `shared/leaseweb.ts` |
| Atacante só toca as nossas VMs | `atacante/alvos.ts`: só IPs literais, lista vazia recusa tudo |
| Sem exploração destrutiva | `atacante/reconhecimento.ts`: TCP connect, banners, 1 tentativa por credencial de fábrica, só leitura |

## API Leaseweb usada

Base `https://api.leaseweb.com/publicCloud/v1`, cabeçalho `X-LSW-Auth`.

| Uso | Pedido |
|---|---|
| Instâncias e IPs | `GET /instances`, `GET /instances/{id}` (`ips[].ip`) |
| Security groups de uma instância | `GET /instances/{id}/securityGroups` |
| Ler regras | `GET /securityGroups/{id}/firewallRules` |
| Fechar | `POST /securityGroups/{id}/revokeFirewallRules` `{ "rules": ["<ruleId>"] }`, que responde 202 |
| Desfazer | `POST /securityGroups/{id}/authorizeFirewallRules` `{ "rules": [{ protocol, startPort, endPort, source }] }` |
