// Migrador de código, passo 2: propor a alteração. Regras fixas por caso (docs/ferramentas.md, "Migrador de
// código", nível A): o S3 só muda configuração (endpoint, credenciais, forcePathStyle) e as variáveis de ambiente
// passam a apontar para a Leaseweb. Nenhum segredo entra na alteração: só marcadores <assim>.
// Depois validarAlteracao confirma que só mudaram os ficheiros e as linhas esperados.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { corrigirRegrasAbertas } from '../tradutor/index';
import type { ServicoUso, UsoAws } from './encontrar';

export interface Alteracao {
  /** Caminho relativo à pasta da app. */
  ficheiro: string;
  /** Conteúdo atual; null = ficheiro novo. */
  antes: string | null;
  depois: string;
  motivo: string;
  /** 'infra' = correção de segurança na configuração da infraestrutura (Terraform), não código da app. */
  tipo?: 'infra';
}

/** Uma regra aberta ao mundo que o PR fecha na configuração (a causa da falha que a defesa fechou pela API). */
export interface CausaCorrigida {
  ficheiro: string;
  recurso: string;
  porta: number;
  /** 'sgApp' = só o grupo da app entra; 'redeApp' = só a subrede da app. */
  via: 'sgApp' | 'redeApp';
}

export interface Proposta {
  alteracoes: Alteracao[];
  /** Diff legível (linhas - e +), para o PR e para o "Ver diff". */
  diff: string;
  /** O que não se muda automaticamente e porquê (vai para a descrição do PR). */
  fora: string[];
  /** Regras abertas ao mundo corrigidas na configuração da infraestrutura (ideia wow 5). */
  causas: CausaCorrigida[];
}

/** Pasta da configuração da infraestrutura dentro da app. */
export const PASTA_INFRA = 'infra';

/** Ficheiro de configuração da app para a Leaseweb. Fica ao lado do .env.example; os valores reais vão no .env. */
export const FICHEIRO_CONFIG = 'leaseweb.env.example';

/** Valor de cada variável no destino. Só marcadores: o repo é público. */
const DESTINO: Record<string, string> = {
  ARMAZENAMENTO_ENDPOINT: 'http://<minio-na-leaseweb>:9000',
  ARMAZENAMENTO_ACCESS_KEY: '<create in MinIO; only in .env>',
  ARMAZENAMENTO_SECRET_KEY: '<create in MinIO; only in .env>',
  DATABASE_URL: 'postgres://<utilizador>:<senha>@<postgres-na-leaseweb>:5432/<base>',
  FILA_TIPO: 'rabbitmq',
  FILA_URL: '',
  RABBITMQ_URL: 'amqp://<utilizador>:<senha>@<rabbitmq-na-leaseweb>:5672',
  SEGREDOS_TIPO: 'openbao',
  OPENBAO_ADDR: 'http://<openbao-na-leaseweb>:8200',
  OPENBAO_TOKEN: '<OpenBao token; only in .env>',
  CACHE_TIPO: 'valkey',
  VALKEY_URL: 'redis://:<senha>@<valkey-na-leaseweb>:6379',
  // O SDK da AWS continua a falar com o MinIO: precisa de uma região (o MinIO aceita us-east-1) e do endpoint.
  AWS_REGION: 'us-east-1',
  AWS_DEFAULT_REGION: 'us-east-1',
  AWS_ENDPOINT_URL_S3: 'http://<minio-na-leaseweb>:9000',
};

/** Variáveis que deixam de ser precisas no destino (o RabbitMQ não usa as chaves do SQS). */
const DEIXAM: Record<string, string> = {
  FILA_ACCESS_KEY: 'no longer needed with RabbitMQ (credentials go in RABBITMQ_URL)',
  FILA_SECRET_KEY: 'no longer needed with RabbitMQ (credentials go in RABBITMQ_URL)',
};

/** Variáveis que passam a existir quando o serviço muda (a app já as sabe ler). */
const NOVAS: Partial<Record<ServicoUso, string[]>> = {
  fila: ['FILA_TIPO', 'RABBITMQ_URL'],
  segredos: ['SEGREDOS_TIPO', 'OPENBAO_ADDR'],
  cache: ['CACHE_TIPO', 'VALKEY_URL'],
};

const NOME_SERVICO: Record<ServicoUso, string> = {
  s3: 'S3 → MinIO',
  postgres: 'RDS PostgreSQL → PostgreSQL',
  fila: 'SQS → RabbitMQ',
  segredos: 'Secrets Manager → OpenBao',
  cache: 'ElastiCache → Valkey',
  credencial: 'AWS credentials',
  outro: 'Outros',
};

function configuracao(usos: UsoAws[]): string | undefined {
  const porServico = new Map<ServicoUso, Set<string>>();
  for (const u of usos) {
    if (u.tipo !== 'variavel' || !u.nome) continue;
    const nomes = porServico.get(u.servico) ?? new Set<string>();
    nomes.add(u.nome);
    for (const n of NOVAS[u.servico] ?? []) nomes.add(n);
    porServico.set(u.servico, nomes);
  }
  porServico.delete('outro');
  if (porServico.size === 0) return undefined;
  const linhas = [
    '# App configuration on Leaseweb, proposed by the code migrator.',
    '# Copy into .env and replace each <placeholder> with the real value. No secrets in this file.',
  ];
  for (const servico of ['s3', 'postgres', 'fila', 'segredos', 'cache'] as ServicoUso[]) {
    const nomes = porServico.get(servico);
    if (!nomes) continue;
    linhas.push('', `# ${NOME_SERVICO[servico]}`);
    for (const nome of [...nomes].sort()) {
      if (nome in DESTINO) linhas.push(`${nome}=${DESTINO[nome]}`);
      else if (nome in DEIXAM) linhas.push(`# ${nome}: ${DEIXAM[nome]}`);
      else linhas.push(`# ${nome}: unchanged (same name at the destination)`);
    }
  }
  const doSdk = [...new Set(usos.filter((u) => u.tipo === 'variavel' && u.servico === 'outro').map((u) => u.nome!))].sort();
  const mantidas = doSdk.filter((n) => n in DESTINO);
  if (mantidas.length) {
    linhas.push('', '# AWS SDK talking to MinIO (same API)');
    for (const n of mantidas) linhas.push(`${n}=${DESTINO[n]}`);
  }
  const credenciais = [
    ...new Set([...usos.filter((u) => u.tipo === 'credencial').map((u) => u.nome!), ...doSdk.filter((n) => !(n in DESTINO))]),
  ].sort();
  if (credenciais.length) {
    linhas.push('', '# AWS variables and credentials: no longer needed. Not copied; delete them from .env.');
    for (const c of credenciais) linhas.push(`# ${c}`);
  }
  return `${linhas.join('\n')}\n`;
}

/** Acrescenta forcePathStyle: true a cada `new S3Client({` que não o tenha. */
function comPathStyle(texto: string, linhas: number[]): string {
  const todas = texto.split('\n');
  for (const n of [...linhas].sort((a, b) => b - a)) {
    const i = n - 1;
    const linha = todas[i]!;
    if (/new S3Client\(\s*\)/.test(linha)) {
      todas[i] = linha.replace(/new S3Client\(\s*\)/, 'new S3Client({ forcePathStyle: true })');
    } else if (/new S3Client\(\{\s*$/.test(linha.trimEnd())) {
      const recuo = (todas[i + 1]?.match(/^\s*/)?.[0] ?? `${linha.match(/^\s*/)?.[0] ?? ''}  `) || '  ';
      todas.splice(i + 1, 0, `${recuo}forcePathStyle: true, // MinIO on Leaseweb uses path-style`);
    } else if (/new S3Client\(\{/.test(linha)) {
      todas[i] = linha.replace(/new S3Client\(\{/, 'new S3Client({ forcePathStyle: true,');
    }
  }
  return todas.join('\n');
}

export function diffDe(alteracoes: Alteracao[]): string {
  const partes: string[] = [];
  for (const a of alteracoes) {
    const antes = a.antes === null ? [] : a.antes.split('\n');
    const depois = a.depois.split('\n');
    partes.push(`--- ${a.antes === null ? '/dev/null' : `a/${a.ficheiro}`}`, `+++ b/${a.ficheiro}`);
    // Diff simples por linhas: chega para alterações pequenas (inserções e trocas de linhas).
    let i = 0;
    let j = 0;
    while (i < antes.length || j < depois.length) {
      if (i < antes.length && j < depois.length && antes[i] === depois[j]) {
        i++;
        j++;
      } else if (j < depois.length && !antes.slice(i).includes(depois[j]!)) {
        partes.push(`@@ ${a.ficheiro}:${j + 1} @@`, `+${depois[j]}`);
        j++;
      } else if (i < antes.length) {
        partes.push(`@@ ${a.ficheiro}:${i + 1} @@`, `-${antes[i]}`);
        i++;
      } else {
        j++;
      }
    }
  }
  return partes.join('\n');
}

export async function proporAlteracao(dirApp: string, usos: UsoAws[]): Promise<Proposta> {
  const alteracoes: Alteracao[] = [];

  // 1. Clientes S3 sem path-style: uma linha a mais, o resto do código fica igual (a API é compatível).
  const semPathStyle = new Map<string, number[]>();
  for (const u of usos) if (u.tipo === 's3-sem-path-style') semPathStyle.set(u.ficheiro, [...(semPathStyle.get(u.ficheiro) ?? []), u.linha]);
  for (const [ficheiro, linhas] of semPathStyle) {
    const antes = await readFile(join(dirApp, ficheiro), 'utf8');
    const depois = comPathStyle(antes, linhas);
    if (depois !== antes) alteracoes.push({ ficheiro, antes, depois, motivo: 'S3 → MinIO: the S3 client now uses path-style' });
  }

  // 2. Configuração para a Leaseweb: as mesmas variáveis, a apontar para os serviços novos.
  const config = configuracao(usos);
  if (config) {
    const antes = await readFile(join(dirApp, FICHEIRO_CONFIG), 'utf8').catch(() => null);
    if (antes !== config) alteracoes.push({ ficheiro: FICHEIRO_CONFIG, antes, depois: config, motivo: 'environment variables pointing to Leaseweb' });
  }

  // 3. A causa: regras abertas a toda a Internet na configuração da infraestrutura passam a deixar entrar só a app.
  //    A defesa fechou a porta pela API; sem isto, voltava a abrir no próximo deploy. Regras fixas do tradutor.
  const fora: string[] = [];
  const causas: CausaCorrigida[] = [];
  const tfs = (await readdir(join(dirApp, PASTA_INFRA)).catch(() => [] as string[])).filter((f) => f.endsWith('.tf.json')).sort();
  for (const nome of tfs) {
    const ficheiro = `${PASTA_INFRA}/${nome}`;
    const antes = await readFile(join(dirApp, ficheiro), 'utf8');
    try {
      const r = corrigirRegrasAbertas(antes, { sgApp: 'app', redeApp: process.env.MIGRADOR_REDE_APP || undefined });
      for (const p of r.porResolver) fora.push(`${ficheiro}: ${p.recurso}, port ${p.porta}: ${p.referencia}. Fix by hand.`);
      if (r.corrigidas.length && r.depois !== antes) {
        alteracoes.push({ ficheiro, antes, depois: r.depois, motivo: 'security: the database is no longer open to the whole Internet', tipo: 'infra' });
        for (const c of r.corrigidas) causas.push({ ficheiro, recurso: c.recurso, porta: c.porta, via: c.via });
      }
    } catch (erro) {
      fora.push(`${ficheiro}: there are rules open to the whole Internet that I could not fix on my own (${erro instanceof Error ? erro.message : String(erro)}).`);
    }
  }

  // 4. O que não se muda sozinho: só se diz.
  const sdkFila = usos.some((u) => u.servico === 'fila' && u.tipo === 'sdk');
  const filaPorVariavel = usos.some((u) => u.nome === 'FILA_TIPO');
  if (sdkFila && !filaPorVariavel) {
    fora.push('SQS → RabbitMQ: the app calls SQS directly. Swapping the client is a rewrite (level B), with tests before and after; not in this PR.');
  }
  for (const u of usos.filter((x) => x.tipo === 'endpoint' && /amazonaws\.com|arn:aws:|s3:\/\//i.test(x.trecho))) {
    fora.push(`${u.ficheiro}:${u.linha}: AWS address or ARN hard-coded. Move it to an environment variable.`);
  }
  for (const u of usos.filter((x) => x.tipo === 's3-config-externa')) {
    fora.push(`${u.ficheiro}:${u.linha}: the S3 client is built from a variable. Check by hand that it sets forcePathStyle: true.`);
  }
  if (usos.some((u) => /s3-request-presigner|lib-storage/.test(u.trecho))) {
    fora.push('S3 pre-signed URLs or multipart uploads: they work on MinIO, but the public address changes. Test by hand.');
  }
  if (usos.some((u) => /rds-signer/.test(u.trecho))) {
    fora.push('IAM authentication on RDS (rds-signer): does not exist on the new PostgreSQL. Use a user and password in DATABASE_URL.');
  }
  const outrosSdk = [...new Set(usos.filter((u) => u.tipo === 'sdk' && u.servico === 'outro').map((u) => u.ficheiro))];
  if (outrosSdk.length) {
    fora.push(`Other AWS services in the code (${outrosSdk.join(', ')}): they need a redesign, not a migration.`);
  }

  return { alteracoes, diff: diffDe(alteracoes), fora, causas };
}

/** Linhas acrescentadas que não podem entrar num PR público. */
const SEGREDO_NA_LINHA: RegExp[] = [
  /\b(AKIA|ASIA)[A-Z0-9]{16}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  // Senha num URL que não seja um <marcador> (também com utilizador vazio: redis://:senha@).
  /:\/\/[^\s/:@]*:(?!<)\S+@/,
  // Nome sensível com um valor literal que não seja vazio nem <marcador>.
  /^\s*[A-Z_]*(SECRET|PASSWORD|PASSWD|TOKEN|ACCESS_KEY|API_KEY)[A-Z_]*\s*=\s*(?!<|$)\S/i,
];

/**
 * Regras que a alteração tem de cumprir antes de ir para PR: só o ficheiro de configuração e os ficheiros com
 * um cliente S3; nas linhas de código só entra forcePathStyle; nenhum segredo. Devolve os problemas (vazio = ok).
 */
export function validarAlteracao(proposta: Proposta, usos: UsoAws[]): string[] {
  const problemas: string[] = [];
  const comS3 = new Set(usos.filter((u) => u.tipo === 's3-sem-path-style').map((u) => u.ficheiro));
  for (const a of proposta.alteracoes) {
    const infra = a.tipo === 'infra' && a.ficheiro.startsWith(`${PASTA_INFRA}/`) && a.ficheiro.endsWith('.tf.json');
    if (infra) {
      problemas.push(...validarInfra(a));
      continue;
    }
    if (a.ficheiro !== FICHEIRO_CONFIG && !comS3.has(a.ficheiro)) problemas.push(`${a.ficheiro}: unexpected file`);
    const antes = new Set((a.antes ?? '').split('\n'));
    const novas = a.depois.split('\n').filter((l) => !antes.has(l));
    for (const l of novas) {
      if (SEGREDO_NA_LINHA.some((re) => re.test(l))) problemas.push(`${a.ficheiro}: a new line looks like a secret`);
      if (a.ficheiro !== FICHEIRO_CONFIG && !/forcePathStyle: true/.test(l)) problemas.push(`${a.ficheiro}: unexpected code line`);
    }
    if (a.antes !== null && a.ficheiro !== FICHEIRO_CONFIG) {
      const removidas = a.antes.split('\n').filter((l) => !a.depois.split('\n').includes(l));
      // Só pode desaparecer a própria linha do `new S3Client(` quando o forcePathStyle entra na mesma linha.
      if (removidas.some((l) => !/new S3Client\(/.test(l))) problemas.push(`${a.ficheiro}: the PR would delete code`);
    }
  }
  return problemas;
}

/** Na configuração da infraestrutura só podem mudar as origens das regras, e nunca para o mundo inteiro. */
function validarInfra(a: Alteracao): string[] {
  const problemas: string[] = [];
  try {
    JSON.parse(a.depois);
  } catch {
    problemas.push(`${a.ficheiro}: the fixed file is not valid JSON`);
  }
  const antes = (a.antes ?? '').split('\n');
  const depois = a.depois.split('\n');
  const novas = depois.filter((l) => !antes.includes(l));
  const removidas = antes.filter((l) => !depois.includes(l));
  const ORIGEM = /"(cidr_blocks|ipv6_cidr_blocks|security_groups|source_security_group_id)"|^\s*"[^"]*",?\s*$|^\s*[\]\[],?\s*$/;
  if (novas.some((l) => !ORIGEM.test(l)) || removidas.some((l) => !ORIGEM.test(l))) problemas.push(`${a.ficheiro}: changed more than the rule sources`);
  if (novas.some((l) => /0\.0\.0\.0\/0|::\/0/.test(l))) problemas.push(`${a.ficheiro}: the fix still opens to the whole Internet`);
  return problemas;
}
