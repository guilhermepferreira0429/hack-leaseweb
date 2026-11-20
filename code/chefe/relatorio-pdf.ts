// Relatório da demo como PDF (fundo branco, A4), para o chefe anexar no Telegram e o painel oferecer para download.
// Sem dependências: escreve-se o PDF à mão com a fonte base Helvetica (14 fontes padrão, sempre presentes no leitor).
// O conteúdo é o mesmo do Telegram — o certificado de migração e o relatório de cada incidente deste ciclo —
// só que paginado num documento que abre num visualizador de PDF (não enorme em mobile, como era o HTML).
// Nada novo é calculado aqui: só os textos já medidos.
import { relatorio as rel, type EventoAuditoria, type Pedido } from '@mwbe/shared';
import { certificado, idCertificado } from './certificado';
import type { OpcoesRelatorioFicheiro } from './relatorio-ficheiro';

// Larguras da Helvetica (AFM, por 1000 em) para ASCII 32..126; o resto cai no valor médio.
const LARGURA: Record<number, number> = {
  32: 278, 33: 278, 34: 355, 35: 556, 36: 556, 37: 889, 38: 667, 39: 191, 40: 333, 41: 333, 42: 389, 43: 584,
  44: 278, 45: 333, 46: 278, 47: 278, 48: 556, 49: 556, 50: 556, 51: 556, 52: 556, 53: 556, 54: 556, 55: 556,
  56: 556, 57: 556, 58: 278, 59: 278, 60: 584, 61: 584, 62: 584, 63: 556, 64: 1015, 65: 667, 66: 667, 67: 722,
  68: 722, 69: 667, 70: 611, 71: 778, 72: 722, 73: 278, 74: 500, 75: 667, 76: 556, 77: 833, 78: 722, 79: 778,
  80: 667, 81: 778, 82: 722, 83: 667, 84: 611, 85: 722, 86: 667, 87: 944, 88: 667, 89: 667, 90: 611, 91: 278,
  92: 278, 93: 278, 94: 469, 95: 556, 96: 333, 97: 556, 98: 556, 99: 500, 100: 556, 101: 556, 102: 278, 103: 556,
  104: 556, 105: 222, 106: 222, 107: 500, 108: 222, 109: 833, 110: 556, 111: 556, 112: 556, 113: 556, 114: 333,
  115: 500, 116: 278, 117: 556, 118: 500, 119: 722, 120: 500, 121: 500, 122: 500, 123: 334, 124: 260, 125: 334, 126: 584,
  183: 278, // · (middot, WinAnsi 0xB7)
};

/** Só o que a Helvetica com WinAnsiEncoding desenha: glifos fora do Latin-1 (setas, vistos, emoji) viram ASCII ou saem. */
function latin1(texto: string): string {
  return texto
    .replace(/→/g, '->')
    .replace(/✓/g, 'OK')
    .replace(/✗/g, 'X')
    .replace(/…/g, '...')
    .replace(/[–—]/g, '-')
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\t\n\r\x20-\x7E -ÿ]/g, '');
}

/** Escapa uma string para um literal PDF. */
const escPdf = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

function larguraTexto(s: string, tamanho: number): number {
  let u = 0;
  for (let i = 0; i < s.length; i++) u += LARGURA[s.charCodeAt(i)] ?? 556;
  return (u * tamanho) / 1000;
}

/** Quebra o texto à largura dada; uma palavra maior que a linha é cortada à força (ex.: um URL). */
function quebrar(texto: string, maxLargura: number, tamanho: number): string[] {
  const linhas: string[] = [];
  for (const paragrafo of texto.split('\n')) {
    const palavras = paragrafo.split(' ');
    let atual = '';
    const empurrar = () => {
      if (atual) linhas.push(atual);
      atual = '';
    };
    for (let palavra of palavras) {
      while (larguraTexto(palavra, tamanho) > maxLargura) {
        // Palavra sozinha não cabe: corta carácter a carácter.
        let corte = palavra.length;
        while (corte > 1 && larguraTexto(palavra.slice(0, corte), tamanho) > maxLargura) corte--;
        const pedaco = palavra.slice(0, corte);
        if (atual) empurrar();
        linhas.push(pedaco);
        palavra = palavra.slice(corte);
      }
      const tentativa = atual ? `${atual} ${palavra}` : palavra;
      if (larguraTexto(tentativa, tamanho) > maxLargura) {
        empurrar();
        atual = palavra;
      } else {
        atual = tentativa;
      }
    }
    empurrar();
    if (paragrafo === '') linhas.push('');
  }
  return linhas;
}

interface Bloco {
  texto: string;
  negrito?: boolean;
  tamanho: number;
  espacoAntes?: number;
  indentar?: number;
}

/** Transforma o texto do certificado e dos incidentes em blocos com estilo. */
function blocos(eventos: EventoAuditoria[], pedidos: Pedido[], opcoes: OpcoesRelatorioFicheiro): Bloco[] {
  const cert = certificado(eventos, pedidos, opcoes.localDados, opcoes.agora).split('\n');
  const bs: Bloco[] = [];
  bs.push({ texto: cert[0] ?? '', negrito: true, tamanho: 17 });
  bs.push({ texto: cert[1] ?? '', tamanho: 10, espacoAntes: 3 });
  let rodapeCert = '';
  for (const linha of cert.slice(2)) {
    const l = linha.trim();
    if (!l) {
      bs.push({ texto: '', tamanho: 5 });
    } else if (/^(SUMMARY|\d+\. [A-Z])/.test(l)) {
      bs.push({ texto: l, negrito: true, tamanho: 12, espacoAntes: 10 });
    } else if (l.startsWith('·')) {
      bs.push({ texto: l, tamanho: 10.5, indentar: 8 });
    } else if (l.startsWith('✗')) {
      bs.push({ texto: l, negrito: true, tamanho: 10.5 });
    } else if (/Generated automatically/.test(l)) {
      rodapeCert = l;
    } else {
      bs.push({ texto: l, tamanho: 10.5 });
    }
  }
  if (rodapeCert) bs.push({ texto: rodapeCert, tamanho: 9, espacoAntes: 8 });

  // Um relatório de incidente por cada achado com pedido da defesa neste ciclo.
  const ids: string[] = [];
  for (const e of eventos) {
    if (e.tipo !== 'pedido' || e.quem !== 'defesa') continue;
    const id = (e.depois as { achado?: { id?: string } } | undefined)?.achado?.id;
    if (id && !ids.includes(id)) ids.push(id);
  }
  if (ids.length) {
    bs.push({ texto: 'INCIDENT REPORT', negrito: true, tamanho: 12, espacoAntes: 14 });
    for (const id of ids) {
      for (const linha of rel.montarRelatorio(id, eventos).texto.split('\n')) {
        bs.push({ texto: linha.trim() || '', tamanho: 10, indentar: linha.startsWith(' ') ? 8 : 0 });
      }
      bs.push({ texto: '', tamanho: 6 });
    }
  }

  bs.push({
    texto: 'Not an official certification: a record for GDPR and NIS2, built only from measured values.',
    tamanho: 8,
    espacoAntes: 12,
  });
  return bs;
}

interface LinhaPosta {
  fonte: 'F1' | 'F2';
  tamanho: number;
  x: number;
  y: number;
  texto: string;
}

const PAGINA_L = 595;
const PAGINA_A = 842;
const MARGEM = 56;
const CONTEUDO_L = PAGINA_L - 2 * MARGEM;

/** Distribui os blocos por páginas A4, com quebra de linha e mudança de página. */
function paginar(bs: Bloco[]): LinhaPosta[][] {
  const paginas: LinhaPosta[][] = [];
  let atual: LinhaPosta[] = [];
  let y = PAGINA_A - MARGEM;
  const novaPagina = () => {
    paginas.push(atual);
    atual = [];
    y = PAGINA_A - MARGEM;
  };
  for (const b of bs) {
    const texto = latin1(b.texto);
    if (texto === '') {
      y -= b.tamanho;
      continue;
    }
    const indent = b.indentar ?? 0;
    const segmentos = quebrar(texto, CONTEUDO_L - indent, b.tamanho);
    let primeiro = true;
    for (const seg of segmentos) {
      const alturaLinha = b.tamanho * 1.32;
      const espaco = primeiro ? b.espacoAntes ?? 0 : 0;
      if (y - (alturaLinha + espaco) < MARGEM) novaPagina();
      y -= espaco + alturaLinha;
      atual.push({
        fonte: b.negrito ? 'F2' : 'F1',
        tamanho: b.tamanho,
        x: MARGEM + indent + (primeiro ? 0 : 10),
        y,
        texto: seg,
      });
      primeiro = false;
    }
  }
  paginas.push(atual);
  return paginas;
}

/** Fluxo de conteúdo (operadores de texto) de uma página. */
function fluxo(linhas: LinhaPosta[]): string {
  const partes = ['BT'];
  let fonteAtual = '';
  for (const l of linhas) {
    const chave = `${l.fonte} ${l.tamanho}`;
    if (chave !== fonteAtual) {
      partes.push(`/${l.fonte} ${l.tamanho} Tf`);
      fonteAtual = chave;
    }
    partes.push(`1 0 0 1 ${l.x.toFixed(2)} ${l.y.toFixed(2)} Tm`);
    partes.push(`(${escPdf(l.texto)}) Tj`);
  }
  partes.push('ET');
  return partes.join('\n');
}

/** O relatório completo como PDF A4 de fundo branco (inglês). `eventos` devem ser só os do ciclo. */
export function relatorioPdf(eventos: EventoAuditoria[], pedidos: Pedido[], opcoes: OpcoesRelatorioFicheiro = {}): Uint8Array {
  const paginas = paginar(blocos(eventos, pedidos, opcoes));

  // Numeração: 1 catálogo, 2 páginas, 3 Helvetica, 4 Helvetica-Bold; depois, por página, o fluxo e o objeto da página.
  const corpos: string[] = [];
  corpos[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  const numPagina = (i: number) => 6 + i * 2;
  const kids = paginas.map((_, i) => `${numPagina(i)} 0 R`).join(' ');
  corpos[1] = `<< /Type /Pages /Kids [${kids}] /Count ${paginas.length} >>`;
  corpos[2] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  corpos[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  paginas.forEach((linhas, i) => {
    const conteudo = fluxo(linhas);
    const comprimento = Buffer.byteLength(conteudo, 'latin1');
    corpos[4 + i * 2] = `<< /Length ${comprimento} >>\nstream\n${conteudo}\nendstream`;
    corpos[5 + i * 2] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGINA_L} ${PAGINA_A}]` +
      ` /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${4 + i * 2 + 1} 0 R >>`;
  });

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  corpos.forEach((corpo, i) => {
    offsets[i] = Buffer.byteLength(pdf, 'latin1');
    pdf += `${i + 1} 0 obj\n${corpo}\nendobj\n`;
  });
  const inicioXref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${corpos.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${corpos.length + 1} /Root 1 0 R >>\nstartxref\n${inicioXref}\n%%EOF`;

  return new Uint8Array(Buffer.from(pdf, 'latin1'));
}

/** Nome do ficheiro: o id do certificado (CERT-AAAAMMDD-HHMM.pdf). */
export function nomeRelatorioPdf(opcoes: OpcoesRelatorioFicheiro = {}): string {
  return `${idCertificado(opcoes.agora)}.pdf`;
}
