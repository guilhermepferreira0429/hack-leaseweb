import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Achado } from '@mwbe/shared';
import { acaoPara, montarPedido, novoIdPedido, tituloPara } from './explicar';

const base: Achado = {
  id: 'a1',
  tipo: 'porta-exposta',
  origem: 'api',
  alvo: '203.0.113.10',
  securityGroupId: 'sg-1',
  regra: { id: 'r1', protocol: 'TCP', source: '0.0.0.0/0', startPort: 5432, endPort: 5432 },
  porta: 5432,
  servico: 'PostgreSQL',
  severidade: 'alta',
  detalhe: 'TCP 5432 0.0.0.0/0',
};

describe('defesa/explicar', () => {
  it('achado com regra -> remover_regra só dessa regra', () => {
    assert.deepEqual(acaoPara(base), { tipo: 'remover_regra', securityGroupId: 'sg-1', regra: base.regra });
  });

  it('sem regra ou sem security group -> nenhuma ação', () => {
    assert.equal(acaoPara({ ...base, regra: undefined }), undefined);
    assert.equal(acaoPara({ ...base, securityGroupId: undefined }), undefined);
  });

  it('títulos por tipo, com recurso à porta se não houver serviço', () => {
    assert.equal(tituloPara(base), 'PostgreSQL open to the whole internet');
    assert.equal(tituloPara({ ...base, servico: null }), 'Port 5432 open to the whole internet');
    assert.match(tituloPara({ ...base, tipo: 'credenciais-por-defeito' }), /factory default password/);
  });

  it('pedido pendente, com id curto que cabe no callback_data do Telegram', () => {
    const p = montarPedido(base, 'texto', acaoPara(base)!);
    assert.equal(p.estado, 'pendente');
    assert.match(p.id, /^[0-9a-f]{8}$/);
    assert.ok(`aprovar:${p.id}`.length <= 64);
    assert.notEqual(novoIdPedido(), novoIdPedido());
  });
});
