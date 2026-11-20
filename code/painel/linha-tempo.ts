// GET / (o ecrã da demo, docs/painel-web.md) e GET /estado.json.
// 4 zonas: relógio de exposição (topo), linha do tempo dos agentes (esquerda), infraestrutura (centro), provas (direita).
// Só dados de estado.json e auditoria.jsonl; o que não se mediu mostra "—". HTML sem frameworks, texto escapado.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { EventoAuditoria, Pedido, Regra } from '@mwbe/shared';
import { auditoria, estado } from '@mwbe/shared';
import { relogioExposicao } from '@mwbe/chefe';

export const FASES = ['migrar', 'atacar', 'aprovar', 'fechar'] as const;
export type Fase = (typeof FASES)[number];

/** Em que fase cai um evento da auditoria (pelo tipo do evento e da ação do pedido). */
export function faseDe(evento: EventoAuditoria): Fase {
  const t = evento.tipo.toLowerCase();
  if (evento.quem === 'migrador') return 'migrar';
  if (evento.quem === 'atacante') return 'atacar';
  if (t.startsWith('migr') || evento.inverso?.tipo === 'migrar') return 'migrar';
  if (/(achado|ataque|atacante|reconhec|scan|nmap)/.test(t)) return 'atacar';
  if (/(a-aplicar|feito|desfeito|falhou|fechad|verific)/.test(t)) return 'fechar';
  return 'aprovar'; // pedido, aprovado, ignorado e afins
}

export type Agente = 'migrador' | 'atacante' | 'defesa' | 'chefe' | 'dono';

/** De quem é o evento, para a cor da linha. Aprovações de um humano são do dono; o modo noite é da defesa. */
export function agenteDe(e: EventoAuditoria): Agente {
  if (e.quem === 'migrador' || e.quem === 'atacante' || e.quem === 'defesa' || e.quem === 'chefe') return e.quem;
  if (e.quem === 'modo-noite') return 'defesa';
  if ((e.tipo === 'aprovado' || e.tipo === 'ignorado') && e.quem) return 'dono';
  if (e.inverso || /(a-aplicar|desfeito|falhou)/.test(e.tipo)) return 'defesa';
  return 'chefe'; // orquestrador, erros e o resto
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});
const regraTxt = (r: Partial<Regra> | undefined) =>
  r ? `${r.protocol ?? ''} ${r.startPort === r.endPort ? r.startPort : `${r.startPort}-${r.endPort}`} de ${r.source ?? '?'}` : '';

/** Frase curta para a linha do tempo (o que se passou, em português simples). */
export function fraseDe(e: EventoAuditoria): string {
  const d = obj(e.depois);
  switch (e.tipo) {
    case 'infra-no-ar':
      return 'Infraestrutura nova no ar. O relógio de exposição começa a contar.';
    case 'migracao-plano-infra':
      return 'Traduziu a configuração da AWS para a Leaseweb (só plano).';
    case 'pedido':
      if (e.quem === 'migrador') return `Propõe migrar: ${((d.servicos as string[]) ?? []).join(', ') || 'serviços da app'}.`;
      return `Pede para fechar: ${String(d.titulo ?? e.pedidoId)}.`;
    case 'aprovado':
      return e.quem === 'modo-noite' ? 'Sem resposta do dono: modo noite.' : 'Aprovado.';
    case 'ignorado':
      return 'Ignorado.';
    case 'sem-resposta':
      return 'Sem resposta do dono.';
    case 'reconhecimento': {
      const portas = (d.portas as { alvo: string; porta: number; servico: string | null }[]) ?? [];
      if (!portas.length) return 'Reconhecimento: nada aberto.';
      return `Encontrou: ${portas.slice(0, 3).map((p) => `${p.servico ?? 'porta'} ${p.porta}`).join(', ')}${portas.length > 3 ? '…' : ''}.`;
    }
    case 'a-aplicar':
      return `A fechar ${regraTxt(e.antes as Regra)}.`;
    case 'modo-noite-permitir':
      return `Modo noite: porta só para ${String(obj(e.depois).source ?? '?')}.`;
    case 'feito':
      if (e.quem === 'migrador') return `${d.objetos ?? '?'} ficheiros copiados, checksums ${d.checksumsOk ? 'iguais' : 'DIFERENTES'}.`;
      return 'Fechado e confirmado pela API da Leaseweb.';
    case 'desfeito':
      return 'Desfeito: a regra voltou.';
    case 'falhou':
      return `Falhou: ${String(e.depois ?? '')}`.slice(0, 140);
    case 'erro':
      return `Erro em ${String(d.fase ?? '?')}.`;
    default:
      return e.tipo;
  }
}

/** Só o ciclo atual: desde o último 'infra-no-ar' (o ficheiro acumula os ensaios do dia). Sem ele, os últimos 40. */
export function cicloAtual(eventos: EventoAuditoria[]): EventoAuditoria[] {
  const i = eventos.findLastIndex((e) => e.tipo === 'infra-no-ar');
  return i >= 0 ? eventos.slice(i) : eventos.slice(-40);
}

export interface Porta {
  alvo: string;
  porta: number;
  servico: string | null;
  estado: 'aberta' | 'a fechar' | 'fechada' | 'reaberta';
  pedidoId: string;
}

/** Portas que a defesa pediu para fechar no ciclo, com o estado mais recente de cada uma. */
export function portasDoCiclo(eventos: EventoAuditoria[]): Porta[] {
  const portas = new Map<string, Porta>();
  for (const e of eventos) {
    if (e.tipo === 'pedido' && e.quem === 'defesa') {
      const a = obj(obj(e.depois).achado);
      portas.set(e.pedidoId, { alvo: String(a.alvo ?? '?'), porta: Number(a.porta), servico: (a.servico as string) ?? null, estado: 'aberta', pedidoId: e.pedidoId });
    }
    const p = portas.get(e.pedidoId);
    if (!p) continue;
    if (e.tipo === 'a-aplicar') p.estado = 'a fechar';
    if (e.tipo === 'feito') p.estado = 'fechada';
    if (e.tipo === 'falhou') p.estado = 'aberta';
    if (e.tipo === 'desfeito') p.estado = 'reaberta';
  }
  return [...portas.values()];
}

const escapar = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const hora = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? escapar(iso) : d.toLocaleTimeString('pt-PT', { timeZone: 'Europe/Lisbon' });
};
const NOME: Record<Agente, string> = { migrador: 'Migrador', atacante: 'Atacante', defesa: 'Defesa', chefe: 'Chefe', dono: 'Dono' };

/** HTML sem frameworks, texto escapado; recarrega quando /estado.json muda (de 2 em 2 s). */
export function renderizar(pedidos: Pedido[], todos: EventoAuditoria[], token = ''): string {
  const eventos = cicloAtual(todos);

  // 1. Relógio de exposição (ideia wow 2): a conta é do chefe (último 'infra-no-ar' -> primeiro fecho confirmado).
  const exp = relogioExposicao(todos);
  const relogio = exp
    ? `<header class="relogio ${exp.aindaExposta ? 'exposta' : 'fechada'}" data-inicio="${escapar(exp.inicio)}" data-fim="${escapar(exp.fim ?? '')}">
<div class="seg">exposto ${exp.segundos} s</div><div class="isco">&nbsp;</div></header>`
    : `<header class="relogio"><div class="seg neutro">à espera da infraestrutura nova</div><div class="isco">&nbsp;</div></header>`;

  // 2. Linha do tempo dos agentes.
  const linhas = eventos
    .slice(-14)
    .reverse()
    .map((e) => {
      const ag = agenteDe(e);
      return `<li class="ag-${ag}"><span class="h">${hora(e.hora)}</span><span class="quem">${NOME[ag]}</span><span>${escapar(fraseDe(e))}</span></li>`;
    })
    .join('');

  // 3. Infraestrutura.
  const migracao = eventos.findLast((e) => e.quem === 'migrador' && e.tipo === 'feito');
  const portas = portasDoCiclo(eventos);
  const caixasPortas = portas.length
    ? portas
        .map((p) => `<div class="porta p-${p.estado.replace(' ', '-')}">${escapar(p.servico ?? 'porta')} ${p.porta}<small>${escapar(p.alvo)} · ${p.estado}</small></div>`)
        .join('')
    : '<div class="porta vazio">—</div>';
  const infra = `<div class="infra">
<div class="caixa">AWS<small>(simulada)</small></div><div class="seta ${migracao ? 'acesa' : ''}">→</div>
<div class="caixa">Leaseweb<small>${migracao ? 'dados migrados' : '—'}</small></div><div class="seta ${portas.length ? 'acesa' : ''}">→</div>
<div class="caixa vitima">vítima${caixasPortas}</div></div>`;

  // 4. Provas.
  const d = obj(migracao?.depois);
  const testes = obj(d.testes);
  const ok = (v: unknown) => (v === true ? '<b class="ok">✓</b>' : v === false ? '<b class="mau">✗</b>' : '—');
  const recon = eventos.findLast((e) => e.tipo === 'reconhecimento');
  const vistas = (obj(recon?.depois).portas as { porta: number }[] | undefined) ?? [];
  const provasDefesa = pedidos
    .filter((p) => p.acao.tipo === 'remover_regra' && portas.some((x) => x.pedidoId === p.id))
    .map((p) => {
      const regra = p.acao.tipo === 'remover_regra' ? p.acao.regra : undefined;
      const viu = regra && vistas.some((v) => v.porta >= regra.startPort && v.porta <= regra.endPort);
      const botao =
        token && p.estado === 'feito'
          ? `<form method="post" action="/desfazer"><input type="hidden" name="id" value="${escapar(p.id)}"><input type="hidden" name="token" value="${escapar(token)}"><button>Desfazer</button></form>`
          : '';
      return `<div class="prova"><b>${escapar(p.titulo)}</b>
<div>antes: ${viu ? '<b class="mau">open</b> (visto pelo atacante)' : '—'} · depois: ${p.estado === 'feito' ? '<b class="ok">regra removida e confirmada</b>' : escapar(p.estado)}</div>
<div class="mut">inverso guardado: criar ${escapar(regraTxt(regra))} · pedido ${escapar(p.id)}</div>${botao}</div>`;
    })
    .join('');
  const provas = `<div class="prova"><b>Migração</b><div>ficheiros ${escapar(d.objetos ?? '—')} · checksums ${ok(d.checksumsOk)} · testes antes ${ok(testes.antes)} depois ${ok(testes.depois)}</div></div>
${provasDefesa || '<div class="prova mut">Defesa: ainda sem pedidos neste ciclo.</div>'}`;

  return `<!doctype html><html lang="pt"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Migrar sem ficar exposto</title>
<style>:root{--bg:#0C1715;--card:#15171C;--fg:#FFFFFF;--mut:#8B929C;--ok:#3ECF8E;--mau:#FF5A4F;--mig:#4C9AFF;--ata:#FF5A4F;--def:#3ECF8E;--che:#8B929C;--dono:#F5B942}
*{box-sizing:border-box}body{margin:0;padding:24px;background:var(--bg);color:var(--fg);font:20px/1.35 Inter,system-ui,sans-serif}
.relogio{background:var(--card);border-radius:14px;padding:20px 28px;display:flex;gap:32px;align-items:baseline;flex-wrap:wrap;margin-bottom:20px}
.seg{font-size:clamp(2.4rem,7vw,5rem);font-weight:800;line-height:1}.exposta .seg{color:var(--mau)}.fechada .seg{color:var(--ok)}.neutro{font-size:1.6rem!important;color:var(--mut)}
.isco{color:var(--mut);font-size:1.3rem}
main{display:grid;grid-template-columns:1.2fr 1fr 1.1fr;gap:20px}@media (max-width:1100px){main{grid-template-columns:1fr}}
section{background:var(--card);border-radius:14px;padding:20px}h2{margin:0 0 12px;font-size:1rem;letter-spacing:.1em;text-transform:uppercase;color:var(--mut)}
ul{list-style:none;margin:0;padding:0}li{display:grid;grid-template-columns:5.5em 6.5em 1fr;gap:8px;padding:7px 0 7px 10px;border-left:4px solid var(--che);margin-bottom:6px}
li .h{color:var(--mut);font-variant-numeric:tabular-nums}li .quem{font-weight:700}
.ag-migrador{border-color:var(--mig)}.ag-migrador .quem{color:var(--mig)}.ag-atacante{border-color:var(--ata)}.ag-atacante .quem{color:var(--ata)}
.ag-defesa{border-color:var(--def)}.ag-defesa .quem{color:var(--def)}.ag-dono{border-color:var(--dono)}.ag-dono .quem{color:var(--dono)}.ag-chefe .quem{color:var(--che)}
.infra{display:flex;flex-direction:column;align-items:stretch;gap:6px}.caixa{border:2px solid #2a313b;border-radius:12px;padding:14px;text-align:center;font-weight:700;font-size:1.3rem}
.caixa small{display:block;font-weight:400;color:var(--mut);font-size:.9rem}.seta{text-align:center;color:#2a313b;font-size:1.8rem;line-height:1}.seta.acesa{color:var(--mig)}
.porta{margin-top:10px;border-radius:10px;padding:10px;font-size:1.4rem}.porta small{display:block;font-size:.85rem;opacity:.85}
.p-aberta,.p-reaberta{background:#3a1715;color:var(--mau)}.p-a-fechar{background:#3a2e12;color:var(--dono)}.p-fechada{background:#0f3324;color:var(--ok)}
.prova{border-bottom:1px solid #222831;padding:10px 0}.prova:last-child{border:0}.mut,.vazio{color:var(--mut)}.ok{color:var(--ok)}.mau{color:var(--mau)}
button{margin-top:8px;background:var(--mau);color:#fff;border:0;border-radius:8px;padding:8px 16px;font-size:1rem;cursor:pointer}form{margin:0}
@media (max-width:600px){body{padding:16px;font-size:16px}li{grid-template-columns:4.5em 5.5em 1fr}}</style>
${relogio}
<main><section><h2>Linha do tempo</h2><ul>${linhas || '<li class="vazio">Ainda sem eventos.</li>'}</ul></section>
<section><h2>Infraestrutura</h2>${infra}</section>
<section><h2>Provas</h2>${provas}</section></main>
<script>
const r=document.querySelector('.relogio[data-inicio]');
if(r){const i=Date.parse(r.dataset.inicio),f=r.dataset.fim?Date.parse(r.dataset.fim):0,seg=r.querySelector('.seg');
 if(!f)setInterval(()=>{seg.textContent='exposto '+Math.round((Date.now()-i)/1000)+' s'},500);
 const q='/isco?json&desde='+encodeURIComponent(r.dataset.inicio)+(f?'&ate='+encodeURIComponent(r.dataset.fim):'');
 fetch(q).then(x=>x.ok?x.json():null).then(c=>{if(c)r.querySelector('.isco').textContent='neste tempo, o isco recebeu '+c.tentativas+' tentativas de entrada'}).catch(()=>{});}
let ultimo='';
setInterval(async()=>{try{const x=await fetch('/estado.json',{cache:'no-store'});const t=await x.text();if(ultimo&&t!==ultimo)location.reload();ultimo=t}catch{}},2000);
</script></html>`;
}

export async function paginaLinhaTempo(req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(renderizar(estado.listarPedidos(), auditoria.ler(), process.env.PAINEL_TOKEN ?? ''));
}

export async function estadoJson(req: IncomingMessage, res: ServerResponse): Promise<void> {
  res
    .writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    .end(JSON.stringify({ pedidos: estado.listarPedidos(), eventos: auditoria.ler() }));
}
