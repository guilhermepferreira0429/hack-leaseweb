// Zona "terminal" do painel (docs/agentes/mensagens-demo.md: "o terminal mostra os comandos que ele executa").
// Cada evento da auditoria vira o comando que o agente correu e o resultado medido. É reconstruído a partir da
// auditoria (não é o stdout cru dos processos), mas só com valores que lá estão: nada inventado.
import type { EventoAuditoria, Regra } from '@mwbe/shared';
import { escapar, numero } from './estilo';
import { agenteDe, type Agente } from './linha-tempo';

export interface LinhaTerminal {
  hora: string;
  agente: Agente;
  comando?: string;
  saida: { texto: string; tom?: 'ok' | 'mau' | 'neutro' }[];
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});
const curto = (id: unknown) => String(id ?? '').slice(0, 8);
const check = (ok: unknown) => (ok ? 'sha256 ✓' : 'sha256 DIFERENTE ✗');
const tomOk = (ok: unknown): 'ok' | 'mau' => (ok ? 'ok' : 'mau');

const MIGRAR: Record<string, string> = {
  s3: 'migrar s3 → minio',
  postgres: 'migrar rds-postgres → postgres',
  fila: 'migrar sqs → rabbitmq',
  segredos: 'migrar secrets-manager → openbao',
  cache: 'migrar elasticache → valkey',
};

function provaMigracao(d: Obj): string {
  if (d.objetos !== undefined) return `${numero(d.objetos)} objetos copiados`;
  if (d.tabelas !== undefined) return `${d.tabelas} tabelas · ${numero(d.linhas)} linhas`;
  if (d.mensagens !== undefined) return `${numero(d.mensagens)} mensagens`;
  if (d.segredos !== undefined) return `${numero(d.segredos)} segredos (valores nunca mostrados)`;
  if (d.chaves !== undefined) return `${numero(d.chaves)} chaves`;
  return 'concluído';
}

/** Um evento -> uma entrada do terminal (ou nada, para eventos que não correspondem a um comando). */
export function paraTerminal(e: EventoAuditoria): LinhaTerminal | undefined {
  const d = obj(e.depois);
  const base = { hora: e.hora, agente: agenteDe(e) };
  switch (e.tipo) {
    case 'pedido':
      if (e.quem === 'migrador' && Array.isArray(d.servicos))
        return { ...base, comando: 'analisar exemplo-app', saida: [{ texto: `serviços AWS: ${(d.servicos as string[]).join(', ')}` }] };
      if (e.quem === 'defesa') return { ...base, saida: [{ texto: `# pedido de aprovação: ${String(d.titulo ?? e.pedidoId)}`, tom: 'neutro' }] };
      return undefined;
    case 'migracao-plano-infra':
      return { ...base, comando: 'traduzir terraform aws → leaseweb', saida: [{ texto: 'plano gerado (nada criado ainda)' }] };
    case 'aprovado':
      if (e.quem === 'migrador') return undefined; // passos aprovados pelo plano: não é uma decisão nova
      return { ...base, saida: [{ texto: e.quem === 'modo-noite' ? '# sem resposta: modo noite' : '# aprovado pelo dono', tom: 'neutro' }] };
    case 'ignorado':
      return { ...base, saida: [{ texto: '# ignorado pelo dono', tom: 'neutro' }] };
    case 'feito':
      if (e.quem === 'migrador' && d.numero !== undefined)
        return { ...base, comando: `git merge PR #${d.numero}`, saida: [{ texto: `commit ${curto(d.commit)}`, tom: 'ok' }] };
      if (e.quem === 'migrador') {
        const t = obj(d.testes);
        const saida: LinhaTerminal['saida'] = [{ texto: `${provaMigracao(d)} · ${check(d.checksumsOk)}`, tom: tomOk(d.checksumsOk) }];
        if (t.antes !== undefined) saida.push({ texto: `testes da app: antes ${t.antes ? '✓' : '✗'} · depois ${t.depois ? '✓' : '✗'}`, tom: tomOk(t.antes && t.depois) });
        return { ...base, comando: MIGRAR[String(d.passo)] ?? 'migrar', saida };
      }
      if (e.inverso?.tipo === 'criar_regra') {
        const via = (e as { confirmacao?: string }).confirmacao === 'de-fora' ? 'confirmado de fora (nmap)' : 'confirmado pela API';
        return { ...base, saida: [{ texto: `✓ regra removida · ${via} · inverso guardado`, tom: 'ok' }] };
      }
      return undefined;
    case 'migracao-codigo': {
      const n = Array.isArray(d.ficheiros) ? d.ficheiros.length : 0;
      return { ...base, comando: 'migrar código → leaseweb', saida: [{ texto: `${n} ficheiro(s) alterados · testes ✓`, tom: 'ok' }] };
    }
    case 'infra-no-ar':
      return { ...base, saida: [{ texto: '# infraestrutura nova no ar · relógio de exposição a contar', tom: 'mau' }] };
    case 'reconhecimento': {
      const portas = (d.portas as { alvo: string; porta: number; servico: string | null }[] | undefined) ?? [];
      const alvos = ((d.alvos as string[] | undefined) ?? [...new Set(portas.map((p) => p.alvo))]).join(' ');
      const lista = [...new Set(portas.map((p) => p.porta))].join(',');
      return {
        ...base,
        comando: `nmap -Pn${lista ? ` -p ${lista}` : ''} ${alvos}`.trim(),
        saida: portas.length
          ? portas.map((p) => ({ texto: `${p.porta}/tcp open ${(p.servico ?? '').toLowerCase()}`.trim(), tom: 'mau' as const }))
          : [{ texto: 'nenhuma porta aberta', tom: 'ok' }],
      };
    }
    case 'verificado':
      return {
        ...base,
        comando: `nmap -Pn -p ${d.porta} ${d.ip}`,
        saida: [{ texto: `${d.porta}/tcp ${d.estado}`, tom: d.estado === 'open' ? 'mau' : 'ok' }],
      };
    case 'a-aplicar': {
      const r = e.antes as Regra | undefined;
      const sg = e.inverso && 'securityGroupId' in e.inverso ? curto(e.inverso.securityGroupId) : '?';
      return {
        ...base,
        comando: `leaseweb revokeFirewallRules sg=${sg} regra=${curto(r?.id)}`,
        saida: [{ texto: `202 Accepted · ${r ? `${r.protocol} ${r.startPort} de ${r.source}` : ''}` }],
      };
    }
    case 'modo-noite-permitir':
      return { ...base, comando: `leaseweb authorizeFirewallRules source=${String(d.source ?? '?')}`, saida: [{ texto: 'regra temporária ACTIVE' }] };
    case 'desfeito':
      if (e.quem === 'migrador') return { ...base, comando: `git revert PR #${d.numero}`, saida: [{ texto: 'PR revertido', tom: 'neutro' }] };
      return { ...base, comando: 'leaseweb authorizeFirewallRules (inverso guardado)', saida: [{ texto: 'regra reposta · ACTIVE', tom: 'neutro' }] };
    case 'falhou':
      return { ...base, saida: [{ texto: `✗ ${String(e.depois ?? 'falhou')}`.slice(0, 160), tom: 'mau' }] };
    case 'erro':
      return { ...base, saida: [{ texto: `✗ ${String(d.passo ?? d.fase ?? '')}: ${String(d.erro ?? '')}`.slice(0, 160), tom: 'mau' }] };
    default:
      return undefined;
  }
}

export function linhasTerminal(eventos: EventoAuditoria[]): LinhaTerminal[] {
  return eventos.map(paraTerminal).filter((l): l is LinhaTerminal => Boolean(l));
}

const HORA = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('pt-PT', { timeZone: 'Europe/Lisbon' });
};

/** HTML do terminal: as últimas `max` entradas, a mais recente em baixo (como num terminal a sério). */
export function renderizarTerminal(eventos: EventoAuditoria[], max = 12): string {
  const linhas = linhasTerminal(eventos).slice(-max);
  if (!linhas.length) return '<div class="term"><div class="t-vazio">$ _</div></div>';
  const html = linhas
    .map(
      (l) =>
        `<div class="t-bloco ag-${l.agente}">${l.comando ? `<div class="t-cmd"><span class="t-h">${HORA(l.hora)}</span><span class="t-ag">${l.agente}$</span> ${escapar(l.comando)}</div>` : ''}${l.saida
          .map((s) => `<div class="t-out t-${s.tom ?? 'neutro'}">${l.comando ? '' : `<span class="t-h">${HORA(l.hora)}</span>`}${escapar(s.texto)}</div>`)
          .join('')}</div>`,
    )
    .join('');
  return `<div class="term">${html}</div>`;
}

export const CSS_TERMINAL: string = `.term{flex:1;min-height:220px;background:#07100E;border:1px solid var(--line);border-radius:14px;padding:16px 18px;
font:15px/1.5 var(--mono);display:flex;flex-direction:column;justify-content:flex-end;overflow:hidden}
.t-bloco{margin-top:8px}.t-cmd{color:var(--ink)}.t-ag{color:var(--c);margin-right:2px}.t-h{color:var(--faint);margin-right:10px;font-size:13px}
.t-out{color:var(--muted);padding-left:6.4em}.t-ok{color:var(--ok)}.t-mau{color:var(--bad)}.t-vazio{color:var(--faint)}`;
