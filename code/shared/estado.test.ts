import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Pedido } from './tipos';
import { guardarPedido, limparEstado, listarPedidos, mudarEstado, obterPedido } from './estado';

const p = (id: string): Pedido => ({ id, titulo: 't', texto: 'x', acao: { tipo: 'migrar', passo: 's3' }, estado: 'pendente' });

describe('shared/estado', () => {
  beforeEach(limparEstado);

  it('guarda, lê, muda de estado e lista por ordem', () => {
    guardarPedido(p('a'));
    guardarPedido(p('b'));
    assert.equal(mudarEstado('a', 'aprovado').estado, 'aprovado');
    assert.equal(obterPedido('a')?.estado, 'aprovado');
    assert.deepEqual(listarPedidos().map((x) => x.id), ['a', 'b']);
  });

  it('não deixa alterar o estado por fora', () => {
    guardarPedido(p('a'));
    const lido = obterPedido('a')!;
    lido.estado = 'feito';
    assert.equal(obterPedido('a')?.estado, 'pendente');
  });

  it('recusa ids repetidos e desconhecidos', () => {
    guardarPedido(p('a'));
    assert.throws(() => guardarPedido(p('a')), /já existe/);
    assert.throws(() => mudarEstado('zzz', 'feito'), /desconhecido/);
    assert.equal(obterPedido('zzz'), undefined);
  });
});
