// GET / (o ecrã da demo, docs/painel-web.md e docs/material/design/web.pen) e GET /estado.json.
// Topo: marca + relógio de exposição. Corpo: linha do tempo dos agentes | infraestrutura | provas.
// Só dados de estado.json e auditoria.jsonl; o que não se mediu mostra "—". HTML sem frameworks, texto escapado.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { EventoAuditoria, Pedido, Regra } from '@mwbe/shared';
import { auditoria, estado } from '@mwbe/shared';
import { relogioExposicao } from '@mwbe/chefe';
import { cabecalho, escapar, horaLisboa, numero } from './estilo';
import { CSS_TERMINAL, renderizarTerminal } from './terminal';

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
  if (e.inverso || /(a-aplicar|desfeito|falhou|verificado)/.test(e.tipo)) return 'defesa';
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
    case 'migracao-plano-destino':
      return 'Escolheu o destino de cada serviço na Leaseweb.';
    case 'pedido':
      if (e.quem === 'migrador') return 'Pede aprovação para migrar.';
      return `Proponho fechar: ${String(d.titulo ?? e.pedidoId)}.`;
    case 'aprovado':
      return e.quem === 'modo-noite' ? 'Sem resposta do dono: modo noite.' : 'Aprovou.';
    case 'ignorado':
      return 'Ignorou.';
    case 'sem-resposta':
      return 'Sem resposta do dono.';
    case 'reconhecimento': {
      const portas = (d.portas as { alvo: string; porta: number; servico: string | null }[]) ?? [];
      if (!portas.length) return 'Não encontrei portas abertas nas nossas máquinas.';
      return `Aberto a toda a Internet: ${portas.slice(0, 3).map((p) => `${p.servico ?? 'porta'} ${p.porta}`).join(', ')}${portas.length > 3 ? '…' : ''}.`;
    }
    case 'a-aplicar':
      return `A fechar ${regraTxt(e.antes as Regra)}.`;
    case 'modo-noite-permitir':
      return `Modo noite: porta só para ${String(d.source ?? '?')}.`;
    case 'verificado':
      return `nmap ${d.fase === 'depois' ? 'depois' : 'antes'}: ${d.porta} ${d.estado}.`;
    case 'feito':
      if (e.quem === 'migrador' && d.tabelas !== undefined)
        return `Base de dados: ${numero(d.linhas)} linhas em ${d.tabelas} tabelas. Checksums ${d.checksumsOk ? 'iguais' : 'DIFERENTES'}.`;
      if (e.quem === 'migrador' && d.mensagens !== undefined)
        return `Fila: ${numero(d.mensagens)} mensagens no RabbitMQ. Checksums ${d.checksumsOk ? 'iguais' : 'DIFERENTES'}.`;
      // Só a contagem: o valor de um segredo nunca chega ao painel.
      if (e.quem === 'migrador' && d.segredos !== undefined)
        return `Segredos: ${numero(d.segredos)} no OpenBao. Checksums ${d.checksumsOk ? 'iguais' : 'DIFERENTES'}.`;
      if (e.quem === 'migrador' && d.chaves !== undefined)
        return `Cache: ${numero(d.chaves)} chaves no Valkey. Checksums ${d.checksumsOk ? 'iguais' : 'DIFERENTES'}.`;
      if (e.quem === 'migrador') return `${numero(d.objetos)} ficheiros copiados. Checksums ${d.checksumsOk ? 'iguais' : 'DIFERENTES'}.`;
      return 'Fechado e confirmado. Inverso guardado.';
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
  // O ciclo começa no primeiro 'pedido' do migrador antes do último 'infra-no-ar' (para a migração aparecer).
  const i = eventos.findLastIndex((e) => e.tipo === 'infra-no-ar');
  if (i < 0) return eventos.slice(-40);
  let inicio = i;
  for (let j = i - 1; j >= 0 && j >= i - 150; j--) {
    if (eventos[j].tipo === 'infra-no-ar') break;
    if (eventos[j].quem === 'migrador') inicio = j;
  }
  return eventos.slice(inicio);
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

/** Quem aprovou, em texto curto para as provas. */
export function aprovadoPor(eventos: EventoAuditoria[], pedidoId: string): string {
  const e = eventos.findLast((x) => x.pedidoId === pedidoId && x.tipo === 'aprovado');
  if (!e) return '—';
  if (e.quem === 'modo-noite') return 'modo noite (sem resposta)';
  if (e.quem === 'consola') return 'dono · consola';
  return 'dono · Telegram';
}

/** Os números das provas e da infraestrutura, tirados do ciclo atual. */
export function provas(eventos: EventoAuditoria[]) {
  const migr = eventos.filter((e) => e.quem === 'migrador' && e.tipo === 'feito').map((e) => obj(e.depois));
  // Cada passo pelo depois.passo; os eventos antigos (sem passo) pelo campo da prova.
  const doPasso = (passo: string, campo: string) =>
    migr.findLast((d) => d.passo === passo || (d.passo === undefined && d[campo] !== undefined));
  const s3 = doPasso('s3', 'objetos');
  const pg = doPasso('postgres', 'tabelas');
  const fila = doPasso('fila', 'mensagens');
  const seg = doPasso('segredos', 'segredos');
  const cache = doPasso('cache', 'chaves');
  const passos = [s3, pg, fila, seg, cache].filter((d) => d !== undefined);
  const testes = obj(passos.findLast((d) => d.testes !== undefined)?.testes);
  const recon = eventos.findLast((e) => e.tipo === 'reconhecimento');
  const verif = (fase: string) =>
    eventos.findLast((e) => e.tipo === 'verificado' && obj(e.depois).fase === fase)?.depois as { porta: number; estado: string } | undefined;
  const ultimoFecho = eventos.findLast((e) => e.tipo === 'feito' && e.inverso?.tipo === 'criar_regra');
  const desfeito = ultimoFecho && eventos.some((e) => e.tipo === 'desfeito' && e.pedidoId === ultimoFecho.pedidoId && e.hora >= ultimoFecho.hora);
  return {
    objetos: s3?.objetos as number | undefined,
    checksums: passos.length ? passos.every((d) => d.checksumsOk ?? true) : undefined,
    testesAntes: testes.antes as boolean | undefined,
    testesDepois: testes.depois as boolean | undefined,
    linhas: pg?.linhas as number | undefined,
    tabelas: pg?.tabelas as number | undefined,
    mensagens: fila?.mensagens as number | undefined,
    segredos: seg?.segredos as number | undefined,
    chaves: cache?.chaves as number | undefined,
    /** Quantos passos da migração têm prova neste ciclo. */
    passosMigrados: passos.length,
    atacou: Boolean(recon),
    nmapAntes: verif('antes'),
    nmapDepois: verif('depois'),
    ultimoFecho: ultimoFecho && !desfeito ? ultimoFecho : undefined,
  };
}

const NOME: Record<Agente, string> = { migrador: 'MIGRADOR', atacante: 'ATACANTE', defesa: 'DEFESA', chefe: 'CHEFE', dono: 'DONO' };

const CSS = `body{padding:48px;min-height:100vh;display:flex;flex-direction:column;gap:28px}
.topo{display:flex;justify-content:space-between;align-items:flex-end;gap:32px;flex-wrap:wrap}
.marca h1{margin:8px 0 0;font:400 56px/1 var(--serif)}
.relogio{display:flex;flex-direction:column;gap:6px;align-items:flex-end}.valor{display:flex;gap:16px;align-items:center}
.seg{font:400 150px/0.9 var(--serif);color:var(--atk)}.fechada .seg{color:var(--def)}.espera .seg{font-size:48px;color:var(--faint)}
.estado{display:flex;flex-direction:column;gap:6px}.pill{display:inline-flex;gap:8px;align-items:center;padding:6px 14px;border-radius:999px;font:16px var(--mono);color:var(--atk);background:#FF8A7A22}
.pill:before{content:'';width:10px;height:10px;border-radius:50%;background:currentColor}.fechada .pill{color:var(--def);background:#7DD3A822}
.isco{font-size:18px;color:var(--muted)}
.corpo{flex:1;display:grid;grid-template-columns:560px 1fr 520px;gap:24px;min-height:0}
section{background:var(--panel);border-radius:18px;padding:28px;display:flex;flex-direction:column;gap:20px;min-width:0}
.cab{display:flex;justify-content:space-between;font:15px var(--mono);letter-spacing:2px;color:var(--muted)}.cab span:last-child{color:var(--faint);letter-spacing:0}
.eventos{display:flex;flex-direction:column;gap:18px;overflow:hidden}
.ev{display:flex;gap:14px}.ev:before{content:'';flex:none;width:4px;border-radius:2px;background:var(--c)}
.meta{display:flex;gap:10px;font:14px var(--mono)}.meta b{color:var(--c);letter-spacing:1px}.meta span{color:var(--faint)}.frase{font-size:20px;margin-top:4px}
.ag-migrador{--c:var(--mig)}.ag-atacante{--c:var(--atk)}.ag-defesa{--c:var(--def)}.ag-dono{--c:var(--ink)}.ag-chefe{--c:var(--chf)}
.fluxo{display:flex;flex-direction:column;gap:10px}.cartao{background:var(--bg);border-radius:14px;padding:14px 20px;display:flex;flex-direction:column;gap:4px}
.cartao h3{margin:0;font:400 24px var(--serif)}.cartao .sub{font:16px var(--mono);color:var(--muted)}.vitima{background:#7DD3A814}
.seta{display:flex;gap:12px;align-items:center;font:15px var(--mono);color:var(--faint)}.seta b{font:22px var(--sans)}.seta.mig{color:var(--mig)}.seta.atk{color:var(--atk)}
.portas{display:flex;gap:10px;flex-wrap:wrap;margin-top:8px}.porta{padding:6px 12px;border-radius:8px;font:16px var(--mono)}
.p-aberta,.p-reaberta{color:var(--atk);background:#FF5C6122}.p-a-fechar{color:#F5B942;background:#F5B94222}.p-fechada{color:var(--def);background:#33D69A22}
.prova h3{margin:0 0 10px;font:400 28px var(--serif)}.kv{display:flex;justify-content:space-between;gap:12px;font-size:17px;padding:4px 0}
.kv span:first-child{color:var(--muted)}.kv span:last-child{font-family:var(--mono)}.ok{color:var(--ok)}.bad{color:var(--bad)}
.espaco{flex:1}.btn{width:100%;padding:18px;border:0;border-radius:12px;background:var(--def);color:var(--bg);font:600 18px var(--sans);cursor:pointer}
.nota{font:13px var(--mono);color:var(--faint)}
.agora{border:1px solid var(--line);border-left:4px solid var(--c);border-radius:10px;padding:12px 14px;font-size:18px;color:var(--muted);font-style:italic}
.agora span{display:block;font:14px var(--mono);font-style:normal;color:var(--c);letter-spacing:1px;margin-bottom:4px}
@media (max-width:1500px){body{padding:24px}.corpo{grid-template-columns:1fr 1fr}.corpo section:first-child{grid-column:1/-1}.seg{font-size:96px}}
@media (max-width:900px){body{padding:16px}.corpo{grid-template-columns:1fr}.seg{font-size:72px}.marca h1{font-size:36px}.relogio{align-items:flex-start}}`;

/** O ecrã da demo. `token` liga o botão Desfazer (PAINEL_TOKEN). */
export function renderizar(pedidos: Pedido[], todos: EventoAuditoria[], token = ''): string {
  const eventos = cicloAtual(todos);
  const p = provas(eventos);

  // Relógio de exposição (ideia wow 2): a conta é do chefe (último 'infra-no-ar' -> primeiro fecho confirmado).
  const exp = relogioExposicao(todos);
  const relogio = exp
    ? `<div class="relogio ${exp.aindaExposta ? 'exposta' : 'fechada'}" data-inicio="${escapar(exp.inicio)}" data-fim="${escapar(exp.fim ?? '')}">
<div class="kicker">Tempo exposto</div><div class="valor"><div class="seg">${exp.segundos} s</div>
<div class="estado"><div class="pill">${exp.aindaExposta ? 'EXPOSTO' : `FECHADO ${horaLisboa(exp.fim!)}`}</div><div class="isco">&nbsp;</div></div></div></div>`
    : `<div class="relogio espera"><div class="kicker">Tempo exposto</div><div class="seg">à espera da infraestrutura nova</div><div class="isco">&nbsp;</div></div>`;

  // Linha "a pensar" (docs/agentes/vozes.md): o texto fixo do último evento 'pensar' do ciclo, por baixo do agente ativo.
  // Não é raciocínio do modelo: é a frase do passo da demo. Os eventos 'pensar' não entram na lista.
  const pensar = eventos.findLast((e) => e.tipo === 'pensar');
  const agora = pensar
    ? `<div class="agora ag-${agenteDe(pensar)}"><span>${NOME[agenteDe(pensar)]} · a pensar</span>${escapar(String(obj(pensar.depois).texto ?? ''))}</div>`
    : '';
  const linhas = eventos
    .filter((e) => e.tipo !== 'pensar')
    .slice(-9)
    .map((e) => {
      const ag = agenteDe(e);
      return `<div class="ev ag-${ag}"><div><div class="meta"><b>${NOME[ag]}</b><span>${horaLisboa(e.hora)}</span></div><div class="frase">${escapar(fraseDe(e))}</div></div></div>`;
    })
    .join('');

  const portas = portasDoCiclo(eventos);
  const pills = portas.length
    ? portas.map((x) => `<span class="porta p-${x.estado.replace(' ', '-')}">${x.porta} · ${x.estado.toUpperCase()}</span>`).join('')
    : '<span class="porta" style="color:var(--faint)">sem portas a fechar</span>';
  const migrou = p.passosMigrados > 0;
  const infra = `<div class="fluxo">
<div class="cartao"><h3>AWS (simulada)</h3><div class="sub">LocalStack · S3 · SQS · Postgres · Secrets Manager · ElastiCache</div></div>
<div class="seta ${migrou ? 'mig' : ''}"><b>↓</b>migrador · ${migrou ? `${p.passosMigrados} ${p.passosMigrados === 1 ? 'passo' : 'passos'} · checksums ${p.checksums ? '✓' : '✗'}` : 'à espera de aprovação'}</div>
<div class="cartao"><h3>Leaseweb Public Cloud</h3><div class="sub">MinIO · Postgres · RabbitMQ · OpenBao · Valkey · tudo na UE</div></div>
<div class="seta ${p.atacou ? 'atk' : ''}"><b>↓</b>atacante · nmap às nossas máquinas</div>
<div class="cartao vitima"><h3>VM vítima</h3><div class="sub">security group · 0.0.0.0/0 → regra removida pela API</div><div class="portas">${pills}</div></div></div>`;

  const sim = (v: boolean | undefined) => (v === true ? '<span class="ok">✓</span>' : v === false ? '<span class="bad">✗</span>' : '—');
  const nmap = (v: { porta: number; estado: string } | undefined) =>
    v ? `<span class="${v.estado === 'open' ? 'bad' : 'ok'}">${v.porta} ${escapar(v.estado)}</span>` : '—';
  const fecho = p.ultimoFecho;
  const pedidoFecho = fecho && pedidos.find((x) => x.id === fecho.pedidoId);
  const botao =
    token && fecho && (!pedidoFecho || pedidoFecho.estado === 'feito')
      ? `<form method="post" action="/desfazer"><input type="hidden" name="id" value="${escapar(fecho.pedidoId)}"><input type="hidden" name="token" value="${escapar(token)}"><button class="btn">Desfazer última ação</button></form>`
      : '';
  const provasHtml = `<div class="prova"><h3>Migração</h3>
<div class="kv"><span>Objetos copiados</span><span>${numero(p.objetos)}</span></div>
${p.linhas !== undefined ? `<div class="kv"><span>Linhas da base de dados</span><span>${numero(p.linhas)} em ${p.tabelas} tabelas</span></div>` : ''}
${p.mensagens !== undefined ? `<div class="kv"><span>Mensagens da fila</span><span>${numero(p.mensagens)}</span></div>` : ''}
${p.segredos !== undefined ? `<div class="kv"><span>Segredos (só a contagem)</span><span>${numero(p.segredos)}</span></div>` : ''}
${p.chaves !== undefined ? `<div class="kv"><span>Chaves da cache</span><span>${numero(p.chaves)}</span></div>` : ''}
<div class="kv"><span>Checksums</span><span>${p.checksums === undefined ? '—' : p.checksums ? '<span class="ok">iguais ✓</span>' : '<span class="bad">diferentes ✗</span>'}</span></div>
<div class="kv"><span>Testes antes / depois</span><span>${sim(p.testesAntes)} / ${sim(p.testesDepois)}</span></div></div>
<div class="prova"><h3>Defesa</h3>
<div class="kv"><span>nmap antes</span><span>${nmap(p.nmapAntes)}</span></div>
<div class="kv"><span>nmap depois</span><span>${nmap(p.nmapDepois)}</span></div>
<div class="kv"><span>Aprovado por</span><span>${escapar(fecho ? aprovadoPor(eventos, fecho.pedidoId) : '—')}</span></div>
<div class="kv"><span>Inverso guardado</span><span>${fecho ? '<span class="ok">criar_regra ✓</span>' : '—'}</span></div></div>
<div class="espaco"></div>${botao}<div class="nota">Tudo vem de auditoria.jsonl e estado.json</div>`;

  return `${cabecalho('Migrar sem ficar exposto', CSS + CSS_TERMINAL)}
<div class="topo"><div class="marca"><div class="kicker">InfraHack · Leaseweb · ao vivo</div><h1>Migrar sem ficar exposto</h1></div>${relogio}</div>
<div class="corpo">
<section><div class="cab"><span>AGENTES · GRUPO DIREÇÃO</span><span>Telegram</span></div>${agora}<div class="eventos">${linhas || '<div class="frase" style="color:var(--faint)">Ainda sem eventos.</div>'}</div></section>
<section><div class="cab"><span>INFRAESTRUTURA</span><span>região UE</span></div>${infra}
<div class="cab"><span>TERMINAL</span><span>reconstruído da auditoria</span></div>${renderizarTerminal(eventos)}</section>
<section><div class="cab"><span>PROVAS</span></div>${provasHtml}</section></div>
<script>
const r=document.querySelector('.relogio[data-inicio]');
if(r){const i=Date.parse(r.dataset.inicio),f=r.dataset.fim?Date.parse(r.dataset.fim):0,seg=r.querySelector('.seg');
 if(!f)setInterval(()=>{seg.textContent=Math.round((Date.now()-i)/1000)+' s'},500);
 const q='/isco?json&desde='+encodeURIComponent(r.dataset.inicio)+(f?'&ate='+encodeURIComponent(r.dataset.fim):'');
 fetch(q).then(x=>x.ok?x.json():null).then(c=>{if(c)r.querySelector('.isco').textContent='neste tempo o isco recebeu '+c.tentativas+' tentativas'}).catch(()=>{});}
let ultimo='';
setInterval(async()=>{try{const x=await fetch('/estado.json',{cache:'no-store'});const t=await x.text();if(ultimo&&t!==ultimo)location.reload();ultimo=t}catch{}},2000);
</script></body></html>`;
}

export async function paginaLinhaTempo(req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(renderizar(estado.listarPedidos(), auditoria.ler(), process.env.PAINEL_TOKEN ?? ''));
}

export async function estadoJson(req: IncomingMessage, res: ServerResponse): Promise<void> {
  res
    .writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    .end(JSON.stringify({ pedidos: estado.listarPedidos(), eventos: auditoria.ler() }));
}
