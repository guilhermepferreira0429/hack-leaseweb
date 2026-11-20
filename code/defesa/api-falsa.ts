// npm run lsw:falsa -> API da Leaseweb FALSA em http://127.0.0.1:4010, para ensaiar o ciclo sem a chave real.
// Imita os endpoints que usamos (shared/leaseweb.ts), incluindo o comportamento assíncrono:
// revoke deixa a regra em DELETING ~2 s antes de desaparecer; authorize cria em CREATING ~2 s antes de ACTIVE.
// Para usar, no .env (e voltar a pôr os valores reais quando a chave chegar):
//   LSW_API_BASE=http://127.0.0.1:4010   LSW_API_KEY=falsa   LSW_SG_GERIDOS=sg-vitima-falso
// API_FALSA_IP: IP que a instância "vítima" falsa diz ter (por omissão o 1.º de ALVOS_PERMITIDOS).
// Nota: fechar aqui não fecha porta nenhuma de verdade; o nmap continua a dar "open". Só serve para o fluxo.
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { carregarEnv } from '@mwbe/shared';

type RegraFalsa = { id: string; protocol: string; source: string; startPort: number; endPort: number; state: string; ate?: number };

const ATRASO_MS = Number(process.env.API_FALSA_ATRASO_MS ?? 2000);

export function criarApiFalsa(ip: string) {
  const grupos: Record<string, { name: string; regras: RegraFalsa[] }> = {
    'sg-vitima-falso': {
      name: 'vitima',
      regras: [
        { id: randomUUID(), protocol: 'TCP', source: '0.0.0.0/0', startPort: 5432, endPort: 5432, state: 'ACTIVE' },
        { id: randomUUID(), protocol: 'TCP', source: '203.0.113.10/32', startPort: 22, endPort: 22, state: 'ACTIVE' },
      ],
    },
    'sg-isco-falso': {
      name: 'isco',
      regras: [{ id: randomUUID(), protocol: 'TCP', source: '0.0.0.0/0', startPort: 22, endPort: 22, state: 'ACTIVE' }],
    },
  };

  /** Avança o tempo: DELETING expirado sai, CREATING expirado fica ACTIVE. */
  function avancar(): void {
    const agora = Date.now();
    for (const g of Object.values(grupos)) {
      g.regras = g.regras.filter((r) => !(r.state === 'DELETING' && r.ate! <= agora));
      for (const r of g.regras) if (r.state === 'CREATING' && r.ate! <= agora) r.state = 'ACTIVE';
    }
  }

  const json = (res: ServerResponse, estado: number, corpo?: unknown) =>
    res.writeHead(estado, { 'Content-Type': 'application/json' }).end(corpo === undefined ? '' : JSON.stringify(corpo));

  async function corpo(req: IncomingMessage): Promise<any> {
    let t = '';
    for await (const c of req) t += c;
    return t ? JSON.parse(t) : {};
  }

  return createServer(async (req, res) => {
    try {
      if (!req.headers['x-lsw-auth']) return json(res, 401, { errorMessage: 'X-LSW-Auth em falta' });
      avancar();
      const url = new URL(req.url ?? '/', 'http://x');
      const p = url.pathname.replace(/^\/publicCloud\/v1/, '').split('/').filter(Boolean);
      const sem = (r: RegraFalsa) => ({ id: r.id, protocol: r.protocol, source: r.source, startPort: r.startPort, endPort: r.endPort, state: r.state });
      console.log(`[api-falsa] ${req.method} ${url.pathname}`);

      if (req.method === 'GET' && p[0] === 'securityGroups' && p.length === 1) {
        const lista = Object.entries(grupos).map(([id, g]) => ({ id, name: g.name, state: 'ACTIVE' }));
        return json(res, 200, { securityGroups: lista, _metadata: { totalCount: lista.length, limit: 50, offset: 0 } });
      }
      if (req.method === 'GET' && p[0] === 'instances' && p.length === 1) {
        return json(res, 200, { instances: [{ id: 'inst-vitima-falsa', reference: 'vitima', ips: [{ ip, version: 4, networkType: 'PUBLIC' }] }] });
      }
      if (req.method === 'GET' && p[0] === 'instances' && p[2] === 'securityGroups') {
        return json(res, 200, { securityGroups: p[1] === 'inst-vitima-falsa' ? [{ id: 'sg-vitima-falso', name: 'vitima' }] : [] });
      }
      const g = p[0] === 'securityGroups' ? grupos[p[1]] : undefined;
      if (!g) return json(res, 404, { errorMessage: 'não existe' });
      if (req.method === 'GET' && p[2] === 'firewallRules') return json(res, 200, { firewallRules: g.regras.map(sem) });
      if (req.method === 'POST' && p[2] === 'revokeFirewallRules') {
        const ids: string[] = (await corpo(req)).rules ?? [];
        for (const r of g.regras) if (ids.includes(r.id)) Object.assign(r, { state: 'DELETING', ate: Date.now() + ATRASO_MS });
        return json(res, 202);
      }
      if (req.method === 'POST' && p[2] === 'authorizeFirewallRules') {
        for (const r of (await corpo(req)).rules ?? []) {
          g.regras.push({ id: randomUUID(), protocol: r.protocol, source: r.source, startPort: r.startPort, endPort: r.endPort, state: 'CREATING', ate: Date.now() + ATRASO_MS });
        }
        return json(res, 202);
      }
      return json(res, 404, { errorMessage: 'rota não imitada' });
    } catch (erro) {
      json(res, 500, { errorMessage: erro instanceof Error ? erro.message : String(erro) });
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  carregarEnv();
  const ip = process.env.API_FALSA_IP || (process.env.ALVOS_PERMITIDOS ?? '').split(',')[0]?.trim() || '127.0.0.1';
  const porta = Number(process.env.API_FALSA_PORTA ?? 4010);
  criarApiFalsa(ip).listen(porta, '127.0.0.1', () => {
    console.log(`[api-falsa] http://127.0.0.1:${porta}  (vítima falsa com IP ${ip})`);
    console.log('[api-falsa] no .env: LSW_API_BASE=http://127.0.0.1:%d LSW_API_KEY=falsa LSW_SG_GERIDOS=sg-vitima-falso', porta);
  });
}
