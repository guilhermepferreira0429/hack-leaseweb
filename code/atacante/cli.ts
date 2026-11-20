// npm run dev:atacante [-- <ip> ...]
// Sem argumentos: todos os IPs de ALVOS_PERMITIDOS. Com argumentos: IPs fora da allowlist são recusados, nunca contactados.
// Imprime os achados; na demo corre pelo orquestrador (npm run dev).
import { naoImplementado } from '@mwbe/shared';

async function main(): Promise<void> {
  // TODO: carregarConfig, reconhecer(process.argv.slice(2) ou allowlist), imprimir achados
  naoImplementado('atacante/cli main');
}

main().catch((erro) => {
  console.error('[atacante]', erro instanceof Error ? erro.message : erro);
  process.exitCode = 1;
});
