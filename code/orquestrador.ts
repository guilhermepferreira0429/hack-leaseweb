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
  relatorio?: { publicar(achadoId: string): Promise<unknown> };
  chefe: {
    resumir(eventos: EventoAuditoria[], pedidos: Pedido[]): string;
    estadoAtual(pedidos: Pedido[]): string;
    /** Certificado de migração (ideia wow 3), dito pelo chefe no fim. */
    certificado?(eventos: EventoAuditoria[], pedidos: Pedido[]): string;
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
    await notificar(`Falha em ${fase}: ${mensagem(erro)}. A demo continua.`);
  }

  /** Respostas que chegaram antes de alguém estar à espera (o dono pode ser mais rápido do que o fluxo). */
  const antecipados = new Map<string, Resultado>();

  /** A auditoria acumula todos os ensaios do dia: o chefe e a voz só falam do ciclo atual. */
  let inicioCiclo = hora();
  /** O que se mediu neste ciclo, para a validação final do chefe. undefined = não medido. */
  let medido: { testes?: boolean; dadosIguais?: boolean; nadaExposto?: boolean } = {};

  /** Linha "a pensar" do painel (docs/agentes/mensagens-demo.md): texto fixo por passo, nunca do modelo. */
  function pensar(passo: PassoDemo): void {
    const { agente, texto } = PENSAR[passo];
    auditar({ pedidoId: "-", tipo: "pensar", quem: agente, depois: { passo, texto } });
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
    if (opcoes.donoId && quem !== opcoes.donoId && !(opcoes.aprovadores ?? []).includes(quem)) {
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
    if (pedido.acao.tipo === "migrar") return concluir(pedidoId, "aprovado");

    try {
      await deps.defesa.corrigir({ ...pedido, estado: "aprovado" });
    } catch (erro) {
      await falha(`fechar "${pedido.titulo}"`, erro);
      falar(
        "defesa",
        "dono",
        `Não consegui fechar "${pedido.titulo}". Nada foi alterado sem confirmação; vejam o painel.`,
      );
      return concluir(pedidoId, "falhou");
    }
    // O aviso "Fechado e confirmado às HH:MM ... /desfazer <id>" já vem do corrigir(); aqui só se passa a vez ao atacante.
    falar(
      "defesa",
      "atacante",
      `@atacante, fechei "${pedido.titulo}" às ${horaCurta()} e guardei como voltar atrás. Podes confirmar?`,
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
      falar(
        "atacante",
        "todos",
        ainda.length === 0
          ? msgAtacanteConfirma()
          : `Ainda chego à porta ${ainda[0].porta} em ${ainda[0].alvo}. Pode demorar uns segundos a aplicar.`,
      );
    } catch (erro) {
      await falha("confirmação do atacante", erro);
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
        await notificar("Ataque não está ligado neste processo.");
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
        `Li a configuração da AWS (Terraform) e traduzi-a para a Leaseweb. Por agora é só o plano, ainda não criei nada:
${resumo}`,
      );
    } catch (erro) {
      await falha("tradução da configuração AWS", erro);
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
      falar("migrador", "dono", texto);
    } catch (erro) {
      await falha("decisor de destino", erro);
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
      `Encontrei ${servicos.length} ${servicos.length === 1 ? "serviço" : "serviços"} AWS na app: ${nomes}.` +
        (passos.length
          ? " Peço um só OK para o plano todo e faço um passo de cada vez, com prova em cada um."
          : ""),
    );
    await mostrarPlanoInfra();
    await mostrarPlanoDestino(servicos);
    if (passos.length === 0) return;

    // Um só "Aprovar plano": o pedido aprovado é o do primeiro passo; os outros nascem aprovados por ele.
    const titulo = `Migrar para a Leaseweb: ${passos.map((s) => NOME_SERVICO[s]).join(", ")}`;
    const texto = deps.migrador.migrarCodigo
      ? `${plano}\nNo fim preparo um pull request para a app passar a usar a Leaseweb. O ramo principal só muda quando alguém fizer merge.`
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
        quem: aprovacao?.quem === opcoes.donoId ? "o dono" : "uma pessoa autorizada",
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
        await falha(`migração ${NOME_SERVICO[passo]}`, erro);
      }
    }
    if (feitos.length === 0) {
      falar(
        "migrador",
        "dono",
        "A migração falhou em todos os passos. Nada foi apagado na AWS; vejam o painel.",
      );
      return;
    }

    // Os mesmos testes da app, uma só vez, com tudo o que foi copiado já no destino.
    let testes = { antes: false, depois: false };
    try {
      testes = await deps.migrador.verificar();
    } catch (erro) {
      await falha("testes da app (verificar)", erro);
    }
    const testesOk = testes.antes && testes.depois;
    medido.testes = testesOk;
    medido.dadosIguais = feitos.length === passos.length && feitos.every((f) => f.copia.ok);
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
      ? "Testes da app a passar dos dois lados"
      : `Testes antes ${testes.antes ? "ok" : "falharam"}, depois ${testes.depois ? "ok" : "falharam"}`;
    const provas = `${feitos.map((f) => f.copia.frase).join(". ")}. ${testesTexto}.`;
    if (deps.migrador.migrarCodigo) {
      falar("migrador", "dono", provas);
      await migrarCodigoDaApp(pedidoPlano.id, testesOk);
      falar(
        "migrador",
        "atacante",
        "@atacante, a infraestrutura nova está no ar.",
      );
    } else {
      falar(
        "migrador",
        "atacante",
        `${provas} @atacante, a infraestrutura nova está no ar.`,
      );
    }
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
          : "não há nada para mudar no código";
        falar(
          "migrador",
          "dono",
          `Não abri o pull request do código: ${porque}.`,
        );
        return;
      }
      const n = r.ficheiros.length;
      const onde =
        r.pr.url ??
        `ramo ${r.pr.ramo}, ensaio sem GitHub: o diff ficou no cérebro`;
      falar(
        "migrador",
        "dono",
        `Código: ${r.pr.simulado ? "preparei" : "abri"} um pull request com ${n} ${n === 1 ? "ficheiro" : "ficheiros"} (${r.ficheiros.join(", ")}) ` +
          `para a app usar a Leaseweb, com os testes a passar e sem segredos (${onde}). O ramo principal só muda com o vosso merge.` +
          (r.causas
            ? " Corrigi também a configuração que deixava a base de dados aberta, para não voltar no próximo deploy."
            : "") +
          (r.fora.length
            ? ` Fica fora: ${r.fora.length} ${r.fora.length === 1 ? "ponto" : "pontos"}, explicados no PR.`
            : ""),
      );
    } catch (erro) {
      await falha("migrador de código", erro);
    }
  }

  type Copia = { ok: boolean; prova: object; frase: string };

  /** Como se executa cada passo. undefined = o migrador ainda não tem essa função ligada. */
  function executor(passo: PassoMigracao): (() => Promise<Copia>) | undefined {
    const m = deps.migrador;
    const igual = (ok: boolean) =>
      ok ? "checksums iguais" : "checksums DIFERENTES";
    switch (passo) {
      case "s3":
        return async () => {
          const c = await m.migrarS3();
          return {
            ok: c.checksumsOk,
            prova: c,
            frase: `${c.objetos} ficheiros copiados para o MinIO, ${igual(c.checksumsOk)}`,
          };
        };
      case "postgres": {
        const f = m.migrarPostgres;
        return f
          ? async () => {
              const c = await f();
              const t = `${c.tabelas} ${c.tabelas === 1 ? "tabela" : "tabelas"} e ${c.linhas} linhas`;
              return {
                ok: c.checksumsOk,
                prova: c,
                frase: `Base de dados: ${t} copiadas para PostgreSQL, ${igual(c.checksumsOk)}`,
              };
            }
          : undefined;
      }
      case "fila": {
        const f = m.migrarFila;
        return f
          ? async () => {
              const c = await f();
              const t = `${c.mensagens} ${c.mensagens === 1 ? "mensagem passada" : "mensagens passadas"}`;
              return {
                ok: c.iguais,
                prova: { mensagens: c.mensagens, checksumsOk: c.iguais },
                frase: `Filas: ${t} para o RabbitMQ, ${igual(c.iguais)}`,
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
                frase: `Segredos: ${c.segredos} passados para o OpenBao sem nunca aparecerem em texto, ${igual(c.iguais)}`,
              };
            }
          : undefined;
      }
      case "cache": {
        const f = m.migrarCache;
        return f
          ? async () => {
              const c = await f();
              const t = `${c.chaves} ${c.chaves === 1 ? "chave copiada" : "chaves copiadas"}`;
              return {
                ok: c.iguais,
                prova: { chaves: c.chaves, checksumsOk: c.iguais },
                frase: `Cache: ${t} para o Valkey, ${igual(c.iguais)}`,
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
      titulo: `Migrar ${NOME_SERVICO[passo]} (plano ${plano.id})`,
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
        `Sem resposta ao pedido de migração: não migro (${titulo.toLowerCase()}). Fica tudo como estava.`,
      );
      return undefined;
    }
    if (r !== "aprovado") {
      falar(
        "migrador",
        "dono",
        `Migração não aprovada (${titulo.toLowerCase()}). Fica tudo como estava.`,
      );
      return undefined;
    }
    return pedido;
  }

  async function faseAtacar(): Promise<Achado[]> {
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
    falar("atacante", "defesa", textoAtacante(achados));
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
      await falha("deteção pela API", erro);
    }
    let achados: Achado[];
    try {
      achados = deps.defesa.correlacionar(daApi, doAtacante);
    } catch (erro) {
      // Sem correlação ficam só os achados da API: são os que trazem a regra a fechar.
      log("correlacionar falhou, a usar só os achados da API:", mensagem(erro));
      achados = daApi;
    }
    const acionaveis = achados.filter((a) => deps.defesa.acaoPara(a));
    if (acionaveis.length === 0) {
      falar(
        "defesa",
        "dono",
        achados.length === 0
          ? "Não encontrei nada aberto a toda a internet."
          : "Há portas visíveis, mas nenhuma regra nossa para fechar.",
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
        await falha(`pedido para ${achado.alvo}:${achado.porta}`, erro);
      }
    }
    return resultados;
  }

  async function correr(): Promise<void> {
    // A auditoria acumula todos os ensaios do dia: o chefe só fala deste ciclo.
    inicioCiclo = hora();
    achadosDoCiclo.clear();
    medido = {};
    pensar("abertura");
    if (opcoes.migrar) {
      falar("chefe", "dono", msgAbertura({ app: opcoes.dirApp.split(/[\\/]/).filter(Boolean).at(-1) }));
      await faseMigrar().catch((e) => falha("migração", e));
    }
    // Daqui em diante a infraestrutura nova conta como "no ar": é o início do relógio de exposição (ideia wow 2).
    auditar({ pedidoId: "-", tipo: "infra-no-ar", quem: "orquestrador" });
    let doAtacante: Achado[] = [];
    if (opcoes.atacar)
      doAtacante = await faseAtacar().catch(
        async (e) => (await falha("reconhecimento", e), []),
      );
    const resultados = await faseDefender(doAtacante);
    // Os pedidos sem resposta ficam "por decidir" no resumo; um Aprovar tardio ainda fecha (foi um humano).
    if ((await comLimite(Promise.all(resultados))) === "sem-resposta")
      log("há pedidos sem resposta; resumo na mesma");
    await publicarRelatorios();
    pensar("validar");
    // Só se diz o que foi medido; um valor que falte sai como "não medido".
    if (Object.values(medido).some((v) => v !== undefined)) falar("chefe", "dono", msgValidacao(medido));
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
        await falha("certificado de migração", erro);
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
        .catch((erro) => falha(`modo noite em "${pedido.titulo}"`, erro));
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
        await deps.relatorio.publicar(achadoId);
      } catch (erro) {
        await falha(`relatório do incidente ${achadoId}`, erro);
      }
    }
  }

  /** Regista os callbacks do canal. Se o canal ainda for stub, avisa e o fluxo segue (sem decisões, só o resumo). */
  function ligar(): void {
    try {
      deps.telegram.aoResponder((id, decisao, quem) => {
        aoResponder(id, decisao, quem).catch((e) =>
          falha("resposta do dono", e),
        );
      });
    } catch (erro) {
      void falha("ligar as respostas do dono (aoResponder)", erro);
    }
    try {
      deps.telegram.aoMensagemDoDono((agente, texto) => {
        aoMensagemDoDono(agente, texto).catch((e) =>
          falha("mensagem do dono", e),
        );
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
    return "Recebido. Não encontrei portas abertas nas nossas máquinas. @defesa";
  const altas = achados.filter((a) => a.severidade === "alta");
  const lista = achados
    .slice(0, 3)
    .map((a) => `${a.servico ?? "serviço"} na porta ${a.porta} (${a.alvo})`)
    .join("; ");
  const resto = achados.length > 3 ? ` e mais ${achados.length - 3}` : "";
  return `Recebido. Responde a qualquer pessoa na internet: ${lista}${resto}. Gravidade ${altas.length > 0 ? "alta" : "média"}. @defesa`;
}

function mensagem(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}
