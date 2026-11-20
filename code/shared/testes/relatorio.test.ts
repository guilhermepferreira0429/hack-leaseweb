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
        '🛡️ Incidente contido — ' + new Date(t(14)).toTimeString().slice(0, 5),
        '',
        'Alguém entrou no servidor vitima-01 como "deploy" vindo de 203.0.113.7,',
        'depois de 37 tentativas falhadas.',
        '',
        'Em 4s fiz, por esta ordem:',
        '• bloqueei 203.0.113.7 na firewall do servidor',
        '• terminei a sessão do atacante (não se pode desfazer)',
        '• não fechei o SSH à Internet na Leaseweb: falhou (precisa de reiniciar a VM)',
        '',
        'A migração terminou às ' + new Date(t(5)).toTimeString().slice(0, 5) + '. Mais nada foi alterado.',
        'Desfazer qualquer passo: usa os botões abaixo.',
      ].join('\n'),
    );
    assert.deepEqual(r.botoes, [{ texto: 'Desfazer bloqueio de 203.0.113.7', pedidoId: 'p1' }]);
  });

  it('pedido recusado não conta como feito', () => {
    const eventos = [
      { hora: t(0), pedidoId: 'p1', tipo: 'pedido', quem: 'defesa', depois: { achado } },
      { hora: t(1), pedidoId: 'p1', tipo: 'ignorado', quem: '42' },
    ] as unknown as EventoAuditoria[];
    const r = montarRelatorio('a1', eventos);
    assert.match(r.texto, /^⚠️ Incidente por conter/);
    assert.match(r.texto, /• não fiz: desconhecida: o pedido foi recusado/);
    assert.equal(r.botoes.length, 0);
  });

  it('abertura para porta aberta, com nome amigável opcional', () => {
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
      assert.match(r.texto, /Encontrei a porta 5432 aberta no servidor vitima-demo \(PostgreSQL\)\./);
      assert.doesNotMatch(r.texto, /Alguém entrou/);
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
    assert.match(r.texto, /Além deste incidente, há 1 alteração registada na auditoria\./);
    assert.doesNotMatch(r.texto, /Mais nada foi alterado/);
  });

  it('botão desfazer: codifica e não se confunde com aprovar/ignorar', () => {
    assert.equal(codificarDesfazer('p-1'), 'desfazer:p-1');
    assert.equal(descodificarDesfazer('desfazer:p-1'), 'p-1');
    assert.equal(descodificarDesfazer('aprovar:p-1'), undefined);
    assert.equal(descodificarBotao('desfazer:p-1'), undefined);
  });
});
