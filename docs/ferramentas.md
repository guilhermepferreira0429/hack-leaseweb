# Catálogo de ferramentas dos agentes

A visão completa, como se houvesse tempo ilimitado. Cada linha tem um nível:

- **A:** entra na demo de hoje.
- **B:** entra se a integração n.º 2 passar antes do tempo.
- **C:** fica para o slide "o que vem a seguir" e para depois do hackathon.

Regra: nada de nível B ou C começa antes de todo o nível A funcionar ponta a ponta.

## Migrador: da AWS para alternativas abertas na Leaseweb

| Serviço AWS | Alternativa aberta na Leaseweb | Como se prova que ficou igual | Nível |
|---|---|---|---|
| S3 | MinIO | Contagem de objetos e checksums iguais; testes da app passam | **A** |
| RDS PostgreSQL | PostgreSQL | `pg_dump`/`pg_restore`; contagem de linhas por tabela e checksum por tabela | **B** |
| SQS | RabbitMQ ou NATS | Mensagens enviadas = recebidas; testes da app passam | **B** |
| ElastiCache Redis | Valkey | Chaves e TTL iguais por amostragem | **B** |
| Secrets Manager / Parameter Store | OpenBao | Segredos migrados sem nunca aparecerem em texto no log; a app arranca | B |
| RDS MySQL | MariaDB | Contagens e checksums por tabela | C |
| DynamoDB | ScyllaDB (Alternator, API compatível) | Contagem e amostragem de itens | C |
| SNS | NATS | Subscrições e entrega de mensagens | C |
| SES | Postal | Envio de teste a uma caixa nossa | C |
| ECR | Harbor | Imagens com o mesmo digest | C |
| CloudWatch Logs | Loki + Grafana | Os logs chegam e pesquisam-se | C |
| Cognito | Keycloak | Login de teste com um utilizador migrado | C |
| Lambda | OpenFaaS | A mesma função dá a mesma resposta | C |
| Route 53 | PowerDNS | Os registos respondem igual (`dig`) | C |
| CloudFront | Caddy / Varnish à frente do MinIO | O mesmo ficheiro com o mesmo hash | C |
| EKS | k3s | Os manifestos aplicam e os pods ficam prontos | C |

Para cada serviço o migrador faz sempre os mesmos 5 passos: **analisar** (encontra o serviço no código e na configuração), **propor** (plano em português simples, aprovado no Telegram), **provisionar** (cria o destino na Leaseweb), **copiar** (dados com prova) e **verificar** (mesmos testes antes e depois). Uma tabela de "tradução" por serviço; acrescentar um serviço é acrescentar uma entrada.

A origem "AWS" é simulada com o LocalStack, que emula S3, SQS, SNS, DynamoDB, Secrets Manager e outros.

## Atacante: só às nossas máquinas (allowlist)

| Ferramenta | O que procura | Nível |
|---|---|---|
| `nmap` às portas sensíveis | Bases de dados, Redis, Elasticsearch, RDP abertos a toda a Internet | **A** |
| Leitura dos security groups pela API | Regras com `0.0.0.0/0` ou `::/0` | **A** |
| Bucket do MinIO público | Política de leitura anónima depois da migração | **B** |
| Credenciais por defeito | Postgres, Redis, MinIO e painéis com a senha de fábrica (só tentativa de login, sem mexer em dados) | **B** |
| Segredos expostos | Chaves no código e em variáveis de ambiente (gitleaks ou trufflehog no repo da app de exemplo) | B |
| TLS e cabeçalhos HTTP | Certificados fracos, HTTP sem TLS, cabeçalhos de segurança em falta | B |
| Versões com CVE conhecidas | Comparar versões de serviços com CVE conhecidas (nuclei com templates não intrusivos) | C |
| SSH | Login por senha ativo, root permitido | C |

Nada destrutivo. Só alvos em `ALVOS_PERMITIDOS`; qualquer outro é recusado e registado.

## Defesa: lista fechada de ações, cada uma com o seu inverso

| Ação | Inverso | Nível |
|---|---|---|
| Remover regra do security group | Recriar a regra | **A** |
| Restringir a origem da regra a um IP ou rede nossa | Repor a origem anterior | **B** |
| Snapshot da máquina antes de mexer | Repor o snapshot | **B** |
| Tornar o bucket privado | Repor a política anterior | **B** |
| Trocar a senha por defeito por uma forte (guardada no OpenBao) | Repor a anterior | B |
| Rodar uma chave exposta | Repor a anterior durante uma janela curta | C |
| Desligar login SSH por senha | Voltar a ligar | C |
| Ativar fail2ban na máquina | Desativar | C |

A IA explica e propõe. A ação vem sempre desta tabela; o modelo nunca escreve comandos.
