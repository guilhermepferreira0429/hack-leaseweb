// npm run dev:atacante [-- <ip> ...]
// Sem argumentos: todos os IPs de ALVOS_PERMITIDOS. Com argumentos: cada IP é validado contra a allowlist;
// qualquer IP fora dela é recusado e registado, nunca contactado.
import { naoImplementado } from '@mwbe/shared';

async function main(): Promise<void> {
  // TODO: carregarConfig, carregarAllowlist, filtrarAlvos(process.argv.slice(2)), campanha
  naoImplementado('atacante/cli main');
}

main().catch((erro) => {
  console.error('[atacante]', erro instanceof Error ? erro.message : erro);
  process.exitCode = 1;
});
