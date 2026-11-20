// Os mesmos testes correm antes (AWS/LocalStack) e depois (Leaseweb). Só mudam as variáveis de ambiente.
// Estão marcados como todo até a app estar implementada, para `npm test` passar na estrutura.
import { describe, it } from 'node:test';

describe('exemplo-app (contrato igual em AWS e Leaseweb)', () => {
  it('guarda e lê uma fatura no armazenamento com o mesmo sha256', { todo: true });
  it('regista uma encomenda e lê-a da base de dados', { todo: true });
  it('publica o evento encomenda-criada e consome-o da fila', { todo: true });
  it('a contagem de encomendas semeadas bate certo depois da migração', { todo: true });
});
