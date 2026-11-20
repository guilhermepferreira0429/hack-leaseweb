import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import ssh2 from 'ssh2';
import { AlvoRecusadoError, carregarAllowlist } from '../alvos';
import { avaliarMetodosSsh, verificarSshPassword } from '../ssh-auth';

const { Server, utils } = ssh2;

describe('atacante/ssh-auth', () => {
  it('métodos com password viram achado', () => {
    const achados = avaliarMetodosSsh('203.0.113.10', ['publickey', 'password']);
    assert.equal(achados.length, 1);
    assert.equal(achados[0]!.servico, 'SSH (palavra-passe)');
    assert.match(achados[0]!.detalhe, /palavra-passe/);
  });

  it('só publickey não é achado', () => {
    assert.deepEqual(avaliarMetodosSsh('203.0.113.10', ['publickey']), []);
  });

  it('recusa o alvo fora da allowlist antes de qualquer ligação', async () => {
    await assert.rejects(
      verificarSshPassword('203.0.113.11', carregarAllowlist('203.0.113.10')),
      AlvoRecusadoError,
    );
  });

  it('deteta palavra-passe num servidor SSH local', async () => {
    const { private: chave } = utils.generateKeyPairSync('ed25519');
    const servidor = new Server({ hostKeys: [chave] }, (cliente) => {
      cliente.on('authentication', (ctx) => {
        // O servidor de teste só aceita publickey/password; o cliente pergunta com 'none'.
        ctx.reject(['password', 'publickey']);
      });
    });

    const porta = await new Promise<number>((ok, falha) => {
      servidor.once('error', falha);
      servidor.listen(0, '127.0.0.1', () => {
        const endereco = servidor.address();
        ok(typeof endereco === 'object' && endereco ? endereco.port : 0);
      });
    });
    servidor.on('error', () => {});

    try {
      const achados = await verificarSshPassword('127.0.0.1', carregarAllowlist('127.0.0.1'), {
        porta,
        timeoutMs: 3_000,
      });
      assert.equal(achados.length, 1);
      assert.equal(achados[0]!.servico, 'SSH (palavra-passe)');
      assert.equal(achados[0]!.porta, porta);
      assert.equal(achados[0]!.alvo, '127.0.0.1');
    } finally {
      await new Promise<void>((ok) => servidor.close(() => ok()));
    }
  });
});
