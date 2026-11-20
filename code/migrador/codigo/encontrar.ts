// Migrador de código, passo 1: encontrar no código e na configuração da app o que a prende à AWS.
// Só lê. Regras fixas, sem IA. Os trechos que se devolvem nunca levam o valor de um segredo.
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

export type ServicoUso = 's3' | 'postgres' | 'fila' | 'segredos' | 'cache' | 'credencial' | 'outro';

export type TipoUso =
  /** Cliente do SDK da AWS (import ou `new XClient`). */
  | 'sdk'
  /** Endereço da AWS (amazonaws.com) ou do LocalStack escrito no código ou na configuração. */
  | 'endpoint'
  /** Variável de ambiente que a app lê para falar com um serviço. */
  | 'variavel'
  /** Credencial da AWS (AWS_ACCESS_KEY_ID, …). Nunca se copia: cria-se outra no destino. */
  | 'credencial'
  /** Cliente S3 sem forcePathStyle: o MinIO precisa dele. */
  | 's3-sem-path-style';

export interface UsoAws {
  ficheiro: string;
  linha: number;
  servico: ServicoUso;
  tipo: TipoUso;
  /** A linha, sem o valor de nenhum segredo. */
  trecho: string;
  /** Nome da variável de ambiente (tipos 'variavel' e 'credencial'). */
  nome?: string;
}

/** Pastas que não são código da app (ferramentas da demo, dependências, testes). */
const IGNORAR = new Set(['node_modules', 'dist', '.git', 'seed', 'testes', 'coverage']);
const EXTENSOES = /\.(ts|js|mjs|cjs|json)$|(^|[\\/])\.env(\.[\w-]+)?$|\.env\.example$/;

const SDK: [RegExp, ServicoUso][] = [
  [/@aws-sdk\/client-s3\b/, 's3'],
  [/@aws-sdk\/client-sqs\b/, 'fila'],
  [/@aws-sdk\/client-(secrets-manager|ssm)\b/, 'segredos'],
  [/@aws-sdk\/client-elasticache\b/, 'cache'],
  [/@aws-sdk\/client-rds\b/, 'postgres'],
  [/\bnew (S3Client)\(/, 's3'],
  [/\bnew (SQSClient)\(/, 'fila'],
  [/\bnew (SecretsManagerClient|SSMClient)\(/, 'segredos'],
];

const ENDPOINT: [RegExp, ServicoUso][] = [
  [/\bs3[.-][\w.-]*amazonaws\.com|\.s3\.amazonaws\.com/i, 's3'],
  [/\bsqs\.[\w.-]*amazonaws\.com/i, 'fila'],
  [/\.rds\.amazonaws\.com/i, 'postgres'],
  [/\.cache\.amazonaws\.com/i, 'cache'],
  [/\bsecretsmanager\.[\w.-]*amazonaws\.com/i, 'segredos'],
  [/amazonaws\.com/i, 'outro'],
  [/\blocalstack\b|:4566\b/i, 'outro'],
];

/** Variáveis de ambiente que a app lê, por serviço (nomes da exemplo-app e os habituais). */
const VARIAVEIS: [RegExp, ServicoUso][] = [
  [/\b(ARMAZENAMENTO_\w+|S3_\w+|BUCKET\w*)\b/, 's3'],
  [/\b(DATABASE_URL|PG\w+|POSTGRES_\w+)\b/, 'postgres'],
  [/\b(FILA_\w+|SQS_\w+|QUEUE_\w+)\b/, 'fila'],
  [/\b(REDIS_\w+|CACHE_\w+)\b/, 'cache'],
];

const CREDENCIAL = /\bAWS_(ACCESS_KEY_ID|SECRET_ACCESS_KEY|SESSION_TOKEN)\b/;
const LEITURA_ENV = /process\.env\.(\w+)|process\.env\[['"](\w+)['"]\]|\bv\(['"](\w+)['"]\)/g;
const NOME_SENSIVEL = /(SECRET|PASSWORD|PASSWD|TOKEN|API_?KEY|ACCESS_?KEY|PRIVATE_?KEY|CREDENTIAL)/i;

/** Tira o valor de qualquer segredo da linha (atribuições a nomes sensíveis, senhas em URLs, chaves AKIA…). */
export function semSegredos(linha: string): string {
  return linha
    .replace(/\b([A-Za-z_]\w*)(\s*[=:]\s*)(["']?)([^\s"',;]+)\3/g, (todo, nome: string, sep: string, aspa: string, valor: string) =>
      NOME_SENSIVEL.test(nome) && !/^(process\.env|\$|<)/.test(valor) && !valor.includes('(') ? `${nome}${sep}${aspa}***${aspa}` : todo,
    )
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:)([^\s@/]+)@/gi, '$1***@')
    .replace(/\b(AKIA|ASIA)[A-Z0-9]{16}\b/g, '***');
}

async function listar(dir: string, raiz = dir): Promise<string[]> {
  const entradas = await readdir(dir, { withFileTypes: true });
  const ficheiros: string[] = [];
  for (const e of entradas) {
    if (IGNORAR.has(e.name)) continue;
    const caminho = join(dir, e.name);
    if (e.isDirectory()) ficheiros.push(...(await listar(caminho, raiz)));
    else if (EXTENSOES.test(e.name) && e.name !== 'package-lock.json' && !/\.test\.ts$/.test(e.name)) ficheiros.push(caminho);
  }
  return ficheiros.sort();
}

/** Usos da AWS numa só linha. */
function usosNaLinha(texto: string): { servico: ServicoUso; tipo: TipoUso; nome?: string }[] {
  const usos: { servico: ServicoUso; tipo: TipoUso; nome?: string }[] = [];
  const sdk = /^\s*(\/\/|\/?\*)/.test(texto) ? undefined : SDK.find(([re]) => re.test(texto));
  if (sdk) usos.push({ servico: sdk[1], tipo: 'sdk' });
  // Um comentário que fala da AWS não é um endereço em uso.
  const comentario = /^\s*(\/\/|\/?\*|#)/.test(texto);
  const endpoint = comentario ? undefined : ENDPOINT.find(([re]) => re.test(texto));
  if (endpoint && !sdk) usos.push({ servico: endpoint[1], tipo: 'endpoint' });
  const cred = texto.match(CREDENCIAL);
  if (cred) usos.push({ servico: 'credencial', tipo: 'credencial', nome: `AWS_${cred[1]}` });
  else {
    // Variáveis lidas pela app (process.env.X ou o atalho v('X') da exemplo-app) ou definidas num .env.
    const nomes = [...texto.matchAll(LEITURA_ENV)].map((m) => m[1] ?? m[2] ?? m[3]!);
    const definida = texto.match(/^\s*([A-Z][A-Z0-9_]*)\s*=/);
    if (definida) nomes.push(definida[1]!);
    for (const nome of new Set(nomes)) {
      const v = VARIAVEIS.find(([re]) => re.test(nome));
      if (v) usos.push({ servico: v[1], tipo: 'variavel', nome });
    }
  }
  return usos;
}

/** Procura, ficheiro a ficheiro e linha a linha, o que prende a app à AWS. */
export async function encontrarUsosAws(dirApp: string): Promise<UsoAws[]> {
  const usos: UsoAws[] = [];
  for (const caminho of await listar(dirApp)) {
    const ficheiro = relative(dirApp, caminho).split(sep).join('/');
    const linhas = (await readFile(caminho, 'utf8')).split(/\r?\n/);
    linhas.forEach((texto, i) => {
      const trecho = semSegredos(texto.trim()).slice(0, 160);
      const vistos = new Set<string>();
      for (const u of usosNaLinha(texto)) {
        const chave = `${u.servico}:${u.tipo}:${u.nome ?? ''}`;
        if (vistos.has(chave)) continue;
        vistos.add(chave);
        usos.push({ ficheiro, linha: i + 1, ...u, trecho });
      }
      // O MinIO só funciona com path-style: um S3Client sem forcePathStyle nas linhas seguintes tem de mudar.
      if (/\bnew S3Client\(/.test(texto)) {
        const bloco = linhas.slice(i, i + 12).join('\n');
        const fim = bloco.indexOf('})');
        if (!/forcePathStyle\s*:\s*true/.test(fim >= 0 ? bloco.slice(0, fim) : bloco)) {
          usos.push({ ficheiro, linha: i + 1, servico: 's3', tipo: 's3-sem-path-style', trecho });
        }
      }
    });
  }
  return usos;
}
