// Relatório da demo como ficheiro (desenho: docs/material/design/web.pen, frame "Incident & migration report").
// Uma página HTML A4, pronta a imprimir ou a guardar em PDF, que o chefe anexa no Telegram e o painel oferece
// para download. O conteúdo é o certificado de migração e o relatório de cada incidente deste ciclo:
// os mesmos textos (já medidos) que vão para o Telegram, só que paginados. Nada novo é calculado aqui.
import { relatorio as rel, type EventoAuditoria, type Pedido } from '@mwbe/shared';
import { certificado } from './certificado';

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ESC[c]!);
/** Links (o PR) clicáveis no ficheiro. */
const comLinks = (t: string) => esc(t).replace(/https:\/\/[^\s)<]+/g, (u) => `<a href="${u}">${u}</a>`);

/** Achados com pedido da defesa nesta auditoria (um relatório de incidente por cada). */
function achadosDaDefesa(eventos: EventoAuditoria[]): string[] {
  const ids: string[] = [];
  for (const e of eventos) {
    if (e.tipo !== 'pedido' || e.quem !== 'defesa') continue;
    const id = (e.depois as { achado?: { id?: string } } | undefined)?.achado?.id;
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** Texto do certificado → secções HTML (título, linha da data, "SUMMARY", "1. …" com as linhas "· …"). */
function seccoesDoCertificado(texto: string): { titulo: string; subtitulo: string; corpo: string; rodape: string } {
  const linhas = texto.split('\n');
  const titulo = linhas[0] ?? '';
  const subtitulo = linhas[1] ?? '';
  const partes: string[] = [];
  let rodape = '';
  let lista: string[] = [];
  const fecharLista = () => {
    if (lista.length) partes.push(`<ul>${lista.map((l) => `<li>${comLinks(l)}</li>`).join('')}</ul>`);
    lista = [];
  };
  for (const linha of linhas.slice(2)) {
    const l = linha.trim();
    if (!l) {
      fecharLista();
      continue;
    }
    if (/^(SUMMARY|\d+\. [A-Z])/.test(l)) {
      fecharLista();
      partes.push(`<h2>${esc(l)}</h2>`);
    } else if (l.startsWith('· ')) {
      lista.push(l.slice(2));
    } else if (l.startsWith('✗')) {
      fecharLista();
      partes.push(`<p class="aviso">${esc(l)}</p>`);
    } else if (/Generated automatically/.test(l)) {
      rodape = l;
    } else {
      fecharLista();
      partes.push(`<p class="resumo">${comLinks(l)}</p>`);
    }
  }
  fecharLista();
  return { titulo, subtitulo, corpo: partes.join('\n'), rodape };
}

export interface OpcoesRelatorioFicheiro {
  /** LOCAL_DADOS (ex.: "Leaseweb, Amsterdam (NL)"). */
  localDados?: string;
  agora?: Date;
}

/** Nome do ficheiro: o id do certificado (CERT-AAAAMMDD-HHMM.html). */
export function nomeRelatorioFicheiro(eventos: EventoAuditoria[], pedidos: Pedido[], opcoes: OpcoesRelatorioFicheiro = {}): string {
  const id = certificado(eventos, pedidos, opcoes.localDados, opcoes.agora).split('\n')[0]?.match(/CERT-\d{8}-\d{4}/)?.[0] ?? 'report';
  return `${id}.html`;
}

/** O relatório completo como página HTML A4 (inglês). `eventos` devem ser só os do ciclo. */
export function relatorioHtml(eventos: EventoAuditoria[], pedidos: Pedido[], opcoes: OpcoesRelatorioFicheiro = {}): string {
  const cert = seccoesDoCertificado(certificado(eventos, pedidos, opcoes.localDados, opcoes.agora));
  const incidentes = achadosDaDefesa(eventos).map((id) => rel.montarRelatorio(id, eventos).texto);
  const blocoIncidentes = incidentes.length
    ? `<h2>INCIDENT REPORT</h2>${incidentes.map((t) => `<pre class="incidente">${comLinks(t)}</pre>`).join('\n')}`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(cert.titulo)}</title>
<style>
  @page { size: A4; margin: 18mm 20mm; }
  * { box-sizing: border-box; }
  body { font-family: "Geist", "Inter", "Segoe UI", system-ui, sans-serif; color: #10201C; margin: 0; background: #fff; }
  .pagina { max-width: 210mm; margin: 0 auto; padding: 32px 40px; }
  .marca { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 2px solid #10201C; padding-bottom: 10px; }
  .marca b { font-family: "Instrument Serif", Georgia, serif; font-size: 22px; font-weight: 400; }
  .marca span { font-family: ui-monospace, "JetBrains Mono", monospace; font-size: 11px; letter-spacing: 2px; color: #4B5E59; }
  h1 { font-size: 28px; margin: 22px 0 4px; letter-spacing: -0.3px; }
  .sub { font-family: ui-monospace, monospace; font-size: 13px; color: #4B5E59; margin-bottom: 18px; }
  h2 { font-family: ui-monospace, monospace; font-size: 12px; letter-spacing: 2px; color: #2F6B57; margin: 22px 0 8px; border-bottom: 1px solid #E3E0D8; padding-bottom: 4px; }
  p.resumo { background: #F5F3EE; border-radius: 8px; padding: 12px 14px; line-height: 1.5; margin: 0; }
  p.aviso { color: #B23A2B; font-weight: 600; }
  ul { margin: 0; padding-left: 18px; line-height: 1.6; font-size: 14px; }
  pre.incidente { white-space: pre-wrap; font-family: ui-monospace, monospace; font-size: 12.5px; background: #F5F3EE; border-radius: 8px; padding: 12px 14px; line-height: 1.5; }
  a { color: #2F6B57; }
  footer { margin-top: 26px; border-top: 1px solid #E3E0D8; padding-top: 10px; font-size: 11.5px; color: #4B5E59; line-height: 1.5; }
  @media print { .pagina { padding: 0; } a { color: inherit; } }
</style>
</head>
<body>
<div class="pagina">
  <div class="marca"><b>Migrate without being exposed</b><span>INFRAHACK · LEASEWEB</span></div>
  <h1>${esc(cert.titulo)}</h1>
  <div class="sub">${esc(cert.subtitulo)}</div>
  ${cert.corpo}
  ${blocoIncidentes}
  <footer>${esc(cert.rodape)}<br>Not an official certification: a record for GDPR and NIS2, built only from measured values.</footer>
</div>
</body>
</html>
`;
}
