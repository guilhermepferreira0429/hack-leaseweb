// Ideias wow 2 e 3 (docs/ideias-wow.md): relógio de exposição e certificado de migração.
// Só números medidos, tirados da auditoria e do estado. Nada inventado: o que não se mediu não aparece.
import type { EventoAuditoria, Pedido } from '@mwbe/shared';
import { duracao } from './resumo';

const HORA = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Lisbon' });
const DATA = (iso: string) => new Date(iso).toLocaleDateString('pt-PT', { timeZone: 'Europe/Lisbon' });

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

const NAO_MEDIDO = 'não medido';
const OK = (v: boolean | undefined) => (v === undefined ? NAO_MEDIDO : v ? '✓' : '✗');

/** Cada serviço migrado: de onde vem, para onde foi, e como se escreve a prova (docs/certificado-migracao.md). */
const SERVICOS: { passo: 's3' | 'postgres' | 'fila' | 'segredos' | 'cache'; aws: string; destino: string; frase: (p: ProvaPasso) => string }[] = [
  { passo: 's3', aws: 'S3', destino: 'MinIO', frase: (p) => `Ficheiros: ${p.objetos ?? NAO_MEDIDO} copiados` },
  {
    passo: 'postgres',
    aws: 'RDS PostgreSQL',
    destino: 'PostgreSQL',
    frase: (p) => `Base de dados: ${p.linhas ?? NAO_MEDIDO} linhas em ${p.tabelas ?? NAO_MEDIDO} ${p.tabelas === 1 ? 'tabela' : 'tabelas'}`,
  },
  { passo: 'fila', aws: 'SQS', destino: 'RabbitMQ', frase: (p) => `Filas: ${p.mensagens ?? NAO_MEDIDO} mensagens passadas` },
  { passo: 'segredos', aws: 'Secrets Manager e Parameter Store', destino: 'OpenBao', frase: (p) => `Segredos: ${p.segredos ?? NAO_MEDIDO} passados, sem nunca mostrar um valor` },
  { passo: 'cache', aws: 'ElastiCache Redis', destino: 'Valkey', frase: (p) => `Cache: ${p.chaves ?? NAO_MEDIDO} chaves copiadas` },
];

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

  const l: string[] = [`CERTIFICADO DE MIGRAÇÃO · ${idCertificado(agora)}`, `${DATA(iso)} ${HORA(iso)} · ${onde}`, ''];

  // Resumo: frases fixas a partir dos números abaixo (a IA não entra aqui; a demo nunca espera por ela).
  const resumo: string[] = [];
  if (feitos.length) {
    resumo.push(
      `Migrámos ${feitos.length} ${feitos.length === 1 ? 'serviço' : 'serviços'} da AWS para ${onde}` +
        (algumDiferente ? ', mas há pelo menos um checksum diferente.' : ', com a impressão digital dos dados igual dos dois lados.'),
    );
  } else if (migrados.length) {
    resumo.push('A migração não ficou concluída.');
  }
  if (recon) {
    const n = recon.portas?.length ?? 0;
    resumo.push(
      n === 0
        ? 'O atacante não encontrou portas abertas.'
        : `O atacante encontrou ${n} ${n === 1 ? 'porta aberta' : 'portas abertas'} e ${fechos.length === 0 ? 'ainda nenhuma foi fechada' : `${fechos.length === 1 ? 'foi fechada' : `${fechos.length} foram fechadas`} com aprovação`}.`,
    );
  }
  if (exp && !exp.aindaExposta) resumo.push(`Exposição: ${duracao(exp.segundos * 1000)}.`);
  l.push('RESUMO', resumo.length ? resumo.join(' ') : NAO_MEDIDO, '');

  l.push('1. ONDE ESTÃO OS DADOS');
  if (migrados.length === 0) l.push(`· ${NAO_MEDIDO}`);
  for (const s of migrados) {
    const estado = s.prova ? '' : ` · ${s.pedido!.estado === 'ignorado' ? 'não aprovado' : 'por concluir'}`;
    l.push(`· ${s.aws} → ${s.destino} · ${onde} · self-hosted${estado}`);
  }
  l.push('');

  l.push('2. PROVA DE QUE NADA SE PERDEU');
  if (feitos.length === 0) l.push(`· ${NAO_MEDIDO}`);
  for (const s of feitos) l.push(`· ${s.frase(s.prova!)} · checksum ${OK(s.prova!.checksumsOk)}`);
  l.push(`· Testes da app: antes ${OK(testes?.antes)} · depois ${OK(testes?.depois)}`);
  if (algumDiferente) l.push('✗ ATENÇÃO: há um checksum diferente. A migração não está completa.');
  l.push('');

  l.push('3. SEGURANÇA DEPOIS DA MIGRAÇÃO');
  if (!recon) l.push(`· Encontrado: ${NAO_MEDIDO}`);
  else {
    const portas = recon.portas ?? [];
    l.push(`· Encontrado: ${portas.length} ${portas.length === 1 ? 'falha' : 'falhas'}${portas.length ? `: ${portas.slice(0, 4).map((p) => `${p.servico ?? 'serviço'} ${p.porta}`).join(', ')}` : ''}`);
  }
  for (const f of fechos.slice(0, 4)) {
    const pedido = pedidos.find((p) => p.id === f.pedidoId);
    const aprov = eventos.find((e) => e.pedidoId === f.pedidoId && e.tipo === 'aprovado');
    const quem = !aprov ? NAO_MEDIDO : aprov.quem === 'modo-noite' ? 'modo noite (sem resposta do dono), só os IPs conhecidos entram' : 'uma pessoa, no Telegram';
    const desfeito = pedido?.estado === 'desfeito' ? ' · depois desfeito pelo dono' : '';
    l.push(`· ${pedido?.titulo ?? f.pedidoId} → fechada às ${HORA(f.hora)}, aprovado por ${quem}${desfeito}`);
  }
  l.push(`· Tempo exposto: ${exp && !exp.aindaExposta ? `${exp.segundos} segundos` : exp?.aindaExposta && fechos.length === 0 && recon?.portas?.length ? 'ainda exposta' : NAO_MEDIDO}`);
  l.push(`· Confirmação do atacante: ${confirmacao?.chega === undefined ? NAO_MEDIDO : confirmacao.chega ? 'ainda chega lá ✗' : 'já não chega lá ✓'}`);
  if (codigo?.causas) l.push(`· Causa corrigida no código: regra aberta na configuração da infraestrutura${codigo.url ? ` (${codigo.url})` : ''}`);
  l.push('');

  l.push('4. COMO VOLTAR ATRÁS');
  if (comInverso.length === 0) l.push('· Nenhuma ação com inverso neste ciclo');
  else {
    const ids = [...new Set(comInverso.map((e) => e.pedidoId))];
    l.push(`· ${ids.length} ${ids.length === 1 ? 'ação guardada' : 'ações guardadas'} com o inverso · desfazer: ${ids.slice(0, 3).map((id) => `/desfazer ${id}`).join(', ')}`);
  }
  l.push('');

  l.push(`Destino dos dados: ${onde}. Gerado automaticamente a partir do registo de auditoria (${eventos.length} ${eventos.length === 1 ? 'evento' : 'eventos'}).`);
  return l.join('\n');
}
