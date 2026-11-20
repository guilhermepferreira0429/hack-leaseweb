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
| SQS | RabbitMQ | Mensagens enviadas = recebidas; testes da app passam | **B** |
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

## Planeador de destino (parte do migrador)

Antes de migrar, o migrador decide **onde fica cada serviço**, e explica porquê no Telegram:

- **Self-hosted numa VM da Leaseweb:** quando a máquina tem recursos e o serviço não é crítico.
- **Serviço gerido pago, europeu:** quando não há RAM ou disco que chegue, ou o serviço é crítico e precisa de alta disponibilidade e backups geridos.
- **Leaseweb primeiro:** se a Leaseweb tiver o serviço gerido, é essa a escolha. Outro fornecedor europeu só quando a Leaseweb não o tiver.

Exemplo da mensagem: "A tua VM tem 8 GB de RAM. O MinIO e o RabbitMQ ficam nela. A base de dados das encomendas é crítica: proponho um Postgres gerido europeu, com backups diários. Custo estimado: …. [Aprovar] [Tudo self-hosted]"

Como decide:

1. Regras fixas no código (RAM e disco necessários por serviço, criticidade marcada pelo dono, dados pessoais ou não). As regras decidem.
2. A IA só explica a decisão em português simples e responde a perguntas do dono. Não inventa preços: só usa os que estiverem na tabela do código, com a data em que foram vistos.

| Peça | Nível |
|---|---|
| Recomendar o destino de cada serviço com regras + explicação da IA no Telegram | **B** |
| O dono escolhe entre "recomendado" e "tudo self-hosted" | **B** |
| Criar e configurar os serviços geridos pelas APIs dos fornecedores europeus | C |
| Comparar custos atualizados entre fornecedores | C |

## Migrador de código (parte do migrador)

Migrar a infraestrutura sem mudar o código deixa a app a apontar para a AWS. O migrador também muda o código, e entrega a mudança como **pull request** que o dono aprova no Telegram.

| Caso | O que muda no código | Dificuldade | Nível |
|---|---|---|---|
| S3 → MinIO / Object Storage da Leaseweb | Só configuração: `endpoint`, credenciais e `forcePathStyle` no cliente S3. O resto do código fica igual (API compatível) | Baixa | **A** |
| Variáveis de ambiente e `.env` | Troca URLs e nomes de serviços AWS pelos novos; segredos nunca vão para o PR | Baixa | **A** |
| RDS Postgres → Postgres | Só a connection string | Baixa | **B** |
| SQS → NATS | Troca o cliente: `SendMessage`/`ReceiveMessage` passam a `publish`/`subscribe`. Reescrita real, com testes antes e depois | Média | **B** |
| DynamoDB → ScyllaDB Alternator | Só o endpoint (API compatível) | Baixa | C |
| Lambda → Serverless Functions / contentor | Reempacotar a função | Alta | C |

Como funciona:

1. **Encontrar:** procura no código os clientes da AWS (`@aws-sdk/*`, `boto3`, variáveis `AWS_*`) e a configuração.
2. **Propor:** a IA escreve a alteração; regras fixas validam que só mudam os ficheiros e linhas esperados.
3. **Provar:** correr os testes da app com o código novo contra o destino novo. Se falharem, o PR não é proposto.
4. **Aprovar:** o Migrador manda no Telegram "PR com 3 ficheiros alterados, testes a passar. [Aprovar] [Ver diff]".
5. **Liga com a defesa:** se a falha encontrada pelo atacante vier da configuração (por exemplo, uma regra aberta num ficheiro de infraestrutura), a defesa fecha na API e o migrador abre o PR que corrige a causa, para não voltar no próximo deploy.

Regra: o código só muda por PR. Nunca há push direto para o ramo principal.

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
