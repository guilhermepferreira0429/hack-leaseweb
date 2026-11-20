# Guião da demo (cerca de 90 s, dentro do pitch de 5 min)

1. **Abertura a frio** (sem "olá, somos a equipa X"): "Esta máquina, na cloud da Leaseweb, foi ligada hoje de manhã. Desde então recebeu **N** tentativas de entrada." Mostrar `/isco`.
2. "Esta app corre na AWS." (LocalStack.) No grupo "Direção" do Telegram, o **Migrador** propõe o plano para os 5 serviços. → **Approve plan** (um só toque).
3. O painel mostra os 5 serviços migrados, cada um com a sua prova (contagens e checksums iguais) e os testes a passar dos dois lados.
4. O Migrador avisa o **Atacante** no grupo. O Atacante faz ligações TCP às portas sensíveis da VM nova, encontra a base de dados (5432) aberta a toda a Internet e chama a **Defesa**. A verificação da defesa, vista de fora com `nmap`, dá `open` (sem o IP da vítima, a defesa espera pela API da Leaseweb).
5. A **Defesa** explica em inglês simples e propõe **Close**. **Um jurado carrega** (entrou pelo QR code; ver `ideias-wow.md`). O Atacante confirma que já não chega lá e o **Chefe** resume.
6. A verificação da defesa (`nmap`, de fora) volta a correr e dá `filtered`; a regra também sai da API da Leaseweb. O painel mostra o **relógio de exposição** ("exposto N s") e as tentativas do isco nesse tempo. No painel: linha do tempo, auditoria com o inverso guardado e botão Desfazer.
7. **Corrigir a causa:** o **Migrador** abre um PR no repo público da app (`hack-leaseweb-exemplo-app`). O PR aponta a app para a Leaseweb e corrige a regra do Terraform que abria a 5432, para não voltar no próximo deploy. → **Approve PR** faz o merge; `/desfazer` abre um PR que reverte. Só com `MIGRADOR_PR=real`; num ensaio o PR é simulado e não há botão.
8. Fecho: "Tudo o que viram foi feito hoje e corre na Leaseweb, com IA de fornecedores europeus. Nada saiu da UE. Migrar sem ficar exposto nem um minuto."

**Números:** só o N medido no dia e os que a demo mostrar. Não inventar países nem estatísticas.

**Se a demo falhar em palco:** "Gravámos às 14:30 por precaução" e passar o vídeo. Não se depura em palco.

## Preparação do cérebro (antes de cada ensaio e da demo)

`bash env/preparar-demo.sh`, da raiz do repo. Por esta ordem:

1. Verifica o `.env`: Postgres de origem e de destino, MinIO, RabbitMQ, redis-origem, Valkey e OpenBao.
2. `infra:up`: LocalStack (S3, SQS, Secrets Manager, SSM), Postgres de origem e de destino, MinIO, RabbitMQ, redis-origem, Valkey e OpenBao, todos em `127.0.0.1`.
3. `npm run seed:limpar-destino -- --sim`: esvazia **só o destino** (buckets da seed no MinIO, Valkey, filas no RabbitMQ, segredos da seed no OpenBao, esquema `loja` e `public.encomendas` no Postgres de destino), para não aparecer cheio antes de Aprovar. Recusa se algum destino apontar para a origem.
4. `npm run seed`: dados falsos de uma PME na origem (S3, Postgres, SQS, Secrets Manager e SSM, ElastiCache), sempre iguais. Volta a pôr as 50 mensagens no SQS depois de qualquer migração anterior, sem duplicar, e repõe as 20 encomendas da app.
5. `npm run seed:comparar`: a origem tem de dar 10/10 iguais ao `esperado.json`.

Os passos 3 e 4 mexem em lados diferentes, por isso a ordem entre eles não altera o resultado; o importante é ficar a origem cheia e o destino vazio antes de migrar. Uma corrida de cada vez: nunca preparar com um ensaio a meio.

Depois: `npm run dev -- --consola --uma-vez` (ensaio) ou `npm run dev` (com Telegram). No fim, a prova independente: `npm run seed:comparar -- --destino` (10/10).

Entre ensaios com "Approve PR": `bash env/repor-repo-app.sh --sim` repõe o repo público da app no estado inicial (fecha os PR, apaga os ramos `migracao/*` e volta o `main` ao commit com a regra 5432 aberta). Sem `--sim` só mostra o estado. E `npm run lsw:vitima -- reabrir` volta a abrir a 5432 da vítima.
DynamoDB, SNS e CloudWatch Logs (`npm run seed:extra`) ficam só no plano; não correr na preparação da demo.
Ver o painel do portátil: `ssh -L 3000:localhost:3000 ubuntu@<cérebro>` e abrir `http://localhost:3000`.

## Contar tentativas no isco

```bash
sudo grep -cE "Invalid user|Failed password|Connection closed by authenticating user|Disconnected from invalid user" /var/log/auth.log
sudo grep -oE "from [0-9.]+" /var/log/auth.log | sort -u | wc -l   # IPs distintos
```
