import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { configurarTelegram, esteBotResponde, podeComandar, textoParaPrivado } from '../telegram';

function comTokens(tokens: Record<string, string>, corpo: () => void): void {
  configurarTelegram({ tokens, grupoId: '', donoId: '42', aprovadores: ['7', '8'] });
  try {
    corpo();
  } finally {
    // Não deixar a configuração de teste a afetar o resto da suite.
    configurarTelegram({ tokens: {}, grupoId: '', donoId: '', aprovadores: [] });
  }
}

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

  it('em privado responde sempre o bot da conversa', () => {
    comTokens({ chefe: 'a', atacante: 'b' }, () => {
      assert.equal(esteBotResponde('private', '/atacar', 'BotAtacante', 'atacante'), true);
      assert.equal(esteBotResponde('private', '/atacar', '', 'defesa'), true);
    });
  });

  it('no grupo sem menção responde só o principal (um aviso, não quatro)', () => {
    comTokens({ chefe: 'a', migrador: 'b', atacante: 'c', defesa: 'd' }, () => {
      assert.equal(esteBotResponde('group', '/atacar', 'BotChefe', 'chefe'), true);
      for (const agente of ['migrador', 'atacante', 'defesa'] as const) {
        assert.equal(esteBotResponde('group', '/atacar', 'BotQualquer', agente), false);
      }
    });
    // Sem bot do chefe, o principal passa a ser a defesa (como no `principal()`).
    comTokens({ defesa: 'd' }, () => {
      assert.equal(esteBotResponde('group', '/atacar', 'BotDefesa', 'defesa'), true);
    });
  });

  it('em privado, tira as menções e o "Recebido." do texto encenado para o grupo', () => {
    const doGrupo =
      'Recebido. Responde a qualquer pessoa na internet: PostgreSQL na porta 5432 (203.0.113.50). Gravidade alta. @defesa';
    assert.equal(
      textoParaPrivado(doGrupo),
      'Responde a qualquer pessoa na internet: PostgreSQL na porta 5432 (203.0.113.50). Gravidade alta.',
    );
    assert.equal(textoParaPrivado('Olá @infrahack_defesa_bot, tudo bem?'), 'Olá, tudo bem?');
    // Nunca envia vazio: se só havia a menção, fica o texto original.
    assert.equal(textoParaPrivado('@defesa'), '@defesa');
  });

  it('no grupo com menção responde só o bot mencionado', () => {
    comTokens({ chefe: 'a', atacante: 'c' }, () => {
      assert.equal(esteBotResponde('group', '/atacar@BotAtacante', 'BotAtacante', 'atacante'), true);
      assert.equal(esteBotResponde('group', '/atacar@BotAtacante', 'BotChefe', 'chefe'), false);
      assert.equal(esteBotResponde('group', '/atacar@BotAtacante', '', 'defesa'), false);
    });
  });
});
