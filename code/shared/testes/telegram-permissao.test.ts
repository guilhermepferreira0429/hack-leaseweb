import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { configurarTelegram, podeComandar } from '../telegram';

describe('telegram/permissao /atacar', () => {
  it('só o dono e os aprovadores podem comandar o ataque', () => {
    configurarTelegram({ tokens: {}, grupoId: '', donoId: '42', aprovadores: ['7', '8'] });
    try {
      assert.equal(podeComandar(42), true);
      assert.equal(podeComandar('7'), true);
      assert.equal(podeComandar(8), true);
      assert.equal(podeComandar(99), false);
    } finally {
      // Não deixar a configuração de teste a afetar o resto da suite.
      configurarTelegram({ tokens: {}, grupoId: '', donoId: '', aprovadores: [] });
    }
  });
});
