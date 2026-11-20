// npm run lsw:ensaio -- <securityGroupId> <regraId> [ipVitima]
// Ensaio do ciclo REAL sem Telegram nem LLM: fecha uma regra e volta a abri-la, com nmap antes e depois.
// Mexe na infraestrutura: só aceita grupos em LSW_SG_GERIDOS e grava tudo na auditoria (pedidoId "ensaio-...").
import type { Pedido } from '@mwbe/shared';
import { carregarConfig, leaseweb } from '@mwbe/shared';
import { corrigir } from './corrigir';
import { desfazer } from './desfazer';
import { estadoPorta } from './verificar-porta';

const t0 = Date.now();
const log = (msg: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(5)} s] ${msg}`);

async function nmap(ip: string | undefined, porta: number): Promise<void> {
  if (!ip) return;
  try {
    log(`nmap ${ip}:${porta} -> ${await estadoPorta(ip, porta)}`);
  } catch (erro) {
    log(`nmap falhou: ${erro instanceof Error ? erro.message : erro}`);
  }
}

async function main(): Promise<void> {
  const [sg, regraId, ip] = process.argv.slice(2);
  if (!sg || !regraId) throw new Error('Uso: npm run lsw:ensaio -- <securityGroupId> <regraId> [ipVitima]');
  const cfg = carregarConfig(['LSW_API_KEY']);
  if (!cfg.leaseweb.securityGroupsGeridos.includes(sg)) throw new Error(`${sg} não está em LSW_SG_GERIDOS`);

  const regra = (await leaseweb.listarRegras(sg)).find((r) => r.id === regraId);
  if (!regra) throw new Error(`Regra ${regraId} não existe em ${sg}`);
  log(`regra: ${regra.protocol} ${regra.startPort}-${regra.endPort} de ${regra.source}`);
  await nmap(ip, regra.startPort);

  const pedido: Pedido = {
    id: `ensaio-${new Date().toISOString().replace(/[:.]/g, '')}`,
    titulo: `Ensaio: ${regra.protocol} ${regra.startPort} aberto a ${regra.source}`,
    texto: 'Ensaio do ciclo real (sem Telegram).',
    acao: { tipo: 'remover_regra', securityGroupId: sg, regra },
    estado: 'aprovado',
  };
  log('a fechar (revoke + esperar que desapareça)...');
  await corrigir(pedido);
  log('fechada e confirmada pela API');
  await nmap(ip, regra.startPort);

  log('a desfazer (authorize + esperar ACTIVE)...');
  await desfazer(pedido.id);
  log('reposta e confirmada pela API');
  await nmap(ip, regra.startPort);
  log(`ciclo completo. Auditoria: ${pedido.id}`);
}

main().catch((erro) => {
  console.error('[ensaio]', erro instanceof Error ? erro.message : erro);
  process.exitCode = 1;
});
