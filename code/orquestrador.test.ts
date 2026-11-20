// Orquestrador com dependências falsas: o fluxo e as salvaguardas, sem Telegram, Leaseweb nem nmap.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type {
  Achado,
  Agente,
  Decisao,
  EventoAuditoria,
  Mensagem,
  Pedido,
  EstadoPedido,
} from "@mwbe/shared";
import { acaoPara, montarPedido, novoIdPedido } from "./defesa/explicar";
import {
  criarOrquestrador,
  textoAtacante,
  type Dependencias,
  type Opcoes,
} from "./orquestrador";

const DONO = "42";

const regra = {
  id: "r-5432",
  protocol: "TCP",
  source: "0.0.0.0/0",
  startPort: 5432,
  endPort: 5432,
};
const achadoApi: Achado = {
  id: "a1",
  tipo: "porta-exposta",
  origem: "api",
  alvo: "203.0.113.10",
  securityGroupId: "sg-vitima",
  regra,
  porta: 5432,
  servico: "PostgreSQL",
  severidade: "alta",
  detalhe: "TCP 5432 0.0.0.0/0",
};
const achadoAtacante: Achado = {
  ...achadoApi,
  id: "b1",
  origem: "atacante",
  tipo: "servico-exposto",
  regra: undefined,
  securityGroupId: undefined,
};

type Cenario = {
  decisao?: (p: Pedido) => Decisao | undefined;
  quem?: string;
  migrarFalha?: boolean;
  portaFechada?: boolean;
  /** bus, auditoria, notificar e correlacionar a lançar de forma síncrona, como os stubs naoImplementado. */
  stubs?: boolean;
  /** aoResponder e aoMensagemDoDono a lançar, como o telegram.ts ainda em stub. */
  canalStub?: boolean;
  /** Outra máquina da allowlist (o isco) com a mesma porta aberta, antes e depois do fecho. */
  outroAlvoAberto?: boolean;
  /** Eventos de ensaios anteriores já no auditoria.jsonl (append-only, o dia inteiro). */
  historico?: EventoAuditoria[];
};

const stub = (): never => {
  throw new Error("Ainda não implementado");
};

function montar(cenario: Cenario = {}, opcoes: Partial<Opcoes> = {}) {
  const falas: Mensagem[] = [];
  const eventos: EventoAuditoria[] = [...(cenario.historico ?? [])];
  const vistoPeloChefe: EventoAuditoria[][] = [];
  const pedidos = new Map<string, Pedido>();
  const pedidosEnviados: { agente: Agente; pedido: Pedido }[] = [];
  const corrigidos: string[] = [];
  const desfeitos: string[] = [];
  const notificacoes: string[] = [];
  const ataques: { alvo?: string; log?: (texto: string) => void }[] = [];
  let reconhecimentos = 0;
  let fechado = false;
  let aoResponder: ((id: string, d: Decisao, quem: string) => void) | undefined;
  let aoMensagem: ((a: Agente | null, t: string) => void) | undefined;

  const deps: Dependencias = {
    telegram: {
      async pedirAprovacao(agente, pedido) {
        pedidosEnviados.push({ agente, pedido });
        const d = (cenario.decisao ?? (() => "aprovar"))(pedido);
        if (d)
          setImmediate(() => aoResponder?.(pedido.id, d, cenario.quem ?? DONO));
      },
      aoResponder: cenario.canalStub ? stub : (cb) => void (aoResponder = cb),
      aoMensagemDoDono: cenario.canalStub
        ? stub
        : (cb) => void (aoMensagem = cb),
      notificar: cenario.stubs
        ? stub
        : async (t) => {
            notificacoes.push(t);
          },
    },
    bus: { enviar: cenario.stubs ? stub : (m) => void falas.push(m) },
    estado: {
      guardarPedido: (p) => void pedidos.set(p.id, { ...p }),
      obterPedido: (id) => pedidos.get(id),
      mudarEstado(id, e: EstadoPedido) {
        const p = { ...pedidos.get(id)!, estado: e };
        pedidos.set(id, p);
        return p;
      },
      listarPedidos: () => [...pedidos.values()],
    },
    auditoria: cenario.stubs
      ? { registar: stub, ler: stub }
      : { registar: (e) => void eventos.push(e), ler: () => eventos },
    defesa: {
      detetar: async () => [achadoApi],
      correlacionar: cenario.stubs
        ? stub
        : (api, atk) => [
            ...api,
            ...atk.filter(
              (a) => !api.some((b) => b.alvo === a.alvo && b.porta === a.porta),
            ),
          ],
      acaoPara,
      async tratar(achado) {
        const pedido = montarPedido(achado, "Três frases.", acaoPara(achado)!);
        deps.estado.guardarPedido(pedido);
        await deps.telegram.pedirAprovacao("defesa", pedido);
        return pedido;
      },
      async corrigir(p) {
        corrigidos.push(p.id);
        fechado = cenario.portaFechada ?? true;
      },
      async desfazer(id) {
        desfeitos.push(id);
      },
      novoIdPedido,
    },
    atacante: {
      async reconhecer() {
        reconhecimentos++;
        const isco = cenario.outroAlvoAberto
          ? [{ ...achadoAtacante, id: "isco", alvo: "203.0.113.99" }]
          : [];
        return fechado ? isco : [achadoAtacante, ...isco];
      },
      async iniciarAtaque(opcoes) {
        ataques.push(opcoes);
        // Ronda de reconhecimento: o orquestrador passa os achados à defesa antes da tentativa seguinte.
        await opcoes.aoRonda?.({
          nome: "reconhecimento",
          achados: [achadoAtacante],
        });
      },
    },
    migrador: {
      analisar: async () => ({
        servicos: ["s3", "postgres", "fila"],
        plano: "S3 -> MinIO",
      }),
      async migrarS3() {
        if (cenario.migrarFalha) throw new Error("MinIO em baixo");
        return { objetos: 12, checksumsOk: true };
      },
      verificar: async () => ({ antes: true, depois: true }),
    },
    chefe: {
      resumir: (e) => (vistoPeloChefe.push(e), "RESUMO"),
      estadoAtual: () => "ESTADO",
      certificado: (e) =>
        `CERT ${e.some((x) => x.tipo === "infra-no-ar") ? "com relógio" : "sem relógio"}`,
    },
  };

  const orq = criarOrquestrador(deps, {
    migrar: true,
    atacar: true,
    dirApp: "code/exemplo-app",
    alvos: ["203.0.113.10"],
    donoId: DONO,
    log: () => {},
    ...opcoes,
  });
  orq.ligar();
  return {
    vistoPeloChefe,
    deps,
    orq,
    falas,
    eventos,
    pedidos,
    pedidosEnviados,
    corrigidos,
    desfeitos,
    notificacoes,
    ataques,
    reconhecimentos: () => reconhecimentos,
    mensagemDoDono: (a: Agente | null, t: string) => aoMensagem?.(a, t),
    responder: (id: string, d: Decisao, quem = DONO) =>
      aoResponder?.(id, d, quem),
  };
}

const textos = (falas: Mensagem[], de: Agente) =>
  falas.filter((f) => f.de === de).map((f) => f.texto);
const esperar = () => new Promise((r) => setImmediate(r));

describe("orquestrador", () => {
  it("corre o fluxo completo: migrar, atacar, defender, fechar, confirmar, resumir", async () => {
    const t = montar();
    await t.orq.correr();

    assert.deepEqual(
      t.pedidosEnviados.map((p) => [p.agente, p.pedido.acao.tipo]),
      [
        ["migrador", "migrar"],
        ["defesa", "remover_regra"],
      ],
    );
    assert.equal(t.corrigidos.length, 1);
    assert.match(
      textos(t.falas, "migrador").at(-1)!,
      /12 files copied to MinIO, checksums match\. App tests passing on both sides\./,
    );
    assert.match(textos(t.falas, "atacante")[0], /PostgreSQL on port 5432/);
    assert.match(
      textos(t.falas, "defesa").at(-1)!,
      /@atacante, I closed "PostgreSQL (?:open to the whole internet|aberto a toda a internet)" at \d\d:\d\d/,
    );
    assert.equal(
      textos(t.falas, "atacante").at(-1),
      "Confirmed. I can no longer reach it.",
    );
    assert.equal(t.falas.at(-1)?.de, "chefe");
    assert.deepEqual(
      t.falas.slice(-2).map((f) => f.texto),
      ["RESUMO", "CERT com relógio"],
    );
    const recon = t.eventos.find((e) => e.tipo === "reconhecimento")
      ?.depois as { portas?: unknown[] };
    assert.equal(
      recon.portas?.length,
      1,
      "as portas encontradas ficam na auditoria para o certificado",
    );
    assert.ok(t.eventos.some((e) => e.tipo === "aprovado" && e.quem === DONO));
    // Regressão: no fluxo "ataca em rondas" o fecho acontece dentro de ataqueDoPlano. O 'infra-no-ar' (início do
    // relógio de exposição) tem de vir ANTES do reconhecimento/fecho, senão o certificado sai "Time exposed: not measured".
    const idxInfra = t.eventos.findIndex((e) => e.tipo === "infra-no-ar");
    const idxRecon = t.eventos.findIndex((e) => e.tipo === "reconhecimento");
    assert.ok(
      idxInfra >= 0 && idxRecon >= 0 && idxInfra < idxRecon,
      `infra-no-ar (${idxInfra}) tem de vir antes do reconhecimento (${idxRecon})`,
    );
  });

  it('mensagens fixas: linha "a pensar" por passo, plano aprovado e validação só com o que foi medido', async () => {
    const t = montar();
    await t.orq.correr();
    const passos = t.eventos
      .filter((e) => e.tipo === "pensar")
      .map((e) => (e.depois as { passo: string }).passo);
    // A defesa pode reagir durante a migração (rondas do atacante), por isso a ordem exata varia.
    assert.equal(passos[0], "abertura");
    assert.equal(passos.at(-2), "validar");
    assert.equal(passos.at(-1), "relatorio");
    for (const p of ["plano", "confirmacao", "migrar", "atacar", "defender"])
      assert.ok(passos.includes(p), `passo ${p}`);
    const pensarDefesa = t.eventos.find(
      (e) =>
        e.tipo === "pensar" &&
        (e.depois as { passo: string }).passo === "defender",
    )!;
    assert.equal(pensarDefesa.quem, "defesa");
    assert.match(
      (pensarDefesa.depois as { texto: string }).texto,
      /Explaining the risk/,
    );
    const chefe = textos(t.falas, "chefe");
    assert.match(
      chefe[0]!,
      /^Good morning\. We are moving the exemplo-app app from AWS to Leaseweb/,
    );
    assert.ok(
      chefe.some((f) =>
        /^Plan approved by the owner at \d\d:\d\d\. @migrador, go ahead\.$/.test(
          f,
        ),
      ),
    );
    assert.ok(
      chefe.includes(
        "Final check: tests ✓, nothing exposed ✓, data identical ✓.",
      ),
    );

    // Sem migração nem atacante, nada foi medido: não há validação inventada.
    const so = montar({}, { migrar: false, atacar: false });
    await so.orq.correr();
    assert.ok(!textos(so.falas, "chefe").some((f) => /Final check/.test(f)));
  });

  it("ideia wow 1: um aprovador (o jurado) pode decidir; quem não está na lista continua ignorado", async () => {
    const JURI = "777";
    const t = montar({ quem: JURI }, { aprovadores: [JURI] });
    await t.orq.correr();
    assert.equal(t.corrigidos.length, 1, "o jurado fechou a porta");
    assert.ok(
      textos(t.falas, "chefe").some((f) =>
        /^Plan approved by an authorised person at/.test(f),
      ),
    );

    const estranho = montar(
      { quem: "999" },
      { aprovadores: [JURI], migrar: false, esperaDecisaoMs: 50 },
    );
    await estranho.orq.correr();
    assert.equal(estranho.corrigidos.length, 0);
  });

  it('relatório em ficheiro: o chefe anexa-o no fim, depois do certificado; uma falha só avisa', async () => {
    const t = montar();
    const anexos: { agente: string; nome: string; conteudo: string | Uint8Array }[] = [];
    t.deps.telegram.enviarDocumento = async (agente, nome, conteudo) => void anexos.push({ agente, nome, conteudo });
    t.deps.chefe.relatorioFicheiro = (eventos) => ({ nome: 'CERT-X.html', conteudo: `<html>${eventos.length}</html>` });
    await t.orq.correr();
    assert.equal(anexos.length, 1);
    assert.equal(anexos[0]!.agente, 'chefe');
    assert.equal(anexos[0]!.nome, 'CERT-X.html');

    const erro = montar();
    erro.deps.telegram.enviarDocumento = async () => {
      throw new Error('Telegram em baixo');
    };
    erro.deps.chefe.relatorioFicheiro = () => ({ nome: 'x.html', conteudo: 'x' });
    await erro.orq.correr();
    assert.ok(erro.notificacoes.some((n) => /report file.*Telegram em baixo/.test(n)));
  });

  it("não fecha nada se o dono ignorar", async () => {
    const t = montar({
      decisao: (p) => (p.acao.tipo === "remover_regra" ? "ignorar" : "aprovar"),
    });
    await t.orq.correr();
    assert.equal(t.corrigidos.length, 0);
    assert.ok(t.eventos.some((e) => e.tipo === "ignorado"));
  });

  it("não migra se o dono ignorar a migração", async () => {
    const t = montar({
      decisao: (p) => (p.acao.tipo === "migrar" ? "ignorar" : "aprovar"),
    });
    await t.orq.correr();
    assert.match(textos(t.falas, "migrador").at(-1)!, /not approved/);
    assert.ok(!t.falas.some((f) => /files copied/.test(f.texto)));
  });

  it("ignora decisões de quem não é o dono", async () => {
    // Um estranho carrega em Aprovar primeiro: não pode contar.
    const t = montar({ quem: "999" }, { migrar: false });
    const corrida = t.orq.correr();
    for (let i = 0; i < 5; i++) await esperar();
    const pedido = t.pedidosEnviados[0].pedido;
    assert.equal(t.corrigidos.length, 0);
    assert.equal(t.pedidos.get(pedido.id)?.estado, "pendente");
    assert.ok(!t.eventos.some((e) => e.quem === "999"));
    // Só a decisão do dono fecha.
    t.responder(pedido.id, "aprovar", DONO);
    await corrida;
    assert.equal(t.corrigidos.length, 1);
  });

  it("um segundo clique no mesmo pedido não volta a fechar", async () => {
    const t = montar({}, { migrar: false });
    await t.orq.correr();
    const pedido = t.pedidosEnviados[0].pedido;
    t.responder(pedido.id, "aprovar");
    await esperar();
    assert.equal(t.corrigidos.length, 1);
  });

  it("cortes: sem migrador e sem atacante, a defesa pela API continua", async () => {
    const t = montar({}, { migrar: false, atacar: false });
    await t.orq.correr();
    assert.equal(t.reconhecimentos(), 0);
    assert.deepEqual(
      t.pedidosEnviados.map((p) => p.agente),
      ["defesa"],
    );
    assert.equal(t.corrigidos.length, 1);
    assert.equal(t.falas.at(-1)?.de, "chefe");
  });

  it("se a migração falhar, audita, avisa e continua para o ataque e a defesa", async () => {
    const t = montar({ migrarFalha: true });
    await t.orq.correr();
    assert.ok(t.eventos.some((e) => e.tipo === "erro"));
    assert.ok(t.notificacoes.some((n) => /MinIO em baixo/.test(n)));
    assert.equal(t.corrigidos.length, 1);
    assert.equal(t.falas.at(-1)?.de, "chefe");
  });

  it("peças ainda em stub (lançam de forma síncrona) não param o fluxo", async () => {
    const t = montar({ stubs: true, migrarFalha: true }, { atacar: false });
    await t.orq.correr();
    // bus, auditoria, notificar e correlacionar rebentam; a migração falha; mesmo assim a defesa fecha.
    assert.equal(t.corrigidos.length, 1);
  });

  it("canal em stub: ligar() não rebenta e avisa", () => {
    const t = montar({ canalStub: true }, { migrar: false, atacar: false });
    // montar() já chamou ligar(); se lançasse, nem chegávamos aqui.
    assert.ok(t.notificacoes.some((n) => /aoResponder/.test(n)));
    assert.ok(t.notificacoes.some((n) => /aoMensagemDoDono/.test(n)));
  });

  it("a confirmação do fecho só olha para o alvo do achado, não para outras máquinas", async () => {
    const t = montar({ outroAlvoAberto: true }, { migrar: false });
    await t.orq.correr();
    assert.equal(
      textos(t.falas, "atacante").at(-1),
      "Confirmed. I can no longer reach it.",
    );
  });

  it("sem resposta do dono: não migra, resume na mesma e deixa a porta por decidir", async () => {
    const t = montar(
      { decisao: () => undefined },
      { atacar: false, esperaDecisaoMs: 20 },
    );
    await t.orq.correr();
    assert.match(
      textos(t.falas, "migrador").at(-1)!,
      /No answer to the migration request: I will not migrate/,
    );
    const migracao = t.pedidosEnviados.find(
      (p) => p.agente === "migrador",
    )!.pedido;
    assert.equal(t.pedidos.get(migracao.id)?.estado, "ignorado");
    assert.equal(t.corrigidos.length, 0);
    assert.equal(t.falas.at(-1)?.de, "chefe");
    // Um clique tardio na migração já não conta; na porta ainda fecha (foi um humano a aprovar).
    const porta = t.pedidosEnviados.find((p) => p.agente === "defesa")!.pedido;
    t.responder(migracao.id, "aprovar");
    t.responder(porta.id, "aprovar");
    await esperar();
    await esperar();
    assert.equal(t.corrigidos.length, 1);
  });

  it("tradutor: o plano da infraestrutura sai antes do pedido de migração; se falhar, migra na mesma", async () => {
    const ok = montar({}, { atacar: false });
    ok.deps.migrador.planoInfra = async () => "Move-se hoje: 1 VM.";
    await ok.orq.correr();
    const iPlano = ok.falas.findIndex((f) =>
      /Move-se hoje: 1 VM/.test(f.texto),
    );
    assert.ok(iPlano >= 0, "o plano foi dito");
    assert.match(
      ok.falas[iPlano].texto,
      /only the plan; I have not created anything/,
    );

    const falha = montar({}, { atacar: false });
    falha.deps.migrador.planoInfra = async () => {
      throw new Error("segredo detetado");
    };
    await falha.orq.correr();
    assert.ok(
      falha.notificacoes.some((n) => /AWS configuration translation/.test(n)),
    );
    assert.ok(
      falha.falas.some((f) => /files copied/.test(f.texto)),
      "a migração S3 continuou",
    );
  });

  it("o chefe só vê a auditoria deste ciclo, não os ensaios anteriores do dia", async () => {
    const antigo = (tipo: string): EventoAuditoria => ({
      hora: "2026-11-20T09:00:00.000Z",
      pedidoId: "velho",
      tipo,
    });
    const t = montar(
      { historico: [antigo("infra-no-ar"), antigo("erro"), antigo("feito")] },
      { atacar: false },
    );
    await t.orq.correr();
    const vistos = t.vistoPeloChefe.at(-1)!;
    assert.ok(vistos.length > 0);
    assert.ok(
      vistos.every((e) => e.pedidoId !== "velho"),
      "nenhum evento de ensaios anteriores",
    );
    assert.ok(
      vistos.some((e) => e.tipo === "infra-no-ar"),
      "o deste ciclo está lá",
    );
  });

  it("decisor de destino: fala antes do pedido com os serviços do analisar; se falhar, migra na mesma", async () => {
    const ok = montar({}, { atacar: false });
    let recebidos: string[] = [];
    ok.deps.migrador.planoDestino = async (s) => (
      (recebidos = s),
      "O PostgreSQL vai para gerido."
    );
    await ok.orq.correr();
    assert.deepEqual(recebidos, ["s3", "postgres", "fila"]);
    const iDestino = ok.falas.findIndex(
      (f) => f.texto === "O PostgreSQL vai para gerido.",
    );
    const iCopia = ok.falas.findIndex((f) => /files copied/.test(f.texto));
    assert.ok(iDestino >= 0 && iDestino < iCopia);

    const falha = montar({}, { atacar: false });
    falha.deps.migrador.planoDestino = async () => {
      throw new Error("tabela de preços");
    };
    await falha.orq.correr();
    assert.ok(falha.notificacoes.some((n) => /destination planner/.test(n)));
    assert.ok(falha.falas.some((f) => /files copied/.test(f.texto)));
  });

  it("decisor de destino: /selfhosted volta a correr o decisor no modo do dono e fica na auditoria", async () => {
    const t = montar({}, { atacar: false });
    const modos: (string | undefined)[] = [];
    t.deps.migrador.planoDestino = async (_s, modo) => (modos.push(modo), modo === "tudo-self-hosted" ? "All on the VM." : "I propose a managed PostgreSQL.");
    // Antes de haver plano: não faz nada, só avisa.
    await t.orq.aoMensagemDoDono(null, "/selfhosted");
    assert.ok(t.notificacoes.some((n) => /no migration plan yet/i.test(n)));
    // Com o pedido do plano no grupo (antes de aprovar), o dono escolhe e muda de ideias.
    const original = t.deps.telegram.pedirAprovacao;
    t.deps.telegram.pedirAprovacao = async (agente, pedido) => {
      if (pedido.acao.tipo === "migrar") {
        await t.orq.aoMensagemDoDono(null, "/selfhosted");
        await t.orq.aoMensagemDoDono(null, "/recomendado");
      }
      return original(agente, pedido);
    };
    await t.orq.correr();
    assert.ok(t.falas.some((f) => /\/recomendado[\s\S]*\/selfhosted/.test(f.texto)), "a recomendação com geridos oferece as duas escolhas");
    assert.ok(t.eventos.some((e) => e.tipo === "decisao-destino" && e.quem === "migrador"), "por omissão: o recomendado, registado");
    assert.ok(t.falas.some((f) => /everything self-hosted on your VM[\s\S]*All on the VM\./.test(f.texto)));
    assert.ok(t.falas.some((f) => /recommended plan[\s\S]*simulated/.test(f.texto)));
    assert.deepEqual(modos, [undefined, "tudo-self-hosted", "recomendado"]);
    const escolhas = t.eventos.filter((e) => e.tipo === "decisao-destino" && e.quem === "dono").map((e) => (e.depois as { modo: string }).modo);
    assert.deepEqual(escolhas, ["tudo-self-hosted", "recomendado"]);
  });

  it("decisor de destino: escolha repetida em seguida conta uma vez; depois de o plano estar decidido, recusa", async () => {
    const t = montar({}, { atacar: false });
    const modos: (string | undefined)[] = [];
    t.deps.migrador.planoDestino = async (_s, modo) => (modos.push(modo), "I propose a managed PostgreSQL.");
    // Durante o pedido do plano (antes de aprovar): o dono escolhe; o mesmo comando chega duas vezes (dois bots).
    const original = t.deps.telegram.pedirAprovacao;
    t.deps.telegram.pedirAprovacao = async (agente, pedido) => {
      if (pedido.acao.tipo === "migrar") {
        await t.orq.aoMensagemDoDono(null, "/selfhosted");
        await t.orq.aoMensagemDoDono(null, "/selfhosted");
      }
      return original(agente, pedido); // o teste aprova como de costume
    };
    await t.orq.correr();
    assert.deepEqual(modos.filter((m) => m === "tudo-self-hosted"), ["tudo-self-hosted"], "duplicado ignorado");
    const antes = t.eventos.filter((e) => e.tipo === "decisao-destino" && e.quem === "dono").length;
    // Plano já decidido: a escolha é recusada e não fica registada.
    await t.orq.aoMensagemDoDono(null, "/recomendado");
    assert.ok(t.notificacoes.some((n) => /already decided/.test(n)));
    assert.equal(t.eventos.filter((e) => e.tipo === "decisao-destino" && e.quem === "dono").length, antes);
  });

  it("ao aprovar o plano, o atacante começa a atacar em paralelo com a migração", async () => {
    const t = montar({}, { atacar: true });
    await t.orq.correr();
    assert.ok(t.pedidosEnviados.some((p) => p.pedido.acao.tipo === "migrar"));
    assert.equal(t.ataques.length, 1);
    assert.equal(t.ataques[0]?.alvo, "203.0.113.10");
    // A defesa reagiu à ronda do atacante (pedido + fecho) antes de o ciclo seguir.
    assert.equal(t.corrigidos.length, 1);
  });

  it('um só "Aprovar plano": todos os passos por ordem, prova e auditoria por passo, testes uma vez no fim', async () => {
    const t = montar({}, { atacar: false });
    const ordem: string[] = [];
    let verificacoes = 0;
    t.deps.migrador.migrarPostgres = async () => (
      ordem.push("postgres"),
      { tabelas: 1, linhas: 20, checksumsOk: true }
    );
    t.deps.migrador.migrarFila = async () => (
      ordem.push("fila"),
      { mensagens: 5, iguais: true }
    );
    t.deps.migrador.verificar = async () => (
      verificacoes++,
      { antes: true, depois: true }
    );
    await t.orq.correr();

    const migrar = t.pedidosEnviados.filter(
      (p) => p.pedido.acao.tipo === "migrar",
    );
    assert.equal(migrar.length, 1, "um só pedido de aprovação");
    assert.match(
      migrar[0].pedido.titulo,
      /Migrate to Leaseweb: S3, Postgres, SQS/,
    );
    assert.deepEqual(ordem, ["postgres", "fila"]);
    assert.equal(verificacoes, 1, "os testes da app correm uma vez, no fim");

    const passos = [...t.pedidos.values()].filter(
      (p) => p.acao.tipo === "migrar",
    );
    assert.deepEqual(
      passos.map((p) => [(p.acao as { passo: string }).passo, p.estado]),
      [
        ["s3", "feito"],
        ["postgres", "feito"],
        ["fila", "feito"],
      ],
    );
    for (const p of passos) {
      assert.ok(
        t.eventos.some((e) => e.pedidoId === p.id && e.tipo === "feito"),
        `prova na auditoria para ${p.id}`,
      );
    }
    const fila = passos.find(
      (p) => (p.acao as { passo: string }).passo === "fila",
    )!;
    assert.deepEqual(
      t.eventos.findLast((e) => e.pedidoId === fila.id)?.depois,
      {
        passo: "fila",
        mensagens: 5,
        checksumsOk: true,
        testes: { antes: true, depois: true },
      },
    );
    assert.ok(
      t.eventos.some(
        (e) =>
          e.pedidoId === fila.id &&
          e.tipo === "aprovado" &&
          (e.depois as { pelo?: string }).pelo === migrar[0].pedido.id,
      ),
    );

    const fala = textos(t.falas, "migrador").at(-1)!;
    assert.match(
      fala,
      /12 files copied to MinIO, checksums match\. Database: 1 table and 20 rows copied to PostgreSQL, checksums match\. Queues: 5 messages moved to RabbitMQ, checksums match\. App tests passing on both sides\. @atacante/,
    );
  });

  it("plano: sem OK não se migra nada; sem função ligada o passo fica de fora", async () => {
    const recusa = montar(
      { decisao: (p) => (p.acao.tipo === "migrar" ? "ignorar" : "aprovar") },
      { atacar: false },
    );
    let tocou = false;
    recusa.deps.migrador.migrarPostgres = async () => (
      (tocou = true),
      { tabelas: 1, linhas: 1, checksumsOk: true }
    );
    recusa.deps.migrador.migrarFila = async () => (
      (tocou = true),
      { mensagens: 1, iguais: true }
    );
    await recusa.orq.correr();
    assert.equal(tocou, false);
    assert.equal(recusa.corrigidos.length, 1, "a defesa segue");

    // O analisar encontra s3, postgres e fila, mas só o S3 tem função: o plano é só o S3.
    const so = montar({}, { atacar: false });
    await so.orq.correr();
    const migrar = so.pedidosEnviados.filter(
      (p) => p.pedido.acao.tipo === "migrar",
    );
    assert.equal(migrar.length, 1);
    assert.match(migrar[0].pedido.titulo, /: S3$/);
    assert.equal(
      [...so.pedidos.values()].filter((p) => p.acao.tipo === "migrar").length,
      1,
    );
  });

  it("plano: um passo que falha não trava os outros; checksums diferentes ou testes a falhar não contam como feito", async () => {
    const t = montar({}, { atacar: false });
    t.deps.migrador.migrarPostgres = async () => {
      throw new Error("Postgres de destino não responde");
    };
    t.deps.migrador.migrarFila = async () => ({ mensagens: 5, iguais: false });
    await t.orq.correr();
    assert.ok(
      t.notificacoes.some((n) =>
        /migration Postgres.*Postgres de destino não responde/.test(n),
      ),
    );
    const estado = (passo: string) =>
      [...t.pedidos.values()].find(
        (p) => (p.acao as { passo?: string }).passo === passo,
      )?.estado;
    assert.equal(estado("s3"), "feito");
    assert.equal(
      estado("postgres"),
      "aprovado",
      "falhou: fica aprovado, não feito",
    );
    assert.equal(
      estado("fila"),
      "aprovado",
      "checksums diferentes não contam como feito",
    );
    assert.ok(
      t.falas.some((f) =>
        /Queues: 5 messages moved to RabbitMQ, checksums DIFFER/.test(f.texto),
      ),
    );
    assert.equal(t.corrigidos.length, 1, "a defesa segue");
    assert.equal(t.falas.at(-1)?.de, "chefe");

    const testes = montar({}, { atacar: false });
    testes.deps.migrador.verificar = async () => ({
      antes: true,
      depois: false,
    });
    await testes.orq.correr();
    assert.equal(
      [...testes.pedidos.values()].find((p) => p.acao.tipo === "migrar")
        ?.estado,
      "aprovado",
    );
    assert.ok(
      testes.falas.some((f) => /Tests before ok, after failed/.test(f.texto)),
    );
  });

  it('"Aprovar PR": merge depois do clique, inverso guardado; /desfazer abre um PR que reverte; simulado não pede', async () => {
    const t = montar({}, { atacar: false });
    const merges: string[] = [];
    const reverts: string[] = [];
    t.deps.migrador.migrarCodigo = async () => ({
      ficheiros: ["leaseweb.env.example", "infra/main.tf.json"],
      fora: [],
      problemas: [],
      causas: 1,
      pr: {
        ramo: "migracao/leaseweb-1",
        simulado: false,
        url: "https://github.com/dono/app/pull/7",
      },
    });
    t.deps.migrador.aprovarPR = async (repo, numero) => (
      merges.push(`${repo}#${numero}`),
      { commit: "abc1234" }
    );
    t.deps.migrador.reverterPR = async (repo, numero, commit) => (
      reverts.push(`${repo}#${numero}@${commit}`),
      { url: "https://github.com/dono/app/pull/8" }
    );
    await t.orq.correr();

    const pedidoPR = t.pedidosEnviados.find(
      (p) => p.pedido.acao.tipo === "aprovar_pr",
    )?.pedido;
    assert.ok(pedidoPR, 'pede "Aprovar PR" no Telegram');
    assert.equal(
      t.pedidosEnviados.find((p) => p.pedido.acao.tipo === "aprovar_pr")!
        .agente,
      "migrador",
    );
    assert.match(
      pedidoPR!.texto,
      /Includes the fix for the rule that left the database open/,
    );
    assert.deepEqual(merges, ["dono/app#7"]);
    assert.equal(t.pedidos.get(pedidoPR!.id)?.estado, "feito");
    const feito = t.eventos.findLast(
      (e) => e.pedidoId === pedidoPR!.id && e.tipo === "feito",
    )!;
    assert.deepEqual(feito.inverso, {
      tipo: "reverter_pr",
      repo: "dono/app",
      numero: 7,
      commit: "abc1234",
    });
    assert.ok(
      t.falas.some((f) =>
        /PR #7 approved and merged into the app repo main branch at \d\d:\d\d\. To undo: \/desfazer/.test(
          f.texto,
        ),
      ),
    );
    assert.equal(
      t.corrigidos.length,
      1,
      "a defesa continua a fechar só regras",
    );

    t.mensagemDoDono(null, `/desfazer ${pedidoPR!.id}`);
    for (let i = 0; i < 5; i++) await esperar();
    assert.deepEqual(reverts, ["dono/app#7@abc1234"]);
    assert.equal(
      t.desfeitos.length,
      0,
      "o /desfazer de um PR não vai para a defesa",
    );
    assert.equal(t.pedidos.get(pedidoPR!.id)?.estado, "desfeito");
    assert.ok(
      t.falas.some((f) =>
        /I opened a PR that reverts PR #7: https:\/\/github\.com\/dono\/app\/pull\/8/.test(
          f.texto,
        ),
      ),
    );

    // Um PR simulado (ensaio sem GitHub) não pede "Aprovar PR".
    const sim = montar({}, { atacar: false });
    sim.deps.migrador.migrarCodigo = async () => ({
      ficheiros: ["x"],
      fora: [],
      problemas: [],
      pr: { ramo: "r", simulado: true },
    });
    sim.deps.migrador.aprovarPR = async () => ({});
    await sim.orq.correr();
    assert.ok(
      !sim.pedidosEnviados.some((p) => p.pedido.acao.tipo === "aprovar_pr"),
    );

    // Ignorar: não há merge.
    const nao = montar(
      {
        decisao: (p) => (p.acao.tipo === "aprovar_pr" ? "ignorar" : "aprovar"),
      },
      { atacar: false },
    );
    let tocou = false;
    nao.deps.migrador.migrarCodigo = t.deps.migrador.migrarCodigo;
    nao.deps.migrador.aprovarPR = async () => ((tocou = true), {});
    await nao.orq.correr();
    assert.equal(tocou, false);
  });

  it("relatório do incidente só com os eventos deste ciclo (a auditoria tem os ensaios do dia)", async () => {
    const antigo: EventoAuditoria = {
      hora: "2000-01-01T00:00:00.000Z",
      pedidoId: "velho",
      tipo: "feito",
      quem: "defesa",
    };
    const t = montar({ historico: [antigo] });
    let recebidos: EventoAuditoria[] = [];
    t.deps.relatorio = {
      publicar: async (_id, eventos) => void (recebidos = eventos),
    };
    await t.orq.correr();
    assert.ok(recebidos.length > 0);
    assert.ok(
      !recebidos.some((e) => e.pedidoId === "velho"),
      "o fecho de um ensaio anterior não entra no relatório",
    );
  });

  it("decisor: com um serviço gerido proposto, dá a escolha ao dono e diz que os geridos são simulados (tudo na VM)", async () => {
    const t = montar({}, { atacar: false });
    t.deps.migrador.planoDestino = async () =>
      "A base de dados é crítica: proponho Scaleway DB-DEV-S, cerca de € 11,39/mês (preço visto a 20/11/2026).";
    await t.orq.correr();
    assert.ok(
      t.falas.some((f) =>
        /proponho Scaleway[\s\S]*\/recomendado[\s\S]*\/selfhosted[\s\S]*simulated today; the data runs on the VM\./.test(
          f.texto,
        ),
      ),
    );
    const so = montar({}, { atacar: false });
    so.deps.migrador.planoDestino = async () =>
      "O MinIO e o RabbitMQ ficam na VM.";
    await so.orq.correr();
    assert.ok(
      !so.falas.some((f) => /\/selfhosted/.test(f.texto)),
      "sem gerido proposto, não há escolha a fazer",
    );
  });

  it("migrador de código: no mesmo plano, depois dos testes; sem PR diz porquê; um erro não trava", async () => {
    const t = montar({}, { atacar: false });
    const chamadas: [string, boolean][] = [];
    t.deps.migrador.migrarCodigo = async (id, ok) => (
      chamadas.push([id, ok]),
      {
        ficheiros: ["leaseweb.env.example"],
        fora: [],
        problemas: [],
        pr: {
          ramo: `migrador/leaseweb-${id}`,
          simulado: false,
          url: "https://github.com/x/y/pull/3",
        },
      }
    );
    await t.orq.correr();
    const plano = t.pedidosEnviados.find(
      (p) => p.pedido.acao.tipo === "migrar",
    )!.pedido;
    assert.equal(
      t.pedidosEnviados.filter((p) => p.pedido.acao.tipo === "migrar").length,
      1,
      "o PR não pede outro clique",
    );
    assert.match(plano.texto, /At the end I prepare a pull request/);
    assert.deepEqual(chamadas, [[plano.id, true]]);
    const migrador = textos(t.falas, "migrador");
    const iPR = migrador.findIndex((f) =>
      /Code: I opened a pull request with 1 file \(leaseweb\.env\.example\).*https:\/\/github\.com\/x\/y\/pull\/3/.test(
        f,
      ),
    );
    assert.ok(iPR > 0, "o PR é anunciado");
    // Guião (mensagens-demo.md): migrar → atacar → defender → só depois o PR do código.
    const iPassagem = t.falas.findIndex((f) =>
      /@atacante, the new infrastructure is live\./.test(f.texto),
    );
    const iFecho = t.falas.findIndex(
      (f) => f.de === "defesa" && /I closed/.test(f.texto),
    );
    const iPRGlobal = t.falas.findIndex((f) =>
      /Code: I opened a pull request/.test(f.texto),
    );
    assert.ok(
      iPassagem >= 0 && iFecho > iPassagem && iPRGlobal > iFecho,
      "o PR do código vem depois da defesa",
    );
    assert.ok(
      t.eventos.some(
        (e) =>
          e.tipo === "migracao-codigo" &&
          (e.depois as { url?: string }).url ===
            "https://github.com/x/y/pull/3",
      ),
    );

    const sem = montar({}, { atacar: false });
    sem.deps.migrador.verificar = async () => ({ antes: true, depois: false });
    sem.deps.migrador.migrarCodigo = async (_id, ok) => ({
      ficheiros: [],
      fora: [],
      problemas: ok ? [] : ["the app tests did not pass against Leaseweb"],
    });
    await sem.orq.correr();
    assert.ok(
      sem.falas.some((f) =>
        /I did not open the code pull request: the app tests did not pass against Leaseweb\./.test(
          f.texto,
        ),
      ),
    );

    const erro = montar({}, { atacar: false });
    erro.deps.migrador.migrarCodigo = async () => {
      throw new Error("gh não está autenticado");
    };
    await erro.orq.correr();
    assert.ok(
      erro.notificacoes.some((n) =>
        /code migrator.*gh não está autenticado/.test(n),
      ),
    );
    assert.equal(erro.corrigidos.length, 1, "a defesa segue");
  });

  it("modo noite: sem resposta, a defesa aplica a medida temporária; se o dono decidir antes, não", async () => {
    const t = montar(
      { decisao: (p) => (p.acao.tipo === "migrar" ? "aprovar" : undefined) },
      { atacar: false, modoNoiteMs: 5, esperaDecisaoMs: 2_000 },
    );
    const noite: string[] = [];
    t.deps.defesa.modoNoite = async (p) => {
      noite.push(p.id);
      t.deps.estado.mudarEstado(p.id, "feito");
      return true;
    };
    await t.orq.correr();
    assert.equal(noite.length, 1, "o modo noite correu uma vez");
    assert.equal(t.corrigidos.length, 0, "não houve fecho por aprovação");
    assert.equal(
      t.falas.at(-1)?.de,
      "chefe",
      "o ciclo acaba sem esperar os 2 s",
    );

    const dono = montar({}, { atacar: false, modoNoiteMs: 30 });
    let chamado = false;
    dono.deps.defesa.modoNoite = async () => ((chamado = true), true);
    await dono.orq.correr();
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(chamado, false, "o dono decidiu antes: o temporizador saiu");
    assert.equal(dono.corrigidos.length, 1);

    const nao = montar(
      { decisao: (p) => (p.acao.tipo === "migrar" ? "aprovar" : undefined) },
      { atacar: false, modoNoiteMs: 5, esperaDecisaoMs: 80 },
    );
    nao.deps.defesa.modoNoite = async () => false;
    await nao.orq.correr();
    assert.equal(
      [...nao.pedidos.values()].find((p) => p.acao.tipo === "remover_regra")
        ?.estado,
      "pendente",
      "não elegível: continua por decidir pelo dono",
    );
  });

  it("plano: segredos e cache entram quando o migrador os tiver, e a prova não leva valores", async () => {
    const t = montar({}, { atacar: false });
    t.deps.migrador.analisar = async () => ({
      servicos: ["s3", "segredos", "cache"],
      plano: "plano",
    });
    t.deps.migrador.migrarSegredos = async () => ({
      segredos: 7,
      iguais: true,
    });
    t.deps.migrador.migrarCache = async () => ({ chaves: 40, iguais: true });
    await t.orq.correr();
    const fala = textos(t.falas, "migrador").at(-1)!;
    assert.match(
      fala,
      /Secrets: 7 moved to OpenBao without ever showing a value, checksums match\. Cache: 40 keys copied to Valkey, checksums match/,
    );
    const seg = [...t.pedidos.values()].find(
      (p) => (p.acao as { passo?: string }).passo === "segredos",
    )!;
    assert.deepEqual(t.eventos.findLast((e) => e.pedidoId === seg.id)?.depois, {
      passo: "segredos",
      segredos: 7,
      checksumsOk: true,
      testes: { antes: true, depois: true },
    });
  });

  it("relatório do incidente: um por achado tratado, depois da defesa e antes do resumo; uma falha não trava", async () => {
    const t = montar();
    const publicados: string[] = [];
    const falasNoMomento: number[] = [];
    t.deps.relatorio = {
      publicar: async (id, eventos) => {
        assert.ok(
          eventos.every((e) => !(e as { antigo?: boolean }).antigo),
          "só eventos deste ciclo",
        );
        publicados.push(id);
        falasNoMomento.push(t.falas.length);
      },
    };
    await t.orq.correr();
    assert.deepEqual(
      publicados,
      ["a1"],
      "o achado da API (correlacionado com o do atacante) dá um só relatório",
    );
    assert.ok(
      t.corrigidos.length === 1 && falasNoMomento[0] < t.falas.length,
      "sai depois do fecho e antes do chefe",
    );
    assert.equal(t.falas.at(-1)?.de, "chefe");

    const erro = montar();
    erro.deps.relatorio = {
      publicar: async () => {
        throw new Error("enviarComDesfazer falhou");
      },
    };
    await erro.orq.correr();
    assert.ok(erro.notificacoes.some((n) => /incident report a1/.test(n)));
    assert.deepEqual(
      erro.falas.slice(-2).map((f) => f.texto),
      ["RESUMO", "CERT com relógio"],
    );

    const nada = montar({}, { atacar: false });
    nada.deps.defesa.detetar = async () => [];
    let chamado = false;
    nada.deps.relatorio = { publicar: async () => void (chamado = true) };
    await nada.orq.correr();
    assert.equal(chamado, false, "sem achados tratados não há relatório");
  });

  it("voz dos agentes: responde quem foi chamado, com o estado; no grupo sem menção cala-se", async () => {
    const t = montar({}, { migrar: false, atacar: false });
    const chamadas: { agente: string; pergunta: string; estado: string }[] = [];
    t.deps.voz = {
      responder: async (agente, pergunta, estado) => (
        chamadas.push({ agente, pergunta, estado }),
        `resposta de ${agente}`
      ),
    };
    await t.orq.correr();
    t.mensagemDoDono("defesa", "o que está aberto agora?");
    t.mensagemDoDono(null, "bom dia a todos");
    for (let i = 0; i < 4; i++) await esperar();
    assert.equal(chamadas.length, 1);
    assert.equal(chamadas[0].agente, "defesa");
    assert.match(chamadas[0].estado, /ESTADO/);
    assert.match(chamadas[0].estado, /RESUMO/);
    assert.equal(t.falas.at(-1)?.de, "defesa");
    assert.equal(t.falas.at(-1)?.texto, "resposta de defesa");
  });

  it("voz: os comandos continuam a ser comandos, não vão para o LLM", async () => {
    const t = montar({}, { migrar: false, atacar: false });
    let chamadas = 0;
    t.deps.voz = { responder: async () => (chamadas++, "x") };
    await t.orq.correr();
    t.mensagemDoDono("defesa", "/estado");
    t.mensagemDoDono("defesa", "/desfazer abc12345");
    for (let i = 0; i < 4; i++) await esperar();
    assert.equal(chamadas, 0);
    assert.deepEqual(t.desfeitos, ["abc12345"]);
  });

  it("o atacante diz se ainda chega à porta depois de fechar", async () => {
    const t = montar({ portaFechada: false }, { migrar: false });
    await t.orq.correr();
    assert.match(
      textos(t.falas, "atacante").at(-1)!,
      /I can still reach port 5432/,
    );
  });

  it("comandos do dono: /estado e /desfazer <id>", async () => {
    const t = montar({}, { migrar: false, atacar: false });
    await t.orq.correr();
    t.mensagemDoDono(null, "/estado");
    t.mensagemDoDono("defesa", "/desfazer abc12345");
    await esperar();
    assert.ok(t.notificacoes.includes("ESTADO"));
    assert.deepEqual(t.desfeitos, ["abc12345"]);
    assert.ok(
      !t.falas.some((f) => /Desfeito/.test(f.texto)),
      "o aviso de desfeito vem do desfazer(), não se repete",
    );
  });

  it("/atacar arranca a sequência do atacante com o alvo indicado", async () => {
    const t = montar({}, { migrar: false, atacar: false });
    await t.orq.correr();
    await t.orq.aoMensagemDoDono(null, "/atacar 203.0.113.10");
    assert.deepEqual(
      t.ataques.map((a) => a.alvo),
      ["203.0.113.10"],
    );
  });
});

describe("textoAtacante", () => {
  it("sem achados", () => {
    assert.match(textoAtacante([]), /I found no open ports/);
  });
  it("resume no máximo 3 e indica o resto", () => {
    const muitos = [5432, 6379, 22, 9200].map((porta, i) => ({
      ...achadoAtacante,
      id: `x${i}`,
      porta,
    }));
    const t = textoAtacante(muitos);
    assert.match(t, /and 1 more/);
    assert.match(t, /Severity high/);
  });
});
