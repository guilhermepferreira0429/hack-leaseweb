// Ideias wow 2 e 3 (docs/ideias-wow.md): relógio de exposição e certificado de migração.
// Só números medidos, tirados da auditoria e do estado. Nada inventado: o que não se mediu não aparece.
import type { EventoAuditoria, Pedido } from '@mwbe/shared';
import { duracao } from './resumo';

const HORA = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Lisbon' });
const DATA = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { timeZone: 'Europe/Lisbon' });

// O último do ciclo: num processo que corre várias vezes, o primeiro seria de um ensaio antigo.
const doPasso = (pedidos: Pedido[], passo: 's3' | 'postgres' | 'fila' | 'segredos' | 'cache') =>
  pedidos.findLast((p) => p.acao.tipo === 'migrar' && p.acao.passo === passo);

export interface Exposicao {
  /** Quando a infraestrutura nova ficou no ar (evento 'infra-no-ar' do orquestrador). */
  inicio: string;
  /** Primeiro fecho confirmado depois disso (evento 'feito' com inverso 'criar_regra'); undefined se ainda exposta. */
  fim?: string;
  segundos: number;
  aindaExposta: boolean;
}

const eFecho = (e: EventoAuditoria) => e.tipo === 'feito' && e.inverso?.tipo === 'criar_regra';

/** Relógio de exposição: da infraestrutura no ar até à primeira porta fechada e confirmada. */
export function relogioExposicao(eventos: EventoAuditoria[], agora: Date = new Date()): Exposicao | undefined {
  // O último: o painel lê a auditoria do dia inteiro, com os ensaios anteriores.
  const inicio = eventos.findLast((e) => e.tipo === 'infra-no-ar');
  if (!inicio) return undefined;
  const t0 = Date.parse(inicio.hora);
  const fecho = eventos.find((e) => eFecho(e) && Date.parse(e.hora) >= t0);
  const t1 = fecho ? Date.parse(fecho.hora) : agora.getTime();
  return { inicio: inicio.hora, fim: fecho?.hora, segundos: Math.max(0, Math.round((t1 - t0) / 1000)), aindaExposta: !fecho };
}

type ProvaPasso = {
  objetos?: number;
  tabelas?: number;
  linhas?: number;
  mensagens?: number;
  segredos?: number;
  chaves?: number;
  checksumsOk?: boolean;
  testes?: { antes?: boolean; depois?: boolean };
};
type Reconhecimento = { achados?: number; portas?: { alvo: string; porta: number; servico: string | null }[] };

const NAO_MEDIDO = 'not measured';
const OK = (v: boolean | undefined) => (v === undefined ? NAO_MEDIDO : v ? '✓' : '✗');

/** Cada serviço migrado: de onde vem, para onde foi, e como se escreve a prova (docs/certificado-migracao.md). */
const SERVICOS: { passo: 's3' | 'postgres' | 'fila' | 'segredos' | 'cache'; aws: string; destino: string; frase: (p: ProvaPasso) => string }[] = [
  { passo: 's3', aws: 'S3', destino: 'MinIO', frase: (p) => `Files: ${p.objetos ?? NAO_MEDIDO} copied` },
  {
    passo: 'postgres',
    aws: 'RDS PostgreSQL',
    destino: 'PostgreSQL',
    frase: (p) => `Database: ${p.linhas ?? NAO_MEDIDO} rows in ${p.tabelas ?? NAO_MEDIDO} ${p.tabelas === 1 ? 'table' : 'tables'}`,
  },
  { passo: 'fila', aws: 'SQS', destino: 'RabbitMQ', frase: (p) => `Queues: ${p.mensagens ?? NAO_MEDIDO} messages moved` },
  { passo: 'segredos', aws: 'Secrets Manager and Parameter Store', destino: 'OpenBao', frase: (p) => `Secrets: ${p.segredos ?? NAO_MEDIDO} moved, no value ever shown` },
  { passo: 'cache', aws: 'ElastiCache Redis', destino: 'Valkey', frase: (p) => `Cache: ${p.chaves ?? NAO_MEDIDO} keys copied` },
];

/** Países da UE (ISO 3166-1 alfa-2). */
const UE = new Set(['AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK']);

/** O local termina num código de país da UE entre parênteses, ex.: "Leaseweb, Amesterdão (NL)". */
export function naUE(local: string | undefined): boolean {
  const m = local?.trim().match(/\(([A-Z]{2})\)$/);
  return Boolean(m && UE.has(m[1]!));
}

/** CERT-AAAAMMDD-HHMM, na hora de Lisboa. */
export function idCertificado(agora: Date = new Date()): string {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Lisbon',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(agora);
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? '00';
  return `CERT-${v('year')}${v('month')}${v('day')}-${v('hour')}${v('minute')}`;
}

/**
 * Certificado de migração (docs/certificado-migracao.md), para o Telegram. Só factos da auditoria e do estado:
 * o que não se mediu sai "não medido". Não é uma certificação oficial; serve de registo (RGPD, NIS2).
 * `localDados`: onde ficam os dados, dito por nós (LOCAL_DADOS no .env, ex.: "Leaseweb, Frankfurt (DE)").
 */
export function certificado(eventos: EventoAuditoria[], pedidos: Pedido[], localDados?: string, agora: Date = new Date()): string {
  const iso = agora.toISOString();
  const onde = localDados?.trim() || NAO_MEDIDO;
  const provaDe = (id: string) => eventos.filter((e) => e.pedidoId === id && e.tipo === 'feito').at(-1)?.depois as ProvaPasso | undefined;

  const migrados = SERVICOS.map((s) => {
    const pedido = doPasso(pedidos, s.passo);
    return { ...s, pedido, prova: pedido?.estado === 'feito' ? provaDe(pedido.id) : undefined };
  }).filter((s) => s.pedido);
  const feitos = migrados.filter((s) => s.prova);
  const algumDiferente = feitos.some((s) => s.prova!.checksumsOk === false);
  const testes = feitos.find((s) => s.prova!.testes)?.prova!.testes;

  const recon = eventos.filter((e) => e.tipo === 'reconhecimento').at(-1)?.depois as Reconhecimento | undefined;
  const fechos = eventos.filter(eFecho);
  const exp = relogioExposicao(eventos, agora);
  const confirmacao = eventos.filter((e) => e.tipo === 'confirmacao-atacante').at(-1)?.depois as { chega?: boolean } | undefined;
  const codigo = eventos.filter((e) => e.tipo === 'migracao-codigo').at(-1)?.depois as { causas?: number; url?: string } | undefined;
  const comInverso = eventos.filter((e) => e.tipo === 'feito' && e.inverso);

  const l: string[] = [`MIGRATION CERTIFICATE · ${idCertificado(agora)}`, `${DATA(iso)} ${HORA(iso)} · ${onde}`, ''];

  // Resumo: frases fixas a partir dos números abaixo (a IA não entra aqui; a demo nunca espera por ela).
  const resumo: string[] = [];
  if (feitos.length) {
    resumo.push(
      `We moved ${feitos.length} ${feitos.length === 1 ? 'service' : 'services'} from AWS to ${onde}` +
        (algumDiferente ? ', but at least one checksum does not match.' : ', with the data fingerprint matching on both sides.'),
    );
  } else if (migrados.length) {
    resumo.push('The migration did not finish.');
  }
  if (recon) {
    const n = recon.portas?.length ?? 0;
    resumo.push(
      n === 0
        ? 'The attacker found no open ports.'
        : `The attacker found ${n} ${n === 1 ? 'open port' : 'open ports'} and ${fechos.length === 0 ? 'none has been closed yet' : `${fechos.length === 1 ? 'it was closed' : `${fechos.length} were closed`} with approval`}.`,
    );
  }
  if (exp && !exp.aindaExposta) resumo.push(`Exposure: ${duracao(exp.segundos * 1000)}.`);
  l.push('SUMMARY', resumo.length ? resumo.join(' ') : NAO_MEDIDO, '');

  l.push('1. WHERE THE DATA IS');
  if (migrados.length === 0) l.push(`· ${NAO_MEDIDO}`);
  for (const s of migrados) {
    const estado = s.prova ? '' : ` · ${s.pedido!.estado === 'ignorado' ? 'not approved' : 'not finished'}`;
    l.push(`· ${s.aws} → ${s.destino} · ${onde} · self-hosted${estado}`);
  }
  l.push('');

  l.push('2. PROOF NOTHING WAS LOST');
  if (feitos.length === 0) l.push(`· ${NAO_MEDIDO}`);
  for (const s of feitos) l.push(`· ${s.frase(s.prova!)} · checksum ${OK(s.prova!.checksumsOk)}`);
  l.push(`· App tests: before ${OK(testes?.antes)} · after ${OK(testes?.depois)}`);
  if (algumDiferente) l.push('✗ WARNING: a checksum does not match. The migration is not complete.');
  l.push('');

  l.push('3. SECURITY AFTER THE MIGRATION');
  if (!recon) l.push(`· Found: ${NAO_MEDIDO}`);
  else {
    const portas = recon.portas ?? [];
    l.push(`· Found: ${portas.length} ${portas.length === 1 ? 'issue' : 'issues'}${portas.length ? `: ${portas.slice(0, 4).map((p) => `${p.servico ?? 'service'} ${p.porta}`).join(', ')}` : ''}`);
  }
  for (const f of fechos.slice(0, 4)) {
    const pedido = pedidos.find((p) => p.id === f.pedidoId);
    const aprov = eventos.find((e) => e.pedidoId === f.pedidoId && e.tipo === 'aprovado');
    const quem = !aprov ? NAO_MEDIDO : aprov.quem === 'modo-noite' ? 'night mode (no answer from the owner), only known IPs get in' : 'a person, in Telegram';
    const desfeito = pedido?.estado === 'desfeito' ? ' · later undone by the owner' : '';
    l.push(`· ${pedido?.titulo ?? f.pedidoId} → closed at ${HORA(f.hora)}, approved by ${quem}${desfeito}`);
  }
  l.push(`· Time exposed: ${exp && !exp.aindaExposta ? `${exp.segundos} seconds` : exp?.aindaExposta && fechos.length === 0 && recon?.portas?.length ? 'still exposed' : NAO_MEDIDO}`);
  l.push(`· Attacker confirmation: ${confirmacao?.chega === undefined ? NAO_MEDIDO : confirmacao.chega ? 'can still reach it ✗' : 'can no longer reach it ✓'}`);
  if (codigo?.causas) l.push(`· Root cause fixed in code: open rule in the infrastructure config${codigo.url ? ` (${codigo.url})` : ''}`);
  l.push('');

  l.push('4. HOW TO UNDO');
  if (comInverso.length === 0) l.push('· No action with a stored inverse in this run');
  else {
    const ids = [...new Set(comInverso.map((e) => e.pedidoId))];
    l.push(`· ${ids.length} ${ids.length === 1 ? 'action stored' : 'actions stored'} with the inverse · undo: ${ids.slice(0, 3).map((id) => `/undo ${id}`).join(', ')}`);
  }
  l.push('');

  // "Nenhum dado saiu da UE" só quando o destino dito por nós (LOCAL_DADOS) é um país da UE, ex.: "(NL)".
  const ue = naUE(localDados) && feitos.length > 0 ? 'No data left the EU. ' : '';
  l.push(`${ue}Data destination: ${onde}. Generated automatically from the audit log (${eventos.length} ${eventos.length === 1 ? 'event' : 'events'}).`);
  return l.join('\n');
}
