// npm run dev:atacante [-- <ip> ...]     reconhecimento TCP das portas sensíveis
// npm run dev:atacante -- --ssh <ip>     passo de SSH da demo (um só alvo, sempre na allowlist)
// npm run dev:atacante -- --segredos [pasta]   chaves AWS e segredos no código (nível B)
// Sem argumentos: todos os IPs de ALVOS_PERMITIDOS. IPs fora da lista são recusados e nunca contactados.
// Na demo, o reconhecimento corre pelo orquestrador (npm run dev).
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { carregarEnv } from '@mwbe/shared';
import { carregarAllowlist, filtrarAlvos } from './alvos';
import { mainForcaBruta } from './index';
import { PORTAS_ALVO, verificarPortas } from './reconhecimento';
import { varrerSegredos } from './segredos';

const RAIZ_REPO = fileURLToPath(new URL('../../', import.meta.url));

async function mainSegredos(args: string[]): Promise<number> {
  const dir = resolve(RAIZ_REPO, args[0] ?? 'code/exemplo-app');
  const encontrados = await varrerSegredos(dir);
  if (encontrados.length === 0) {
    console.log(`[atacante] nenhum segredo em ${dir}`);
    return 0;
  }
  console.log(`[atacante] ${encontrados.length} segredo(s) em ${dir}`);
  for (const s of encontrados) {
    // O valor nunca é impresso; só o tipo, o nome e o sítio.
    console.log(`  ${s.tipo} (${s.nome}) em ${s.ficheiro}:${s.linha}`);
  }
  return 0;
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args[0] === '--ssh') return mainForcaBruta(args.slice(1));
  if (args[0] === '--segredos') return mainSegredos(args.slice(1));

  carregarEnv();
  const allowlist = carregarAllowlist(process.env.ALVOS_PERMITIDOS);
  const pedidos = args.length > 0 ? args : [...allowlist];
  if (pedidos.length === 0) {
    console.error('[atacante] ALVOS_PERMITIDOS está vazio: nada para testar.');
    return 1;
  }

  // Os recusados ficam de fora antes de qualquer ligação; os permitidos são os únicos contactados.
  const { permitidos, recusados } = filtrarAlvos(pedidos, allowlist);
  for (const alvo of recusados) console.error(`[atacante] recusado (fora da allowlist): ${alvo}`);
  if (permitidos.length === 0) return 1;

  console.log(`[atacante] portas testadas: ${PORTAS_ALVO.join(', ')}`);
  let abertas = 0;
  for (const alvo of permitidos) {
    console.log(`[atacante] ${alvo}`);
    for (const porta of await verificarPortas(alvo, allowlist)) {
      console.log(`  ${porta.porta}/tcp  ${porta.estado}`);
      if (porta.estado === 'aberta') abertas++;
    }
  }
  console.log(`[atacante] ${abertas} porta(s) aberta(s) em ${permitidos.length} alvo(s) da allowlist.`);
  return recusados.length > 0 ? 1 : 0;
}

main()
  .then((codigo) => {
    process.exitCode = codigo;
  })
  .catch((erro) => {
    console.error('[atacante]', erro instanceof Error ? erro.message : erro);
    process.exitCode = 1;
  });
