// npm run dev:atacante [-- <ip> ...]     reconhecimento TCP das portas sensíveis
// npm run dev:atacante -- --ssh <ip>     passo de SSH da demo (um só alvo, sempre na allowlist)
// npm run dev:atacante -- --segredos [pasta]   chaves AWS e segredos no código (nível B)
// npm run dev:atacante -- --extras <ip>   TLS/cabeçalhos, credenciais de fábrica e bucket público (nível B)
// Sem argumentos: todos os IPs de ALVOS_PERMITIDOS. IPs fora da lista são recusados e nunca contactados.
// Na demo, o reconhecimento corre pelo orquestrador (npm run dev).
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { carregarEnv } from '@mwbe/shared';
import { carregarAllowlist, filtrarAlvos } from './alvos';
import { executarExtras } from './extras';
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

async function mainExtras(args: string[]): Promise<number> {
  carregarEnv();
  const allowlist = carregarAllowlist(process.env.ALVOS_PERMITIDOS);
  if (allowlist.size === 0) {
    console.error('[atacante] ALVOS_PERMITIDOS está vazio: nenhum alvo permitido.');
    return 1;
  }

  const alvoPedido = args.find((a) => !a.startsWith('--'));
  if (!alvoPedido && allowlist.size > 1) {
    console.error('[atacante] há vários IPs na allowlist: indica o alvo dos extras.');
    return 1;
  }
  const alvo = alvoPedido ?? [...allowlist][0]!;
  const bucket = process.env.ATACANTE_BUCKET || process.env.ARMAZENAMENTO_BUCKET || '';
  const portaBucket = Number.parseInt(process.env.ATACANTE_BUCKET_PORTA ?? '9000', 10) || 9000;

  console.log(`[atacante] extras em ${alvo}${bucket ? ` (bucket ${bucket}:${portaBucket})` : ''}`);
  const achados = await executarExtras(alvo, allowlist, { bucket, portaBucket });
  if (achados.length === 0) {
    console.log('[atacante] extras: nada encontrado');
    return 0;
  }
  for (const a of achados) {
    console.log(`  [${a.severidade}] ${a.servico ?? 'serviço'} porta ${a.porta}: ${a.detalhe}`);
  }
  return 0;
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args[0] === '--ssh') return mainForcaBruta(args.slice(1));
  if (args[0] === '--segredos') return mainSegredos(args.slice(1));
  if (args[0] === '--extras') return mainExtras(args.slice(1));

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
