// GET / (HTML simples, tabela se faltar tempo) e GET /estado.json.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { EventoAuditoria, Pedido } from '@mwbe/shared';
import { auditoria, estado } from '@mwbe/shared';

export const FASES = ['migrar', 'atacar', 'aprovar', 'fechar'] as const;
export type Fase = (typeof FASES)[number];

/** Em que fase cai um evento da auditoria (pelo tipo do evento e da ação do pedido). */
export function faseDe(evento: EventoAuditoria): Fase {
  const t = evento.tipo.toLowerCase();
  if (t.startsWith('migr') || evento.inverso?.tipo === 'migrar') return 'migrar';
  if (/(achado|ataque|atacante|reconhec|scan|nmap)/.test(t)) return 'atacar';
  if (/(a-aplicar|feito|desfeito|falhou|fechad|verific)/.test(t)) return 'fechar';
  return 'aprovar'; // pedido, aprovado, ignorado e afins
}

const escapar = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const hora = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? escapar(iso) : d.toLocaleTimeString('pt-PT', { timeZone: 'Europe/Lisbon' });
};

/** HTML sem frameworks, texto escapado, a ler /estado.json de 2 em 2 s. */
export function renderizar(pedidos: Pedido[], eventos: EventoAuditoria[]): string {
  const colunas = FASES.map((f) => {
    const doFase = eventos.filter((e) => faseDe(e) === f).slice(-8).reverse();
    const itens = doFase
      .map((e) => `<li><b>${hora(e.hora)}</b> ${escapar(e.tipo)} <small>${escapar(e.pedidoId)}${e.quem ? ` · ${escapar(e.quem)}` : ''}</small></li>`)
      .join('');
    return `<section class="${doFase.length ? 'ativa' : ''}"><h2>${f}</h2><ul>${itens || '<li class="vazio">—</li>'}</ul></section>`;
  }).join('<div class="seta">→</div>');
  const linhas = pedidos
    .map((p) => `<tr><td>${escapar(p.id)}</td><td>${escapar(p.titulo)}</td><td class="e-${escapar(p.estado)}">${escapar(p.estado)}</td></tr>`)
    .join('');
  return `<!doctype html><html lang="pt"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Linha do tempo</title>
<style>:root{--bg:#0b0f14;--fg:#e8eef5;--mut:#8a97a6;--card:#141b23;--ok:#3ecf8e;--mau:#ff5a4f;--esp:#f5b942}
body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font-family:system-ui,sans-serif}
h1{font-size:1.3rem}.fases{display:flex;gap:8px;align-items:stretch;flex-wrap:wrap}
section{flex:1;min-width:180px;background:var(--card);border-radius:10px;padding:10px;opacity:.55}section.ativa{opacity:1;outline:2px solid var(--ok)}
h2{margin:0 0 6px;text-transform:uppercase;font-size:.9rem;letter-spacing:.08em}ul{list-style:none;margin:0;padding:0;font-size:.85rem}
li{padding:3px 0;border-bottom:1px solid #222c37}small,.vazio{color:var(--mut)}.seta{align-self:center;color:var(--mut);font-size:1.4rem}
table{width:100%;border-collapse:collapse;margin-top:16px;font-size:.9rem}td,th{padding:6px;border-bottom:1px solid #222c37;text-align:left}
.e-feito{color:var(--ok)}.e-pendente,.e-aprovado{color:var(--esp)}.e-desfeito,.e-ignorado{color:var(--mut)}</style>
<h1>Migrar → atacar → aprovar → fechar</h1><div class="fases">${colunas}</div>
<table><thead><tr><th>Pedido</th><th>O quê</th><th>Estado</th></tr></thead><tbody>${linhas || '<tr><td colspan="3" class="vazio">Sem pedidos</td></tr>'}</tbody></table>
<script>
let ultimo='';
setInterval(async()=>{try{const r=await fetch('/estado.json',{cache:'no-store'});const t=await r.text();if(ultimo&&t!==ultimo)location.reload();ultimo=t}catch{}},2000);
</script></html>`;
}

export async function paginaLinhaTempo(req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(renderizar(estado.listarPedidos(), auditoria.ler()));
}

export async function estadoJson(req: IncomingMessage, res: ServerResponse): Promise<void> {
  res
    .writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    .end(JSON.stringify({ pedidos: estado.listarPedidos(), eventos: auditoria.ler() }));
}
