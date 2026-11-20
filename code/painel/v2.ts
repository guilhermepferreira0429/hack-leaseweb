// Ecrã da demo v2 (desenho "Demo screen v2", "Live logs · Code agent" e "Web: download report" em
// docs/material/design/web.pen). Em inglês: a demo é em inglês. Três colunas, tudo tirado da auditoria do ciclo:
//   1. Agent chain: os passos dos agentes, a linha "thinking now" (último evento 'pensar') e o passo ativo.
//   2. Services: um cartão por passo da migração (DONE / MIGRATING / QUEUED / FAILED) e a VM vítima.
//   3. Live logs: a auditoria como log; a variante Code quando o último passo é o migrador de código.
// Nada inventado: o que não está na auditoria não aparece (sem barras de progresso falsas nem contagens antecipadas).
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { EventoAuditoria, Pedido, Regra } from '@mwbe/shared';
import { auditoria, carregarEnv, estado } from '@mwbe/shared';
import { nomeRelatorioPdf, relatorioPdf, relogioExposicao } from '@mwbe/chefe';
import { cabecalho, escapar } from './estilo';
import { agenteDe, cicloAtual, portasDoCiclo, provas } from './linha-tempo';
import { fraseIngles } from './palco';

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});
const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString('en-US') : '—');
const hora = (iso: string | Date) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-GB', { timeZone: 'Europe/Lisbon' });
};

/** Quem fala na cadeia. 'codigo' é o migrador de código (cor própria no desenho). */
export type AgenteV2 = 'migrador' | 'atacante' | 'defesa' | 'chefe' | 'dono' | 'codigo';
const NOME: Record<AgenteV2, string> = { migrador: 'MIGRATOR', atacante: 'ATTACKER', defesa: 'DEFENSE', chefe: 'CHIEF', dono: 'OWNER', codigo: 'CODE' };
const COR: Record<AgenteV2, string> = { migrador: 'mig', atacante: 'atk', defesa: 'def', chefe: 'chf', dono: 'ink', codigo: 'code' };

export function agenteV2(e: EventoAuditoria): AgenteV2 {
  const d = obj(e.depois);
  if (e.tipo === 'migracao-codigo' || (e.quem === 'migrador' && d.numero !== undefined)) return 'codigo';
  if (e.tipo === 'pensar' && (e.quem === 'migrador' || e.quem === 'atacante' || e.quem === 'defesa' || e.quem === 'chefe')) return e.quem;
  return agenteDe(e);
}

// ---------- coluna 1: cadeia dos agentes ----------

const TIPOS_PASSO = new Set(['pedido', 'aprovado', 'ignorado', 'feito', 'erro', 'falhou', 'reconhecimento', 'migracao-codigo', 'confirmacao-atacante', 'infra-no-ar', 'desfeito']);

export interface PassoCadeia {
  hora: string;
  agente: AgenteV2;
  mensagem: string;
  /** O texto do último 'pensar' deste agente antes do passo. */
  pensar?: string;
  /** Rótulo do botão (só mostra o que a pessoa carregou no Telegram; não é clicável aqui). */
  botao?: string;
  resultado?: { texto: string; ok: boolean };
}

function mensagemPasso(e: EventoAuditoria): string | undefined {
  const d = obj(e.depois);
  if (e.tipo === 'pedido' && e.quem === 'migrador' && Array.isArray(d.passos)) return `Migration plan for ${d.passos.length} AWS services, waiting for the owner.`;
  if (e.tipo === 'pedido' && e.quem === 'migrador') return undefined; // passos do plano: já aprovados com ele
  if (e.tipo === 'aprovado' && e.quem === 'migrador') return undefined;
  if (e.tipo === 'migracao-codigo') {
    const f = Array.isArray(d.ficheiros) ? d.ficheiros.length : 0;
    return d.url ? `PR opened: ${f} file(s), tests passing.` : f ? `Code change ready: ${f} file(s)${d.simulado ? ' (dry run)' : ''}.` : 'Nothing to change in the code.';
  }
  if (e.tipo === 'confirmacao-atacante') return d.chega ? 'Re-scan: the port still answers.' : 'Re-scan: the port no longer answers.';
  if (e.tipo === 'feito' && e.quem === 'migrador' && d.passo !== undefined && fraseIngles(e) === undefined) return `${String(d.passo)} migrated.`;
  return fraseIngles(e);
}

/** Os passos da cadeia, por ordem, com o resultado de cada pedido quando já se sabe. */
export function cadeia(eventos: EventoAuditoria[]): PassoCadeia[] {
  const passos: PassoCadeia[] = [];
  const pensarPendente = new Map<AgenteV2, string>();
  for (const e of eventos) {
    const ag = agenteV2(e);
    if (e.tipo === 'pensar') {
      pensarPendente.set(ag, String(obj(e.depois).texto ?? ''));
      continue;
    }
    if (!TIPOS_PASSO.has(e.tipo)) continue;
    // A decisão do dono aparece no próprio pedido (resultado), não numa linha à parte.
    if ((e.tipo === 'aprovado' || e.tipo === 'ignorado') && eventos.some((x) => x.tipo === 'pedido' && x.pedidoId === e.pedidoId)) continue;
    const mensagem = mensagemPasso(e);
    if (!mensagem) continue;
    const p: PassoCadeia = { hora: e.hora, agente: ag, mensagem, pensar: pensarPendente.get(ag) };
    pensarPendente.delete(ag);
    if (e.tipo === 'pedido') {
      const d = obj(e.depois);
      const plano = e.quem === 'migrador';
      p.botao = plano ? 'Approve plan' : 'Close';
      const decisao = eventos.find((x) => x.pedidoId === e.pedidoId && (x.tipo === 'aprovado' || x.tipo === 'ignorado') && x.hora >= e.hora);
      const fecho = eventos.find((x) => x.pedidoId === e.pedidoId && x.tipo === 'feito' && x.inverso?.tipo === 'criar_regra');
      const depois = eventos.findLast((x) => x.pedidoId === e.pedidoId && x.tipo === 'verificado' && obj(x.depois).fase === 'depois');
      if (fecho) {
        const v = obj(depois?.depois);
        p.resultado = { texto: `✓ Closed ${hora(fecho.hora)}${depois ? ` · verified from outside: ${String(v.estado)} ${v.estado === 'open' ? '✗' : '✓'}` : ''}`, ok: !depois || v.estado !== 'open' };
      } else if (decisao?.tipo === 'ignorado') p.resultado = { texto: 'Declined by owner', ok: false };
      else if (decisao) p.resultado = { texto: `✓ Approved by ${decisao.quem === 'modo-noite' ? 'night mode' : 'owner'} ${hora(decisao.hora).slice(0, 5)}`, ok: true };
      else p.resultado = { texto: 'waiting for the owner in Telegram…', ok: false };
      if (!plano && d.titulo) p.mensagem = `${String(d.titulo)}. Proposes to close it, inverse stored.`;
    }
    if (e.tipo === 'migracao-codigo' && obj(e.depois).url) p.botao = 'Approve PR';
    passos.push(p);
  }
  return passos;
}

// ---------- coluna 2: serviços ----------

export type PassoMigracao = 's3' | 'postgres' | 'fila' | 'segredos' | 'cache';
const SERVICO: Record<PassoMigracao, [string, string]> = {
  s3: ['S3', 'MinIO'],
  postgres: ['RDS PostgreSQL', 'PostgreSQL'],
  fila: ['SQS', 'RabbitMQ'],
  segredos: ['Secrets Manager', 'OpenBao'],
  cache: ['ElastiCache', 'Valkey'],
};
const ORDEM: PassoMigracao[] = ['s3', 'postgres', 'fila', 'segredos', 'cache'];

export interface CartaoServico {
  passo: PassoMigracao;
  estado: 'done' | 'migrating' | 'queued' | 'failed';
  /** Prova medida (só quando 'done'). */
  prova?: string;
  checksumOk?: boolean;
}

function provaDe(passo: PassoMigracao, d: Obj): string {
  const sha = d.checksumsOk === false ? 'sha256 ✗' : 'sha256 ✓';
  switch (passo) {
    case 's3':
      return `${n(d.objetos)} files · ${sha}`;
    case 'postgres':
      return `${n(d.linhas)} rows · ${n(d.tabelas)} tables · ${sha}`;
    case 'fila':
      return `${n(d.mensagens)} messages · ${sha}`;
    case 'segredos':
      return `${n(d.segredos)} secrets · values never shown · ${sha}`;
    case 'cache':
      return `${n(d.chaves)} keys · ${sha}`;
  }
}

/** Um cartão por passo do plano (ou por passo visto na auditoria, se o plano não estiver no ciclo). */
export function servicos(eventos: EventoAuditoria[]): CartaoServico[] {
  const migr = eventos.filter((e) => e.quem === 'migrador');
  const plano = migr.findLast((e) => e.tipo === 'pedido' && Array.isArray(obj(e.depois).passos));
  const doPlano = (obj(plano?.depois).passos as string[] | undefined)?.filter((p): p is PassoMigracao => p in SERVICO);
  const vistos = ORDEM.filter((p) => migr.some((e) => obj(e.depois).passo === p));
  const lista = doPlano?.length ? doPlano : vistos;
  const planoAprovado = plano ? eventos.some((e) => e.pedidoId === plano.pedidoId && e.tipo === 'aprovado') : vistos.length > 0;
  // Quem já começou: o 1.º passo com o plano aprovado; os outros quando nasce o pedido deles.
  const comecou = (p: PassoMigracao, i: number) => (i === 0 ? planoAprovado : migr.some((e) => e.tipo === 'pedido' && obj(e.depois).passo === p));
  return lista.map((passo, i) => {
    const feito = migr.findLast((e) => e.tipo === 'feito' && obj(e.depois).passo === passo);
    if (feito) {
      const d = obj(feito.depois);
      return { passo, estado: 'done', prova: provaDe(passo, d), checksumOk: d.checksumsOk !== false };
    }
    if (migr.some((e) => e.tipo === 'erro' && obj(e.depois).passo === passo)) return { passo, estado: 'failed' };
    return { passo, estado: comecou(passo, i) ? 'migrating' : 'queued' };
  });
}

// ---------- coluna 3: logs ----------

export interface LinhaLog {
  hora: string;
  agente: AgenteV2;
  texto: string;
  tom?: 'ok' | 'mau';
}

const ROTULO: Record<AgenteV2, string> = { migrador: 'migrator', atacante: 'attacker', defesa: 'defense', chefe: 'chief', dono: 'owner', codigo: 'code' };

/** Um evento da auditoria em linhas de log (inglês). Sem IPs nem valores de segredos. */
export function paraLog(e: EventoAuditoria): LinhaLog[] {
  const d = obj(e.depois);
  const ag = agenteV2(e);
  const l = (texto: string, tom?: 'ok' | 'mau'): LinhaLog => ({ hora: e.hora, agente: ag, texto: `[${ROTULO[ag]}] ${texto}`, tom });
  switch (e.tipo) {
    case 'pedido':
      if (e.quem === 'migrador' && Array.isArray(d.passos)) return [l(`plan: ${(d.passos as string[]).join(', ')} → leaseweb`)];
      if (e.quem === 'defesa') return [l(`asking the owner: ${String(d.titulo ?? '')}`)];
      return [];
    case 'aprovado':
      return e.quem === 'migrador' ? [] : [l(e.quem === 'modo-noite' ? 'no answer · night mode' : 'approved in Telegram', 'ok')];
    case 'ignorado':
      return [l('declined in Telegram', 'mau')];
    case 'feito': {
      if (e.quem === 'migrador' && d.numero !== undefined) return [l(`PR #${String(d.numero)} merged`, 'ok')];
      if (e.quem === 'migrador' && typeof d.passo === 'string' && d.passo in SERVICO) {
        const t = obj(d.testes);
        const linhas = [l(`${d.passo} ${provaDe(d.passo as PassoMigracao, d)}`, d.checksumsOk === false ? 'mau' : 'ok')];
        if (t.antes !== undefined) linhas.push(l(`tests before ${t.antes ? '✓' : '✗'} after ${t.depois ? '✓' : '✗'}`, t.antes && t.depois ? 'ok' : 'mau'));
        return linhas;
      }
      if (e.inverso?.tipo === 'criar_regra') {
        const via = (e as { confirmacao?: string }).confirmacao === 'de-fora' ? 'confirmed from outside' : 'confirmed by the API';
        return [l(`rule removed · ${via} · inverse stored ✓`, 'ok')];
      }
      return [];
    }
    case 'infra-no-ar':
      return [l('new infrastructure live · exposure clock running', 'mau')];
    case 'reconhecimento': {
      const portas = (d.portas as { porta: number; servico: string | null }[] | undefined) ?? [];
      return portas.length ? portas.map((p) => l(`tcp ${p.porta} open ${(p.servico ?? '').toLowerCase()}`.trim(), 'mau')) : [l('no open ports', 'ok')];
    }
    case 'verificado':
      return [l(`nmap :${String(d.porta)} ${String(d.estado)}${d.fase === 'depois' && d.estado !== 'open' ? ' ✓' : ''}`, d.estado === 'open' ? 'mau' : 'ok')];
    case 'a-aplicar': {
      const r = e.antes as Regra | undefined;
      return [l(`revoke ${r ? `${r.protocol} ${r.startPort} from ${r.source}` : 'rule'} · inverse stored first`)];
    }
    case 'modo-noite-permitir':
      return [l(`night mode: temporary rule for ${String(d.source ?? '?')}`)];
    case 'desfeito':
      return [l(e.quem === 'migrador' ? `PR #${String(d.numero)} reverted` : 'undo · rule restored')];
    case 'confirmacao-atacante':
      return [l(d.chega ? 're-scan: still reachable' : 're-scan: no longer answers ✓', d.chega ? 'mau' : 'ok')];
    case 'migracao-codigo': {
      const f = Array.isArray(d.ficheiros) ? d.ficheiros.length : 0;
      const linhas = [l(`scanning the app for AWS endpoints · ${f} file(s) to change`)];
      if (d.ramo) linhas.push(l(`branch ${String(d.ramo)}`));
      if (d.url) linhas.push(l(`PR opened on GitHub`, 'ok'));
      return linhas;
    }
    case 'falhou':
    case 'erro':
      return [l(`✗ ${String(d.passo ?? d.fase ?? e.tipo)} failed`, 'mau')];
    default:
      return [];
  }
}

export function logs(eventos: EventoAuditoria[]): LinhaLog[] {
  return eventos.flatMap(paraLog);
}

// ---------- HTML ----------

const CSS = `body{padding:40px 48px;height:100vh;display:flex;flex-direction:column;gap:22px;overflow:hidden}
:root{--code:#C4A7FF}
.topo{display:flex;justify-content:space-between;align-items:flex-end;gap:32px}
.marca h1{margin:8px 0 0;font:400 64px/1 var(--serif)}
.relogio{display:flex;flex-direction:column;gap:6px;align-items:flex-end}.relogio .valor{display:flex;gap:18px;align-items:center}
.seg{font:400 108px/1 var(--serif);color:var(--atk)}.fechada .seg{color:var(--def)}.espera .seg{font-size:40px;color:var(--faint)}
.pill{display:inline-flex;gap:8px;align-items:center;padding:6px 14px;border-radius:999px;font:17px var(--mono);color:var(--atk);background:#FF8A7A22}
.pill:before{content:'';width:10px;height:10px;border-radius:50%;background:currentColor}.fechada .pill{color:var(--def);background:#7DD3A822}
.isco{font-size:19px;color:var(--muted)}
.corpo{flex:1;display:grid;grid-template-columns:720px 1fr 500px;gap:24px;min-height:0}
section{background:var(--panel);border-radius:18px;padding:22px;display:flex;flex-direction:column;gap:12px;min-width:0;min-height:0;overflow:hidden}
.cab{display:flex;justify-content:space-between;font:15px var(--mono);letter-spacing:2px;color:var(--muted)}.cab span:last-child{color:var(--faint);letter-spacing:0}
.mig{--c:var(--mig)}.atk{--c:var(--atk)}.def{--c:var(--def)}.chf{--c:var(--chf)}.ink{--c:var(--ink)}.code{--c:var(--code)}
.agora{border:1px solid color-mix(in srgb,var(--c) 33%,transparent);background:color-mix(in srgb,var(--c) 8%,transparent);border-radius:14px;padding:14px 18px;display:flex;flex-direction:column;gap:6px}
.agora .q{display:flex;gap:10px;align-items:center;font:700 14px var(--mono);letter-spacing:1px;color:var(--c)}.agora .q:before{content:'';width:10px;height:10px;border-radius:50%;background:var(--c)}
.agora .t{font:400 27px/1.15 var(--serif)}
.passos{display:flex;flex-direction:column;justify-content:flex-end;flex:1;min-height:0;overflow:hidden}
.passo{display:flex;gap:14px}.trilho{width:14px;flex:none;display:flex;flex-direction:column;align-items:center;padding-top:5px}
.trilho i{width:12px;height:12px;border-radius:50%;background:var(--c)}.trilho b{flex:1;width:2px;background:#2C4A45;margin-top:2px}
.conteudo{flex:1;padding:0 0 10px;display:flex;flex-direction:column;gap:4px;min-width:0}
.ativo .trilho{padding-top:15px}.ativo .conteudo{background:color-mix(in srgb,var(--c) 6%,transparent);border:1px solid var(--c);border-radius:12px;padding:10px 16px 12px}
.meta{display:flex;gap:12px;align-items:baseline;font:14px var(--mono)}.meta b{color:var(--c);letter-spacing:1px}.meta span{color:var(--faint)}
.meta em{font:400 18px var(--serif);color:#7E958F;font-style:normal;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.msg{font-size:18px}.acoes{display:flex;gap:10px;align-items:center;font:14px var(--mono);padding-top:2px}
.botao{border:1px solid var(--c);color:var(--c);border-radius:8px;padding:1px 10px}.res.ok{color:var(--ok)}.res.mau{color:var(--muted)}
.cartoes{display:flex;flex-direction:column;gap:10px}
.srv{background:var(--bg);border:1px solid var(--line);border-radius:14px;padding:12px 16px;display:flex;flex-direction:column;gap:8px}
.srv .linha{display:flex;justify-content:space-between;align-items:center;font-size:21px}.srv .nome{display:flex;gap:10px}.srv .nome b{font-weight:600}.srv .nome i{font-style:normal;color:var(--faint)}
.srv .det{display:flex;justify-content:space-between;align-items:baseline;gap:12px;font:15px var(--mono)}.srv .det small{font-size:13px;color:var(--faint);white-space:nowrap;flex:none}
.est{display:inline-flex;gap:6px;align-items:center;padding:4px 12px;border-radius:999px;font:14px var(--mono)}
.done .est{color:var(--def);background:#7DD3A822}.done .det span{color:var(--ok)}
.migrating{border-color:#8DB8FF66;opacity:.75}.migrating .est{color:var(--mig);background:#8DB8FF22}.migrating .est:before{content:'';width:8px;height:8px;border-radius:50%;background:var(--mig)}
.migrating .nome b,.migrating .det span{color:var(--mig)}.migrating .nome span{color:var(--muted)}
.barra{height:6px;border-radius:3px;background:var(--line);overflow:hidden}.barra i{display:block;height:100%;width:35%;border-radius:3px;background:var(--mig);animation:anda 1.4s ease-in-out infinite}
@keyframes anda{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}
.queued{opacity:.5}.queued .est{color:var(--faint);background:#5E767022}.queued .nome span,.queued .nome b{color:var(--muted)}.queued .det span{color:var(--faint)}
.failed{border-color:#FF8A7A66}.failed .est{color:var(--atk);background:#FF8A7A22}.failed .det span{color:var(--bad)}
.espaco{flex:1}
.vitima{background:#7DD3A812;border:1px solid var(--def);border-radius:14px;padding:16px 18px;display:flex;flex-direction:column;gap:10px}
.vitima.aberta{background:#FF8A7A12;border-color:var(--atk)}
.vitima .rot{font:14px var(--mono);color:var(--muted);letter-spacing:1px}.vitima .porta{display:flex;gap:14px;align-items:center}
.vitima .porta b{font:400 32px var(--serif)}.p{padding:4px 12px;border-radius:999px;font:15px var(--mono)}
.p-open{color:var(--atk);background:#FF8A7A1F;border:1px solid #FF8A7A66}.p-open.antes{opacity:.7}
.p-closed{color:var(--def);background:#7DD3A82E}.p-closing{color:#F5B942;background:#F5B94222}.p-reopened{color:var(--atk);background:#FF8A7A22}
.vitima .nota{color:var(--def);font-size:18px}.vitima .janela{font:14px var(--mono);color:var(--muted)}
.abas{display:flex;gap:8px}.aba{font:13px var(--mono);letter-spacing:1px;padding:4px 12px;border-radius:8px;color:var(--faint);border:1px solid var(--line)}
.aba.on{color:var(--bg);background:var(--c);border-color:var(--c)}
.term{flex:1;min-height:0;background:#07100E;border:1px solid var(--line);border-radius:14px;padding:16px;display:flex;flex-direction:column;justify-content:flex-end;gap:7px;overflow:hidden;font:15px/1.35 var(--mono)}
.ln{display:flex;gap:10px}.ln span{color:var(--faint);flex:none}.ln p{margin:0;color:var(--ink);overflow-wrap:anywhere}.ln.velha{opacity:.5}
.ln p.ok{color:var(--ok)}.ln p.mau{color:var(--bad)}
.troca{display:flex;gap:10px;align-items:center;font:13px var(--mono);color:var(--c);padding:4px 0}.troca:before{content:'';width:18px;height:1px;background:var(--c)}.troca:after{content:'';flex:1;height:1px;background:var(--line)}
.cursor{color:var(--def)}.dica{font:13px var(--mono);color:var(--faint)}
.fich{border:1px solid var(--line);border-radius:10px;padding:10px 12px;color:var(--muted)}.fich b{color:var(--ink);font-weight:400}
.pr{border:1px solid var(--code);background:#C4A7FF14;border-radius:14px;padding:14px 16px;display:flex;flex-direction:column;gap:6px}
.pr b{font:400 24px var(--serif)}.pr a{color:var(--code);font:14px var(--mono);overflow-wrap:anywhere}
.rodape{display:flex;justify-content:space-between;align-items:center;gap:16px;font:15px var(--mono);color:var(--faint)}
.rodape .bts{display:flex;gap:12px}.bt{display:inline-flex;align-items:center;gap:8px;padding:8px 14px;border-radius:10px;font:600 17px var(--sans);text-decoration:none;cursor:pointer;border:0}
.bt.desc{background:var(--ink);color:var(--bg)}.bt.desf{background:transparent;color:var(--def);border:1px solid var(--def)}
@media (max-width:1700px){body{height:auto;overflow:auto;padding:24px}.corpo{grid-template-columns:1fr 1fr}.corpo section:first-child{grid-column:1/-1}.seg{font-size:72px}}`;

function htmlRelogio(todos: EventoAuditoria[], agora: Date): string {
  const exp = relogioExposicao(todos, agora);
  if (!exp) return `<div class="relogio espera"><div class="kicker">Time exposed</div><div class="seg">waiting for the new infrastructure</div><div class="isco">&nbsp;</div></div>`;
  return `<div class="relogio ${exp.aindaExposta ? 'exposta' : 'fechada'}" data-inicio="${escapar(exp.inicio)}" data-fim="${escapar(exp.fim ?? '')}">
<div class="kicker">Time exposed</div><div class="valor"><div class="seg">${exp.segundos} s</div>
<div><div class="pill">${exp.aindaExposta ? 'EXPOSED' : `CLOSED ${hora(exp.fim!)}`}</div><div class="isco">&nbsp;</div></div></div></div>`;
}

function htmlCadeia(eventos: EventoAuditoria[]): string {
  const pensar = eventos.findLast((e) => e.tipo === 'pensar');
  const agora = pensar
    ? `<div class="agora ${COR[agenteV2(pensar)]}"><div class="q">${NOME[agenteV2(pensar)]} · THINKING NOW</div><div class="t">${escapar(obj(pensar.depois).texto)}</div></div>`
    : '';
  const passos = cadeia(eventos).slice(-8);
  const html = passos
    .map((p, i) => {
      const ativo = i === passos.length - 1 ? ' ativo' : '';
      const acoes =
        p.botao || p.resultado
          ? `<div class="acoes">${p.botao ? `<span class="botao">${escapar(p.botao)}</span>` : ''}${p.resultado ? `<span class="res ${p.resultado.ok ? 'ok' : 'mau'}">${escapar(p.resultado.texto)}</span>` : ''}</div>`
          : '';
      return `<div class="passo ${COR[p.agente]}${ativo}"><div class="trilho"><i></i><b></b></div><div class="conteudo">
<div class="meta"><b>${NOME[p.agente]}</b><span>${hora(p.hora)}</span>${p.pensar ? `<em>${escapar(p.pensar)}</em>` : ''}</div>
<div class="msg">${escapar(p.mensagem)}</div>${acoes}</div></div>`;
    })
    .join('');
  return `<section><div class="cab"><span>AGENT CHAIN</span><span>Telegram · Direção group</span></div>${agora}
<div class="passos">${html || '<div class="msg" style="color:var(--faint)">No events yet.</div>'}</div></section>`;
}

function htmlServicos(eventos: EventoAuditoria[], local: string, agora: Date): string {
  const rota = `AWS (sim) → ${escapar(local)}`;
  const cartoes = servicos(eventos)
    .map((c) => {
      const [de, para] = SERVICO[c.passo];
      const rotulo = { done: c.checksumOk === false ? 'DONE ✗' : 'DONE ✓', migrating: 'MIGRATING', queued: 'QUEUED', failed: 'FAILED' }[c.estado];
      const det = { done: c.prova ?? '', migrating: 'copying…', queued: 'waiting', failed: 'failed · see logs' }[c.estado];
      return `<div class="srv ${c.estado}"><div class="linha"><div class="nome"><span>${de}</span><i>→</i><b>${para}</b></div><span class="est">${rotulo}</span></div>
<div class="det"><span>${escapar(det)}</span><small>${rota}</small></div>${c.estado === 'migrating' ? '<div class="barra"><i></i></div>' : ''}</div>`;
    })
    .join('');

  const porta = portasDoCiclo(eventos).at(-1);
  let vitima = '';
  if (porta) {
    const exp = relogioExposicao(eventos, agora);
    const fechada = porta.estado === 'fechada';
    const pills =
      porta.estado === 'aberta'
        ? '<span class="p p-open">OPEN</span>'
        : `<span class="p p-open antes">OPEN</span><span style="color:var(--faint)">→</span><span class="p p-${{ 'a fechar': 'closing', fechada: 'closed', reaberta: 'reopened' }[porta.estado]}">${{ 'a fechar': 'CLOSING', fechada: 'CLOSED', reaberta: 'REOPENED' }[porta.estado]}</span>`;
    vitima = `<div class="vitima${fechada ? '' : ' aberta'}"><div class="rot">VICTIM VM · LEASEWEB</div>
<div class="porta"><b>${escapar(porta.servico ?? 'port')}${Number.isFinite(porta.porta) ? ` :${porta.porta}` : ''}</b>${pills}</div>
${fechada ? '<div class="nota">Rule removed via Leaseweb API · inverse stored</div>' : ''}
${exp ? `<div class="janela">open ${hora(exp.inicio)}${exp.fim ? `  →  closed ${hora(exp.fim)}` : ''}  ·  ${exp.segundos} s exposed</div>` : ''}</div>`;
  }
  return `<section><div class="cab"><span>SERVICES</span><span>AWS (simulated) → Leaseweb</span></div>
<div class="cartoes">${cartoes || '<div class="msg" style="color:var(--faint)">Waiting for the migration plan.</div>'}</div><div class="espaco"></div>${vitima}</section>`;
}

function htmlLogs(eventos: EventoAuditoria[]): string {
  const ultimo = eventos.findLast((e) => e.tipo !== 'pensar' && paraLog(e).length);
  const linhas = logs(eventos).slice(-16);
  const ativo = linhas.at(-1)?.agente;
  const abas = (['migrador', 'atacante', 'defesa', 'codigo'] as AgenteV2[])
    .map((a) => `<span class="aba ${COR[a]}${a === ativo ? ' on' : ''}">${NOME[a]}</span>`)
    .join('');

  let corpo = '';
  linhas.forEach((l, i) => {
    if (i > 0 && linhas[i - 1]!.agente !== l.agente) corpo += `<div class="troca ${COR[l.agente]}">handoff → ${NOME[l.agente]}</div>`;
    corpo += `<div class="ln${l.agente !== ativo ? ' velha' : ''}"><span>${hora(l.hora)}</span><p class="${l.tom ?? ''}">${escapar(l.texto)}</p></div>`;
  });

  // Variante Code: o último passo é o migrador de código -> ficheiros do PR e o cartão do PR.
  let extra = '';
  if (ultimo?.tipo === 'migracao-codigo') {
    const d = obj(ultimo.depois);
    const ficheiros = Array.isArray(d.ficheiros) ? (d.ficheiros as string[]) : [];
    extra =
      ficheiros.map((f) => `<div class="fich"><b>${escapar(f)}</b> · changed</div>`).join('') +
      (d.url
        ? `<div class="pr"><b>PR · Point the app to Leaseweb</b><span class="dica">${ficheiros.length} file(s) · tests ✓</span><a href="${escapar(d.url)}">${escapar(d.url)}</a></div>`
        : d.simulado
          ? `<div class="pr"><b>PR (dry run)</b><span class="dica">${ficheiros.length} file(s) · ${escapar(d.ramo ?? '')}</span></div>`
          : '');
  }
  return `<section><div class="cab"><span>LIVE LOGS</span><span>● streaming</span></div><div class="abas">${abas}</div>
<div class="term">${corpo || '<div class="ln"><p style="color:var(--faint)">waiting for the first agent…</p></div>'}<div class="cursor">▍</div></div>${extra}
<div class="dica">follows the active agent · switches on handoff</div></section>`;
}

/** O ecrã v2. `token` liga o botão Undo (PAINEL_TOKEN); `local` é onde ficam os dados (LOCAL_DADOS). */
export function renderizarV2(pedidos: Pedido[], todos: EventoAuditoria[], opcoes: { token?: string; local?: string; agora?: Date } = {}): string {
  const agora = opcoes.agora ?? new Date();
  const eventos = cicloAtual(todos);
  const fecho = provas(eventos).ultimoFecho;
  const pedidoFecho = fecho && pedidos.find((x) => x.id === fecho.pedidoId);
  const desfazer =
    opcoes.token && fecho && (!pedidoFecho || pedidoFecho.estado === 'feito')
      ? `<form method="post" action="/desfazer" style="margin:0"><input type="hidden" name="id" value="${escapar(fecho.pedidoId)}"><input type="hidden" name="token" value="${escapar(opcoes.token)}"><button class="bt desf">↺ Undo last action</button></form>`
      : '';
  return `${cabecalho('Migrate without being exposed', CSS)}
<div class="topo"><div class="marca"><div class="kicker">InfraHack · Leaseweb · live</div><h1>Migrate without being exposed</h1></div>${htmlRelogio(todos, agora)}</div>
<div class="corpo">${htmlCadeia(eventos)}${htmlServicos(eventos, opcoes.local || 'Leaseweb', agora)}${htmlLogs(eventos)}</div>
<div class="rodape"><span>Everything comes from auditoria.jsonl and estado.json</span><div class="bts"><a class="bt desc" href="/relatorio.pdf" download>⤓ Download report (PDF)</a>${desfazer}</div></div>
<script>
const r=document.querySelector('.relogio[data-inicio]');
if(r){const i=Date.parse(r.dataset.inicio),f=r.dataset.fim?Date.parse(r.dataset.fim):0,seg=r.querySelector('.seg');
 if(!f)setInterval(()=>{seg.textContent=Math.round((Date.now()-i)/1000)+' s'},500);
 const q='/isco?json&desde='+encodeURIComponent(r.dataset.inicio)+(f?'&ate='+encodeURIComponent(r.dataset.fim):'');
 fetch(q).then(x=>x.ok?x.json():null).then(c=>{if(c)r.querySelector('.isco').textContent='meanwhile the honeypot got '+c.tentativas+' attempts'}).catch(()=>{});}
let ultimo='';
setInterval(async()=>{try{const x=await fetch('/estado.json',{cache:'no-store'});const t=await x.text();if(ultimo&&t!==ultimo)location.reload();ultimo=t}catch{}},2000);
</script></body></html>`;
}

export async function paginaV2(req: IncomingMessage, res: ServerResponse): Promise<void> {
  carregarEnv();
  res
    .writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    .end(renderizarV2(estado.listarPedidos(), auditoria.ler(), { token: process.env.PAINEL_TOKEN ?? '', local: process.env.LOCAL_DADOS || undefined }));
}

/** GET /relatorio.pdf: o relatório A4 do chefe (certificado + incidentes) do ciclo atual, em PDF, como ficheiro. */
export async function paginaRelatorio(req: IncomingMessage, res: ServerResponse): Promise<void> {
  carregarEnv();
  const eventos = cicloAtual(auditoria.ler());
  const pedidos = estado.listarPedidos();
  const opcoes = { localDados: process.env.LOCAL_DADOS || undefined };
  const pdf = relatorioPdf(eventos, pedidos, opcoes);
  const nome = nomeRelatorioPdf(opcoes).replace(/[^\w.-]/g, '');
  res
    .writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${nome}"` })
    .end(Buffer.from(pdf));
}
