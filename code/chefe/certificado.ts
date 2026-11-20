// Ideias wow 2 e 3 (docs/ideias-wow.md): relógio de exposição e certificado de migração.
// Só números medidos, tirados da auditoria e do estado. Nada inventado: o que não se mediu não aparece.
import type { EventoAuditoria, Pedido } from '@mwbe/shared';
import { duracao } from './resumo';

const HORA = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Lisbon' });
const DATA = (iso: string) => new Date(iso).toLocaleDateString('pt-PT', { timeZone: 'Europe/Lisbon' });

const doPasso = (pedidos: Pedido[], passo: 's3' | 'postgres' | 'fila') =>
  pedidos.find((p) => p.acao.tipo === 'migrar' && p.acao.passo === passo);

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

type ProvaMigracao = { objetos?: number; checksumsOk?: boolean; testes?: { antes?: boolean; depois?: boolean } };
type Reconhecimento = { achados?: number; portas?: { alvo: string; porta: number; servico: string | null }[] };

/**
 * Certificado de migração para o dono (texto simples, cabe numa mensagem do Telegram).
 * `localDados`: onde ficam os dados, dito por nós (LOCAL_DADOS no .env, ex.: "Leaseweb, Amesterdão (NL)").
 */
export function certificado(eventos: EventoAuditoria[], pedidos: Pedido[], localDados?: string, agora: Date = new Date()): string {
  const linhas = [`Certificado de migração · ${DATA(agora.toISOString())} ${HORA(agora.toISOString())}`];

  const migracao = doPasso(pedidos, 's3');
  const prova = migracao && (eventos.filter((e) => e.pedidoId === migracao.id && e.tipo === 'feito').at(-1)?.depois as ProvaMigracao | undefined);
  if (migracao?.estado === 'feito' && prova) {
    linhas.push(`Dados: ficheiros do S3 passados para MinIO${localDados ? `, em ${localDados}` : ''}.`);
    const n = typeof prova.objetos === 'number' ? `${prova.objetos} ficheiros copiados` : 'Ficheiros copiados';
    const testes = prova.testes?.antes && prova.testes?.depois ? '; os mesmos testes da app passam antes e depois' : '';
    linhas.push(`Prova: ${n}, impressão digital (sha256) ${prova.checksumsOk ? 'igual dos dois lados' : 'DIFERENTE em pelo menos um'}${testes}.`);
  } else if (migracao) {
    linhas.push(`Migração: ${migracao.estado === 'ignorado' ? 'não aprovada' : 'por concluir'}.`);
  }

  const pg = doPasso(pedidos, 'postgres');
  const provaPg = pg && (eventos.filter((e) => e.pedidoId === pg.id && e.tipo === 'feito').at(-1)?.depois as { tabelas?: number; linhas?: number; checksumsOk?: boolean } | undefined);
  if (pg?.estado === 'feito' && provaPg) {
    const quanto = typeof provaPg.tabelas === 'number' && typeof provaPg.linhas === 'number' ? `${provaPg.tabelas} ${provaPg.tabelas === 1 ? 'tabela' : 'tabelas'} e ${provaPg.linhas} linhas` : 'Tabelas';
    linhas.push(`Base de dados: ${quanto} copiadas para PostgreSQL${localDados ? `, em ${localDados}` : ''}; contagem e sha256 ${provaPg.checksumsOk ? 'iguais' : 'DIFERENTES'} em cada tabela.`);
  }

  const fl = doPasso(pedidos, 'fila');
  const provaFila = fl && (eventos.filter((e) => e.pedidoId === fl.id && e.tipo === 'feito').at(-1)?.depois as { mensagens?: number; checksumsOk?: boolean } | undefined);
  if (fl?.estado === 'feito' && provaFila) {
    const quanto = typeof provaFila.mensagens === 'number' ? `${provaFila.mensagens} ${provaFila.mensagens === 1 ? 'mensagem passada' : 'mensagens passadas'}` : 'Mensagens passadas';
    linhas.push(`Filas: ${quanto} do SQS para RabbitMQ${localDados ? `, em ${localDados}` : ''}; contagem e sha256 ${provaFila.checksumsOk ? 'iguais' : 'DIFERENTES'}.`);
  }

  const recon = eventos.filter((e) => e.tipo === 'reconhecimento').at(-1)?.depois as Reconhecimento | undefined;
  if (recon?.portas?.length) {
    const lista = recon.portas.slice(0, 4).map((p) => `${p.servico ?? 'serviço'} ${p.porta} (${p.alvo})`).join(', ');
    linhas.push(`Ataque às nossas máquinas: ${recon.portas.length} ${recon.portas.length === 1 ? 'porta aberta' : 'portas abertas'}: ${lista}${recon.portas.length > 4 ? ', …' : ''}.`);
  } else if (recon) {
    linhas.push('Ataque às nossas máquinas: nenhuma porta aberta encontrada.');
  }

  const fechos = eventos.filter(eFecho);
  for (const f of fechos.slice(0, 4)) {
    const pedido = pedidos.find((p) => p.id === f.pedidoId);
    const aprov = eventos.find((e) => e.pedidoId === f.pedidoId && e.tipo === 'aprovado');
    const desfeito = pedido?.estado === 'desfeito' ? ' (depois desfeito pelo dono)' : '';
    linhas.push(
      `Fechado: ${pedido?.titulo ?? f.pedidoId}, às ${HORA(f.hora)}` +
        `${aprov ? `, aprovado por uma pessoa às ${HORA(aprov.hora)}` : ''}; inverso guardado${desfeito}.`,
    );
  }

  const exp = relogioExposicao(eventos, agora);
  if (exp && !exp.aindaExposta) linhas.push(`Exposição: ${duracao(exp.segundos * 1000)} entre a infraestrutura nova ficar no ar e a porta fechar.`);
  else if (exp?.aindaExposta && fechos.length === 0 && pedidos.some((p) => p.acao.tipo === 'remover_regra'))
    linhas.push(`Exposição: ainda há portas por fechar (${duracao(exp.segundos * 1000)} desde que a infraestrutura ficou no ar).`);

  // Só se promete o inverso se ele estiver mesmo guardado.
  const comInverso = eventos.some((e) => e.inverso) ? '; cada porta fechada tem o inverso guardado para desfazer' : '';
  linhas.push(`Registo: ${eventos.length} ${eventos.length === 1 ? 'evento' : 'eventos'} na auditoria${comInverso}.`);
  return linhas.join('\n');
}
