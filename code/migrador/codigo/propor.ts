// Migrador de código, passo 2: propor a alteração. Regras fixas por caso (docs/ferramentas.md, "Migrador de
// código", nível A): o S3 só muda configuração (endpoint, credenciais, forcePathStyle) e as variáveis de ambiente
// passam a apontar para a Leaseweb. Nenhum segredo entra na alteração: só marcadores <assim>.
// Depois validarAlteracao confirma que só mudaram os ficheiros e as linhas esperados.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ServicoUso, UsoAws } from './encontrar';

export interface Alteracao {
  /** Caminho relativo à pasta da app. */
  ficheiro: string;
  /** Conteúdo atual; null = ficheiro novo. */
  antes: string | null;
  depois: string;
  motivo: string;
}

export interface Proposta {
  alteracoes: Alteracao[];
  /** Diff legível (linhas - e +), para o PR e para o "Ver diff". */
  diff: string;
  /** O que não se muda automaticamente e porquê (vai para a descrição do PR). */
  fora: string[];
}

/** Ficheiro de configuração da app para a Leaseweb. Fica ao lado do .env.example; os valores reais vão no .env. */
export const FICHEIRO_CONFIG = 'leaseweb.env.example';

/** Valor de cada variável no destino. Só marcadores: o repo é público. */
const DESTINO: Record<string, string> = {
  ARMAZENAMENTO_ENDPOINT: 'http://<minio-na-leaseweb>:9000',
  ARMAZENAMENTO_ACCESS_KEY: '<criar no MinIO; só no .env>',
  ARMAZENAMENTO_SECRET_KEY: '<criar no MinIO; só no .env>',
  DATABASE_URL: 'postgres://<utilizador>:<senha>@<postgres-na-leaseweb>:5432/<base>',
  FILA_TIPO: 'rabbitmq',
  FILA_URL: '',
  RABBITMQ_URL: 'amqp://<utilizador>:<senha>@<rabbitmq-na-leaseweb>:5672',
  SEGREDOS_TIPO: 'openbao',
  OPENBAO_ADDR: 'http://<openbao-na-leaseweb>:8200',
  CACHE_TIPO: 'valkey',
  VALKEY_URL: 'redis://<valkey-na-leaseweb>:6379',
};

/** Variáveis que deixam de ser precisas no destino (o RabbitMQ não usa as chaves do SQS). */
const DEIXAM: Record<string, string> = {
  FILA_ACCESS_KEY: 'deixa de ser precisa com o RabbitMQ (as credenciais vão no RABBITMQ_URL)',
  FILA_SECRET_KEY: 'deixa de ser precisa com o RabbitMQ (as credenciais vão no RABBITMQ_URL)',
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
  credencial: 'Credenciais da AWS',
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
  if (porServico.size === 0) return undefined;
  const linhas = [
    '# Configuração da app na Leaseweb, proposta pelo migrador de código.',
    '# Copiar para o .env e trocar cada <marcador> pelo valor real. Nenhum segredo vem neste ficheiro.',
  ];
  for (const servico of ['s3', 'postgres', 'fila', 'segredos', 'cache'] as ServicoUso[]) {
    const nomes = porServico.get(servico);
    if (!nomes) continue;
    linhas.push('', `# ${NOME_SERVICO[servico]}`);
    for (const nome of [...nomes].sort()) {
      if (nome in DESTINO) linhas.push(`${nome}=${DESTINO[nome]}`);
      else if (nome in DEIXAM) linhas.push(`# ${nome}: ${DEIXAM[nome]}`);
      else linhas.push(`# ${nome}: fica igual (o mesmo nome no destino)`);
    }
  }
  const credenciais = [...new Set(usos.filter((u) => u.tipo === 'credencial').map((u) => u.nome!))].sort();
  if (credenciais.length) {
    linhas.push('', '# Credenciais da AWS: deixam de ser precisas. Não se copiam; apaguem-nas do .env.');
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
      todas.splice(i + 1, 0, `${recuo}forcePathStyle: true, // o MinIO na Leaseweb usa path-style`);
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
    if (depois !== antes) alteracoes.push({ ficheiro, antes, depois, motivo: 'S3 → MinIO: o cliente S3 passa a usar path-style' });
  }

  // 2. Configuração para a Leaseweb: as mesmas variáveis, a apontar para os serviços novos.
  const config = configuracao(usos);
  if (config) {
    const antes = await readFile(join(dirApp, FICHEIRO_CONFIG), 'utf8').catch(() => null);
    if (antes !== config) alteracoes.push({ ficheiro: FICHEIRO_CONFIG, antes, depois: config, motivo: 'variáveis de ambiente a apontar para a Leaseweb' });
  }

  // 3. O que não se muda sozinho: só se diz.
  const fora: string[] = [];
  const sdkFila = usos.some((u) => u.servico === 'fila' && u.tipo === 'sdk');
  const filaPorVariavel = usos.some((u) => u.nome === 'FILA_TIPO');
  if (sdkFila && !filaPorVariavel) {
    fora.push('SQS → RabbitMQ: a app chama o SQS diretamente. Trocar o cliente é uma reescrita (nível B), com testes antes e depois; não entra neste PR.');
  }
  for (const u of usos.filter((x) => x.tipo === 'endpoint' && /amazonaws\.com/i.test(x.trecho))) {
    fora.push(`${u.ficheiro}:${u.linha}: endereço da AWS escrito no código. Passar para uma variável de ambiente.`);
  }

  return { alteracoes, diff: diffDe(alteracoes), fora };
}

/** Linhas acrescentadas que não podem entrar num PR público. */
const SEGREDO_NA_LINHA: RegExp[] = [
  /\b(AKIA|ASIA)[A-Z0-9]{16}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  // Senha num URL que não seja um <marcador>.
  /:\/\/[^\s/:@]+:(?!<)[^\s@/]+@/,
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
    if (a.ficheiro !== FICHEIRO_CONFIG && !comS3.has(a.ficheiro)) problemas.push(`${a.ficheiro}: ficheiro fora do esperado`);
    const antes = new Set((a.antes ?? '').split('\n'));
    const novas = a.depois.split('\n').filter((l) => !antes.has(l));
    for (const l of novas) {
      if (SEGREDO_NA_LINHA.some((re) => re.test(l))) problemas.push(`${a.ficheiro}: uma linha nova parece ter um segredo`);
      if (a.ficheiro !== FICHEIRO_CONFIG && !/forcePathStyle: true/.test(l)) problemas.push(`${a.ficheiro}: linha de código fora do esperado`);
    }
    if (a.antes !== null && a.ficheiro !== FICHEIRO_CONFIG) {
      const removidas = a.antes.split('\n').filter((l) => !a.depois.split('\n').includes(l));
      // Só pode desaparecer a própria linha do `new S3Client(` quando o forcePathStyle entra na mesma linha.
      if (removidas.some((l) => !/new S3Client\(/.test(l))) problemas.push(`${a.ficheiro}: o PR apagaria código`);
    }
  }
  return problemas;
}
