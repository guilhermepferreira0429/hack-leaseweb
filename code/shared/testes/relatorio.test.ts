import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { montarRelatorio } from '../relatorio';
import { codificarDesfazer, descodificarDesfazer, descodificarBotao } from '../telegram';
import type { EventoAuditoria } from '../tipos';

const achado = {
  id: 'a1',
  tipo: 'compromisso',
  origem: 'auth-log',
  alvo: 'vitima-01',
  porta: 22,
  servico: 'ssh',
  severidade: 'critica',
  detalhe: 'login aceite depois de falhas',
  ipOrigem: '203.0.113.7',
  utilizador: 'deploy',
  tentativas: 37,
};

const t = (s: number) => new Date(Date.UTC(2026, 10, 20, 14, 0, s)).toISOString();

function passo(id: string, s: number, acao: Record<string, unknown>, fim: Partial<EventoAuditoria>, inverso: unknown): unknown[] {
  return [
    { hora: t(s), pedidoId: id, tipo: 'pedido', quem: 'defesa', depois: { achado, titulo: id } },
    { hora: t(s + 1), pedidoId: id, tipo: 'aprovado', quem: '42' },
    { hora: t(s + 2), pedidoId: id, tipo: `${acao.tipo}:inicio`, acao, inverso },
    { hora: t(s + 3), pedidoId: id, acao, inverso, ...fim },
  ];
}

describe('shared/relatorio', () => {
  it('formato acordado, só com factos, um Desfazer por passo reversível', () => {
    const eventos = [
      { hora: t(0), pedidoId: 'm1', tipo: 'pedido', quem: 'migrador', depois: { servicos: ['s3'] } },
      { hora: t(5), pedidoId: 'm1', tipo: 'feito' },
      ...passo('p1', 10, { tipo: 'bloquear_ip', host: 'h', ip: '203.0.113.7' }, { tipo: 'bloquear_ip', depois: {} }, { tipo: 'desbloquear_ip' }),
      ...passo('p2', 11, { tipo: 'terminar_sessoes', host: 'h', utilizador: 'deploy' }, { tipo: 'terminar_sessoes', depois: {} }, { tipo: 'irreversivel', motivo: 'x' }),
      ...passo('p3', 12, { tipo: 'fechar_ssh_mundo', securityGroupId: 'sg', ipAdmin: '1.2.3.4' }, { tipo: 'falhou', depois: { erro: 'precisa de reiniciar a VM' } }, { tipo: 'reabrir_ssh_mundo' }),
    ] as unknown as EventoAuditoria[];

    const r = montarRelatorio('a1', eventos);
    assert.equal(
      r.texto,
      [
        '🛡️ Incident contained — ' + new Date(t(14)).toTimeString().slice(0, 5),
        '',
        'Someone logged into server vitima-01 as "deploy" from 203.0.113.7,',
        'after 37 failed attempts.',
        '',
        'In 4 seconds I did the following, in order:',
        '• blocked the attacker (203.0.113.7) from the server',
        '• ended the session the attacker had open (cannot be undone)',
        '• did not close remote access to the server from the Internet: failed (precisa de reiniciar a VM)',
        '',
        'Proof:',
        '• approved by a person in Telegram at ' + new Date(t(13)).toTimeString().slice(0, 5),
        '',
        'The migration finished at ' + new Date(t(5)).toTimeString().slice(0, 5) + '. Nothing else was changed.',
        'To undo any step, use the buttons below.',
      ].join('\n'),
    );
    assert.deepEqual(r.botoes, [{ texto: 'Undo blocking the attacker (203.0.113.7)', pedidoId: 'p1' }]);
  });

  it('prova da porta fechada: verificação de fora, confirmação do atacante e exposição desde a infra no ar', () => {
    const porta = { ...achado, id: 'a2', tipo: 'servico-exposto', porta: 5432, servico: 'PostgreSQL', utilizador: undefined, ipOrigem: undefined };
    const inv = { tipo: 'criar_regra', securityGroupId: 'sg', regra: { protocol: 'TCP', source: '0.0.0.0/0', startPort: 5432, endPort: 5432 } };
    const eventos = [
      { hora: t(0), pedidoId: '-', tipo: 'infra-no-ar', quem: 'orquestrador' },
      { hora: t(20), pedidoId: 'd1', tipo: 'pedido', quem: 'defesa', depois: { achado: porta } },
      { hora: t(30), pedidoId: 'd1', tipo: 'aprovado', quem: '42' },
      { hora: t(31), pedidoId: 'd1', tipo: 'verificado', quem: 'defesa', depois: { porta: 5432, fase: 'antes', estado: 'open' } },
      { hora: t(38), pedidoId: 'd1', tipo: 'feito', quem: 'defesa', inverso: inv },
      { hora: t(40), pedidoId: 'd1', tipo: 'verificado', quem: 'defesa', depois: { porta: 5432, fase: 'depois', estado: 'filtered' } },
      { hora: t(42), pedidoId: 'd1', tipo: 'confirmacao-atacante', quem: 'atacante', depois: { chega: false } },
    ] as unknown as EventoAuditoria[];
    const r = montarRelatorio('a2', eventos);
    assert.match(r.texto, /Proof:\n• approved by a person in Telegram at \d\d:\d\d\n• checked from outside: port 5432 no longer answers \(filtered\) ✓\n• the attacker tried again and can no longer reach it ✓\n• it was exposed for 38 seconds since the new infrastructure went live/);
    assert.equal(r.botoes.length, 1, 'um Desfazer para o fecho');
  });

  it('pedido recusado não conta como feito', () => {
    const eventos = [
      { hora: t(0), pedidoId: 'p1', tipo: 'pedido', quem: 'defesa', depois: { achado } },
      { hora: t(1), pedidoId: 'p1', tipo: 'ignorado', quem: '42' },
    ] as unknown as EventoAuditoria[];
    const r = montarRelatorio('a1', eventos);
    assert.match(r.texto, /^⚠️ Incident not contained yet/);
    assert.match(r.texto, /• did not do: desconhecida: the request was declined/);
    assert.equal(r.botoes.length, 0);
  });

  it('abertura para porta aberta, em linguagem simples', () => {
    const achadoPorta = {
      ...achado,
      id: 'porta1',
      tipo: 'porta-exposta',
      alvo: '203.0.113.10',
      porta: 5432,
      servico: 'PostgreSQL',
      utilizador: undefined,
      ipOrigem: undefined,
      tentativas: undefined,
    };
    const eventos = [
      { hora: t(0), pedidoId: 'p1', tipo: 'pedido', quem: 'defesa', depois: { achado: achadoPorta } },
      { hora: t(2), pedidoId: 'p1', tipo: 'feito' },
    ] as unknown as EventoAuditoria[];
    const antes = process.env.RELATORIO_NOME_SERVIDOR;
    process.env.RELATORIO_NOME_SERVIDOR = 'vitima-demo';
    try {
      const r = montarRelatorio('porta1', eventos);
      assert.match(r.texto, /I found a port open to anyone on the Internet on server vitima-demo: the database \(port 5432\)\./);
      assert.doesNotMatch(r.texto, /Someone logged into/);
    } finally {
      if (antes === undefined) delete process.env.RELATORIO_NOME_SERVIDOR;
      else process.env.RELATORIO_NOME_SERVIDOR = antes;
    }
  });

  it('diz quantas outras alterações há na auditoria', () => {
    const eventos = [
      { hora: t(0), pedidoId: 'p1', tipo: 'pedido', quem: 'defesa', depois: { achado } },
      { hora: t(2), pedidoId: 'p1', tipo: 'feito' },
      { hora: t(3), pedidoId: 'outro', tipo: 'pedido', quem: 'defesa', depois: { titulo: 'outro' } },
      { hora: t(4), pedidoId: 'outro', tipo: 'feito' },
    ] as unknown as EventoAuditoria[];
    const r = montarRelatorio('a1', eventos);
    assert.match(r.texto, /Besides this incident, there is 1 other change recorded in the audit log\./);
    assert.doesNotMatch(r.texto, /Nothing else was changed/);
  });

  it('dois pedidos que fecham a mesma regra contam como um passo e um botão', () => {
    const regra = { id: 'r-5432', protocol: 'tcp', source: '0.0.0.0/0', startPort: 5432, endPort: 5432 };
    const acao = { tipo: 'remover_regra', securityGroupId: 'sg-1', regra };
    const inverso = { tipo: 'criar_regra', securityGroupId: 'sg-1', regra: { ...regra, id: undefined } };
    const eventos = [
      ...passo('r1', 10, acao, { tipo: 'remover_regra', depois: {} }, inverso),
      ...passo('r2', 12, acao, { tipo: 'remover_regra', depois: {} }, inverso),
    ] as unknown as EventoAuditoria[];
    const r = montarRelatorio('a1', eventos);
    assert.equal(r.passos.length, 1);
    assert.equal(r.botoes.length, 1);
    assert.equal((r.texto.match(/closed the database \(port 5432\)/g) ?? []).length, 1);
    assert.deepEqual(r.botoes, [{ texto: 'Undo closing port 5432', pedidoId: 'r1' }]);
  });

  it('duas portas diferentes aparecem e distinguem-se na linha e no botão', () => {
    const regra = (porta: number) => ({ id: `r-${porta}`, protocol: 'tcp', source: '0.0.0.0/0', startPort: porta, endPort: porta });
    const acao = (porta: number) => ({ tipo: 'remover_regra', securityGroupId: 'sg-1', regra: regra(porta) });
    const inverso = (porta: number) => ({ tipo: 'criar_regra', securityGroupId: 'sg-1', regra: { ...regra(porta), id: undefined } });
    const eventos = [
      ...passo('r1', 10, acao(5432), { tipo: 'remover_regra', depois: {} }, inverso(5432)),
      ...passo('r2', 12, acao(22), { tipo: 'remover_regra', depois: {} }, inverso(22)),
    ] as unknown as EventoAuditoria[];
    const r = montarRelatorio('a1', eventos);
    assert.equal(r.passos.length, 2);
    assert.match(r.texto, /closed the database \(port 5432\) to the Internet on the Leaseweb firewall/);
    assert.match(r.texto, /closed remote access to the server \(port 22\) to the Internet on the Leaseweb firewall/);
    assert.deepEqual(
      r.botoes.map((b) => b.texto),
      ['Undo closing port 5432', 'Undo closing port 22'],
    );
  });

  it('botão desfazer: codifica e não se confunde com aprovar/ignorar', () => {
    assert.equal(codificarDesfazer('p-1'), 'desfazer:p-1');
    assert.equal(descodificarDesfazer('desfazer:p-1'), 'p-1');
    assert.equal(descodificarDesfazer('aprovar:p-1'), undefined);
    assert.equal(descodificarBotao('desfazer:p-1'), undefined);
  });
});
