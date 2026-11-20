// Verificação vista de fora, com nmap: a porta está open, closed ou filtered?
// Antes de fechar deve dar "open"; depois de remover a regra no security group, "filtered".
// Só toca em IPs de ALVOS_PERMITIDOS (a mesma vedação do atacante). Um único pacote por porta, sem scripts.
import { execFile } from 'node:child_process';
import { carregarConfig } from '@mwbe/shared';

export type EstadoPorta = 'open' | 'closed' | 'filtered' | 'desconhecido';

/** Função pura: lê o estado da porta na saída "grepable" do nmap (-oG -). */
export function lerEstadoNmap(saida: string, porta: number): EstadoPorta {
  const m = new RegExp(`\\b${porta}/(open|closed|filtered|open\\|filtered)/tcp`).exec(saida);
  if (!m) return 'desconhecido';
  return m[1] === 'open|filtered' ? 'filtered' : (m[1] as EstadoPorta);
}

export function estadoPorta(ip: string, porta: number): Promise<EstadoPorta> {
  const { alvosPermitidos } = carregarConfig([]);
  if (!alvosPermitidos.includes(ip)) return Promise.reject(new Error(`${ip} não está em ALVOS_PERMITIDOS: recusado`));
  if (!Number.isInteger(porta) || porta < 1 || porta > 65535) return Promise.reject(new Error(`Porta inválida: ${porta}`));
  return new Promise((ok, falha) =>
    execFile(
      'nmap',
      ['-Pn', '-n', '-sT', '--max-retries', '1', '--host-timeout', '20s', '-p', String(porta), '-oG', '-', ip],
      { timeout: 30_000 },
      (erro, stdout) => (erro ? falha(erro) : ok(lerEstadoNmap(stdout, porta))),
    ),
  );
}

// npm run lsw:nmap -- <ip> <porta>
if (import.meta.url === `file://${process.argv[1]}`) {
  const [ip, porta] = process.argv.slice(2);
  estadoPorta(ip, Number(porta))
    .then((e) => console.log(`${ip}:${porta} -> ${e}`))
    .catch((erro) => {
      console.error('[nmap]', erro instanceof Error ? erro.message : erro);
      process.exitCode = 1;
    });
}
