// Lê a app de exemplo, encontra os serviços AWS usados e escreve o plano em texto.
import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';

export type ServicoAws = 's3' | 'postgres' | 'fila';

/** Alternativa aberta proposta para cada serviço. Só o S3 é migrado hoje; o resto é slide. */
export const ALTERNATIVA: Record<ServicoAws, string> = {
  s3: 'MinIO',
  postgres: 'PostgreSQL',
  fila: 'RabbitMQ',
};

/** Nome do serviço AWS como o dono o conhece. */
export const NOME_AWS: Record<ServicoAws, string> = {
  s3: 'S3 (ficheiros)',
  postgres: 'RDS PostgreSQL (base de dados)',
  fila: 'SQS (fila de mensagens)',
};

/** Tabela de tradução: o que denuncia cada serviço no código ou na configuração. */
const SINAIS: Record<ServicoAws, RegExp> = {
  s3: /@aws-sdk\/client-s3|aws-sdk\/clients\/s3|\bS3Client\b/,
  postgres: /from\s+['"]pg['"]|require\(\s*['"]pg['"]\s*\)|"pg"\s*:|postgres(?:ql)?:\/\//,
  fila: /@aws-sdk\/client-sqs|aws-sdk\/clients\/sqs|\bSQSClient\b/,
};

const ORDEM: ServicoAws[] = ['s3', 'postgres', 'fila'];
const EXTENSOES = new Set(['.ts', '.js', '.mjs', '.cjs', '.json', '.yml', '.yaml', '.env']);
const IGNORAR = new Set(['node_modules', '.git', 'dist', 'build', 'coverage']);

async function* ficheiros(dir: string): AsyncGenerator<string> {
  for (const entrada of await readdir(dir, { withFileTypes: true })) {
    if (IGNORAR.has(entrada.name)) continue;
    const caminho = join(dir, entrada.name);
    if (entrada.isDirectory()) yield* ficheiros(caminho);
    else if (entrada.isFile() && EXTENSOES.has(extname(entrada.name))) yield caminho;
  }
}

function escreverPlano(servicos: ServicoAws[]): string {
  if (servicos.length === 0) return 'Não encontrei serviços da AWS nesta app. Não há nada para migrar.';
  const lista = servicos.map((s) => NOME_AWS[s]);
  const encontrados = lista.length === 1 ? lista[0] : `${lista.slice(0, -1).join(', ')} e ${lista.at(-1)}`;
  const linhas = [`Encontrei ${servicos.length === 1 ? 'um serviço' : `${servicos.length} serviços`} da AWS na app: ${encontrados}.`];
  if (servicos.includes('s3')) {
    linhas.push(
      'Proponho passar já os ficheiros do S3 para o MinIO na Leaseweb, na UE. Copio cada ficheiro e confirmo que a impressão digital (sha256) é igual dos dois lados.',
      'No fim corro os mesmos testes da app contra a AWS e contra a Leaseweb. Nada é apagado na AWS.',
    );
  }
  const resto = servicos.filter((s) => s !== 's3').map((s) => `${NOME_AWS[s].split(' ')[0]} → ${ALTERNATIVA[s]}`);
  if (resto.length > 0) linhas.push(`Fica para a fase seguinte: ${resto.join(', ')}.`);
  return linhas.join('\n');
}

/** Procura imports do SDK AWS (@aws-sdk/client-s3, client-sqs) e do pg na pasta da app. */
export async function analisar(dirApp: string): Promise<{ servicos: ServicoAws[]; plano: string }> {
  const info = await stat(dirApp).catch(() => undefined);
  if (!info?.isDirectory()) throw new Error(`A pasta da app não existe: ${dirApp}`);

  const vistos = new Set<ServicoAws>();
  for await (const caminho of ficheiros(dirApp)) {
    const texto = await readFile(caminho, 'utf8');
    for (const s of ORDEM) if (!vistos.has(s) && SINAIS[s].test(texto)) vistos.add(s);
    if (vistos.size === ORDEM.length) break;
  }
  const servicos = ORDEM.filter((s) => vistos.has(s));
  return { servicos, plano: escreverPlano(servicos) };
}
