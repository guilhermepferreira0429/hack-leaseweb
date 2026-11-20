// Lê a app de exemplo, encontra os serviços AWS usados e escreve o plano em texto.
import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';

/** Os mesmos nomes no tradutor/decisor (code/migrador/tradutor/destino). */
export type ServicoAws = 's3' | 'postgres' | 'fila' | 'segredos' | 'cache';

/** Alternativa aberta proposta para cada serviço (migrarS3, migrarPostgres, migrarFila, migrarSegredos, migrarCache). */
export const ALTERNATIVA: Record<ServicoAws, string> = {
  s3: 'MinIO',
  postgres: 'PostgreSQL',
  fila: 'RabbitMQ',
  segredos: 'OpenBao',
  cache: 'Valkey',
};

/** Nome do serviço AWS como o dono o conhece (em inglês: a demo e o Telegram são em inglês). */
export const NOME_AWS: Record<ServicoAws, string> = {
  s3: 'S3 (files)',
  postgres: 'RDS PostgreSQL (database)',
  fila: 'SQS (message queue)',
  segredos: 'Secrets Manager and SSM (passwords and settings)',
  cache: 'ElastiCache Redis (cache)',
};

/** Nome curto para o plano ("S3 → MinIO"). */
const CURTO: Record<ServicoAws, string> = {
  s3: 'S3',
  postgres: 'RDS',
  fila: 'SQS',
  segredos: 'Secrets Manager/SSM',
  cache: 'ElastiCache',
};

/** Tabela de tradução: o que denuncia cada serviço no código ou na configuração. */
const SINAIS: Record<ServicoAws, RegExp> = {
  s3: /@aws-sdk\/client-s3|aws-sdk\/clients\/s3|\bS3Client\b/,
  postgres: /from\s+['"]pg['"]|require\(\s*['"]pg['"]\s*\)|"pg"\s*:|postgres(?:ql)?:\/\//,
  fila: /@aws-sdk\/client-sqs|aws-sdk\/clients\/sqs|\bSQSClient\b/,
  segredos: /@aws-sdk\/client-(?:secrets-manager|ssm)|aws-sdk\/clients\/(?:secretsmanager|ssm)|\b(?:SecretsManagerClient|SSMClient)\b/,
  cache: /from\s+['"](?:redis|ioredis|@valkey\/[\w-]+)['"]|require\(\s*['"](?:redis|ioredis)['"]\s*\)|"(?:redis|ioredis)"\s*:|rediss?:\/\//,
};

const ORDEM: ServicoAws[] = ['s3', 'postgres', 'fila', 'segredos', 'cache'];
const EXTENSOES = new Set(['.ts', '.js', '.mjs', '.cjs', '.json', '.yml', '.yaml', '.env']);
// seed/ são ferramentas que enchem a "AWS" de dados falsos, não fazem parte da app.
const IGNORAR = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', 'seed']);

async function* ficheiros(dir: string): AsyncGenerator<string> {
  for (const entrada of await readdir(dir, { withFileTypes: true })) {
    if (IGNORAR.has(entrada.name)) continue;
    const caminho = join(dir, entrada.name);
    if (entrada.isDirectory()) yield* ficheiros(caminho);
    else if (entrada.isFile() && EXTENSOES.has(extname(entrada.name))) yield caminho;
  }
}

function escreverPlano(servicos: ServicoAws[]): string {
  if (servicos.length === 0) return 'I found no AWS services in this app. There is nothing to migrate.';
  const lista = servicos.map((s) => NOME_AWS[s]);
  const encontrados = lista.length === 1 ? lista[0] : `${lista.slice(0, -1).join(', ')} and ${lista.at(-1)}`;
  const passos = servicos.map((s) => `${CURTO[s]} → ${ALTERNATIVA[s]}`);
  // Curto de propósito: 3 linhas no grupo. O detalhe (o que fica na AWS, segredos, testes) vai no certificado e no painel.
  return [
    `I found ${servicos.length === 1 ? 'one AWS service' : `${servicos.length} AWS services`} in the app: ${encontrados}.`,
    passos.length > 1
      ? `I propose moving them to Leaseweb (EU), with one approval: ${passos.join(', ')}.`
      : `I propose moving it to Leaseweb (EU), with your approval: ${passos.join(', ')}.`,
    'Each copy is checksum-verified (count + sha256) and the app tests run on both sides.',
  ].join('\n');
}

/** Procura imports do SDK AWS (@aws-sdk/client-s3, client-sqs) e do pg na pasta da app. */
export async function analisar(dirApp: string): Promise<{ servicos: ServicoAws[]; plano: string }> {
  const info = await stat(dirApp).catch(() => undefined);
  if (!info?.isDirectory()) throw new Error(`App folder not found: ${dirApp}`);

  const vistos = new Set<ServicoAws>();
  for await (const caminho of ficheiros(dirApp)) {
    const texto = await readFile(caminho, 'utf8');
    for (const s of ORDEM) if (!vistos.has(s) && SINAIS[s].test(texto)) vistos.add(s);
    if (vistos.size === ORDEM.length) break;
  }
  const servicos = ORDEM.filter((s) => vistos.has(s));
  return { servicos, plano: escreverPlano(servicos) };
}
