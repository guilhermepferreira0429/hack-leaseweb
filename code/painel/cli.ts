// npm run dev:painel -> só o painel (lê o estado e a auditoria). Porta: PORT no .env (3000 por defeito).
import { carregarEnv } from '@mwbe/shared';
import { iniciarPainel } from './servidor';

carregarEnv();
iniciarPainel(Number(process.env.PORT ?? 3000));
