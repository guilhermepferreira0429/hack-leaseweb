// Lógica do orquestrador, com as dependências injetadas (testável sem Telegram, Leaseweb nem nmap).
// code/index.ts liga isto aos módulos reais.
//
// Fluxo (docs/agentes-telegram.md, docs/demo.md):
//   migrar   migrador.analisar -> um só "Aprovar plano" -> cada passo com prova (S3, Postgres, fila, ...) -> verificar
//   atacar   atacante.reconhecer(ALVOS_PERMITIDOS)
//   defender defesa.detetar (API) + correlacionar -> tratar cada achado com regra
//   fechar   aprovado -> defesa.corrigir -> atacante volta a confirmar
//   resumir  chefe.resumir
// Cortes (docs/plano.md): sem migrador e/ou sem atacante; a defesa pela API fica sempre.
// Uma falha numa fase é auditada e avisada, e o fluxo continua: a demo não pára.
import { isIP } from "node:net";
import type {
  Acao,
  Achado,
  Agente,
  Decisao,
  EventoAuditoria,
  Mensagem,
  Pedido,
  EstadoPedido,
  PassoDemo,
} from "@mwbe/shared";
import {
  PENSAR,
  msgAbertura,
  msgAtacanteConfirma,
  msgPlanoAprovado,
  msgValidacao,
} from "@mwbe/shared";

export interface Dependencias {
  telegram: {
    pedirAprovacao(agente: Agente, pedido: Pedido): Promise<void>;
    aoResponder(
      cb: (pedidoId: string, decisao: Decisao, quem: string) => void,
    ): void;
    aoMensagemDoDono(cb: (agente: Agente | null, texto: string) => void): void;
    notificar(texto: string): Promise<void>;
    /** Anexo no grupo (ex.: o relatório PDF). Opcional: sem ele, não se anexa. */
    enviarDocumento?(agente: Agente, nome: string, conteudo: string | Uint8Array, legenda?: string, tipo?: string): Promise<void>;
  };
  bus: { enviar(m: Mensagem): void };
  estado: {
    guardarPedido(p: Pedido): void;
    obterPedido(id: string): Pedido | undefined;
    mudarEstado(id: string, e: EstadoPedido): Pedido;
    listarPedidos(): Pedido[];
  };
  auditoria: { registar(e: EventoAuditoria): void; ler(): EventoAuditoria[] };
  defesa: {
    detetar(): Promise<Achado[]>;
    correlacionar(daApi: Achado[], doAtacante: Achado[]): Achado[];
    acaoPara(achado: Achado): Pedido["acao"] | undefined;
    tratar(achado: Achado): Promise<Pedido>;
    corrigir(pedido: Pedido): Promise<void>;
    desfazer(pedidoId: string): Promise<void>;
    novoIdPedido(): string;
    /**
     * Modo noite (ideia wow 4): sem resposta do dono a uma falha crítica, medida temporária e reversível.
     * Devolve true se aplicou; false se não era elegível (o pedido fica para o dono).
     */
    modoNoite?(pedido: Pedido): Promise<boolean>;
  };
  atacante: {
    reconhecer(alvos: string[]): Promise<Achado[]>;
    /** /atacar no grupo: corre a sequência e relata pelo bus. Opcional para os testes antigos. */
    iniciarAtaque?(opcoes: {
      alvo?: string;
      log?: (texto: string) => void;
      /** A defesa reage entre rondas (reconhecimento/extras) antes da tentativa seguinte. */
      aoRonda?: (ronda: {
        nome: "reconhecimento" | "extras";
        achados: Achado[];
      }) => Promise<void> | void;
    }): Promise<unknown>;
  };
  migrador: {
    analisar(
      dirApp: string,
    ): Promise<{ servicos: PassoMigracao[]; plano: string }>;
    migrarS3(): Promise<{ objetos: number; checksumsOk: boolean }>;
    verificar(): Promise<{ antes: boolean; depois: boolean }>;
    /** Nível B: RDS PostgreSQL -> PostgreSQL na Leaseweb, com prova por tabela. */
    migrarPostgres?(): Promise<{
      tabelas: number;
      linhas: number;
      checksumsOk: boolean;
    }>;
    /** SQS -> RabbitMQ na Leaseweb, com prova por contagem e sha256 das mensagens. */
    migrarFila?(): Promise<{ mensagens: number; iguais: boolean }>;
    /** Secrets Manager / SSM -> OpenBao. A prova nunca leva valores, só contagem e sha256. */
    migrarSegredos?(): Promise<{ segredos: number; iguais: boolean }>;
    /** ElastiCache Redis -> Valkey, com prova por chave, tipo e valor. */
    migrarCache?(): Promise<{ chaves: number; iguais: boolean }>;
    /** Migrador de código: PR com a app a usar a Leaseweb. Só se os testes passaram; nunca push para main. */
    migrarCodigo?(planoId: string, testesOk: boolean): Promise<ResultadoCodigo>;
    /** Merge do PR no repo da app (botão "Aprovar PR"). Devolve o commit do merge, para o inverso. */
    aprovarPR?(repo: string, numero: number): Promise<{ commit?: string }>;
    /** Inverso do merge: abre um PR que reverte o commit (o merge desse volta a ser de uma pessoa). */
    reverterPR?(
      repo: string,
      numero: number,
      commit?: string,
    ): Promise<{ url?: string }>;
    /** Resumo do tradutor AWS (Terraform) -> Leaseweb, só plano. undefined = não há configuração AWS para traduzir. */
    planoInfra?(): Promise<string | undefined>;
    /** Decisor de destino (self-hosted ou gerido europeu), só informativo. undefined = não há dados da VM. */
    planoDestino?(servicos: PassoMigracao[]): Promise<string | undefined>;
  };
  /** Voz dos agentes: resposta em texto, no papel do agente, a partir do estado. Opcional. */
  voz?: {
    responder(
      agente: Agente,
      pergunta: string,
      estado: string,
    ): Promise<string>;
  };
  /** Relatório do incidente no grupo "Direção" (shared/relatorio.ts), um por achado tratado no ciclo. Opcional. */
  relatorio?: {
    publicar(achadoId: string, eventos: EventoAuditoria[]): Promise<unknown>;
  };
  chefe: {
    resumir(eventos: EventoAuditoria[], pedidos: Pedido[]): string;
    estadoAtual(pedidos: Pedido[]): string;
    /** Certificado de migração (ideia wow 3), dito pelo chefe no fim. */
    certificado?(eventos: EventoAuditoria[], pedidos: Pedido[]): string;
    /** O relatório da demo como ficheiro (PDF A4), para anexar no Telegram. */
    relatorioFicheiro?(eventos: EventoAuditoria[], pedidos: Pedido[]): { nome: string; conteudo: string | Uint8Array; tipo?: string };
  };
}

/** O que o migrador de código devolve (code/migrador/codigo). */
export interface ResultadoCodigo {
  ficheiros: string[];
  fora: string[];
  problemas: string[];
  /** Regras abertas a toda a Internet corrigidas na configuração (a causa da falha). */
  causas?: number;
  pr?: { ramo: string; simulado: boolean; url?: string };
}

export interface Opcoes {
  migrar: boolean;
  atacar: boolean;
  dirApp: string;
  alvos: string[];
  /** Se definido, só aceita decisões e comandos deste utilizador (defesa em profundidade; o telegram.ts já filtra). */
  donoId?: string;
  /** Outros que também podem decidir (TELEGRAM_APROVADORES, ex.: o jurado da ideia wow 1). */
  aprovadores?: string[];
  /** Quanto se espera pelas decisões do dono antes de seguir (por omissão ESPERA_DECISAO_MS = 10 min). */
  esperaDecisaoMs?: number;
  /** Modo noite: ao fim deste tempo sem resposta, chama defesa.modoNoite. Sem valor, não há modo noite. */
  modoNoiteMs?: number;
  agora?: () => Date;
  log?: (...args: unknown[]) => void;
}

export const ESPERA_DECISAO_MS = 10 * 60_000;

export type Resultado = "feito" | "ignorado" | "falhou" | "aprovado";

type PassoMigracao = Extract<Acao, { tipo: "migrar" }>["passo"];

const NOME_SERVICO: Record<PassoMigracao, string> = {
  s3: "S3",
  postgres: "Postgres",
  fila: "SQS",
  segredos: "Secrets Manager",
  cache: "ElastiCache",
};

export function criarOrquestrador(deps: Dependencias, opcoes: Opcoes) {
  const agora = opcoes.agora ?? (() => new Date());
  const log =
    opcoes.log ?? ((...a: unknown[]) => console.log("[orquestrador]", ...a));
  const espera = new Map<string, (r: Resultado) => void>();
  /** Achado que deu origem a cada pedido da defesa (para o atacante confirmar no alvo certo). */
  const achadoDoPedido = new Map<string, Achado>();
  /** Achados com pedido da defesa neste ciclo: cada um leva um relatório do incidente no fim. */
  const achadosDoCiclo = new Set<string>();
  /** Temporizadores do modo noite, por pedido da defesa. Saem quando o dono decide. */
  const noite = new Map<string, ReturnType<typeof setTimeout>>();
  /** Ataque lançado ao aprovar o plano: corre em paralelo com a migração. */
  let ataqueDoPlano: Promise<unknown> | undefined;
  /** Resultados da defesa que correu entre rondas do ataque. */
  const resultadosDuranteAtaque: Promise<Resultado>[] = [];
  /** Achados que o atacante encontrou nas rondas (a porta pode já estar fechada quando o ciclo segue). */
  const achadosDuranteAtaque: Achado[] = [];
  let pensouAtacar = false;

  const hora = () => agora().toISOString();
  const horaCurta = () =>
    agora().toLocaleTimeString("pt-PT", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Lisbon",
    });
  // As peças dos outros podem ainda ser stubs que lançam de forma síncrona: nada disso pode parar a demo.
  function falar(de: Agente, para: Mensagem["para"], texto: string): void {
    try {
      deps.bus.enviar({ de, para, texto });
    } catch (erro) {
      log(`bus falhou (${de} -> ${para}):`, mensagem(erro), "|", texto);
    }
  }

  /** Cópia local do que se auditou: se a auditoria falhar, o resumo do chefe continua a ter números. */
  const eventosLocais: EventoAuditoria[] = [];

  function auditar(e: Omit<EventoAuditoria, "hora">): void {
    const evento = { hora: hora(), ...e };
    eventosLocais.push(evento);
    try {
      deps.auditoria.registar(evento);
    } catch (erro) {
      log("auditoria falhou:", mensagem(erro));
    }
  }

  function lerAuditoria(): EventoAuditoria[] {
    try {
      return deps.auditoria.ler();
    } catch (erro) {
      log("auditoria.ler falhou, a usar a cópia local:", mensagem(erro));
      return eventosLocais;
    }
  }

  async function notificar(texto: string): Promise<void> {
    try {
      await deps.telegram.notificar(texto);
    } catch (erro) {
      log("notificar falhou:", mensagem(erro), "|", texto);
    }
  }

  async function falha(fase: string, erro: unknown): Promise<void> {
    log(`${fase} falhou:`, mensagem(erro));
    auditar({
      pedidoId: "-",
      tipo: "erro",
      quem: "orquestrador",
      depois: { fase, erro: mensagem(erro) },
    });
    await notificar(`Failure in ${fase}: ${mensagem(erro)}. The demo goes on.`);
  }

  /** Respostas que chegaram antes de alguém estar à espera (o dono pode ser mais rápido do que o fluxo). */
  const antecipados = new Map<string, Resultado>();

  /** A auditoria acumula todos os ensaios do dia: o chefe e a voz só falam do ciclo atual. */
  let inicioCiclo = hora();
  /** O que se mediu neste ciclo, para a validação final do chefe. undefined = não medido. */
  let medido: {
    testes?: boolean;
    dadosIguais?: boolean;
    nadaExposto?: boolean;
  } = {};
  /** Migração aprovada e feita neste ciclo: o PR do código abre depois da defesa (docs/agentes/mensagens-demo.md, passo 6). */
  let codigoPorFazer: { planoId: string; testesOk: boolean } | undefined;

  /** Linha "a pensar" do painel (docs/agentes/mensagens-demo.md): texto fixo por passo, nunca do modelo. */
  function pensar(passo: PassoDemo): void {
    const { agente, texto } = PENSAR[passo];
    auditar({
      pedidoId: "-",
      tipo: "pensar",
      quem: agente,
      depois: { passo, texto },
    });
  }
  const doCiclo = () => lerAuditoria().filter((e) => e.hora >= inicioCiclo);

  function esperarResultado(pedidoId: string): Promise<Resultado> {
    const ja = antecipados.get(pedidoId);
    if (ja) {
      antecipados.delete(pedidoId);
      return Promise.resolve(ja);
    }
    return new Promise((resolve) => espera.set(pedidoId, resolve));
  }

  /** Espera por `p`, mas no máximo esperaDecisaoMs: o dono pode nunca responder. */
  function comLimite<T>(p: Promise<T>): Promise<T | "sem-resposta"> {
    let relogio: ReturnType<typeof setTimeout> | undefined;
    const limite = new Promise<"sem-resposta">((r) => {
      relogio = setTimeout(
        () => r("sem-resposta"),
        opcoes.esperaDecisaoMs ?? ESPERA_DECISAO_MS,
      );
    });
    return Promise.race([p, limite]).finally(() => clearTimeout(relogio));
  }

  function concluir(pedidoId: string, r: Resultado): void {
    const resolver = espera.get(pedidoId);
    if (resolver) {
      espera.delete(pedidoId);
      resolver(r);
    } else {
      antecipados.set(pedidoId, r);
    }
  }

  // ---------- respostas do dono ----------

  async function aoResponder(
    pedidoId: string,
    decisao: Decisao,
    quem: string,
  ): Promise<void> {
    if (
      opcoes.donoId &&
      quem !== opcoes.donoId &&
      !(opcoes.aprovadores ?? []).includes(quem)
    ) {
      log(`decisão de ${quem} ignorada (não é o dono nem um aprovador)`);
      return;
    }
    const pedido = deps.estado.obterPedido(pedidoId);
    pararModoNoite(pedidoId);
    if (!pedido || pedido.estado !== "pendente") {
      log(
        `decisão para ${pedidoId} ignorada (${pedido ? `estado ${pedido.estado}` : "pedido desconhecido"})`,
      );
      return;
    }
    const aprovado = decisao === "aprovar";
    deps.estado.mudarEstado(pedidoId, aprovado ? "aprovado" : "ignorado");
    auditar({ pedidoId, tipo: aprovado ? "aprovado" : "ignorado", quem });

    if (!aprovado) return concluir(pedidoId, "ignorado");
    // A migração continua no próprio fluxo (faseMigrar está à espera).
    if (pedido.acao.tipo === "migrar") {
      concluir(pedidoId, "aprovado");
      // Plano aprovado: o atacante começa já, enquanto o migrador copia (o fluxo vê-se seguido no grupo).
      // Entre rondas, a defesa deteta e pede aprovação; o atacante só continua depois de a defesa agir.
      if (opcoes.atacar && deps.atacante.iniciarAtaque) {
        ataqueDoPlano = deps.atacante
          .iniciarAtaque({
            alvo: opcoes.alvos[0],
            log: (texto) => log("atacante:", texto),
            aoRonda: async (ronda) => {
              if (ronda.achados.length === 0) return;
              if (!pensouAtacar) {
                pensar("atacar");
                pensouAtacar = true;
              }
              // O atacante anuncia o que encontrou; a defesa responde já a seguir (no grupo).
              falar("atacante", "dono", textoAtacante(ronda.achados));
              achadosDuranteAtaque.push(...ronda.achados);
              if (ronda.nome === "reconhecimento")
                auditar({
                  pedidoId: "-",
                  tipo: "reconhecimento",
                  quem: "atacante",
                  depois: {
                    alvos: opcoes.alvos,
                    achados: ronda.achados.length,
                    portas: ronda.achados.map((a) => ({
                      alvo: a.alvo,
                      porta: a.porta,
                      servico: a.servico,
                    })),
                  },
                });
              const resultados = await faseDefender(ronda.achados);
              resultadosDuranteAtaque.push(...resultados);
              // O atacante espera pela decisão do dono: a tentativa e o fecho ficam lado a lado no grupo.
              await comLimite(Promise.all(resultados));
            },
          })
          .catch((erro) =>
            log(
              `atacante: ${erro instanceof Error ? erro.message : String(erro)}`,
            ),
          );
      }
      return;
    }
    if (pedido.acao.tipo === "aprovar_pr")
      return concluir(
        pedidoId,
        await fazerMergePR(pedido as Pedido & { acao: { tipo: "aprovar_pr" } }),
      );

    try {
      await deps.defesa.corrigir({ ...pedido, estado: "aprovado" });
    } catch (erro) {
      await falha(`fechar "${pedido.titulo}"`, erro);
      falar(
        "defesa",
        "dono",
        `I could not close "${pedido.titulo}". Nothing was changed without confirmation; check the dashboard.`,
      );
      return concluir(pedidoId, "falhou");
    }
    // O aviso "Fechado e confirmado às HH:MM ... /desfazer <id>" já vem do corrigir(); aqui só se passa a vez ao atacante.
    falar(
      "defesa",
      "atacante",
      `@atacante, I closed "${pedido.titulo}" at ${horaCurta()} and stored how to undo it. Can you confirm?`,
    );
    if (opcoes.atacar) await confirmarFecho(pedido);
    concluir(pedidoId, "feito");
  }

  /** O atacante volta à porta que foi fechada e diz se ainda lá chega. */
  async function confirmarFecho(pedido: Pedido): Promise<void> {
    if (pedido.acao.tipo !== "remover_regra") return;
    const { startPort, endPort } = pedido.acao.regra;
    // Com o IP do alvo conhecido, só conta esse alvo: outra máquina da allowlist com a mesma porta
    // aberta (o isco tem a 22) não é sinal de que o fecho falhou. Sem IP (só instanceId), conta a porta.
    const alvo = achadoDoPedido.get(pedido.id)?.alvo;
    const doAlvo = (a: Achado) => !alvo || !isIP(alvo) || a.alvo === alvo;
    try {
      const achados = await deps.atacante.reconhecer(opcoes.alvos);
      const ainda = achados.filter(
        (a) => doAlvo(a) && a.porta >= startPort && a.porta <= endPort,
      );
      // Várias portas fechadas no ciclo: basta uma ainda aberta para não estar tudo fechado.
      medido.nadaExposto = (medido.nadaExposto ?? true) && ainda.length === 0;
      // Para o certificado (secção 3, "Confirmação do atacante").
      auditar({
        pedidoId: pedido.id,
        tipo: "confirmacao-atacante",
        quem: "atacante",
        depois: { chega: ainda.length > 0 },
      });
      falar(
        "atacante",
        "todos",
        ainda.length === 0
          ? msgAtacanteConfirma()
          : `I can still reach port ${ainda[0].porta} on ${ainda[0].alvo}. It may take a few seconds to apply.`,
      );
    } catch (erro) {
      await falha("attacker confirmation", erro);
    }
  }

  async function aoMensagemDoDono(
    agente: Agente | null,
    texto: string,
  ): Promise<void> {
    const t = texto.trim();
    if (t === "/estado" || t.startsWith("/estado@")) {
      await notificar(deps.chefe.estadoAtual(deps.estado.listarPedidos()));
      return;
    }
    const desfazer = t.match(/^\/desfazer(?:@\S+)?\s+(\S+)/);
    if (desfazer) {
      const id = desfazer[1];
      try {
        const alvo = deps.estado.obterPedido(id);
        if (alvo?.acao.tipo === "aprovar_pr") {
          await reverterMergePR(
            alvo as Pedido & { acao: { tipo: "aprovar_pr" } },
          );
          return;
        }
        // O aviso "Desfeito às HH:MM: a regra voltou (...)" já vem do desfazer() da defesa.
        await deps.defesa.desfazer(id);
        log(`pedido ${id} desfeito`);
      } catch (erro) {
        await falha(`desfazer ${id}`, erro);
      }
      return;
    }

    const atacar = t.match(/^\/atacar(?:@\S+)?(?:\s+(\S+))?$/);
    if (atacar) {
      if (!deps.atacante.iniciarAtaque) {
        await notificar("The attack is not enabled in this process.");
        return;
      }
      try {
        // A sequência relata sozinha pelo bus; aqui só se arranca e injeta o log do orquestrador.
        await deps.atacante.iniciarAtaque({
          alvo: atacar[1],
          log: (texto) => log("atacante:", texto),
        });
      } catch (erro) {
        await falha("atacar", erro);
      }
      return;
    }
    // Voz dos agentes: só responde a quem foi chamado (privado ou com menção); no grupo sem menção, cala-se.
    if (!agente || !deps.voz || !t) {
      log(
        `mensagem do dono para ${agente ?? "ninguém"} sem comando: ${t.slice(0, 80)}`,
      );
      return;
    }
    const pedidos = deps.estado.listarPedidos();
    let estadoTexto = deps.chefe.estadoAtual(pedidos);
    try {
      estadoTexto += `

${deps.chefe.resumir(doCiclo(), pedidos)}`;
    } catch (erro) {
      log("resumo para a voz falhou:", mensagem(erro));
    }
    falar(agente, "dono", await deps.voz.responder(agente, t, estadoTexto));
  }

  // ---------- fases ----------

  /** O tradutor só informa (dry-run): um erro dele não trava a migração dos dados. */
  async function mostrarPlanoInfra(): Promise<void> {
    if (!deps.migrador.planoInfra) return;
    try {
      const resumo = await deps.migrador.planoInfra();
      if (!resumo) return;
      auditar({
        pedidoId: "-",
        tipo: "migracao-plano-infra",
        quem: "migrador",
        depois: { resumo },
      });
      falar(
        "migrador",
        "dono",
        `I read the AWS configuration (Terraform) and translated it to Leaseweb. For now it is only the plan; I have not created anything:
${resumo}`,
      );
    } catch (erro) {
      await falha("AWS configuration translation", erro);
    }
  }

  /** Onde fica cada serviço (regras do decisor, preços com data). Só informa; um erro não trava a migração. */
  async function mostrarPlanoDestino(servicos: PassoMigracao[]): Promise<void> {
    if (!deps.migrador.planoDestino) return;
    try {
      const texto = await deps.migrador.planoDestino(servicos);
      if (!texto) return;
      auditar({
        pedidoId: "-",
        tipo: "migracao-plano-destino",
        quem: "migrador",
        depois: { texto },
      });
      // A recomendação mostra o raciocínio e os preços; nada se contrata. Hoje migra-se tudo para a VM.
      const geridos = /proponho|propose|recommend/i.test(texto);
      falar(
        "migrador",
        "dono",
        geridos
          ? `${texto}\nThis is only my recommendation: in this migration everything stays on the VM (self-hosted) and I do not buy anything. Moving a service to a managed offer is your decision, for later.`
          : texto,
      );
    } catch (erro) {
      await falha("destination planner", erro);
    }
  }

  async function faseMigrar(): Promise<void> {
    pensar("plano");
    const { servicos, plano } = await deps.migrador.analisar(opcoes.dirApp);
    const nomes = servicos.map((s) => NOME_SERVICO[s]).join(", ");
    // Só entram os passos que o migrador sabe fazer (um serviço novo no analisar sem função fica de fora).
    const passos = servicos.filter((s) => executor(s));
    falar(
      "migrador",
      "dono",
      `I found ${servicos.length} AWS ${servicos.length === 1 ? "service" : "services"} in the app: ${nomes}.` +
        (passos.length
          ? " I ask for one OK for the whole plan and go one step at a time, with proof at each step."
          : ""),
    );
    await mostrarPlanoInfra();
    await mostrarPlanoDestino(servicos);
    if (passos.length === 0) return;

    // Um só "Aprovar plano": o pedido aprovado é o do primeiro passo; os outros nascem aprovados por ele.
    const titulo = `Migrate to Leaseweb: ${passos.map((s) => NOME_SERVICO[s]).join(", ")}`;
    const texto = deps.migrador.migrarCodigo
      ? `${plano}\nAt the end I prepare a pull request so the app uses Leaseweb. The main branch only changes when someone merges it.`
      : plano;
    pensar("confirmacao");
    const pedidoPlano = await pedirMigracao(passos[0], titulo, texto, {
      servicos,
      passos,
      plano,
    });
    if (!pedidoPlano) return;
    const aprovacao = eventosLocais.findLast(
      (e) => e.pedidoId === pedidoPlano.id && e.tipo === "aprovado",
    );
    falar(
      "chefe",
      "dono",
      msgPlanoAprovado({
        quem:
          aprovacao?.quem === opcoes.donoId
            ? "the owner"
            : "an authorised person",
        hora: horaCurta(),
      }),
    );
    pensar("migrar");

    const feitos: { passo: PassoMigracao; pedido: Pedido; copia: Copia }[] = [];
    for (const passo of passos) {
      const pedido =
        passo === passos[0] ? pedidoPlano : pedidoDoPlano(passo, pedidoPlano);
      try {
        feitos.push({ passo, pedido, copia: await executor(passo)!() });
      } catch (erro) {
        auditar({
          pedidoId: pedido.id,
          tipo: "erro",
          quem: "migrador",
          depois: { passo, erro: mensagem(erro) },
        });
        await falha(`migration ${NOME_SERVICO[passo]}`, erro);
      }
    }
    if (feitos.length === 0) {
      falar(
        "migrador",
        "dono",
        "The migration failed in every step. Nothing was deleted on AWS; check the dashboard.",
      );
      return;
    }

    // Os mesmos testes da app, uma só vez, com tudo o que foi copiado já no destino.
    let testes = { antes: false, depois: false };
    try {
      testes = await deps.migrador.verificar();
    } catch (erro) {
      await falha("app tests (verify)", erro);
    }
    const testesOk = testes.antes && testes.depois;
    medido.testes = testesOk;
    medido.dadosIguais =
      feitos.length === passos.length && feitos.every((f) => f.copia.ok);
    for (const { passo, pedido, copia } of feitos) {
      const ok = copia.ok && testesOk;
      deps.estado.mudarEstado(pedido.id, ok ? "feito" : "aprovado");
      auditar({
        pedidoId: pedido.id,
        tipo: ok ? "feito" : "erro",
        quem: "migrador",
        depois: { passo, ...copia.prova, testes },
      });
    }
    const testesTexto = testesOk
      ? "App tests passing on both sides"
      : `Tests before ${testes.antes ? "ok" : "failed"}, after ${testes.depois ? "ok" : "failed"}`;
    const provas = `${feitos.map((f) => f.copia.frase).join(". ")}. ${testesTexto}.`;
    if (deps.migrador.migrarCodigo)
      codigoPorFazer = { planoId: pedidoPlano.id, testesOk };
    falar(
      "migrador",
      "atacante",
      `${provas} @atacante, the new infrastructure is live. Your turn.`,
    );
  }

  /** O código da app passa a apontar para a Leaseweb, por pull request. Um erro aqui não trava a demo. */
  async function migrarCodigoDaApp(
    planoId: string,
    testesOk: boolean,
  ): Promise<void> {
    pensar("codigo");
    try {
      const r = await deps.migrador.migrarCodigo!(planoId, testesOk);
      auditar({
        pedidoId: planoId,
        tipo: "migracao-codigo",
        quem: "migrador",
        depois: {
          ficheiros: r.ficheiros,
          problemas: r.problemas,
          fora: r.fora,
          causas: r.causas ?? 0,
          ramo: r.pr?.ramo,
          url: r.pr?.url,
          simulado: r.pr?.simulado,
        },
      });
      if (!r.pr) {
        const porque = r.problemas.length
          ? r.problemas.join("; ")
          : "there is nothing to change in the code";
        falar(
          "migrador",
          "dono",
          `I did not open the code pull request: ${porque}.`,
        );
        return;
      }
      const n = r.ficheiros.length;
      const onde =
        r.pr.url ??
        `branch ${r.pr.ramo}, rehearsal without GitHub: the diff stayed on the server`;
      falar(
        "migrador",
        "dono",
        `Code: I ${r.pr.simulado ? "prepared" : "opened"} a pull request with ${n} ${n === 1 ? "file" : "files"} (${r.ficheiros.join(", ")}) ` +
          `so the app uses Leaseweb, with tests passing and no secrets (${onde}). The main branch only changes when you merge.` +
          (r.causas
            ? " I also fixed the configuration that left the database open, so it does not come back on the next deploy."
            : "") +
          (r.fora.length
            ? ` Left out: ${r.fora.length} ${r.fora.length === 1 ? "item" : "items"}, explained in the PR.`
            : ""),
      );
      await pedirAprovarPR(r);
    } catch (erro) {
      await falha("code migrator", erro);
    }
  }

  /** "Aprovar PR": só para um PR real, com o merge ligado. Sem resposta, o PR fica aberto e nada muda. */
  async function pedirAprovarPR(r: ResultadoCodigo): Promise<void> {
    const pr = lerPR(r.pr?.url);
    if (!pr || r.pr?.simulado || !deps.migrador.aprovarPR) return;
    const pedido: Pedido = {
      id: deps.defesa.novoIdPedido(),
      titulo: `Approve PR #${pr.numero} in the app repo`,
      texto: [
        `PR #${pr.numero}: ${r.ficheiros.length} ${r.ficheiros.length === 1 ? "file" : "files"} (${r.ficheiros.join(", ")}), tests passing, no secrets.`,
        r.causas
          ? "Includes the fix for the rule that left the database open."
          : "",
        `If you approve, I merge it into the main branch of the app repo. To undo, /desfazer opens a PR that reverts it.`,
        r.pr?.url ?? "",
      ]
        .filter(Boolean)
        .join("\n"),
      acao: { tipo: "aprovar_pr", repo: pr.repo, numero: pr.numero },
      estado: "pendente",
    };
    deps.estado.guardarPedido(pedido);
    auditar({
      pedidoId: pedido.id,
      tipo: "pedido",
      quem: "migrador",
      depois: { repo: pr.repo, numero: pr.numero, url: r.pr?.url },
    });
    const decisao = esperarResultado(pedido.id);
    await deps.telegram.pedirAprovacao("migrador", pedido);
    if ((await comLimite(decisao)) === "sem-resposta") {
      falar(
        "migrador",
        "dono",
        `PR #${pr.numero} stays open, waiting for a decision. Nothing changed on the main branch.`,
      );
    }
  }

  /** Merge do PR aprovado; guarda o inverso (um PR que reverte). */
  async function fazerMergePR(
    pedido: Pedido & { acao: { tipo: "aprovar_pr" } },
  ): Promise<Resultado> {
    const { repo, numero } = pedido.acao;
    try {
      const { commit } = await deps.migrador.aprovarPR!(repo, numero);
      deps.estado.mudarEstado(pedido.id, "feito");
      auditar({
        pedidoId: pedido.id,
        tipo: "feito",
        quem: "migrador",
        depois: { repo, numero, commit },
        inverso: { tipo: "reverter_pr", repo, numero, commit },
      });
      falar(
        "migrador",
        "dono",
        `PR #${numero} approved and merged into the app repo main branch at ${horaCurta()}. To undo: /desfazer ${pedido.id}`,
      );
      return "feito";
    } catch (erro) {
      await falha(`merge of PR #${numero}`, erro);
      falar(
        "migrador",
        "dono",
        `I could not merge PR #${numero}. The main branch is unchanged.`,
      );
      return "falhou";
    }
  }

  /** /desfazer de um merge: abre um PR que o reverte. Não mexe no ramo principal sozinho. */
  async function reverterMergePR(
    pedido: Pedido & { acao: { tipo: "aprovar_pr" } },
  ): Promise<void> {
    const feito = lerAuditoria().findLast(
      (e) => e.pedidoId === pedido.id && e.tipo === "feito",
    );
    const inv = feito?.inverso;
    if (!inv || inv.tipo !== "reverter_pr" || !deps.migrador.reverterPR) {
      await notificar(`Request ${pedido.id} has no merge to revert.`);
      return;
    }
    const { url } = await deps.migrador.reverterPR(
      inv.repo,
      inv.numero,
      inv.commit,
    );
    deps.estado.mudarEstado(pedido.id, "desfeito");
    auditar({
      pedidoId: pedido.id,
      tipo: "desfeito",
      quem: "migrador",
      depois: { repo: inv.repo, numero: inv.numero, url },
    });
    falar(
      "migrador",
      "dono",
      `I opened a PR that reverts PR #${inv.numero}${url ? `: ${url}` : ""}. The main branch only changes when you merge.`,
    );
  }

  type Copia = { ok: boolean; prova: object; frase: string };

  /** Como se executa cada passo. undefined = o migrador ainda não tem essa função ligada. */
  function executor(passo: PassoMigracao): (() => Promise<Copia>) | undefined {
    const m = deps.migrador;
    const igual = (ok: boolean) =>
      ok ? "checksums match" : "checksums DIFFER";
    switch (passo) {
      case "s3":
        return async () => {
          const c = await m.migrarS3();
          return {
            ok: c.checksumsOk,
            prova: c,
            frase: `${c.objetos} files copied to MinIO, ${igual(c.checksumsOk)}`,
          };
        };
      case "postgres": {
        const f = m.migrarPostgres;
        return f
          ? async () => {
              const c = await f();
              const t = `${c.tabelas} ${c.tabelas === 1 ? "table" : "tables"} and ${c.linhas} rows`;
              return {
                ok: c.checksumsOk,
                prova: c,
                frase: `Database: ${t} copied to PostgreSQL, ${igual(c.checksumsOk)}`,
              };
            }
          : undefined;
      }
      case "fila": {
        const f = m.migrarFila;
        return f
          ? async () => {
              const c = await f();
              const t = `${c.mensagens} ${c.mensagens === 1 ? "message moved" : "messages moved"}`;
              return {
                ok: c.iguais,
                prova: { mensagens: c.mensagens, checksumsOk: c.iguais },
                frase: `Queues: ${t} to RabbitMQ, ${igual(c.iguais)}`,
              };
            }
          : undefined;
      }
      case "segredos": {
        const f = m.migrarSegredos;
        return f
          ? async () => {
              const c = await f();
              return {
                ok: c.iguais,
                prova: { segredos: c.segredos, checksumsOk: c.iguais },
                frase: `Secrets: ${c.segredos} moved to OpenBao without ever showing a value, ${igual(c.iguais)}`,
              };
            }
          : undefined;
      }
      case "cache": {
        const f = m.migrarCache;
        return f
          ? async () => {
              const c = await f();
              const t = `${c.chaves} ${c.chaves === 1 ? "key copied" : "keys copied"}`;
              return {
                ok: c.iguais,
                prova: { chaves: c.chaves, checksumsOk: c.iguais },
                frase: `Cache: ${t} to Valkey, ${igual(c.iguais)}`,
              };
            }
          : undefined;
      }
    }
  }

  /** Pedido de um passo coberto pelo "Aprovar plano": nasce aprovado, ligado ao pedido do plano. */
  function pedidoDoPlano(passo: PassoMigracao, plano: Pedido): Pedido {
    const pedido: Pedido = {
      id: deps.defesa.novoIdPedido(),
      titulo: `Migrate ${NOME_SERVICO[passo]} (plan ${plano.id})`,
      texto: plano.texto,
      acao: { tipo: "migrar", passo },
      estado: "aprovado",
    };
    deps.estado.guardarPedido(pedido);
    auditar({
      pedidoId: pedido.id,
      tipo: "pedido",
      quem: "migrador",
      depois: { passo, plano: plano.id },
    });
    auditar({
      pedidoId: pedido.id,
      tipo: "aprovado",
      quem: "migrador",
      depois: { pelo: plano.id },
    });
    return pedido;
  }

  /**
   * Pede aprovação para um passo de migração e espera (com limite). Devolve o pedido aprovado, ou undefined.
   * Sem resposta: fecha o pedido, para um clique tardio não arrancar uma migração a meio da demo.
   */
  async function pedirMigracao(
    passo: PassoMigracao,
    titulo: string,
    texto: string,
    prova: object,
  ): Promise<Pedido | undefined> {
    const pedido: Pedido = {
      id: deps.defesa.novoIdPedido(),
      titulo,
      texto,
      acao: { tipo: "migrar", passo },
      estado: "pendente",
    };
    deps.estado.guardarPedido(pedido);
    auditar({
      pedidoId: pedido.id,
      tipo: "pedido",
      quem: "migrador",
      depois: prova,
    });
    const decisao = esperarResultado(pedido.id);
    await deps.telegram.pedirAprovacao("migrador", pedido);
    const r = await comLimite(decisao);
    if (r === "sem-resposta") {
      deps.estado.mudarEstado(pedido.id, "ignorado");
      auditar({ pedidoId: pedido.id, tipo: "sem-resposta", quem: "migrador" });
      falar(
        "migrador",
        "dono",
        `No answer to the migration request: I will not migrate (${titulo}). Everything stays as it was.`,
      );
      return undefined;
    }
    if (r !== "aprovado") {
      falar(
        "migrador",
        "dono",
        `Migration not approved (${titulo}). Everything stays as it was.`,
      );
      return undefined;
    }
    return pedido;
  }

  async function faseAtacar(falarTexto = true): Promise<Achado[]> {
    pensar("atacar");
    const achados = await deps.atacante.reconhecer(opcoes.alvos);
    auditar({
      pedidoId: "-",
      tipo: "reconhecimento",
      quem: "atacante",
      depois: {
        alvos: opcoes.alvos,
        achados: achados.length,
        portas: achados.map((a) => ({
          alvo: a.alvo,
          porta: a.porta,
          servico: a.servico,
        })),
      },
    });
    // Com a defesa já a ter reagido entre rondas, "não encontrei portas" seria enganador.
    if (falarTexto) falar("atacante", "defesa", textoAtacante(achados));
    return achados;
  }

  async function faseDefender(
    doAtacante: Achado[],
  ): Promise<Promise<Resultado>[]> {
    pensar("defender");
    let daApi: Achado[] = [];
    try {
      daApi = await deps.defesa.detetar();
    } catch (erro) {
      await falha("API detection", erro);
    }
    let achados: Achado[];
    try {
      achados = deps.defesa.correlacionar(daApi, doAtacante);
    } catch (erro) {
      // Sem correlação ficam só os achados da API: são os que trazem a regra a fechar.
      log("correlacionar falhou, a usar só os achados da API:", mensagem(erro));
      achados = daApi;
    }
    const acionaveis = achados.filter(
      (a) => deps.defesa.acaoPara(a) && !achadosDoCiclo.has(a.id),
    );
    if (acionaveis.length === 0) {
      falar(
        "defesa",
        "dono",
        achados.length === 0
          ? "I found nothing open to the whole Internet."
          : "Some ports are visible, but none of our rules can close them.",
      );
      return [];
    }
    const resultados: Promise<Resultado>[] = [];
    for (const achado of acionaveis) {
      try {
        const pedido = await deps.defesa.tratar(achado);
        achadoDoPedido.set(pedido.id, achado);
        achadosDoCiclo.add(achado.id);
        armarModoNoite(pedido);
        resultados.push(esperarResultado(pedido.id));
      } catch (erro) {
        await falha(`request for ${achado.alvo}:${achado.porta}`, erro);
      }
    }
    return resultados;
  }

  async function correr(): Promise<void> {
    // A auditoria acumula todos os ensaios do dia: o chefe só fala deste ciclo.
    inicioCiclo = hora();
    achadosDoCiclo.clear();
    medido = {};
    codigoPorFazer = undefined;
    pensar("abertura");
    if (opcoes.migrar) {
      falar(
        "chefe",
        "dono",
        msgAbertura({
          app: opcoes.dirApp.split(/[\\/]/).filter(Boolean).at(-1),
        }),
      );
      await faseMigrar().catch((e) => falha("migração", e));
    }
    // Se o ataque foi lançado ao aprovar o plano, esperar por ele antes de resumir.
    if (ataqueDoPlano) await ataqueDoPlano;
    // Daqui em diante a infraestrutura nova conta como "no ar": é o início do relógio de exposição (ideia wow 2).
    auditar({ pedidoId: "-", tipo: "infra-no-ar", quem: "orquestrador" });
    let doAtacante: Achado[] = [];
    if (opcoes.atacar) {
      if (resultadosDuranteAtaque.length > 0) {
        // O atacante já encontrou e a defesa já reagiu na ronda; não se repete o reconhecimento.
        doAtacante = achadosDuranteAtaque;
      } else {
        doAtacante = await faseAtacar().catch(
          async (e) => (await falha("reconhecimento", e), []),
        );
      }
    }
    const resultados =
      resultadosDuranteAtaque.length > 0 ? [] : await faseDefender(doAtacante);
    const todosOsResultados = [...resultadosDuranteAtaque, ...resultados];
    // Os pedidos sem resposta ficam "por decidir" no resumo; um Aprovar tardio ainda fecha (foi um humano).
    if ((await comLimite(Promise.all(todosOsResultados))) === "sem-resposta")
      log("há pedidos sem resposta; resumo na mesma");
    if (codigoPorFazer) {
      const { planoId, testesOk } = codigoPorFazer;
      codigoPorFazer = undefined;
      await migrarCodigoDaApp(planoId, testesOk);
    }
    await publicarRelatorios();
    pensar("validar");
    // Só se diz o que foi medido; um valor que falte sai como "não medido".
    if (Object.values(medido).some((v) => v !== undefined))
      falar("chefe", "dono", msgValidacao(medido));
    falar(
      "chefe",
      "dono",
      deps.chefe.resumir(doCiclo(), deps.estado.listarPedidos()),
    );
    pensar("relatorio");
    if (deps.chefe.certificado) {
      try {
        falar(
          "chefe",
          "dono",
          deps.chefe.certificado(doCiclo(), deps.estado.listarPedidos()),
        );
      } catch (erro) {
        await falha("migration certificate", erro);
      }
    }
    if (deps.chefe.relatorioFicheiro && deps.telegram.enviarDocumento) {
      try {
        const f = deps.chefe.relatorioFicheiro(doCiclo(), deps.estado.listarPedidos());
        await deps.telegram.enviarDocumento("chefe", f.nome, f.conteudo, "Full incident & migration report (PDF).", f.tipo);
      } catch (erro) {
        await falha("report file", erro);
      }
    }
  }

  /** Se o dono não decidir a tempo, o modo noite da defesa aplica a medida temporária (só falhas críticas). */
  function armarModoNoite(pedido: Pedido): void {
    if (!deps.defesa.modoNoite || !opcoes.modoNoiteMs) return;
    const t = setTimeout(() => {
      noite.delete(pedido.id);
      if (deps.estado.obterPedido(pedido.id)?.estado !== "pendente") return;
      deps.defesa.modoNoite!(pedido)
        .then((aplicou) => {
          // O aviso ("Modo noite às HH:MM … /desfazer <id>") já vem da defesa.
          if (aplicou) concluir(pedido.id, "feito");
        })
        .catch((erro) => falha(`night mode on "${pedido.titulo}"`, erro));
    }, opcoes.modoNoiteMs);
    // Não segura o processo (--uma-vez) só por causa deste temporizador.
    t.unref?.();
    noite.set(pedido.id, t);
  }

  function pararModoNoite(pedidoId: string): void {
    const t = noite.get(pedidoId);
    if (t) clearTimeout(t);
    noite.delete(pedidoId);
  }

  /** Um relatório por achado tratado neste ciclo. Uma falha num não impede os outros nem o resumo. */
  async function publicarRelatorios(): Promise<void> {
    if (!deps.relatorio) return;
    for (const achadoId of achadosDoCiclo) {
      try {
        // Só os eventos deste ciclo: com os ensaios anteriores, o relatório somava fechos e tempos de outras corridas.
        await deps.relatorio.publicar(achadoId, doCiclo());
      } catch (erro) {
        await falha(`incident report ${achadoId}`, erro);
      }
    }
  }

  /** Regista os callbacks do canal. Se o canal ainda for stub, avisa e o fluxo segue (sem decisões, só o resumo). */
  function ligar(): void {
    try {
      deps.telegram.aoResponder((id, decisao, quem) => {
        aoResponder(id, decisao, quem).catch((e) => falha("owner answer", e));
      });
    } catch (erro) {
      void falha("ligar as respostas do dono (aoResponder)", erro);
    }
    try {
      deps.telegram.aoMensagemDoDono((agente, texto) => {
        aoMensagemDoDono(agente, texto).catch((e) => falha("owner message", e));
      });
    } catch (erro) {
      void falha("ligar as mensagens do dono (aoMensagemDoDono)", erro);
    }
  }

  return { ligar, correr, aoResponder, aoMensagemDoDono };
}

/** Fala do atacante a partir dos achados (determinística; a voz com IA vem depois). */
export function textoAtacante(achados: Achado[]): string {
  if (achados.length === 0)
    return "Received. I found no open ports on our machines. @defesa";
  const altas = achados.filter((a) => a.severidade === "alta");
  const lista = achados
    .slice(0, 3)
    .map((a) => `${a.servico ?? "service"} on port ${a.porta} (${a.alvo})`)
    .join("; ");
  const resto = achados.length > 3 ? ` and ${achados.length - 3} more` : "";
  return `Received. It answers anyone on the Internet: ${lista}${resto}. Severity ${altas.length > 0 ? "high" : "medium"}. @defesa`;
}

/** Repo e número a partir do URL do PR (https://github.com/dono/repo/pull/12). */
export function lerPR(
  url: string | undefined,
): { repo: string; numero: number } | undefined {
  const m = url?.match(/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/);
  return m ? { repo: m[1]!, numero: Number(m[2]) } : undefined;
}

function mensagem(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}
