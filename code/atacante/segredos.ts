// Caça a chaves AWS e segredos óbvios no código da app (nível B de docs/ferramentas.md).
// Só lê ficheiros locais; não contacta alvos. O valor encontrado nunca sai daqui:
// o resultado leva o tipo, o nome e a linha, para o segredo não acabar no painel nem na auditoria.
import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

export type TipoSegredo = 'aws-access-key' | 'aws-secret';

export interface SegredoEncontrado {
  ficheiro: string;
  linha: number;
  tipo: TipoSegredo;
  nome: string;
}

export interface OpcoesSegredos {
  /** Corta a varredura depois deste número de achados. */
  maxResultados?: number;
}

const MAX_RESULTADOS = 100;
const MAX_BYTES = 512 * 1024;
const IGNORAR_DIR = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.cache']);
const EXTENSOES = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.json', '.tf', '.tfvars', '.hcl',
  '.sh', '.bash', '.yml', '.yaml', '.toml', '.ini', '.conf', '.properties',
  '.py', '.go', '.java', '.rb', '.php',
  '.md', '.txt', '.env',
]);

const PADROES: { tipo: TipoSegredo; nome: string; regex: RegExp }[] = [
  { tipo: 'aws-access-key', nome: 'AWS access key ID', regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { tipo: 'aws-secret', nome: 'AWS_SECRET_ACCESS_KEY', regex: /\bAWS_SECRET_ACCESS_KEY\b\s*[:=]\s*['"]?([^\s'"]{8,})/g },
];

/** Valores de exemplo/documentação não são segredos reais. */
const PLACEHOLDER = /^(?:<[^>]*>|\$\{[^}]*\}|changeme|example|exemplo|placeholder|segredo|password|senha|xxx+|\*+)$/i;

function ehPlaceholder(valor: string | undefined): boolean {
  return !valor || PLACEHOLDER.test(valor.trim());
}

/** Função pura: varre um texto e devolve onde estão os segredos, sem copiar o valor. */
export function varrerTexto(texto: string, ficheiro: string): SegredoEncontrado[] {
  const encontrados: SegredoEncontrado[] = [];
  const linhas = texto.split(/\r?\n/);
  for (const padrao of PADROES) {
    for (let i = 0; i < linhas.length; i++) {
      padrao.regex.lastIndex = 0;
      const m = padrao.regex.exec(linhas[i]!);
      if (!m) continue;
      // O segredo AWS só conta se o valor não for um placeholder (ex.: <senha> ou ${VAR}).
      if (padrao.tipo === 'aws-secret' && ehPlaceholder(m[1])) continue;
      encontrados.push({ ficheiro, linha: i + 1, tipo: padrao.tipo, nome: padrao.nome });
    }
  }
  return encontrados.sort((a, b) => a.linha - b.linha);
}

/** Nome de ficheiro que vale a pena ler (o .env não tem extensão). */
function extensaoAceite(nome: string): boolean {
  return nome === '.env' || nome.startsWith('.env.') || EXTENSOES.has(extname(nome).toLowerCase());
}

/** Varre uma pasta (por omissão, o repo da app) e devolve os segredos encontrados. */
export async function varrerSegredos(dir: string, opcoes: OpcoesSegredos = {}): Promise<SegredoEncontrado[]> {
  const max = opcoes.maxResultados ?? MAX_RESULTADOS;
  const encontrados: SegredoEncontrado[] = [];

  async function percorrer(pasta: string): Promise<void> {
    if (encontrados.length >= max) return;
    let entradas;
    try {
      entradas = await readdir(pasta, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entrada of entradas) {
      if (encontrados.length >= max) return;
      const caminho = join(pasta, entrada.name);
      if (entrada.isDirectory()) {
        if (!IGNORAR_DIR.has(entrada.name)) await percorrer(caminho);
        continue;
      }
      if (!entrada.isFile() || !extensaoAceite(entrada.name)) continue;
      try {
        const info = await stat(caminho);
        if (info.size > MAX_BYTES) continue;
        encontrados.push(...varrerTexto(await readFile(caminho, 'utf8'), relative(dir, caminho)));
      } catch {
        // Ficheiro ilegível ou binário: não interessa para esta varredura.
      }
    }
  }

  await percorrer(dir);
  return encontrados
    .sort((a, b) => a.ficheiro.localeCompare(b.ficheiro) || a.linha - b.linha)
    .slice(0, max);
}
