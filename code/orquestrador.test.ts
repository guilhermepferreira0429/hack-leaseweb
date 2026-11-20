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
};

const stub = (): never => {
  throw new Error('Ainda não implementado');
};

function montar(cenario: Cenario = {}, opcoes: Partial<Opcoes> = {}) {
  const falas: Mensagem[] = [];
  const eventos: EventoAuditoria[] = [];
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
        return fechado ? [] : [achadoAtacante];
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
    chefe: { resumir: () => 'RESUMO', estadoAtual: () => 'ESTADO' },
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
    assert.match(textos(t.falas, 'migrador').at(-1)!, /12 ficheiros copiados, checksums iguais, testes a passar dos dois lados/);
    assert.match(textos(t.falas, 'atacante')[0], /PostgreSQL na porta 5432/);
    assert.match(textos(t.falas, 'defesa').at(-1)!, /@atacante, fechei "PostgreSQL aberto a toda a internet" às \d\d:\d\d/);
    assert.equal(textos(t.falas, 'atacante').at(-1), 'Confirmo. Já não chego lá.');
    assert.equal(t.falas.at(-1)?.de, 'chefe');
    assert.equal(t.falas.at(-1)?.texto, 'RESUMO');
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
    assert.match(textos(t.falas, 'defesa').at(-1)!, /Desfeito/);
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
