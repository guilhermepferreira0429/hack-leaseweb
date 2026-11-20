// Orquestrador com dependências falsas: o fluxo e as salvaguardas, sem Telegram, Leaseweb nem nmap.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Achado, Agente, Decisao, EventoAuditoria, Mensagem, Pedido, EstadoPedido } from '@mwbe/shared';
import { acaoPara, montarPedido, novoIdPedido } from './defesa/explicar';
import { criarOrquestrador, textoAtacante, type Dependencias, type Opcoes } from './orquestrador';

const DONO = '42';

const regra = { id: 'r-5432', protocol: 'TCP', source: '0.0.0.0/0', startPort: 5432, endPort: 5432 };
const achadoApi: Achado = {
  id: 'a1',
  tipo: 'porta-exposta',
  origem: 'api',
  alvo: '203.0.113.10',
  securityGroupId: 'sg-vitima',
  regra,
  porta: 5432,
  servico: 'PostgreSQL',
  severidade: 'alta',
  detalhe: 'TCP 5432 0.0.0.0/0',
};
const achadoAtacante: Achado = { ...achadoApi, id: 'b1', origem: 'atacante', tipo: 'servico-exposto', regra: undefined, securityGroupId: undefined };

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
  throw new Error('Ainda não implementado');
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
  let reconhecimentos = 0;
  let fechado = false;
  let aoResponder: ((id: string, d: Decisao, quem: string) => void) | undefined;
  let aoMensagem: ((a: Agente | null, t: string) => void) | undefined;

  const deps: Dependencias = {
    telegram: {
      async pedirAprovacao(agente, pedido) {
        pedidosEnviados.push({ agente, pedido });
        const d = (cenario.decisao ?? (() => 'aprovar'))(pedido);
        if (d) setImmediate(() => aoResponder?.(pedido.id, d, cenario.quem ?? DONO));
      },
      aoResponder: cenario.canalStub ? stub : (cb) => void (aoResponder = cb),
      aoMensagemDoDono: cenario.canalStub ? stub : (cb) => void (aoMensagem = cb),
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
    auditoria: cenario.stubs ? { registar: stub, ler: stub } : { registar: (e) => void eventos.push(e), ler: () => eventos },
    defesa: {
      detetar: async () => [achadoApi],
      correlacionar: cenario.stubs ? stub : (api, atk) => [...api, ...atk.filter((a) => !api.some((b) => b.alvo === a.alvo && b.porta === a.porta))],
      acaoPara,
      async tratar(achado) {
        const pedido = montarPedido(achado, 'Três frases.', acaoPara(achado)!);
        deps.estado.guardarPedido(pedido);
        await deps.telegram.pedirAprovacao('defesa', pedido);
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
        const isco = cenario.outroAlvoAberto ? [{ ...achadoAtacante, id: 'isco', alvo: '203.0.113.99' }] : [];
        return fechado ? isco : [achadoAtacante, ...isco];
      },
    },
    migrador: {
      analisar: async () => ({ servicos: ['s3', 'postgres', 'fila'], plano: 'S3 -> MinIO' }),
      async migrarS3() {
        if (cenario.migrarFalha) throw new Error('MinIO em baixo');
        return { objetos: 12, checksumsOk: true };
      },
      verificar: async () => ({ antes: true, depois: true }),
    },
    chefe: { resumir: (e) => (vistoPeloChefe.push(e), 'RESUMO'), estadoAtual: () => 'ESTADO', certificado: (e) => `CERT ${e.some((x) => x.tipo === 'infra-no-ar') ? 'com relógio' : 'sem relógio'}` },
  };

  const orq = criarOrquestrador(deps, {
    migrar: true,
    atacar: true,
    dirApp: 'code/exemplo-app',
    alvos: ['203.0.113.10'],
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
    reconhecimentos: () => reconhecimentos,
    mensagemDoDono: (a: Agente | null, t: string) => aoMensagem?.(a, t),
    responder: (id: string, d: Decisao, quem = DONO) => aoResponder?.(id, d, quem),
  };
}

const textos = (falas: Mensagem[], de: Agente) => falas.filter((f) => f.de === de).map((f) => f.texto);
const esperar = () => new Promise((r) => setImmediate(r));

describe('orquestrador', () => {
  it('corre o fluxo completo: migrar, atacar, defender, fechar, confirmar, resumir', async () => {
    const t = montar();
    await t.orq.correr();

    assert.deepEqual(
      t.pedidosEnviados.map((p) => [p.agente, p.pedido.acao.tipo]),
      [
        ['migrador', 'migrar'],
        ['defesa', 'remover_regra'],
      ],
    );
    assert.equal(t.corrigidos.length, 1);
    assert.match(textos(t.falas, 'migrador').at(-1)!, /12 ficheiros copiados para o MinIO, checksums iguais\. Testes da app a passar dos dois lados\./);
    assert.match(textos(t.falas, 'atacante')[0], /PostgreSQL na porta 5432/);
    assert.match(textos(t.falas, 'defesa').at(-1)!, /@atacante, fechei "PostgreSQL aberto a toda a internet" às \d\d:\d\d/);
    assert.equal(textos(t.falas, 'atacante').at(-1), 'Confirmo. Já não chego lá.');
    assert.equal(t.falas.at(-1)?.de, 'chefe');
    assert.deepEqual(t.falas.slice(-2).map((f) => f.texto), ['RESUMO', 'CERT com relógio']);
    const recon = t.eventos.find((e) => e.tipo === 'reconhecimento')?.depois as { portas?: unknown[] };
    assert.equal(recon.portas?.length, 1, 'as portas encontradas ficam na auditoria para o certificado');
    assert.ok(t.eventos.some((e) => e.tipo === 'aprovado' && e.quem === DONO));
  });

  it('não fecha nada se o dono ignorar', async () => {
    const t = montar({ decisao: (p) => (p.acao.tipo === 'remover_regra' ? 'ignorar' : 'aprovar') });
    await t.orq.correr();
    assert.equal(t.corrigidos.length, 0);
    assert.ok(t.eventos.some((e) => e.tipo === 'ignorado'));
  });

  it('não migra se o dono ignorar a migração', async () => {
    const t = montar({ decisao: (p) => (p.acao.tipo === 'migrar' ? 'ignorar' : 'aprovar') });
    await t.orq.correr();
    assert.match(textos(t.falas, 'migrador').at(-1)!, /não aprovada/);
    assert.ok(!t.falas.some((f) => /ficheiros copiados/.test(f.texto)));
  });

  it('ignora decisões de quem não é o dono', async () => {
    // Um estranho carrega em Aprovar primeiro: não pode contar.
    const t = montar({ quem: '999' }, { migrar: false });
    const corrida = t.orq.correr();
    for (let i = 0; i < 5; i++) await esperar();
    const pedido = t.pedidosEnviados[0].pedido;
    assert.equal(t.corrigidos.length, 0);
    assert.equal(t.pedidos.get(pedido.id)?.estado, 'pendente');
    assert.ok(!t.eventos.some((e) => e.quem === '999'));
    // Só a decisão do dono fecha.
    t.responder(pedido.id, 'aprovar', DONO);
    await corrida;
    assert.equal(t.corrigidos.length, 1);
  });

  it('um segundo clique no mesmo pedido não volta a fechar', async () => {
    const t = montar({}, { migrar: false });
    await t.orq.correr();
    const pedido = t.pedidosEnviados[0].pedido;
    t.responder(pedido.id, 'aprovar');
    await esperar();
    assert.equal(t.corrigidos.length, 1);
  });

  it('cortes: sem migrador e sem atacante, a defesa pela API continua', async () => {
    const t = montar({}, { migrar: false, atacar: false });
    await t.orq.correr();
    assert.equal(t.reconhecimentos(), 0);
    assert.deepEqual(t.pedidosEnviados.map((p) => p.agente), ['defesa']);
    assert.equal(t.corrigidos.length, 1);
    assert.equal(t.falas.at(-1)?.de, 'chefe');
  });

  it('se a migração falhar, audita, avisa e continua para o ataque e a defesa', async () => {
    const t = montar({ migrarFalha: true });
    await t.orq.correr();
    assert.ok(t.eventos.some((e) => e.tipo === 'erro'));
    assert.ok(t.notificacoes.some((n) => /MinIO em baixo/.test(n)));
    assert.equal(t.corrigidos.length, 1);
    assert.equal(t.falas.at(-1)?.de, 'chefe');
  });

  it('peças ainda em stub (lançam de forma síncrona) não param o fluxo', async () => {
    const t = montar({ stubs: true, migrarFalha: true }, { atacar: false });
    await t.orq.correr();
    // bus, auditoria, notificar e correlacionar rebentam; a migração falha; mesmo assim a defesa fecha.
    assert.equal(t.corrigidos.length, 1);
  });

  it('canal em stub: ligar() não rebenta e avisa', () => {
    const t = montar({ canalStub: true }, { migrar: false, atacar: false });
    // montar() já chamou ligar(); se lançasse, nem chegávamos aqui.
    assert.ok(t.notificacoes.some((n) => /aoResponder/.test(n)));
    assert.ok(t.notificacoes.some((n) => /aoMensagemDoDono/.test(n)));
  });

  it('a confirmação do fecho só olha para o alvo do achado, não para outras máquinas', async () => {
    const t = montar({ outroAlvoAberto: true }, { migrar: false });
    await t.orq.correr();
    assert.equal(textos(t.falas, 'atacante').at(-1), 'Confirmo. Já não chego lá.');
  });

  it('sem resposta do dono: não migra, resume na mesma e deixa a porta por decidir', async () => {
    const t = montar({ decisao: () => undefined }, { atacar: false, esperaDecisaoMs: 20 });
    await t.orq.correr();
    assert.match(textos(t.falas, 'migrador').at(-1)!, /Sem resposta ao pedido de migração: não migro/);
    const migracao = t.pedidosEnviados.find((p) => p.agente === 'migrador')!.pedido;
    assert.equal(t.pedidos.get(migracao.id)?.estado, 'ignorado');
    assert.equal(t.corrigidos.length, 0);
    assert.equal(t.falas.at(-1)?.de, 'chefe');
    // Um clique tardio na migração já não conta; na porta ainda fecha (foi um humano a aprovar).
    const porta = t.pedidosEnviados.find((p) => p.agente === 'defesa')!.pedido;
    t.responder(migracao.id, 'aprovar');
    t.responder(porta.id, 'aprovar');
    await esperar();
    await esperar();
    assert.equal(t.corrigidos.length, 1);
  });

  it('tradutor: o plano da infraestrutura sai antes do pedido de migração; se falhar, migra na mesma', async () => {
    const ok = montar({}, { atacar: false });
    ok.deps.migrador.planoInfra = async () => 'Move-se hoje: 1 VM.';
    await ok.orq.correr();
    const iPlano = ok.falas.findIndex((f) => /Move-se hoje: 1 VM/.test(f.texto));
    assert.ok(iPlano >= 0, 'o plano foi dito');
    assert.match(ok.falas[iPlano].texto, /só o plano, ainda não criei nada/);

    const falha = montar({}, { atacar: false });
    falha.deps.migrador.planoInfra = async () => {
      throw new Error('segredo detetado');
    };
    await falha.orq.correr();
    assert.ok(falha.notificacoes.some((n) => /tradução da configuração AWS/.test(n)));
    assert.ok(falha.falas.some((f) => /ficheiros copiados/.test(f.texto)), 'a migração S3 continuou');
  });

  it('o chefe só vê a auditoria deste ciclo, não os ensaios anteriores do dia', async () => {
    const antigo = (tipo: string): EventoAuditoria => ({ hora: '2026-11-20T09:00:00.000Z', pedidoId: 'velho', tipo });
    const t = montar({ historico: [antigo('infra-no-ar'), antigo('erro'), antigo('feito')] }, { atacar: false });
    await t.orq.correr();
    const vistos = t.vistoPeloChefe.at(-1)!;
    assert.ok(vistos.length > 0);
    assert.ok(vistos.every((e) => e.pedidoId !== 'velho'), 'nenhum evento de ensaios anteriores');
    assert.ok(vistos.some((e) => e.tipo === 'infra-no-ar'), 'o deste ciclo está lá');
  });

  it('decisor de destino: fala antes do pedido com os serviços do analisar; se falhar, migra na mesma', async () => {
    const ok = montar({}, { atacar: false });
    let recebidos: string[] = [];
    ok.deps.migrador.planoDestino = async (s) => ((recebidos = s), 'O PostgreSQL vai para gerido.');
    await ok.orq.correr();
    assert.deepEqual(recebidos, ['s3', 'postgres', 'fila']);
    const iDestino = ok.falas.findIndex((f) => f.texto === 'O PostgreSQL vai para gerido.');
    const iCopia = ok.falas.findIndex((f) => /ficheiros copiados/.test(f.texto));
    assert.ok(iDestino >= 0 && iDestino < iCopia);

    const falha = montar({}, { atacar: false });
    falha.deps.migrador.planoDestino = async () => {
      throw new Error('tabela de preços');
    };
    await falha.orq.correr();
    assert.ok(falha.notificacoes.some((n) => /decisor de destino/.test(n)));
    assert.ok(falha.falas.some((f) => /ficheiros copiados/.test(f.texto)));
  });

  it('um só "Aprovar plano": todos os passos por ordem, prova e auditoria por passo, testes uma vez no fim', async () => {
    const t = montar({}, { atacar: false });
    const ordem: string[] = [];
    let verificacoes = 0;
    t.deps.migrador.migrarPostgres = async () => (ordem.push('postgres'), { tabelas: 1, linhas: 20, checksumsOk: true });
    t.deps.migrador.migrarFila = async () => (ordem.push('fila'), { mensagens: 5, iguais: true });
    t.deps.migrador.verificar = async () => (verificacoes++, { antes: true, depois: true });
    await t.orq.correr();

    const migrar = t.pedidosEnviados.filter((p) => p.pedido.acao.tipo === 'migrar');
    assert.equal(migrar.length, 1, 'um só pedido de aprovação');
    assert.match(migrar[0].pedido.titulo, /Migrar para a Leaseweb: S3, Postgres, SQS/);
    assert.deepEqual(ordem, ['postgres', 'fila']);
    assert.equal(verificacoes, 1, 'os testes da app correm uma vez, no fim');

    const passos = [...t.pedidos.values()].filter((p) => p.acao.tipo === 'migrar');
    assert.deepEqual(
      passos.map((p) => [(p.acao as { passo: string }).passo, p.estado]),
      [
        ['s3', 'feito'],
        ['postgres', 'feito'],
        ['fila', 'feito'],
      ],
    );
    for (const p of passos) {
      assert.ok(t.eventos.some((e) => e.pedidoId === p.id && e.tipo === 'feito'), `prova na auditoria para ${p.id}`);
    }
    const fila = passos.find((p) => (p.acao as { passo: string }).passo === 'fila')!;
    assert.deepEqual(t.eventos.findLast((e) => e.pedidoId === fila.id)?.depois, {
      passo: 'fila',
      mensagens: 5,
      checksumsOk: true,
      testes: { antes: true, depois: true },
    });
    assert.ok(t.eventos.some((e) => e.pedidoId === fila.id && e.tipo === 'aprovado' && (e.depois as { pelo?: string }).pelo === migrar[0].pedido.id));

    const fala = textos(t.falas, 'migrador').at(-1)!;
    assert.match(fala, /12 ficheiros copiados para o MinIO, checksums iguais\. Base de dados: 1 tabela e 20 linhas copiadas para PostgreSQL, checksums iguais\. Filas: 5 mensagens passadas para o RabbitMQ, checksums iguais\. Testes da app a passar dos dois lados\. @atacante/);
  });

  it('plano: sem OK não se migra nada; sem função ligada o passo fica de fora', async () => {
    const recusa = montar({ decisao: (p) => (p.acao.tipo === 'migrar' ? 'ignorar' : 'aprovar') }, { atacar: false });
    let tocou = false;
    recusa.deps.migrador.migrarPostgres = async () => ((tocou = true), { tabelas: 1, linhas: 1, checksumsOk: true });
    recusa.deps.migrador.migrarFila = async () => ((tocou = true), { mensagens: 1, iguais: true });
    await recusa.orq.correr();
    assert.equal(tocou, false);
    assert.equal(recusa.corrigidos.length, 1, 'a defesa segue');

    // O analisar encontra s3, postgres e fila, mas só o S3 tem função: o plano é só o S3.
    const so = montar({}, { atacar: false });
    await so.orq.correr();
    const migrar = so.pedidosEnviados.filter((p) => p.pedido.acao.tipo === 'migrar');
    assert.equal(migrar.length, 1);
    assert.match(migrar[0].pedido.titulo, /: S3$/);
    assert.equal([...so.pedidos.values()].filter((p) => p.acao.tipo === 'migrar').length, 1);
  });

  it('plano: um passo que falha não trava os outros; checksums diferentes ou testes a falhar não contam como feito', async () => {
    const t = montar({}, { atacar: false });
    t.deps.migrador.migrarPostgres = async () => {
      throw new Error('Postgres de destino não responde');
    };
    t.deps.migrador.migrarFila = async () => ({ mensagens: 5, iguais: false });
    await t.orq.correr();
    assert.ok(t.notificacoes.some((n) => /migração Postgres.*Postgres de destino não responde/.test(n)));
    const estado = (passo: string) => [...t.pedidos.values()].find((p) => (p.acao as { passo?: string }).passo === passo)?.estado;
    assert.equal(estado('s3'), 'feito');
    assert.equal(estado('postgres'), 'aprovado', 'falhou: fica aprovado, não feito');
    assert.equal(estado('fila'), 'aprovado', 'checksums diferentes não contam como feito');
    assert.ok(t.falas.some((f) => /Filas: 5 mensagens passadas para o RabbitMQ, checksums DIFERENTES/.test(f.texto)));
    assert.equal(t.corrigidos.length, 1, 'a defesa segue');
    assert.equal(t.falas.at(-1)?.de, 'chefe');

    const testes = montar({}, { atacar: false });
    testes.deps.migrador.verificar = async () => ({ antes: true, depois: false });
    await testes.orq.correr();
    assert.equal([...testes.pedidos.values()].find((p) => p.acao.tipo === 'migrar')?.estado, 'aprovado');
    assert.ok(testes.falas.some((f) => /Testes antes ok, depois falharam/.test(f.texto)));
  });

  it('plano: segredos e cache entram quando o migrador os tiver, e a prova não leva valores', async () => {
    const t = montar({}, { atacar: false });
    t.deps.migrador.analisar = async () => ({ servicos: ['s3', 'segredos', 'cache'], plano: 'plano' });
    t.deps.migrador.migrarSegredos = async () => ({ segredos: 7, iguais: true });
    t.deps.migrador.migrarCache = async () => ({ chaves: 40, iguais: true });
    await t.orq.correr();
    const fala = textos(t.falas, 'migrador').at(-1)!;
    assert.match(fala, /Segredos: 7 passados para o OpenBao sem nunca aparecerem em texto, checksums iguais\. Cache: 40 chaves copiadas para o Valkey, checksums iguais/);
    const seg = [...t.pedidos.values()].find((p) => (p.acao as { passo?: string }).passo === 'segredos')!;
    assert.deepEqual(t.eventos.findLast((e) => e.pedidoId === seg.id)?.depois, { passo: 'segredos', segredos: 7, checksumsOk: true, testes: { antes: true, depois: true } });
  });

  it('relatório do incidente: um por achado tratado, depois da defesa e antes do resumo; uma falha não trava', async () => {
    const t = montar();
    const publicados: string[] = [];
    const falasNoMomento: number[] = [];
    t.deps.relatorio = {
      publicar: async (id) => {
        publicados.push(id);
        falasNoMomento.push(t.falas.length);
      },
    };
    await t.orq.correr();
    assert.deepEqual(publicados, ['a1'], 'o achado da API (correlacionado com o do atacante) dá um só relatório');
    assert.ok(t.corrigidos.length === 1 && falasNoMomento[0] < t.falas.length, 'sai depois do fecho e antes do chefe');
    assert.equal(t.falas.at(-1)?.de, 'chefe');

    const erro = montar();
    erro.deps.relatorio = {
      publicar: async () => {
        throw new Error('enviarComDesfazer falhou');
      },
    };
    await erro.orq.correr();
    assert.ok(erro.notificacoes.some((n) => /relatório do incidente a1/.test(n)));
    assert.deepEqual(erro.falas.slice(-2).map((f) => f.texto), ['RESUMO', 'CERT com relógio']);

    const nada = montar({}, { atacar: false });
    nada.deps.defesa.detetar = async () => [];
    let chamado = false;
    nada.deps.relatorio = { publicar: async () => void (chamado = true) };
    await nada.orq.correr();
    assert.equal(chamado, false, 'sem achados tratados não há relatório');
  });

  it('voz dos agentes: responde quem foi chamado, com o estado; no grupo sem menção cala-se', async () => {
    const t = montar({}, { migrar: false, atacar: false });
    const chamadas: { agente: string; pergunta: string; estado: string }[] = [];
    t.deps.voz = { responder: async (agente, pergunta, estado) => (chamadas.push({ agente, pergunta, estado }), `resposta de ${agente}`) };
    await t.orq.correr();
    t.mensagemDoDono('defesa', 'o que está aberto agora?');
    t.mensagemDoDono(null, 'bom dia a todos');
    for (let i = 0; i < 4; i++) await esperar();
    assert.equal(chamadas.length, 1);
    assert.equal(chamadas[0].agente, 'defesa');
    assert.match(chamadas[0].estado, /ESTADO/);
    assert.match(chamadas[0].estado, /RESUMO/);
    assert.equal(t.falas.at(-1)?.de, 'defesa');
    assert.equal(t.falas.at(-1)?.texto, 'resposta de defesa');
  });

  it('voz: os comandos continuam a ser comandos, não vão para o LLM', async () => {
    const t = montar({}, { migrar: false, atacar: false });
    let chamadas = 0;
    t.deps.voz = { responder: async () => (chamadas++, 'x') };
    await t.orq.correr();
    t.mensagemDoDono('defesa', '/estado');
    t.mensagemDoDono('defesa', '/desfazer abc12345');
    for (let i = 0; i < 4; i++) await esperar();
    assert.equal(chamadas, 0);
    assert.deepEqual(t.desfeitos, ['abc12345']);
  });

  it('o atacante diz se ainda chega à porta depois de fechar', async () => {
    const t = montar({ portaFechada: false }, { migrar: false });
    await t.orq.correr();
    assert.match(textos(t.falas, 'atacante').at(-1)!, /Ainda chego à porta 5432/);
  });

  it('comandos do dono: /estado e /desfazer <id>', async () => {
    const t = montar({}, { migrar: false, atacar: false });
    await t.orq.correr();
    t.mensagemDoDono(null, '/estado');
    t.mensagemDoDono('defesa', '/desfazer abc12345');
    await esperar();
    assert.ok(t.notificacoes.includes('ESTADO'));
    assert.deepEqual(t.desfeitos, ['abc12345']);
    assert.ok(!t.falas.some((f) => /Desfeito/.test(f.texto)), 'o aviso de desfeito vem do desfazer(), não se repete');
  });
});

describe('textoAtacante', () => {
  it('sem achados', () => {
    assert.match(textoAtacante([]), /Não encontrei portas abertas/);
  });
  it('resume no máximo 3 e indica o resto', () => {
    const muitos = [5432, 6379, 22, 9200].map((porta, i) => ({ ...achadoAtacante, id: `x${i}`, porta }));
    const t = textoAtacante(muitos);
    assert.match(t, /e mais 1/);
    assert.match(t, /Gravidade alta/);
  });
});
