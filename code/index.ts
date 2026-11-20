// Orquestrador: um só processo Node no cérebro.
//   npm run dev                         tudo: migrar -> atacar -> defender -> resumir
//   npm run dev -- --sem-migrador       corte 1 (docs/plano.md)
//   npm run dev -- --sem-atacante       corte 2: a defesa lê só os security groups pela API
//   npm run dev -- --consola            o terminal faz de Telegram (ensaio e plano B); aprova-se com "s"
//   npm run dev -- --uma-vez            sai no fim do ciclo (para ensaios), em vez de ficar à escuta
//   npm run dev -- --sem-fila           salta o passo SQS -> RabbitMQ (se o contentor rabbitmq não estiver no ar)
//   npm run dev -- --sem-segredos       salta o passo Secrets Manager/SSM -> OpenBao
//   npm run dev -- --sem-cache          salta o passo ElastiCache Redis -> Valkey
// A lógica está em orquestrador.ts; aqui só se ligam os módulos reais.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  auditoria,
  bus,
  estado,
  relatorio,
  responderComoAgente,
  telegram,
} from "@mwbe/shared";
import * as defesa from "@mwbe/defesa";
import { carregarAllowlist, iniciarAtaque, reconhecer } from "@mwbe/atacante";
import {
  analisar,
  migrarCache,
  migrarFila,
  migrarPostgres,
  migrarS3,
  migrarSegredos,
  verificar,
} from "@mwbe/migrador";
import { certificado, estadoAtual, resumir } from "@mwbe/chefe";
import { iniciarPainel } from "@mwbe/painel";
import {
  decidirDestino,
  mensagemDestino,
  resumoPlano,
  traduzir,
} from "./migrador/tradutor/index";
import { migrarCodigo } from "./migrador/codigo/index";
import { criarConsola, DONO_CONSOLA } from "./consola";
import { criarOrquestrador } from "./orquestrador";

const RAIZ = fileURLToPath(new URL("../", import.meta.url));

function carregarEnv(): void {
  try {
    process.loadEnvFile(`${RAIZ}.env`);
  } catch {
    console.warn(
      "[orquestrador] sem .env na raiz: a usar só as variáveis do ambiente.",
    );
  }
}

/** Configuração AWS a traduzir: TERRAFORM_ORIGEM no .env, ou o exemplo da demo. Lida como texto (segredos com linha). */
async function planoInfra(): Promise<string | undefined> {
  const ficheiro =
    process.env.TERRAFORM_ORIGEM ||
    `${RAIZ}code/migrador/tradutor/exemplo/main.tf.json`;
  if (!existsSync(ficheiro)) return undefined;
  return resumoPlano(traduzir(readFileSync(ficheiro, "utf8")));
}

const NOME_SERVICO = { s3: "S3", postgres: "PostgreSQL", fila: "SQS" } as const;

/** Decisor de destino: só fala se a capacidade da VM destino estiver no .env (VM_DESTINO_*); nada se adivinha. */
async function planoDestino(
  servicos: ("s3" | "postgres" | "fila")[],
): Promise<string | undefined> {
  const n = (v: string | undefined) =>
    v && Number(v) > 0 ? Number(v) : undefined;
  const ram = n(process.env.VM_DESTINO_RAM_GB);
  const vcpu = n(process.env.VM_DESTINO_VCPU);
  const disco = n(process.env.VM_DESTINO_DISCO_GB);
  if (!ram || !vcpu || !disco || servicos.length === 0) return undefined;
  const vm = { ramLivreGb: ram, vcpuLivres: vcpu, discoLivreGb: disco };
  const decisoes = decidirDestino({
    servicos: servicos.map((servico) => ({
      servico,
      nome: NOME_SERVICO[servico],
    })),
    vm,
    temBackups: process.env.DONO_TEM_BACKUPS === "sim",
  });
  return mensagemDestino(decisoes, vm);
}

async function main(): Promise<void> {
  carregarEnv();
  const args = new Set(process.argv.slice(2));
  const consola = args.has("--consola") ? criarConsola() : undefined;
  const canal = consola ?? { telegram, bus };

  const painel = iniciarPainel(Number(process.env.PORT ?? 3000), {
    desfazer: (id) => defesa.desfazer(id, canal.telegram.notificar),
  });

  const orquestrador = criarOrquestrador(
    {
      telegram: canal.telegram,
      bus: canal.bus,
      estado,
      auditoria,
      // Os avisos da defesa ("Fechado e confirmado…", "Desfeito…") vão pelo mesmo canal (Telegram ou --consola).
      defesa: {
        ...defesa,
        tratar: (achado) =>
          defesa.tratar(achado, canal.telegram.pedirAprovacao),
        corrigir: (pedido) => defesa.corrigir(pedido, canal.telegram.notificar),
        desfazer: (id) => defesa.desfazer(id, canal.telegram.notificar),
        modoNoite: (pedido) =>
          defesa.modoNoite(pedido, canal.telegram.notificar),
      },
      atacante: { reconhecer, iniciarAtaque },
      migrador: {
        analisar,
        migrarS3,
        migrarPostgres,
        migrarFila: args.has("--sem-fila") ? undefined : migrarFila,
        migrarSegredos: args.has("--sem-segredos") ? undefined : migrarSegredos,
        migrarCache: args.has("--sem-cache") ? undefined : migrarCache,
        verificar,
        planoInfra,
        planoDestino,
        // PR real no GitHub só com MIGRADOR_PR=real; por omissão é um ensaio (o diff fica numa pasta temporária).
        migrarCodigo: (planoId, testesOk) =>
          migrarCodigo(`${RAIZ}code/exemplo-app`, {
            raizRepo: RAIZ,
            id: planoId,
            testesOk,
            real: process.env.MIGRADOR_PR === 'real',
            // O PR abre no repo público da app (docs/agentes/checkup-12h.md); o token só serve para esse repo.
            repoApp: process.env.MIGRADOR_PR_REPO || undefined,
            token: process.env.GITHUB_TOKEN_EXEMPLO || undefined,
          }),
      },
      // Relatório do incidente (David) no grupo "Direção", com um Desfazer por passo. Na --consola não há grupo.
      relatorio: consola
        ? undefined
        : { publicar: (achadoId) => relatorio.publicarRelatorio(achadoId) },
      voz: {
        responder: (agente, pergunta, estadoTexto) =>
          responderComoAgente(agente, pergunta, estadoTexto),
      },
      chefe: {
        resumir,
        estadoAtual,
        certificado: (eventos, pedidos) =>
          certificado(eventos, pedidos, process.env.LOCAL_DADOS || undefined),
      },
    },
    {
      migrar: !args.has("--sem-migrador"),
      atacar: !args.has("--sem-atacante"),
      dirApp: `${RAIZ}code/exemplo-app`,
      // Falha fechado: uma entrada que não seja IP literal faz o arranque parar, nunca alarga a vedação.
      alvos: [...carregarAllowlist(process.env.ALVOS_PERMITIDOS)],
      donoId: consola
        ? DONO_CONSOLA
        : process.env.TELEGRAM_DONO_ID || undefined,
      // Modo noite só com MODO_NOITE_MINUTOS e MODO_NOITE_IPS no .env (falha fechado: sem eles, não há).
      modoNoiteMs:
        (defesa.configModoNoite()?.minutos ?? 0) * 60_000 || undefined,
      esperaDecisaoMs:
        Number(process.env.ESPERA_DECISAO_MS) > 0
          ? Number(process.env.ESPERA_DECISAO_MS)
          : undefined,
    },
  );

  orquestrador.ligar();
  await orquestrador.correr();

  if (args.has("--uma-vez")) {
    consola?.fechar();
    painel.close();
    return;
  }
  console.log(
    "[orquestrador] ciclo terminado; o painel e o canal continuam ativos (/estado, /desfazer).",
  );
}

main().catch((erro) => {
  console.error("[orquestrador]", erro instanceof Error ? erro.message : erro);
  process.exitCode = 1;
});
