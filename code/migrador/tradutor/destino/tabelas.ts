// Tabelas do decisor de destino, copiadas de docs/decisor-destino.md (preços vistos a 20/11/2026, sem IVA).
// Nada aqui é inventado: o que o documento não diz fica 'desconhecido' ou 'a confirmar'.

/** Serviços que o decisor conhece. 's3' | 'postgres' | 'fila' | 'segredos' | 'cache' são os mesmos nomes do migrador (analisar.ts). */
export type ServicoDestino =
  | 's3'
  | 'postgres'
  | 'mysql'
  | 'cache'
  | 'dynamodb'
  | 'documentdb'
  | 'nats'
  | 'fila'
  | 'kafka'
  | 'segredos'
  | 'ecr'
  | 'logs'
  | 'cognito'
  | 'email'
  | 'dns'
  | 'balanceador'
  | 'kubernetes';

/** Disco: 'fator' = dados × fator; 'baixo' = sem mínimo; 'medio'/'alto' = o documento não dá número, conta-se pelo menos os dados. */
export type Disco = { tipo: 'fator'; fator: number } | { tipo: 'baixo' } | { tipo: 'medio' } | { tipo: 'alto' };

export type Recursos = {
  servicoAws: string;
  alternativa: string;
  /** RAM mínima em GB. Para o Valkey é 'dados em RAM × 1,5'. */
  ramGb: number | { dadosVezes: number };
  disco: Disco;
  baseDeDados: boolean;
  /** Crítico por omissão mesmo sem ser base de dados (ex.: o cofre de segredos). */
  criticoPorOmissao?: boolean;
  nota?: string;
};

/** "Recursos mínimos para self-hosted (valores de referência do decisor)". */
export const RECURSOS: Record<ServicoDestino, Recursos> = {
  s3: { servicoAws: 'S3', alternativa: 'MinIO', ramGb: 1, disco: { tipo: 'fator', fator: 1.2 }, baseDeDados: false },
  postgres: {
    servicoAws: 'RDS PostgreSQL',
    alternativa: 'PostgreSQL',
    ramGb: 1,
    disco: { tipo: 'fator', fator: 1.5 },
    baseDeDados: true,
    nota: '2 GB of RAM recommended; backups are on us.',
  },
  mysql: { servicoAws: 'RDS MySQL', alternativa: 'MariaDB', ramGb: 1, disco: { tipo: 'fator', fator: 1.5 }, baseDeDados: true },
  cache: { servicoAws: 'ElastiCache', alternativa: 'Valkey', ramGb: { dadosVezes: 1.5 }, disco: { tipo: 'baixo' }, baseDeDados: false },
  dynamodb: {
    servicoAws: 'DynamoDB',
    alternativa: 'ScyllaDB (Alternator)',
    ramGb: 2,
    disco: { tipo: 'fator', fator: 2 },
    baseDeDados: true,
    nota: 'Heavy for small VMs.',
  },
  documentdb: { servicoAws: 'DocumentDB', alternativa: 'FerretDB', ramGb: 1, disco: { tipo: 'fator', fator: 1.5 }, baseDeDados: true },
  nats: { servicoAws: 'SNS', alternativa: 'NATS', ramGb: 0.25, disco: { tipo: 'baixo' }, baseDeDados: false },
  fila: { servicoAws: 'SQS', alternativa: 'RabbitMQ', ramGb: 0.5, disco: { tipo: 'baixo' }, baseDeDados: false },
  kafka: {
    servicoAws: 'MSK (Kafka)',
    alternativa: 'Redpanda',
    ramGb: 2,
    disco: { tipo: 'alto' },
    baseDeDados: false,
    nota: 'Rarely worth self-hosting for a small business.',
  },
  segredos: {
    servicoAws: 'Secrets Manager',
    alternativa: 'OpenBao',
    ramGb: 0.25,
    disco: { tipo: 'baixo' },
    baseDeDados: false,
    criticoPorOmissao: true,
    nota: 'Critical: losing this means losing everything.',
  },
  ecr: { servicoAws: 'ECR', alternativa: 'Harbor', ramGb: 2, disco: { tipo: 'fator', fator: 1.2 }, baseDeDados: false },
  logs: { servicoAws: 'CloudWatch Logs', alternativa: 'Loki + Grafana', ramGb: 1, disco: { tipo: 'fator', fator: 1 }, baseDeDados: false },
  cognito: { servicoAws: 'Cognito', alternativa: 'Keycloak', ramGb: 1, disco: { tipo: 'baixo' }, baseDeDados: false },
  email: {
    servicoAws: 'SES',
    alternativa: 'Postal',
    ramGb: 1,
    disco: { tipo: 'baixo' },
    baseDeDados: false,
    nota: 'Deliverability is hard when self-hosted.',
  },
  dns: { servicoAws: 'Route 53', alternativa: 'PowerDNS', ramGb: 0.25, disco: { tipo: 'baixo' }, baseDeDados: false },
  balanceador: { servicoAws: 'ELB', alternativa: 'HAProxy', ramGb: 0.25, disco: { tipo: 'baixo' }, baseDeDados: false },
  kubernetes: { servicoAws: 'EKS', alternativa: 'k3s', ramGb: 2, disco: { tipo: 'medio' }, baseDeDados: false },
};

/** Margem: deixar sempre 25% da RAM da VM livre. */
export const MARGEM_RAM = 0.25;
/** Preço com mais dias do que isto -> "preço a confirmar". */
export const DIAS_VALIDADE_PRECO = 30;
/** Horas num mês, para passar preços à hora para mês (730 = 24 × 365 / 12). */
export const HORAS_MES = 730;

export type Preco =
  | { tipo: 'mes'; valor: number; moeda: 'EUR' | 'USD' }
  | { tipo: 'hora'; valor: number; moeda: 'EUR' | 'USD' }
  /** Por GB guardado por mês: multiplica-se pelos dados. */
  | { tipo: 'gb-mes'; valor: number; moeda: 'EUR' | 'USD' }
  /** Por GB transferido ou ingerido: depende do uso, não se fazem contas. */
  | { tipo: 'gb-uso'; valor: number; moeda: 'EUR' | 'USD' }
  | { tipo: 'a-confirmar' };

export type OpcaoGerida = {
  fornecedor: string;
  plano: string;
  /** País da sede. Só entram fornecedores com sede e dados na UE. */
  pais: string;
  ue: boolean;
  preco: Preco;
  /** 'desconhecido' quando o documento não diz. */
  altaDisponibilidade: boolean | 'desconhecido';
  vistoEm: string;
  fonte: string;
  nota?: string;
};

const VISTO = '2026-11-20';

/** O que a Leaseweb tem gerido (escolha preferida). Bases de dados geridas: não encontrámos, a confirmar no dia. */
export const GERIDO_LEASEWEB: Partial<Record<ServicoDestino, OpcaoGerida>> = {
  s3: {
    fornecedor: 'Leaseweb',
    plano: 'Object Storage on demand',
    pais: 'NL',
    ue: true,
    preco: { tipo: 'gb-mes', valor: 0.01733, moeda: 'EUR' },
    altaDisponibilidade: 'desconhecido',
    vistoEm: VISTO,
    fonte: 'leaseweb.com/en/products-services/object-storage',
  },
  balanceador: {
    fornecedor: 'Leaseweb',
    plano: 'Load balancer como serviço (HAProxy)',
    pais: 'NL',
    ue: true,
    preco: { tipo: 'a-confirmar' },
    altaDisponibilidade: 'desconhecido',
    vistoEm: VISTO,
    fonte: 'kb.leaseweb.com (load balancer of Public Cloud)',
    nota: 'Runs on an instance: you pay the price of the chosen instance.',
  },
  kubernetes: {
    fornecedor: 'Leaseweb',
    plano: 'Managed Kubernetes',
    pais: 'NL',
    ue: true,
    preco: { tipo: 'mes', valor: 21.6, moeda: 'EUR' },
    altaDisponibilidade: 'desconhecido',
    vistoEm: VISTO,
    fonte: 'leaseweb.com/en/configure/vc/product/entityKey/KUBERNETES/2001',
    nota: 'Base price; vCPU at €0.0038/h and RAM at €0.0019/GB/h extra.',
  },
};

/** Bases de dados geridas da Leaseweb: "não encontrámos na Public Cloud; confirmar no dia". */
export const LEASEWEB_POR_CONFIRMAR = new Set<ServicoDestino>(['postgres', 'mysql', 'cache', 'documentdb', 'dynamodb']);

const scaleway = (o: Omit<OpcaoGerida, 'fornecedor' | 'pais' | 'ue' | 'vistoEm' | 'altaDisponibilidade'> & Partial<OpcaoGerida>): OpcaoGerida => ({
  fornecedor: 'Scaleway',
  pais: 'FR',
  ue: true,
  vistoEm: VISTO,
  altaDisponibilidade: 'desconhecido',
  ...o,
});

const DB_DEV_S = scaleway({
  plano: 'DB-DEV-S (2 vCPU, 2 GB)',
  preco: { tipo: 'hora', valor: 0.0156, moeda: 'EUR' },
  fonte: 'scaleway.com/en/pricing/managed-databases-pricing',
  nota: 'Backups extra: €0.03/GB/month.',
});

/** Geridos europeus quando a Leaseweb não tem. */
export const GERIDO_EUROPEU: Partial<Record<ServicoDestino, OpcaoGerida[]>> = {
  postgres: [
    DB_DEV_S,
    {
      fornecedor: 'UpCloud',
      plano: '1 nó, 2 GB, 25 GB, backups 24 h',
      pais: 'FI',
      ue: true,
      preco: { tipo: 'mes', valor: 30, moeda: 'EUR' },
      altaDisponibilidade: false,
      vistoEm: VISTO,
      fonte: 'upcloud.com/docs/products/managed-postgresql/pricing',
    },
    {
      fornecedor: 'OVHcloud',
      plano: 'Essential db1-7 (2 vCPU, 7 GB, 50 GB)',
      pais: 'FR',
      ue: true,
      preco: { tipo: 'hora', valor: 0.17, moeda: 'USD' },
      altaDisponibilidade: 'desconhecido',
      vistoEm: VISTO,
      fonte: 'sparecores.com/database/ovh/postgresql-essential-db1-7',
    },
  ],
  mysql: [DB_DEV_S],
  cache: [
    scaleway({
      plano: 'RED1-MICRO (2 vCPU, 2 GB)',
      preco: { tipo: 'hora', valor: 0.048, moeda: 'EUR' },
      fonte: 'scaleway.com/fr/tarifs/managed-databases',
      nota: 'Price "from".',
    }),
  ],
  documentdb: [
    scaleway({
      plano: 'MGDB-PLAY2-NANO (2 vCPU, 4 GB)',
      preco: { tipo: 'hora', valor: 0.1077, moeda: 'EUR' },
      fonte: 'scaleway.com/en/pricing/managed-databases-pricing',
      nota: 'Storage extra.',
    }),
  ],
  fila: [scaleway({ plano: 'Queues (compatível com SQS)', preco: { tipo: 'gb-uso', valor: 0.01, moeda: 'EUR' }, fonte: 'scaleway.com/en/pricing/managed-databases-pricing' })],
  nats: [
    scaleway({
      plano: 'NATS',
      preco: { tipo: 'gb-uso', valor: 0.01, moeda: 'EUR' },
      fonte: 'scaleway.com/en/pricing/managed-databases-pricing',
      nota: 'Persistence about €0.14/GB/month extra.',
    }),
  ],
  kafka: [
    { fornecedor: 'OVHcloud', plano: 'Kafka gerido', pais: 'FR', ue: true, preco: { tipo: 'a-confirmar' }, altaDisponibilidade: 'desconhecido', vistoEm: VISTO, fonte: 'ovhcloud.com (choosing right database)' },
    scaleway({ plano: 'Kafka gerido', preco: { tipo: 'a-confirmar' }, fonte: 'scaleway.com' }),
  ],
  logs: [scaleway({ plano: 'Cockpit, logs custom', preco: { tipo: 'gb-uso', valor: 0.35, moeda: 'EUR' }, fonte: 'scaleway.com/en/pricing/managed-services' })],
  email: [scaleway({ plano: 'Transactional Email', preco: { tipo: 'a-confirmar' }, fonte: 'scaleway.com/transactional-email-tem' })],
  segredos: [scaleway({ plano: 'Secret Manager', preco: { tipo: 'a-confirmar' }, fonte: 'scaleway.com/en/docs/secret-manager/faq' })],
  ecr: [scaleway({ plano: 'Container Registry', preco: { tipo: 'a-confirmar' }, fonte: 'scaleway.com/en/pricing/containers' })],
  balanceador: [
    {
      fornecedor: 'OVHcloud',
      plano: 'Load Balancer',
      pais: 'FR',
      ue: true,
      preco: { tipo: 'mes', valor: 6.94, moeda: 'USD' },
      altaDisponibilidade: 'desconhecido',
      vistoEm: VISTO,
      fonte: 'pricingsaas.com/companies/ovhcloud.publiccloud',
    },
  ],
  s3: [
    {
      fornecedor: 'Exoscale',
      plano: 'Object Storage Standard',
      pais: 'CH',
      ue: false,
      preco: { tipo: 'gb-mes', valor: 0.0184, moeda: 'EUR' },
      altaDisponibilidade: 'desconhecido',
      vistoEm: VISTO,
      fonte: 'exoscale.com/object-storage/classes',
      nota: 'Comparison only: headquartered in Switzerland, outside the EU.',
    },
    {
      fornecedor: 'OVHcloud',
      plano: 'Object Storage Standard',
      pais: 'FR',
      ue: true,
      preco: { tipo: 'gb-mes', valor: 8.3 / 1024, moeda: 'USD' },
      altaDisponibilidade: 'desconhecido',
      vistoEm: VISTO,
      fonte: 'pricingsaas.com/companies/ovhcloud.publiccloud',
      nota: '$8.3/TiB/month.',
    },
  ],
};
