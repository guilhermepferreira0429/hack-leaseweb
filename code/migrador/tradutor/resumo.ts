// Resumo curto do plano, em inglês simples (a demo é em inglês), para o pedido de migração no Telegram.
// Determinístico: sai só do plano. A IA explica depois; isso não é feito aqui.
import type { ItemRecusar, PlanoTraducao } from './tipos';
import { PORTAS_SENSIVEIS } from './tabelas';

const MAX_POR_LISTA = 3;

function listar(itens: string[]): string {
  const unicos = [...new Set(itens)];
  if (unicos.length <= MAX_POR_LISTA) return unicos.join(', ');
  return `${unicos.slice(0, MAX_POR_LISTA).join(', ')} and ${unicos.length - MAX_POR_LISTA} more`;
}

function juntar(itens: string[]): string {
  return itens.length <= 1 ? itens.join('') : `${itens.slice(0, -1).join(', ')} and ${itens.at(-1)}`;
}

function nomesPortas(portas: number[]): string {
  return listar(portas.map((p) => `${PORTAS_SENSIVEIS[p] ?? 'port'} (${p})`));
}

const ONDE: Record<'user_data' | 'tags' | 'atributo', string> = {
  user_data: 'startup script',
  tags: 'tags',
  atributo: 'Terraform',
};

/**
 * Versão curta para o Telegram: no máximo 3 linhas curtas. O plano completo está em resumoPlanoDetalhe.
 * Ex.: "Terraform → Leaseweb (nothing created): m5.large (Ireland) → lsw.m5.large in Amsterdam, 7 services mapped."
 */
export function resumoPlano(plano: PlanoTraducao): string {
  const linhas: string[] = [];

  const servidores = plano.criar
    .filter((c) => c.acao === 'criar-instancia')
    .map((c) => c.descricao.replace(/^server /, '').replace(/, [^,]*$/, ''));
  const mapeados = plano.substituir.length;
  linhas.push(
    `Terraform → Leaseweb (nothing created): ${[...servidores, ...(mapeados > 0 ? [`${mapeados} ${mapeados === 1 ? 'service' : 'services'} mapped`] : [])].join(', ') || 'nothing to translate'}.`,
  );

  const recusas = plano.recusar.filter((r): r is Extract<ItemRecusar, { tipo: 'porta-aberta' }> => r.tipo === 'porta-aberta');
  const recusei: string[] = [];
  const fechadas = [...new Set(recusas.filter((r) => r.destino === 'nao-existe').flatMap((r) => r.portasSensiveis))];
  if (fechadas.length > 0) recusei.push(`${listar(fechadas.map((p) => `${PORTAS_SENSIVEIS[p] ?? 'port'} ${p}`))} open to all`);
  const soAdmin = [...new Set(recusas.filter((r) => r.destino === 'so-admin').flatMap((r) => r.portasSensiveis))];
  if (soAdmin.length > 0) recusei.push(`${listar(soAdmin.map((p) => PORTAS_SENSIVEIS[p] ?? `port ${p}`))} only from your IP`);
  const semAdmin = [...new Set(recusas.filter((r) => r.destino === 'admin-ip-em-falta').flatMap((r) => r.portasSensiveis))];
  if (semAdmin.length > 0) recusei.push(`${listar(semAdmin.map((p) => PORTAS_SENSIVEIS[p] ?? `port ${p}`))} until ADMIN_IP`);
  const segredos = new Set(plano.recusar.flatMap((r) => (r.tipo === 'segredo' ? [`${r.onde}:${r.nome}`] : []))).size;
  if (segredos > 0) recusei.push(`${segredos} ${segredos === 1 ? 'secret' : 'secrets'} not copied`);
  if (recusei.length > 0) linhas.push(`Refused: ${recusei.join(', ')}.`);

  const redesenho = [
    ...new Set(
      plano.sinalizar
        .filter((s) => s.assunto === 'iam' || s.assunto === 'lock-in' || s.assunto === 'ami-custom')
        .map((s) => s.titulo.split(' ')[0]!),
    ),
  ];
  const avisos = plano.sinalizar.filter((s) => !['iam', 'lock-in', 'ami-custom', 'segredo'].includes(s.assunto)).length;
  const ultima = [
    ...(redesenho.length > 0 ? [`Needs redesign: ${listar(redesenho)}.`] : []),
    ...(avisos > 0 ? [`${avisos} ${avisos === 1 ? 'warning' : 'warnings'} in the full plan.`] : []),
  ];
  if (ultima.length > 0) linhas.push(ultima.join(' '));
  return linhas.join('\n');
}

/** O plano completo (o texto que era o resumo antes de 15:15): para o detalhe, a auditoria e o painel. */
export function resumoPlanoDetalhe(plano: PlanoTraducao): string {
  const linhas = ['Plan for Leaseweb (nothing created yet).'];

  // Moves today
  const hoje: string[] = [];
  for (const c of plano.criar.filter((c) => c.acao === 'criar-instancia')) hoje.push(c.descricao);
  const regras = plano.criar
    .filter((c) => c.acao === 'autorizar-regras')
    .flatMap((c) => (c.pedido.corpo.rules as { protocol: string; startPort?: number; endPort?: number; source: string }[]) ?? []);
  const abertas = regras
    .filter((r) => (r.source === '0.0.0.0/0' || r.source === '::/0') && r.startPort !== undefined)
    .map((r) => (r.startPort === r.endPort ? `${r.startPort}` : `${r.startPort}-${r.endPort}`));
  if (abertas.length > 0) hoje.push(`Open to all: ${listar(abertas)}`);
  const recusas = plano.recusar.filter((r): r is Extract<ItemRecusar, { tipo: 'porta-aberta' }> => r.tipo === 'porta-aberta');
  const soAdmin = recusas.filter((r) => r.destino === 'so-admin').flatMap((r) => r.portasSensiveis);
  if (soAdmin.length > 0) hoje.push(`${nomesPortas([...new Set(soAdmin)])} only from your IP`);
  // Trocas por alternativas abertas, juntas por alternativa (ex.: Secrets Manager and SSM → OpenBao).
  const porAlternativa = new Map<string, { servicos: string[]; soPlano: boolean }>();
  for (const s of plano.substituir) {
    const alternativa = s.alternativa.split(' ')[0]!;
    const atual = porAlternativa.get(alternativa) ?? { servicos: [], soPlano: true };
    const curto = s.servicoAws.replace(/ (PostgreSQL|MySQL|Redis|Parameter Store)$/, '');
    if (!atual.servicos.includes(curto)) atual.servicos.push(curto);
    atual.soPlano &&= s.nivel === 'C';
    porAlternativa.set(alternativa, atual);
  }
  const trocas = [...porAlternativa].map(
    ([alternativa, { servicos, soPlano }]) => `${juntar(servicos)} → ${alternativa}${soPlano ? ' (plan only)' : ''}`,
  );
  if (trocas.length > 0) hoje.push(trocas.join(', '));
  if (hoje.length > 0) linhas.push(`Moves today: ${hoje.join('. ')}.`);

  // Not copied
  const recusei: string[] = [];
  const fechadas = [...new Set(recusas.filter((r) => r.destino === 'nao-existe').flatMap((r) => r.portasSensiveis))];
  if (fechadas.length > 0) recusei.push(`${nomesPortas(fechadas)} open to all: closed`);
  const semAdmin = [...new Set(recusas.filter((r) => r.destino === 'admin-ip-em-falta').flatMap((r) => r.portasSensiveis))];
  if (semAdmin.length > 0) recusei.push(`${nomesPortas(semAdmin)} closed until ADMIN_IP is set in .env`);
  // Segredos: um só total, com os nomes agrupados por sítio.
  const grupos = (['user_data', 'tags', 'atributo'] as const).flatMap((onde) => {
    const nomes = [...new Set(plano.recusar.flatMap((r) => (r.tipo === 'segredo' && r.onde === onde ? [r.nome] : [])))];
    return nomes.length > 0 ? [{ nomes, texto: `${listar(nomes)} (${ONDE[onde]})` }] : [];
  });
  const totalSegredos = grupos.reduce((n, g) => n + g.nomes.length, 0);
  if (totalSegredos > 0)
    recusei.push(`${totalSegredos} ${totalSegredos === 1 ? 'secret' : 'secrets'} not copied: ${grupos.map((g) => g.texto).join('; ')}`);
  if (recusei.length > 0) linhas.push(`I refused to copy: ${recusei.join('. ')}.`);

  // Needs redesign / warnings
  const redesenho = plano.sinalizar.filter((s) => s.assunto === 'iam' || s.assunto === 'lock-in' || s.assunto === 'ami-custom');
  if (redesenho.length > 0) linhas.push(`Needs redesign: ${listar(redesenho.map((s) => s.titulo))}.`);
  // O aviso 'segredo' (valor guardado num cofre) já está coberto pela troca para o OpenBao.
  const avisos = plano.sinalizar.filter((s) => !redesenho.includes(s) && s.assunto !== 'segredo');
  if (avisos.length > 0) linhas.push(`Warnings: ${listar(avisos.map((s) => s.titulo))}.`);

  return linhas.join('\n');
}
