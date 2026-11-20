// Resumo curto do plano, em português simples, para o pedido de migração no Telegram.
// Determinístico: sai só do plano. A IA explica depois; isso não é feito aqui.
import type { ItemRecusar, PlanoTraducao } from './tipos';
import { PORTAS_SENSIVEIS } from './tabelas';

const MAX_POR_LISTA = 3;

function listar(itens: string[]): string {
  const unicos = [...new Set(itens)];
  if (unicos.length <= MAX_POR_LISTA) return unicos.join(', ');
  return `${unicos.slice(0, MAX_POR_LISTA).join(', ')} e mais ${unicos.length - MAX_POR_LISTA}`;
}

function juntar(itens: string[]): string {
  return itens.length <= 1 ? itens.join('') : `${itens.slice(0, -1).join(', ')} e ${itens.at(-1)}`;
}

function nomesPortas(portas: number[]): string {
  return listar(portas.map((p) => `${PORTAS_SENSIVEIS[p] ?? 'porta'} (${p})`));
}

const ONDE: Record<'user_data' | 'tags' | 'atributo', string> = {
  user_data: 'arranque',
  tags: 'tags',
  atributo: 'Terraform',
};

export function resumoPlano(plano: PlanoTraducao): string {
  const linhas = ['Plano para a Leaseweb (nada criado ainda).'];

  // Move-se hoje
  const hoje: string[] = [];
  for (const c of plano.criar.filter((c) => c.acao === 'criar-instancia')) hoje.push(c.descricao);
  const regras = plano.criar
    .filter((c) => c.acao === 'autorizar-regras')
    .flatMap((c) => (c.pedido.corpo.rules as { protocol: string; startPort?: number; endPort?: number; source: string }[]) ?? []);
  const abertas = regras
    .filter((r) => (r.source === '0.0.0.0/0' || r.source === '::/0') && r.startPort !== undefined)
    .map((r) => (r.startPort === r.endPort ? `${r.startPort}` : `${r.startPort}-${r.endPort}`));
  if (abertas.length > 0) hoje.push(`abertas a todos: ${listar(abertas)}`);
  const recusas = plano.recusar.filter((r): r is Extract<ItemRecusar, { tipo: 'porta-aberta' }> => r.tipo === 'porta-aberta');
  const soAdmin = recusas.filter((r) => r.destino === 'so-admin').flatMap((r) => r.portasSensiveis);
  if (soAdmin.length > 0) hoje.push(`${nomesPortas([...new Set(soAdmin)])} só para o teu IP`);
  // Trocas por alternativas abertas, juntas por alternativa (ex.: Secrets Manager e SSM → OpenBao).
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
    ([alternativa, { servicos, soPlano }]) => `${juntar(servicos)} → ${alternativa}${soPlano ? ' (só plano)' : ''}`,
  );
  if (trocas.length > 0) hoje.push(trocas.join(', '));
  if (hoje.length > 0) linhas.push(`Move-se hoje: ${hoje.join('. ')}.`);

  // Recusei copiar
  const recusei: string[] = [];
  const fechadas = [...new Set(recusas.filter((r) => r.destino === 'nao-existe').flatMap((r) => r.portasSensiveis))];
  if (fechadas.length > 0) recusei.push(`${nomesPortas(fechadas)} aberto a todos: fechado`);
  const semAdmin = [...new Set(recusas.filter((r) => r.destino === 'admin-ip-em-falta').flatMap((r) => r.portasSensiveis))];
  if (semAdmin.length > 0) recusei.push(`${nomesPortas(semAdmin)} fechado sem ADMIN_IP no .env`);
  // Segredos: um só total, com os nomes agrupados por sítio.
  const grupos = (['user_data', 'tags', 'atributo'] as const).flatMap((onde) => {
    const nomes = [...new Set(plano.recusar.flatMap((r) => (r.tipo === 'segredo' && r.onde === onde ? [r.nome] : [])))];
    return nomes.length > 0 ? [{ nomes, texto: `${listar(nomes)} (${ONDE[onde]})` }] : [];
  });
  const totalSegredos = grupos.reduce((n, g) => n + g.nomes.length, 0);
  if (totalSegredos > 0)
    recusei.push(`${totalSegredos} ${totalSegredos === 1 ? 'segredo não copiado' : 'segredos não copiados'}: ${grupos.map((g) => g.texto).join('; ')}`);
  if (recusei.length > 0) linhas.push(`Recusei copiar: ${recusei.join('. ')}.`);

  // Precisa de redesenho / avisos
  const redesenho = plano.sinalizar.filter((s) => s.assunto === 'iam' || s.assunto === 'lock-in' || s.assunto === 'ami-custom');
  if (redesenho.length > 0) linhas.push(`Precisa de redesenho: ${listar(redesenho.map((s) => s.titulo))}.`);
  // O aviso 'segredo' (valor guardado num cofre) já está coberto pela troca para o OpenBao.
  const avisos = plano.sinalizar.filter((s) => !redesenho.includes(s) && s.assunto !== 'segredo');
  if (avisos.length > 0) linhas.push(`Avisos: ${listar(avisos.map((s) => s.titulo))}.`);

  return linhas.join('\n');
}
