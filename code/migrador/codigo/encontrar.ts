// Migrador de código, passo 1: encontrar no código e na configuração da app o que a prende à AWS.
// Só lê. Regras fixas, sem IA. Os trechos que se devolvem nunca levam o valor de um segredo;
// dos ficheiros .env só se leem os nomes das variáveis.
import { readdir, readFile } from 'node:fs/promises';
import { basename, join, relative, sep } from 'node:path';

export type ServicoUso = 's3' | 'postgres' | 'fila' | 'segredos' | 'cache' | 'credencial' | 'outro';

export type TipoUso =
  /** Cliente ou biblioteca do SDK da AWS. */
  | 'sdk'
  /** Endereço da AWS (amazonaws.com, ARN, s3://) ou do LocalStack escrito no código ou na configuração. */
  | 'endpoint'
  /** Variável de ambiente que a app lê para falar com um serviço. */
  | 'variavel'
  /** Credencial da AWS (AWS_ACCESS_KEY_ID, …). Nunca se copia: cria-se outra no destino. */
  | 'credencial'
  /** Cliente S3 sem forcePathStyle: o MinIO precisa dele. */
  | 's3-sem-path-style'
  /** Cliente S3 construído a partir de uma variável: não se mexe sozinho, vai para o "fora". */
  | 's3-config-externa';

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
const EXTENSOES = /\.(ts|tsx|js|jsx|mjs|cjs|json|ya?ml|tf|py)$|^Dockerfile$|^\.env(\.[\w-]+)?$/;

/** Ficheiro .env com valores reais (o .env.example não conta): só se leem os nomes. */
const ENV_REAL = (nome: string) => /^\.env(\.[\w-]+)?$/.test(nome) && !nome.endsWith('.example');

const SDK: [RegExp, ServicoUso][] = [
  [/@aws-sdk\/(client-s3|s3-request-presigner|lib-storage)\b/, 's3'],
  [/@aws-sdk\/client-sqs\b/, 'fila'],
  [/@aws-sdk\/client-(secrets-manager|ssm)\b/, 'segredos'],
  [/@aws-sdk\/client-elasticache\b/, 'cache'],
  [/@aws-sdk\/(client-rds|rds-signer)\b/, 'postgres'],
  [/\bnew (S3Client|S3)\(/, 's3'],
  [/\bnew (SQSClient|SQS)\(/, 'fila'],
  [/\bnew (SecretsManagerClient|SSMClient)\(/, 'segredos'],
  // Tudo o resto do SDK (v3 e v2): DynamoDB, SNS, SES, Lambda, credential-providers, …
  [/@aws-sdk\/[\w-]+|\baws-sdk\b|\bnew AWS\.\w+\(/, 'outro'],
];

const ENDPOINT: [RegExp, ServicoUso][] = [
  [/\bs3[.-][\w.-]*amazonaws\.com|\.s3\.amazonaws\.com|\bs3:\/\//i, 's3'],
  [/\bsqs\.[\w.-]*amazonaws\.com/i, 'fila'],
  [/\.rds\.amazonaws\.com/i, 'postgres'],
  [/\.cache\.amazonaws\.com/i, 'cache'],
  [/\bsecretsmanager\.[\w.-]*amazonaws\.com/i, 'segredos'],
  [/amazonaws\.com|\barn:aws:/i, 'outro'],
  [/\blocalstack\b|:4566\b/i, 'outro'],
];

/** Variáveis de ambiente que a app lê, por serviço. `_` separa palavras: FATURAS_BUCKET e APP_REDIS_URL contam. */
const VARIAVEIS: [RegExp, ServicoUso][] = [
  [/(^|_)(ARMAZENAMENTO|S3|BUCKET)(_|$)/, 's3'],
  [/^DATABASE_URL$|^PG[A-Z]+$|(^|_)(POSTGRES|RDS)(_|$)/, 'postgres'],
  [/(^|_)(FILA|SQS|QUEUE)(_|$)/, 'fila'],
  [/(^|_)(REDIS|CACHE|ELASTICACHE)(_|$)/, 'cache'],
  [/(^|_)(SEGREDOS|SECRETS|SSM|OPENBAO)(_|$)/, 'segredos'],
  // Variáveis que o próprio SDK da AWS lê.
  [/^AWS_(REGION|DEFAULT_REGION|PROFILE|ROLE_ARN|ENDPOINT_URL\w*)$/, 'outro'],
];

const CREDENCIAL = /\bAWS_(ACCESS_KEY_ID|SECRET_ACCESS_KEY|SESSION_TOKEN)\b/;
const LEITURA_ENV = /process\.env\.(\w+)|process\.env\[['"](\w+)['"]\]|\bv\(['"](\w+)['"]\)|os\.environ(?:\.get\(|\[)['"](\w+)['"]/g;
/** Nomes que levam um segredo. Largo de propósito: tapar a mais não faz mal, tapar a menos faz. */
const NOME_SENSIVEL = /(SECRET|PASS|TOKEN|KEY|CREDENTIAL|AUTH)/i;

/** Tira o valor de qualquer segredo da linha (atribuições a nomes sensíveis, senhas em URLs, chaves AKIA…). */
export function semSegredos(linha: string): string {
  return (
    linha
      // nome = valor, nome: valor e "nome": "valor" (JSON), com o nome sensível.
      .replace(/\b([A-Za-z_]\w*)(["']?)(\s*[=:]\s*)(["']?)([^\s"',;]+)\4/g, (todo, nome: string, aspaNome: string, sep: string, aspa: string, valor: string) =>
        NOME_SENSIVEL.test(nome) && !/^(process\.env|\$|<)/.test(valor) && !valor.includes('(') ? `${nome}${aspaNome}${sep}${aspa}***${aspa}` : todo,
      )
      // Senha num URL, com utilizador vazio (redis://:senha@) e com / ou @ na senha: tapa até ao último @.
      .replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]*:)\S*@/gi, (todo, inicio: string) => (todo.slice(inicio.length).startsWith('<') ? todo : `${inicio}***@`))
      .replace(/\b(AKIA|ASIA)[A-Z0-9]{16}\b/g, '***')
  );
}

async function listar(dir: string): Promise<string[]> {
  const entradas = await readdir(dir, { withFileTypes: true });
  const ficheiros: string[] = [];
  for (const e of entradas) {
    if (IGNORAR.has(e.name)) continue;
    const caminho = join(dir, e.name);
    if (e.isDirectory()) ficheiros.push(...(await listar(caminho)));
    else if ((EXTENSOES.test(e.name) || e.name.endsWith('.env.example')) && e.name !== 'package-lock.json' && !/\.test\.ts$/.test(e.name)) {
      ficheiros.push(caminho);
    }
  }
  return ficheiros.sort();
}

const COMENTARIO = /^\s*(\/\/|\/?\*|#)/;

/** Usos da AWS numa só linha. */
function usosNaLinha(texto: string): { servico: ServicoUso; tipo: TipoUso; nome?: string }[] {
  const usos: { servico: ServicoUso; tipo: TipoUso; nome?: string }[] = [];
  // Um comentário que fala da AWS não é um uso.
  const comentario = COMENTARIO.test(texto);
  const sdk = comentario ? undefined : SDK.find(([re]) => re.test(texto));
  if (sdk) usos.push({ servico: sdk[1], tipo: 'sdk' });
  const endpoint = comentario ? undefined : ENDPOINT.find(([re]) => re.test(texto));
  if (endpoint && !sdk) usos.push({ servico: endpoint[1], tipo: 'endpoint' });
  const cred = texto.match(CREDENCIAL);
  if (cred) usos.push({ servico: 'credencial', tipo: 'credencial', nome: `AWS_${cred[1]}` });
  else {
    // Variáveis lidas pela app (process.env.X, o atalho v('X') da exemplo-app, os.environ) ou definidas num .env.
    const nomes = [...texto.matchAll(LEITURA_ENV)].map((m) => m[1] ?? m[2] ?? m[3] ?? m[4]!);
    const definida = texto.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/);
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
    const soNomes = ENV_REAL(basename(caminho));
    const linhas = (await readFile(caminho, 'utf8')).split(/\r?\n/);
    linhas.forEach((texto, i) => {
      // Num .env real, o valor nunca sai daqui: o trecho fica só com o nome.
      const trecho = soNomes ? texto.trim().replace(/=.*/, '=***') : semSegredos(texto.trim()).slice(0, 160);
      const vistos = new Set<string>();
      for (const u of usosNaLinha(texto)) {
        const chave = `${u.servico}:${u.tipo}:${u.nome ?? ''}`;
        if (vistos.has(chave)) continue;
        vistos.add(chave);
        usos.push({ ficheiro, linha: i + 1, ...u, trecho });
      }
      // O MinIO só funciona com path-style.
      if (!COMENTARIO.test(texto) && /\bnew S3Client\(/.test(texto)) {
        // Só um objeto literal ({ … }) se estende por várias linhas; new S3Client(config) é só esta linha.
        const bloco = /new S3Client\(\s*\{/.test(texto) ? linhas.slice(i, i + 12).join('\n') : texto;
        const fim = bloco.indexOf('})');
        const corpo = fim >= 0 ? bloco.slice(0, fim) : bloco;
        // Qualquer forcePathStyle (literal ou de uma variável) conta como resolvido: nunca se mete um segundo.
        if (/forcePathStyle/.test(corpo)) return;
        const literal = /new S3Client\(\s*(\{|\))/.test(texto);
        usos.push({ ficheiro, linha: i + 1, servico: 's3', tipo: literal ? 's3-sem-path-style' : 's3-config-externa', trecho });
      }
    });
  }
  return usos;
}
