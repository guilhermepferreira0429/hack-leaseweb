import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AllowlistInvalidaError,
  AlvoRecusadoError,
  carregarAllowlist,
  filtrarAlvos,
  garantirPermitido,
} from '../alvos';

const LISTA = '203.0.113.10, 198.51.100.7';

describe('atacante/alvos', () => {
  it('lê IPs literais e ignora espaços e entradas vazias', () => {
    const lista = carregarAllowlist(' 203.0.113.10 ,, 198.51.100.7 ');
    assert.deepEqual([...lista], ['203.0.113.10', '198.51.100.7']);
  });

  it('lista vazia ou em falta recusa tudo', () => {
    for (const valor of [undefined, '', '   ', ',,']) {
      const lista = carregarAllowlist(valor);
      assert.equal(lista.size, 0);
      assert.throws(() => garantirPermitido('203.0.113.10', lista), AlvoRecusadoError);
    }
  });

  it('falha fechado se uma entrada não for IP literal', () => {
    for (const invalida of ['exemplo.com', '10.0.0.0/8', '203.0.113.0/24', '0.0.0.0/0', '1.2.3.4.5']) {
      assert.throws(() => carregarAllowlist('203.0.113.10, ' + invalida), AllowlistInvalidaError);
    }
  });

  it('aceita IPv6 literal e recusa outro IPv6 fora da lista', () => {
    const lista = carregarAllowlist('2001:db8::1');
    garantirPermitido('2001:db8::1', lista);
    assert.throws(() => garantirPermitido('2001:db8::2', lista), AlvoRecusadoError);
  });

  it('garantirPermitido aceita só quem está na lista', () => {
    const lista = carregarAllowlist(LISTA);
    garantirPermitido('203.0.113.10', lista);
    garantirPermitido(' 203.0.113.10 ', lista);
    assert.throws(() => garantirPermitido('203.0.113.11', lista), AlvoRecusadoError);
  });

  it('filtrarAlvos separa sem contactar e normaliza os espaços', () => {
    const { permitidos, recusados } = filtrarAlvos(
      ['203.0.113.10', '203.0.113.11', ' 198.51.100.7 '],
      carregarAllowlist(LISTA),
    );
    assert.deepEqual(permitidos, ['203.0.113.10', '198.51.100.7']);
    assert.deepEqual(recusados, ['203.0.113.11']);
  });
});
