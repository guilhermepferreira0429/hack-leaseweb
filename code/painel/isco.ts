// /isco -> página isco (honeypot leve). Responde algo plausível e regista um achado
// 'isco-tocado' com IP de origem, método, caminho e user-agent. Não executa nada do pedido.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { naoImplementado } from '@mwbe/shared';

export async function tratarIsco(req: IncomingMessage, res: ServerResponse): Promise<void> {
  naoImplementado('tratarIsco');
}
