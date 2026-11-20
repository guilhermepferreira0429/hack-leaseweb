// Orquestrador: um só processo Node no cérebro.
//   npm run dev                         tudo: migrar -> atacar -> defender -> resumir
//   npm run dev -- --sem-migrador       corte 1 (docs/plano.md)
//   npm run dev -- --sem-atacante       corte 2: a defesa lê só os security groups pela API
//   npm run dev -- --consola            o terminal faz de Telegram (ensaio e plano B); aprova-se com "s"
//   npm run dev -- --uma-vez            sai no fim do ciclo (para ensaios), em vez de ficar à escuta
// A lógica está em orquestrador.ts; aqui só se ligam os módulos reais.
import { fileURLToPath } from 'node:url';
import { auditoria, bus, estado, telegram } from '@mwbe/shared';
import * as defesa from '@mwbe/defesa';
import { reconhecer } from '@mwbe/atacante';
import { analisar, migrarS3, verificar } from '@mwbe/migrador';
import { estadoAtual, resumir } from '@mwbe/chefe';
import { iniciarPainel } from '@mwbe/painel';
import { criarConsola, DONO_CONSOLA } from './consola';
import { criarOrquestrador } from './orquestrador';

const RAIZ = fileURLToPath(new URL('../', import.meta.url));

function carregarEnv(): void {
  try {
    process.loadEnvFile(`${RAIZ}.env`);
  } catch {
    console.warn('[orquestrador] sem .env na raiz: a usar só as variáveis do ambiente.');
  }
}

function lista(valor: string | undefined): string[] {
  return (valor ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function main(): Promise<void> {
  carregarEnv();
  const args = new Set(process.argv.slice(2));
  const consola = args.has('--consola') ? criarConsola() : undefined;
  const canal = consola ?? { telegram, bus };

  const painel = iniciarPainel(Number(process.env.PORT ?? 3000));

  const orquestrador = criarOrquestrador(
    {
      telegram: canal.telegram,
      bus: canal.bus,
      estado,
      auditoria,
      defesa: { ...defesa, tratar: (achado) => defesa.tratar(achado, canal.telegram.pedirAprovacao) },
      atacante: { reconhecer },
      migrador: { analisar, migrarS3, verificar },
      chefe: { resumir, estadoAtual },
    },
    {
      migrar: !args.has('--sem-migrador'),
      atacar: !args.has('--sem-atacante'),
      dirApp: `${RAIZ}code/exemplo-app`,
      alvos: lista(process.env.ALVOS_PERMITIDOS),
      donoId: consola ? DONO_CONSOLA : process.env.TELEGRAM_DONO_ID || undefined,
    },
  );

  orquestrador.ligar();
  await orquestrador.correr();

  if (args.has('--uma-vez')) {
    consola?.fechar();
    painel.close();
    return;
  }
  console.log('[orquestrador] ciclo terminado; o painel e o canal continuam ativos (/estado, /desfazer).');
}

main().catch((erro) => {
  console.error('[orquestrador]', erro instanceof Error ? erro.message : erro);
  process.exitCode = 1;
});
