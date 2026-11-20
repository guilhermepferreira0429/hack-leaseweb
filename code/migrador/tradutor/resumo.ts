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

function nomesPortas(portas: number[]): string {
  return portas.map((p) => `${PORTAS_SENSIVEIS[p] ?? 'porta'} (${p})`).join(', ');
}

const ONDE: Record<'user_data' | 'tags' | 'atributo', string> = {
  user_data: 'no script de arranque',
  tags: 'nas tags',
  atributo: 'no Terraform',
};

export function resumoPlano(plano: PlanoTraducao): string {
  const linhas = ['Plano de migração para a Leaseweb (só plano: ainda nada foi criado).'];

  // Move-se hoje
  const hoje: string[] = [];
  for (const c of plano.criar.filter((c) => c.acao === 'criar-instancia')) hoje.push(c.descricao);
  const regras = plano.criar
    .filter((c) => c.acao === 'autorizar-regras')
    .flatMap((c) => (c.pedido.corpo.rules as { protocol: string; startPort?: number; endPort?: number; source: string }[]) ?? []);
  const abertas = regras
    .filter((r) => (r.source === '0.0.0.0/0' || r.source === '::/0') && r.startPort !== undefined)
    .map((r) => (r.startPort === r.endPort ? `${r.startPort}` : `${r.startPort}-${r.endPort}`));
  if (abertas.length > 0) hoje.push(`portas abertas a todos: ${listar(abertas)}`);
  const recusas = plano.recusar.filter((r): r is Extract<ItemRecusar, { tipo: 'porta-aberta' }> => r.tipo === 'porta-aberta');
  const soAdmin = recusas.filter((r) => r.destino === 'so-admin').flatMap((r) => r.portasSensiveis);
  if (soAdmin.length > 0) hoje.push(`${nomesPortas([...new Set(soAdmin)])} só para o teu IP`);
  if (plano.substituir.length > 0)
    hoje.push(listar(plano.substituir.map((s) => `${s.servicoAws} → ${s.alternativa.split(' ')[0]}`)));
  if (hoje.length > 0) linhas.push(`Move-se hoje: ${hoje.join('. ')}.`);

  // Recusei copiar
  const recusei: string[] = [];
  const fechadas = [...new Set(recusas.filter((r) => r.destino === 'nao-existe').flatMap((r) => r.portasSensiveis))];
  if (fechadas.length > 0) recusei.push(`${nomesPortas(fechadas)} aberto a toda a Internet: no destino fica fechado`);
  const semAdmin = [...new Set(recusas.filter((r) => r.destino === 'admin-ip-em-falta').flatMap((r) => r.portasSensiveis))];
  if (semAdmin.length > 0) recusei.push(`${nomesPortas(semAdmin)} fica fechado até pores o ADMIN_IP no .env`);
  for (const onde of ['user_data', 'tags', 'atributo'] as const) {
    const nomes = plano.recusar.flatMap((r) => (r.tipo === 'segredo' && r.onde === onde ? [r.nome] : []));
    if (nomes.length === 0) continue;
    const n = new Set(nomes).size;
    recusei.push(`${n} ${n === 1 ? 'segredo' : 'segredos'} ${ONDE[onde]} (${listar(nomes)}), não copiados`);
  }
  if (recusei.length > 0) linhas.push(`Recusei copiar: ${recusei.join('. ')}.`);

  // Precisa de redesenho / avisos
  const redesenho = plano.sinalizar.filter((s) => s.assunto === 'iam' || s.assunto === 'lock-in' || s.assunto === 'ami-custom');
  if (redesenho.length > 0) linhas.push(`Precisa de redesenho: ${listar(redesenho.map((s) => s.titulo))}.`);
  const avisos = plano.sinalizar.filter((s) => !redesenho.includes(s));
  if (avisos.length > 0) linhas.push(`Avisos: ${listar(avisos.map((s) => s.titulo))}.`);

  return linhas.join('\n');
}
