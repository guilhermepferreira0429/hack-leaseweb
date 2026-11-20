// Verificação de TLS e cabeçalhos HTTP (nível B de docs/ferramentas.md).
// Só faz HEAD, sem credenciais e sem escrever. A allowlist é conferida antes de cada ligação.
import { request as httpRequest } from 'node:http';
import type { IncomingHttpHeaders } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { Achado } from '@mwbe/shared';
import { garantirPermitido } from './alvos';

export const TIMEOUT_HTTP_MS = 3_000;

export interface RespostaHttp {
  porta: number;
  estado: number;
  cabecalhos: IncomingHttpHeaders;
  https: boolean;
  /** Resultado da validação do certificado (só HTTPS). */
  autorizado?: boolean;
}

function pedir(alvo: string, porta: number, https: boolean, timeoutMs: number): Promise<RespostaHttp> {
  return new Promise((concluir, falhar) => {
    const pedido = (https ? httpsRequest : httpRequest)(
      {
        host: alvo,
        port: porta,
        path: '/',
        method: 'HEAD',
        timeout: timeoutMs,
        // Vamos ver o certificado, não confiar nele: um certificado inválido é um achado, não um erro.
        rejectUnauthorized: false,
        headers: { 'user-agent': 'mwbe-atacante/0.1', accept: '*/*' },
      },
      (resposta) => {
        resposta.resume();
        const socket = resposta.socket as { authorized?: boolean };
        concluir({
          porta,
          estado: resposta.statusCode ?? 0,
          cabecalhos: resposta.headers,
          https,
          autorizado: https ? socket.authorized : undefined,
        });
      },
    );
    pedido.on('timeout', () => pedido.destroy(new Error('timeout')));
    pedido.on('error', (erro) => falhar(erro));
    pedido.end();
  });
}

/** Função pura: problemas de TLS/cabeçalhos numa resposta. Testável sem rede. */
export function avaliarResposta(alvo: string, r: RespostaHttp): Achado[] {
  const achados: Achado[] = [];
  const base = { origem: 'atacante' as const, alvo, porta: r.porta, tipo: 'servico-exposto' as const };

  if (!r.https) {
    const destino = String(r.cabecalhos.location ?? '');
    if (!destino.toLowerCase().startsWith('https://')) {
      achados.push({
        ...base,
        id: `http-${alvo}-${r.porta}-sem-tls`,
        servico: 'HTTP',
        severidade: 'alta',
        detalhe: `HTTP na porta ${r.porta} responde sem redirecionar para HTTPS`,
      });
    }
    return achados;
  }

  if (r.autorizado === false) {
    achados.push({
      ...base,
      id: `http-${alvo}-${r.porta}-certificado`,
      servico: 'HTTPS',
      severidade: 'alta',
      detalhe: 'certificado TLS não validado (autoassinado, expirado ou cadeia incompleta)',
    });
  }

  if (!r.cabecalhos['strict-transport-security']) {
    achados.push({
      ...base,
      id: `http-${alvo}-${r.porta}-hsts`,
      servico: 'HTTPS',
      severidade: 'media',
      detalhe: 'HSTS em falta (Strict-Transport-Security)',
    });
  }

  const faltam = ['content-security-policy', 'x-content-type-options', 'x-frame-options'].filter(
    (h) => !r.cabecalhos[h],
  );
  if (faltam.length > 0) {
    achados.push({
      ...base,
      id: `http-${alvo}-${r.porta}-cabecalhos`,
      servico: 'HTTPS',
      severidade: 'media',
      detalhe: `cabeçalhos de segurança em falta: ${faltam.join(', ')}`,
    });
  }

  return achados;
}

/**
 * Verifica HTTP/HTTPS (por omissão 80 e 443) de um alvo da allowlist.
 * Uma porta fechada ou filtrada não é achado; um certificado inválido é.
 */
export async function verificarHttp(
  alvo: string,
  allowlist: ReadonlySet<string>,
  portas: readonly number[] = [80, 443],
  timeoutMs = TIMEOUT_HTTP_MS,
): Promise<Achado[]> {
  const endereco = alvo.trim();
  garantirPermitido(endereco, allowlist);

  const achados: Achado[] = [];
  for (const porta of portas) {
    // A guarda repete-se antes de CADA ligação, como no reconhecimento.
    garantirPermitido(endereco, allowlist);
    try {
      const resposta = await pedir(endereco, porta, porta === 443, timeoutMs);
      achados.push(...avaliarResposta(endereco, resposta));
    } catch {
      // Porta fechada/filtrada ou sem HTTP: não há achado para reportar.
    }
  }
  return achados;
}
