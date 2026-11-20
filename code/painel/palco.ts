// GET /palco: o ecrã para o júri (projetor, lido do fundo da sala, em inglês como o pitch).
// Uma pergunta por zona: em que fase estamos? o que está em risco? quanto tempo exposto? está provado?
// Os mesmos dados que o "/" (auditoria + estado); só muda o que se mostra e como. O "/" fica para os ensaios.
// Só números medidos; o que não se mediu mostra "—".
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { EventoAuditoria, Pedido } from '@mwbe/shared';
import { auditoria, carregarEnv, estado } from '@mwbe/shared';
import { relogioExposicao } from '@mwbe/chefe';
import QRCode from 'qrcode';
import { cabecalho, escapar } from './estilo';
import { agenteDe, cicloAtual, portasDoCiclo, provas, type Agente } from './linha-tempo';
import { linhasTerminal } from './terminal';

export const FASES_PALCO = ['migrate', 'attack', 'approve', 'close'] as const;
export type FasePalco = (typeof FASES_PALCO)[number];

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});
const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString('en-US') : '—');
const hora = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-GB', { timeZone: 'Europe/Lisbon' });
};

/** Destino escolhido (último decisao-destino do ciclo): o dono escolheu, ou o recomendado por omissão. */
export function destinoEscolhido(eventos: EventoAuditoria[]): { modo: 'recomendado' | 'tudo-self-hosted'; peloDono: boolean } | undefined {
  const e = eventos.findLast((x) => x.tipo === 'decisao-destino');
  if (!e) return undefined;
  const d = obj(e.depois);
  return { modo: d.modo === 'tudo-self-hosted' ? 'tudo-self-hosted' : 'recomendado', peloDono: e.quem === 'dono' };
}

export interface EstadoPalco {
  /** Fase em curso; undefined antes de começar. `concluido` = a porta fechou e tudo acabou. */
  fase?: FasePalco;
  concluido: boolean;
  porta?: { numero: number; servico: string; alvo: string; estado: 'open' | 'closing' | 'closed' | 'reopened' };
  /** Pedido da defesa à espera de uma pessoa (mostra a faixa "waiting for approval"). */
  aEsperar?: { titulo: string; texto: string };
  /** O último texto da IA para o dono (pedido da defesa), mesmo depois de aprovado. */
  textoIa?: string;
  aprovadoPorPessoa?: boolean;
}

/** Função pura: o estado do ecrã a partir do ciclo atual da auditoria e dos pedidos em memória. */
export function estadoPalco(eventos: EventoAuditoria[], pedidos: Pedido[]): EstadoPalco {
  const pedidosDefesa = eventos.filter((e) => e.tipo === 'pedido' && e.quem === 'defesa');
  const ultimoPedido = pedidosDefesa.at(-1);
  const decidido = (id: string) => eventos.some((e) => e.pedidoId === id && (e.tipo === 'aprovado' || e.tipo === 'ignorado'));
  const portas = portasDoCiclo(eventos);
  const p = portas.at(-1);
  const recon = eventos.findLast((e) => e.tipo === 'reconhecimento');
  const vista = (obj(recon?.depois).portas as { alvo: string; porta: number; servico: string | null }[] | undefined)?.find((x) => x.porta !== 22);

  const mapa = { aberta: 'open', 'a fechar': 'closing', fechada: 'closed', reaberta: 'reopened' } as const;
  const porta = p
    ? { numero: p.porta, servico: p.servico ?? 'service', alvo: p.alvo, estado: mapa[p.estado] }
    : vista
      ? { numero: vista.porta, servico: vista.servico ?? 'service', alvo: vista.alvo, estado: 'open' as const }
      : undefined;

  let fase: FasePalco | undefined;
  if (portas.some((x) => x.estado === 'a fechar' || x.estado === 'fechada')) fase = 'close';
  else if (ultimoPedido) fase = 'approve';
  else if (recon || eventos.some((e) => e.tipo === 'infra-no-ar')) fase = 'attack';
  else if (eventos.some((e) => e.quem === 'migrador')) fase = 'migrate';

  const pendente = ultimoPedido && !decidido(ultimoPedido.pedidoId) ? ultimoPedido : undefined;
  const d = obj(ultimoPedido?.depois);
  const textoIa = String(d.texto ?? pedidos.find((x) => x.id === ultimoPedido?.pedidoId)?.texto ?? '') || undefined;
  const aprovacao = ultimoPedido && eventos.findLast((e) => e.pedidoId === ultimoPedido.pedidoId && e.tipo === 'aprovado');

  return {
    fase,
    concluido: p?.estado === 'fechada',
    porta,
    aEsperar: pendente ? { titulo: String(d.titulo ?? ''), texto: textoIa ?? '' } : undefined,
    textoIa,
    aprovadoPorPessoa: aprovacao ? aprovacao.quem !== 'modo-noite' : undefined,
  };
}

/** Frase curta em inglês para o feed dos agentes (os textos do Telegram ficam em português, para o dono). */
export function fraseIngles(e: EventoAuditoria): string | undefined {
  const d = obj(e.depois);
  switch (e.tipo) {
    case 'pedido':
      if (e.quem === 'migrador' && Array.isArray(d.servicos)) return `Found ${d.servicos.length} AWS services. Proposed a migration plan.`;
      if (e.quem === 'defesa') return 'Explained the risk. Asking to close it.';
      return undefined;
    case 'aprovado':
      if (e.quem === 'migrador') return undefined;
      return e.quem === 'modo-noite' ? 'No answer: night mode applied a temporary fix.' : 'Approved in Telegram.';
    case 'ignorado':
      return 'Declined in Telegram.';
    case 'feito':
      if (e.quem === 'migrador' && d.objetos !== undefined) return `${n(d.objetos)} files copied. Checksums match.`;
      if (e.quem === 'migrador' && d.tabelas !== undefined) return `Database: ${n(d.linhas)} rows in ${d.tabelas} tables. Checksums match.`;
      if (e.quem === 'migrador' && d.mensagens !== undefined) return `Queue: ${n(d.mensagens)} messages moved to RabbitMQ.`;
      if (e.quem === 'migrador' && d.segredos !== undefined) return `Secrets: ${n(d.segredos)} moved to OpenBao (values never shown).`;
      if (e.quem === 'migrador' && d.chaves !== undefined) return `Cache: ${n(d.chaves)} keys moved to Valkey.`;
      if (e.quem === 'migrador' && d.numero !== undefined) return `Code change merged (PR #${d.numero}).`;
      if (e.inverso?.tipo === 'criar_regra') return 'Closed and confirmed. Undo saved.';
      return undefined;
    case 'decisao-destino':
      if (d.porOmissao) return undefined;
      return d.modo === 'tudo-self-hosted'
        ? 'Chose everything self-hosted on the VM, no managed services.'
        : 'Chose the recommended plan: Leaseweb managed where it makes sense (simulated).';
    case 'infra-no-ar':
      return 'New infrastructure is live.';
    case 'reconhecimento': {
      const portas = ((d.portas as { porta: number; servico: string | null }[]) ?? []).filter((p) => p.porta !== 22);
      return portas.length ? `Open to the whole internet: ${portas.map((p) => `${p.servico ?? 'port'} ${p.porta}`).join(', ')}.` : 'Nothing open to the internet.';
    }
    case 'verificado':
      return d.fase === 'depois' ? `Checked from outside: port ${d.porta} ${d.estado}.` : undefined;
    case 'desfeito':
      return 'Undone: the rule is back.';
    case 'falhou':
    case 'erro':
      return 'A step failed. The demo carries on; nothing changed without confirmation.';
    default:
      return undefined;
  }
}

/** O terminal em inglês: os comandos já o são; traduz só as saídas que escrevemos em português. */
const SAIDAS: [RegExp, string][] = [
  [/objetos copiados/, 'objects copied'],
  [/(\d+) tabelas · /, '$1 tables · '],
  [/ linhas/, ' rows'],
  [/ mensagens/, ' messages'],
  [/ segredos \(valores nunca mostrados\)/, ' secrets (values never shown)'],
  [/ chaves/, ' keys'],
  [/testes da app: antes (.) · depois (.)/, 'app tests: before $1 · after $2'],
  [/sha256 DIFERENTE/, 'sha256 MISMATCH'],
  [/✓ regra removida · confirmado de fora \(nmap\) · inverso guardado/, '✓ rule removed · confirmed from outside · undo saved'],
  [/✓ regra removida · confirmado pela API · inverso guardado/, '✓ rule removed · confirmed by API · undo saved'],
  [/nenhuma porta aberta/, 'no open ports'],
  [/regra reposta/, 'rule restored'],
  [/regra temporária/, 'temporary rule'],
  [/serviços AWS: (.*)/, 'AWS services: $1'],
  [/plano gerado \(nada criado ainda\)/, 'plan generated (nothing created yet)'],
  [/ficheiro\(s\) alterados · testes/, 'file(s) changed · tests'],
  [/^concluído$/, 'done'],
];
const COMANDOS: [RegExp, string][] = [
  [/^migrar código → leaseweb/, 'migrate code → leaseweb'],
  [/^migrar /, 'migrate '],
  [/^analisar /, 'analyse '],
  [/^traduzir terraform aws/, 'translate terraform aws'],
];
const SERVICOS: Record<string, string> = { s3: 'S3', postgres: 'Postgres', fila: 'SQS', segredos: 'Secrets Manager', cache: 'ElastiCache' };
const comandoIngles = (c: string) => COMANDOS.reduce((s, [de, para]) => s.replace(de, para), c);
const emIngles = (t: string) =>
  SAIDAS.reduce((s, [de, para]) => s.replace(de, para), t)
    .replace(/(\d)\.(\d{3})/g, '$1,$2')
    .replace(/^(AWS services: )(.*)$/, (_m, a: string, l: string) => a + l.split(', ').map((x) => SERVICOS[x] ?? x).join(', '));

const COR: Record<Agente, string> = { migrador: 'mig', atacante: 'atk', defesa: 'def', chefe: 'chf', dono: 'ink' };
const NOME: Record<Agente, string> = { migrador: 'MIGRATOR', atacante: 'ATTACKER', defesa: 'DEFENCE', chefe: 'CHIEF', dono: 'OWNER' };

const CSS = `body{height:100vh;padding:32px 40px;display:grid;gap:18px;overflow:hidden;
grid-template-rows:auto auto auto auto 1fr auto;font-size:20px}
.fases{display:flex;gap:10px;align-items:center;font:600 18px var(--mono);letter-spacing:2px;color:var(--faint)}
.fases .f{padding:10px 18px;border-radius:999px;border:1px solid var(--line)}.fases .feita{color:var(--def);border-color:#7DD3A855}
.fases .agora{color:var(--bg);background:var(--ink);border-color:var(--ink)}.fases .seta{color:var(--line)}
.fases .titulo{margin-left:auto;font:400 34px var(--serif);letter-spacing:0;color:var(--ink)}
.heroi{display:grid;grid-template-columns:1.5fr 1fr;gap:18px}
.cartao{background:var(--panel);border-radius:20px;padding:26px 32px}
.porta .rot{font:16px var(--mono);letter-spacing:2px;color:var(--muted)}
.porta .estado{display:flex;align-items:center;gap:18px;font:400 64px/1.05 var(--serif);margin:8px 0}
.porta .estado:before{content:'';width:28px;height:28px;border-radius:50%;background:currentColor;flex:none}
.e-open,.e-reopened{color:var(--atk)}.e-closing{color:#F5B942}.e-closed{color:var(--def)}.e-wait{color:var(--faint)}
.porta .onde{color:var(--muted);font-size:18px}.tag{display:inline-block;font:13px var(--mono);letter-spacing:1px;padding:3px 10px;border-radius:999px;margin-left:8px;vertical-align:middle}
.real{color:var(--def);border:1px solid #7DD3A866}.sim{color:var(--muted);border:1px solid var(--line)}
.relogio .rot{font:16px var(--mono);letter-spacing:2px;color:var(--muted)}.relogio .seg{font:400 120px/1 var(--serif);color:var(--atk)}
.relogio.fechada .seg{color:var(--def)}.relogio.parado .seg{color:var(--faint);font-size:34px;line-height:1.2;margin-top:10px}.relogio .isco{color:var(--muted);font-size:18px}
.ia{display:grid;grid-template-columns:1fr auto;gap:24px;align-items:center}.ia .quem{font:700 15px var(--mono);letter-spacing:2px;color:var(--def)}
.ia blockquote{margin:8px 0;font-size:22px;line-height:1.4;color:var(--ink);font-style:italic}
.ia .regra{font:15px var(--mono);color:var(--muted)}.ia .regra b{color:var(--ink);font-weight:400}
.espera{border:2px solid #F5B942;animation:pulsa 1.6s ease-in-out infinite}.espera .aviso{font:600 22px var(--sans);color:#F5B942;margin-top:10px}
@keyframes pulsa{50%{border-color:#F5B94233}}
.qr{background:#fff;border-radius:12px;padding:10px;width:150px}.qr svg{display:block;width:100%;height:auto}.qr+small{display:block;text-align:center;color:var(--muted);font-size:14px;margin-top:6px}
.kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:14px}
.kpi{background:var(--panel);border-radius:16px;padding:16px 20px}.kpi .v{font:400 44px/1 var(--serif)}.kpi .v.ok{color:var(--def)}.kpi .v.mau{color:var(--atk)}.kpi .v.nd{color:var(--faint)}
.kpi .l{font-size:16px;color:var(--muted);margin-top:6px}
.baixo{display:grid;grid-template-columns:1fr 1.15fr;gap:18px;min-height:0}
.feed,.term{background:var(--panel);border-radius:16px;padding:18px 22px;overflow:hidden;display:flex;flex-direction:column;justify-content:flex-end;gap:10px}
.feed .ev{display:flex;gap:12px;font-size:19px}.feed .ev b{font:700 14px var(--mono);letter-spacing:1px;min-width:7.5em;padding-top:4px}
.mig{color:var(--mig)}.atk{color:var(--atk)}.def{color:var(--def)}.chf{color:var(--chf)}.ink{color:var(--ink)}
.term{background:#07100E;border:1px solid var(--line);font:16px/1.45 var(--mono);gap:2px}.term .c{color:var(--ink)}.term .c i{font-style:normal}
.term .o{color:var(--muted);padding-left:1.6em}.term .ok{color:var(--ok)}.term .mau{color:var(--bad)}
.rodape{display:flex;gap:28px;justify-content:center;font:15px var(--mono);color:var(--faint);letter-spacing:1px}
.rodape b{color:var(--muted);font-weight:400}`;

async function qrSvg(): Promise<string> {
  const url = process.env.TELEGRAM_CONVITE_URL?.trim();
  if (!url || !/^https:\/\/t\.me\//.test(url)) return '';
  return QRCode.toString(url, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' });
}

export function renderizarPalco(pedidos: Pedido[], todos: EventoAuditoria[], opcoes: { qr?: string; local?: string } = {}): string {
  const eventos = cicloAtual(todos);
  const s = estadoPalco(eventos, pedidos);
  const p = provas(eventos);
  const exp = relogioExposicao(todos);

  // 1. Fases.
  const iFase = s.fase ? FASES_PALCO.indexOf(s.fase) : -1;
  const fases = FASES_PALCO.map((f, i) => {
    const classe = s.concluido || i < iFase ? 'feita' : i === iFase ? 'agora' : '';
    return `<span class="f ${classe}">${i + 1} ${f.toUpperCase()}${classe === 'feita' ? ' ✓' : ''}</span>`;
  }).join('<span class="seta">──</span>');

  // Destino escolhido pelo dono (ou o recomendado por omissão). Os geridos da Leaseweb são simulados.
  const dest = destinoEscolhido(eventos);
  const quem = dest ? (dest.peloDono ? 'owner\'s choice' : 'recommended by default') : '';
  const destinoTexto = !dest
    ? 'Leaseweb<span class="tag real">REAL</span>'
    : dest.modo === 'tudo-self-hosted'
      ? `everything self-hosted on the VM<span class="tag real">REAL</span> <span style="color:var(--faint)">(${quem})</span>`
      : `Leaseweb, managed where it makes sense<span class="tag sim">MANAGED: SIMULATED</span> <span style="color:var(--faint)">(${quem})</span>`;

  // 2. Protagonista: a porta.
  const textoEstado = { open: 'OPEN TO THE INTERNET', closing: 'CLOSING…', closed: 'CLOSED', reopened: 'REOPENED (undo)' } as const;
  const porta = s.porta
    ? `<div class="rot">${escapar(s.porta.servico.toUpperCase())} · PORT ${s.porta.numero}</div>
<div class="estado e-${s.porta.estado}">${textoEstado[s.porta.estado]}</div>
<div class="onde">victim VM ${escapar(s.porta.alvo)} · ${escapar(opcoes.local || 'Leaseweb Public Cloud')}<span class="tag real">REAL</span></div>`
    : `<div class="rot">NEW INFRASTRUCTURE</div><div class="estado e-wait">${s.fase === 'migrate' ? 'MIGRATING…' : 'NOT STARTED'}</div>
<div class="onde">from AWS<span class="tag sim">SIMULATED</span> to ${destinoTexto}</div>`;

  // 3. Relógio de exposição (a conta é do chefe).
  const relogio = exp
    ? `<div class="cartao relogio ${exp.aindaExposta ? '' : 'fechada'}" data-inicio="${escapar(exp.inicio)}" data-fim="${escapar(exp.fim ?? '')}">
<div class="rot">${exp.aindaExposta ? 'EXPOSED FOR' : 'WAS EXPOSED FOR'}</div><div class="seg">${exp.segundos} s</div><div class="isco">&nbsp;</div></div>`
    : `<div class="cartao relogio parado"><div class="rot">EXPOSURE CLOCK</div><div class="seg">starts when the new infrastructure goes live</div></div>`;

  // 4. A IA e a pessoa.
  const qr = opcoes.qr ? `<div><div class="qr">${opcoes.qr}</div><small>jury: join &amp; approve</small></div>` : '';
  const ia = s.textoIa
    ? `<div class="cartao ia ${s.aEsperar ? 'espera' : ''}"><div><div class="quem">DEFENCE · AI EXPLANATION TO THE OWNER <span style="color:var(--faint);letter-spacing:0">(in Portuguese, plain words)</span></div>
<blockquote>“${escapar(s.textoIa)}”</blockquote>
<div class="regra">written by AI (text only) · action chosen by code from a closed list: <b>remove 1 firewall rule</b> · undo saved first</div>
${s.aEsperar ? '<div class="aviso">▶ Waiting for a human to approve in Telegram</div>' : s.aprovadoPorPessoa ? '<div class="regra" style="color:var(--def);margin-top:8px">✓ approved by a human</div>' : ''}</div>${s.aEsperar ? qr : ''}</div>`
    : `<div class="cartao ia"><div><div class="quem" style="color:var(--muted)">HOW IT WORKS</div>
<div class="regra" style="font-size:19px;margin-top:8px">4 agents in a Telegram group · AI only writes text · every action needs a human tap · every change has an undo</div></div>${qr}</div>`;

  // 5. Provas em números.
  const kpi = (v: string, l: string, tom: 'ok' | 'mau' | 'nd' | '' = '') => `<div class="kpi"><div class="v ${tom}">${v}</div><div class="l">${l}</div></div>`;
  const tick = (b: boolean | undefined) => (b === undefined ? ['—', 'nd'] : b ? ['✓', 'ok'] : ['✗', 'mau']) as [string, 'ok' | 'mau' | 'nd'];
  const [tA, cA] = tick(p.testesAntes);
  const [tD, cD] = tick(p.testesDepois);
  const kpis = [
    kpi(p.objetos !== undefined ? `${n(p.objetos)} ${p.checksums ? '✓' : '✗'}` : '—', 'files copied · sha256 match', p.objetos === undefined ? 'nd' : p.checksums ? 'ok' : 'mau'),
    kpi(p.linhas !== undefined ? `${n(p.linhas)} ✓` : '—', 'database rows · sha256 match', p.linhas === undefined ? 'nd' : 'ok'),
    kpi(`${tA} / ${tD}`, 'app tests before / after', cA === 'mau' || cD === 'mau' ? 'mau' : cA === 'nd' ? 'nd' : 'ok'),
    (() => {
      // nmap da defesa (antes/depois); sem ele, o que o atacante viu de fora.
      const v = p.nmapDepois?.estado ?? p.nmapAntes?.estado ?? (s.porta && s.porta.estado === 'open' ? 'open' : undefined);
      return kpi(v ? escapar(v) : '—', `port ${s.porta?.numero ?? ''} seen from outside`.replace('  ', ' '), v ? (v === 'open' ? 'mau' : 'ok') : 'nd');
    })(),
    kpi(p.ultimoFecho ? 'ready ✓' : '—', 'undo (inverse saved)', p.ultimoFecho ? 'ok' : 'nd'),
  ].join('');

  // 6. Feed dos agentes (4 últimos) e terminal (5 últimas entradas).
  const feed = eventos
    .map((e) => ({ e, f: fraseIngles(e) }))
    .filter((x): x is { e: EventoAuditoria; f: string } => Boolean(x.f))
    .slice(-7)
    .map(({ e, f }) => {
      const a = agenteDe(e);
      return `<div class="ev"><b class="${COR[a]}">${NOME[a]}</b><span>${escapar(f)}</span></div>`;
    })
    .join('');
  const term = linhasTerminal(eventos)
    .slice(-9)
    .map(
      (l) =>
        (l.comando ? `<div class="c"><i class="${COR[l.agente]}">${l.agente === 'migrador' ? 'migrator' : l.agente === 'atacante' ? 'attacker' : l.agente === 'defesa' ? 'defence' : 'chief'}$</i> ${escapar(comandoIngles(l.comando))}</div>` : '') +
        l.saida
          .filter((o) => !o.texto.startsWith('#'))
          .map((o) => `<div class="o ${o.tom ?? ''}">${escapar(emIngles(o.texto))}</div>`)
          .join(''),
    )
    .join('');

  return `${cabecalho('Migrate without being exposed', CSS).replace('<html lang="pt">', '<html lang="en">')}
<div class="fases">${fases}<span class="titulo">Migrate without being exposed</span></div>
<div class="heroi"><div class="cartao porta">${porta}</div>${relogio}</div>
${ia}
<div class="kpis">${kpis}</div>
<div class="baixo"><div class="feed">${feed || '<div class="ev" style="color:var(--faint)">Agents are waiting.</div>'}</div>
<div class="term">${term || '<div class="o">$ _</div>'}</div></div>
<div class="rodape"><span>AWS side <b>simulated</b></span><span>everything on Leaseweb is <b>real</b></span><span>AI only <b>writes text</b></span><span>a human <b>approves</b></span><span>every change has an <b>undo</b></span></div>
<script>
const r=document.querySelector('.relogio[data-inicio]');
if(r){const i=Date.parse(r.dataset.inicio),f=r.dataset.fim?Date.parse(r.dataset.fim):0,seg=r.querySelector('.seg');
 if(!f)setInterval(()=>{seg.textContent=Math.round((Date.now()-i)/1000)+' s'},500);
 const q='/isco?json&desde='+encodeURIComponent(r.dataset.inicio)+(f?'&ate='+encodeURIComponent(r.dataset.fim):'');
 fetch(q).then(x=>x.ok?x.json():null).then(c=>{if(c)r.querySelector('.isco').textContent='meanwhile our honeypot got '+c.tentativas+' login attempts'}).catch(()=>{});}
let ultimo='';
setInterval(async()=>{try{const x=await fetch('/estado.json',{cache:'no-store'});const t=await x.text();if(ultimo&&t!==ultimo)location.reload();ultimo=t}catch{}},1500);
</script></body></html>`;
}

export async function paginaPalco(req: IncomingMessage, res: ServerResponse): Promise<void> {
  carregarEnv();
  const html = renderizarPalco(estado.listarPedidos(), auditoria.ler(), { qr: await qrSvg(), local: process.env.LOCAL_DADOS || undefined });
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html);
}
