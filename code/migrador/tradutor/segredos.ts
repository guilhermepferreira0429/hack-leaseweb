// Procura segredos escritos à mão no user_data, nas tags e em atributos.
// Devolve o nome e a linha. O valor só serve para a verificação final de fugas e nunca sai do tradutor.

export type SegredoEncontrado = { nome: string; linha: number; valor: string };

/** Nomes que indicam um segredo (variáveis, tags, atributos). */
const NOME_SENSIVEL = /(SECRET|PASSWORD|PASSWD|PWD|TOKEN|API_?KEY|ACCESS_?KEY|PRIVATE_?KEY|CREDENTIAL)/i;

const ATRIBUICAO = /\b([A-Za-z_][A-Za-z0-9_]*)\s*[=:]\s*(["']?)([^\s"']+)\2/g;
const OPCAO_LINHA_COMANDO = /(--?(?:password|passwd|token|secret|api-key))(?:=|\s+)(["']?)([^\s"']+)\2/gi;
const CHAVE_AWS = /\b((?:AKIA|ASIA)[A-Z0-9]{16})\b/g;
const SENHA_EM_URL = /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:([^\s@/]+)@/gi;
const INICIO_CHAVE_PRIVADA = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const FIM_CHAVE_PRIVADA = /-----END [A-Z ]*PRIVATE KEY-----/;
const SSH_COM_SENHA = /^\s*[^#]*PasswordAuthentication\s+yes\b/i;

/** Um valor é literal se não for uma referência (${...}, $VAR) nem vazio. */
export function eLiteral(valor: string): boolean {
  const v = valor.trim();
  return v.length > 0 && !v.includes('${') && !v.startsWith('$');
}

export function nomeSensivel(nome: string): boolean {
  return NOME_SENSIVEL.test(nome);
}

/** Segredos numa linha de texto. `linha` é a que se passa. */
function segredosNaLinha(texto: string, linha: number): SegredoEncontrado[] {
  const achados: SegredoEncontrado[] = [];
  const valores = new Set<string>();
  const juntar = (nome: string, valor: string) => {
    if (!eLiteral(valor) || valores.has(valor)) return;
    valores.add(valor);
    achados.push({ nome, linha, valor });
  };
  for (const m of texto.matchAll(ATRIBUICAO)) if (nomeSensivel(m[1]!)) juntar(m[1]!, m[3]!);
  for (const m of texto.matchAll(OPCAO_LINHA_COMANDO)) juntar(m[1]!, m[3]!);
  for (const m of texto.matchAll(CHAVE_AWS)) juntar('chave de acesso AWS', m[1]!);
  for (const m of texto.matchAll(SENHA_EM_URL)) juntar('senha num URL', m[1]!);
  return achados;
}

/** Segredos num texto com várias linhas (user_data). Linhas contadas a partir de 1. */
export function procurarSegredos(texto: string): { segredos: SegredoEncontrado[]; linhasARemover: Set<number> } {
  const linhas = texto.split(/\r?\n/);
  const segredos: SegredoEncontrado[] = [];
  const linhasARemover = new Set<number>();
  let blocoChave: { inicio: number; partes: string[] } | null = null;

  linhas.forEach((conteudo, i) => {
    const n = i + 1;
    if (blocoChave) {
      blocoChave.partes.push(conteudo);
      linhasARemover.add(n);
      if (FIM_CHAVE_PRIVADA.test(conteudo)) {
        segredos.push({ nome: 'chave privada', linha: blocoChave.inicio, valor: blocoChave.partes.join('\n') });
        blocoChave = null;
      }
      return;
    }
    if (INICIO_CHAVE_PRIVADA.test(conteudo)) {
      blocoChave = { inicio: n, partes: [conteudo] };
      linhasARemover.add(n);
      return;
    }
    const naLinha = segredosNaLinha(conteudo, n);
    if (naLinha.length > 0) {
      segredos.push(...naLinha);
      linhasARemover.add(n);
    }
  });
  // Chave privada sem fim: remove-se tudo até ao fim e conta como segredo.
  if (blocoChave) {
    const { inicio, partes } = blocoChave as { inicio: number; partes: string[] };
    segredos.push({ nome: 'chave privada', linha: inicio, valor: partes.join('\n') });
  }
  return { segredos, linhasARemover };
}

/** O user_data sem as linhas com segredos; cada linha removida passa a um comentário só com o nome. */
export function limparUserData(texto: string, segredos: SegredoEncontrado[], linhasARemover: Set<number>): string {
  const nomesPorLinha = new Map<number, string[]>();
  for (const s of segredos) nomesPorLinha.set(s.linha, [...(nomesPorLinha.get(s.linha) ?? []), s.nome]);
  const saida: string[] = [];
  texto.split(/\r?\n/).forEach((conteudo, i) => {
    const n = i + 1;
    if (!linhasARemover.has(n)) return void saida.push(conteudo);
    const nomes = nomesPorLinha.get(n);
    if (nomes) saida.push(`# [tradutor] linha ${n} removida: tinha ${nomes.join(', ')}. Cria uma credencial nova no destino.`);
  });
  return saida.join('\n');
}

/** Linhas do user_data que ligam o login SSH por senha. */
export function linhasSshComSenha(texto: string): number[] {
  return texto
    .split(/\r?\n/)
    .flatMap((conteudo, i) => (SSH_COM_SENHA.test(conteudo) ? [i + 1] : []));
}

/** Segredos nas tags: pelo nome da tag ou pelo formato do valor. `linha` fica a 0 (quem chama põe a do ficheiro). */
export function segredosNasTags(tags: Record<string, unknown>): SegredoEncontrado[] {
  const achados: SegredoEncontrado[] = [];
  for (const [chave, valor] of Object.entries(tags)) {
    if (typeof valor !== 'string' || !eLiteral(valor)) continue;
    if (nomeSensivel(chave) || segredosNaLinha(valor, 0).length > 0) achados.push({ nome: chave, linha: 0, valor });
  }
  return achados;
}
