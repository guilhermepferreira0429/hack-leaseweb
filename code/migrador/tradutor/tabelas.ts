// Tabelas fixas do tradutor. As regras decidem; nada disto vem de um modelo de IA.
// Fonte: docs/research/aws-to-leaseweb-mapping.md e docs/research/leaseweb-api.md (vistos a 2026-11-20).

/** Região da Leaseweb (Amesterdão, AMS-01/AMS-02). Atenção: o "eu-west-3" da AWS é Paris; o da Leaseweb é Amesterdão. */
export const REGIAO_DESTINO = 'eu-west-3';
export const NOTA_REGIAO = 'Confirmar com GET /regions. O eu-west-3 da Leaseweb é Amesterdão (na AWS é Paris).';

/**
 * Tipo AWS -> tipo Leaseweb (mesmo nome com prefixo lsw.). vCPU e RAM são os da AWS.
 * Na documentação só vimos lsw.m3.large e lsw.m5.large: confirmar com GET /instanceTypes?region=eu-west-3.
 */
export const TIPOS: Record<string, { lsw: string; vcpu: number; ramGb: number }> = {
  't3.micro': { lsw: 'lsw.t3.micro', vcpu: 2, ramGb: 1 },
  't3.small': { lsw: 'lsw.t3.small', vcpu: 2, ramGb: 2 },
  't3.medium': { lsw: 'lsw.t3.medium', vcpu: 2, ramGb: 4 },
  't3.large': { lsw: 'lsw.t3.large', vcpu: 2, ramGb: 8 },
  't3.xlarge': { lsw: 'lsw.t3.xlarge', vcpu: 4, ramGb: 16 },
  'm5.large': { lsw: 'lsw.m5.large', vcpu: 2, ramGb: 8 },
  'm5.xlarge': { lsw: 'lsw.m5.xlarge', vcpu: 4, ramGb: 16 },
  'm5.2xlarge': { lsw: 'lsw.m5.2xlarge', vcpu: 8, ramGb: 32 },
  'm5.4xlarge': { lsw: 'lsw.m5.4xlarge', vcpu: 16, ramGb: 64 },
  'c5.large': { lsw: 'lsw.c5.large', vcpu: 2, ramGb: 4 },
  'c5.xlarge': { lsw: 'lsw.c5.xlarge', vcpu: 4, ramGb: 8 },
  'c5.2xlarge': { lsw: 'lsw.c5.2xlarge', vcpu: 8, ramGb: 16 },
  'r5.large': { lsw: 'lsw.r5.large', vcpu: 2, ramGb: 16 },
  'r5.xlarge': { lsw: 'lsw.r5.xlarge', vcpu: 4, ramGb: 32 },
  'r5.2xlarge': { lsw: 'lsw.r5.2xlarge', vcpu: 8, ramGb: 64 },
};
export const NOTA_TIPO = 'Confirmar com GET /instanceTypes?region=eu-west-3.';

/** Imagem base por SO e versão, a partir do nome da AMI pública. Só UBUNTU_20_04/22_04 vistos na referência. */
export const IMAGENS: { padrao: RegExp; imageId: string; so: string }[] = [
  { padrao: /ubuntu.*26\.04/i, imageId: 'UBUNTU_26_04_64BIT', so: 'Ubuntu 26.04' },
  { padrao: /ubuntu.*(noble|24\.04)/i, imageId: 'UBUNTU_24_04_64BIT', so: 'Ubuntu 24.04' },
  { padrao: /ubuntu.*(jammy|22\.04)/i, imageId: 'UBUNTU_22_04_64BIT', so: 'Ubuntu 22.04' },
  { padrao: /ubuntu.*(focal|20\.04)/i, imageId: 'UBUNTU_20_04_64BIT', so: 'Ubuntu 20.04' },
  { padrao: /debian.*(bookworm|-12)/i, imageId: 'DEBIAN_12_64BIT', so: 'Debian 12' },
  { padrao: /debian.*(bullseye|-11)/i, imageId: 'DEBIAN_11_64BIT', so: 'Debian 11' },
];
export const NOTA_IMAGEM = 'Confirmar com GET /images.';

/** Regiões AWS dentro da UE. Londres (eu-west-2) e Zurique (eu-central-2) ficam fora da UE. */
export const REGIOES_UE = new Set(['eu-west-1', 'eu-west-3', 'eu-central-1', 'eu-north-1', 'eu-south-1', 'eu-south-2']);

export const NOMES_REGIAO: Record<string, string> = {
  'eu-west-1': 'Irlanda',
  'eu-west-2': 'Londres',
  'eu-west-3': 'Paris',
  'eu-central-1': 'Frankfurt',
  'eu-central-2': 'Zurique',
  'eu-north-1': 'Estocolmo',
  'eu-south-1': 'Milão',
  'eu-south-2': 'Espanha',
  'us-east-1': 'Virgínia do Norte',
  'us-east-2': 'Ohio',
  'us-west-1': 'Califórnia',
  'us-west-2': 'Oregon',
};

/** Portas que nunca ficam abertas a toda a Internet. Igual à lista de docs/arquitetura.md e de defesa/detetar.ts. */
export const PORTAS_SENSIVEIS: Record<number, string> = {
  22: 'SSH',
  3389: 'RDP',
  5432: 'PostgreSQL',
  5984: 'CouchDB',
  3306: 'MySQL',
  1433: 'SQL Server',
  27017: 'MongoDB',
  6379: 'Redis',
  9200: 'Elasticsearch',
  445: 'SMB',
  23: 'Telnet',
};
/** Destas, só as de administração passam a aceitar o ADMIN_IP. As outras deixam de existir no destino. */
export const PORTAS_ADMIN = new Set([22, 3389]);

/** Serviços geridos da AWS -> alternativa aberta na Leaseweb (ferramentas.md). */
export const SUBSTITUICOES: Record<
  string,
  { servicoAws: string; alternativa: string; comoSeMove: string; nivel: 'A' | 'B' | 'C'; motor?: RegExp }[]
> = {
  aws_s3_bucket: [
    {
      servicoAws: 'S3',
      alternativa: 'MinIO numa instância Leaseweb',
      comoSeMove:
        'Mesma API S3: a app só muda o endpoint e as chaves. Os objetos copiam-se pela API S3 e confirmam-se por contagem e checksums.',
      nivel: 'A',
    },
  ],
  aws_sqs_queue: [
    {
      servicoAws: 'SQS',
      alternativa: 'RabbitMQ numa instância Leaseweb',
      comoSeMove:
        'A fila é recriada; quem envia e quem recebe muda de cliente. As mensagens em curso esvaziam-se antes da mudança.',
      nivel: 'B',
    },
  ],
  aws_db_instance: [
    {
      servicoAws: 'RDS PostgreSQL',
      alternativa: 'PostgreSQL numa instância Leaseweb',
      comoSeMove: 'pg_dump e pg_restore; depois contagem de linhas e checksum por tabela nos dois lados.',
      nivel: 'B',
      motor: /^postgres/,
    },
    {
      servicoAws: 'RDS MySQL',
      alternativa: 'MariaDB numa instância Leaseweb',
      comoSeMove: 'mysqldump e restauro; depois contagem e checksum por tabela.',
      nivel: 'C',
      motor: /^(mysql|mariadb)/,
    },
  ],
  aws_rds_cluster: [
    {
      servicoAws: 'Aurora PostgreSQL',
      alternativa: 'PostgreSQL numa instância Leaseweb',
      comoSeMove: 'pg_dump e pg_restore; depois contagem de linhas e checksum por tabela nos dois lados.',
      nivel: 'B',
      motor: /^aurora-postgresql/,
    },
  ],
  aws_elasticache_cluster: [
    {
      servicoAws: 'ElastiCache Redis',
      alternativa: 'Valkey numa instância Leaseweb',
      comoSeMove: 'Chaves copiadas com o TTL; confirma-se por amostragem.',
      nivel: 'B',
      motor: /^(redis|valkey)/,
    },
  ],
  // Grupo de replicação: sem `engine` é Redis por omissão.
  aws_elasticache_replication_group: [
    {
      servicoAws: 'ElastiCache Redis',
      alternativa: 'Valkey numa instância Leaseweb',
      comoSeMove: 'Chaves copiadas com o TTL; confirma-se por amostragem.',
      nivel: 'B',
      motor: /^(redis|valkey|)$/,
    },
  ],
  aws_secretsmanager_secret: [
    {
      servicoAws: 'Secrets Manager',
      alternativa: 'OpenBao numa instância Leaseweb',
      comoSeMove: 'Segredos copiados de cofre para cofre, sem nunca aparecerem em texto no log.',
      nivel: 'B',
    },
  ],
  aws_sns_topic: [
    {
      servicoAws: 'SNS',
      alternativa: 'NATS numa instância Leaseweb',
      comoSeMove: 'Tópicos e subscrições recriados; confirma-se que as mensagens enviadas chegam.',
      nivel: 'C',
    },
  ],
};

/** Prefixos de recursos que são lock-in: precisam de redesenho, não de migração. */
export const LOCK_IN: { prefixo: string; nome: string; alternativa: string }[] = [
  { prefixo: 'aws_lambda_', nome: 'Lambda', alternativa: 'reescrever como serviço normal ou OpenFaaS' },
  { prefixo: 'aws_dynamodb_', nome: 'DynamoDB', alternativa: 'ScyllaDB com a API Alternator' },
  { prefixo: 'aws_api_gateway_', nome: 'API Gateway', alternativa: 'Caddy ou nginx à frente da app' },
  { prefixo: 'aws_apigatewayv2_', nome: 'API Gateway', alternativa: 'Caddy ou nginx à frente da app' },
  { prefixo: 'aws_cognito_', nome: 'Cognito', alternativa: 'Keycloak' },
  { prefixo: 'aws_sfn_', nome: 'Step Functions', alternativa: 'orquestração no código da app' },
  { prefixo: 'aws_kinesis_', nome: 'Kinesis', alternativa: 'NATS JetStream' },
];

/** Recursos de rede da AWS que não têm tradução direta (a Leaseweb dá um IPv4 público por instância). */
export const REDE = ['aws_vpc', 'aws_subnet', 'aws_internet_gateway', 'aws_route_table', 'aws_route_table_association', 'aws_nat_gateway', 'aws_eip'];
