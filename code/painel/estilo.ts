// Tokens e cabeçalho HTML comuns aos ecrãs do painel (docs/material/design/web.pen).
// Fontes: Geist (texto), Geist Mono (rótulos e números pequenos), Instrument Serif (títulos e números grandes).
// Sem rede (projetor offline), cai para as fontes do sistema e continua legível.

export const escapar = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export const horaLisboa = (iso: string | number | Date, segundos = true) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit', ...(segundos ? { second: '2-digit' } : {}), timeZone: 'Europe/Lisbon' });
};

/** Número com separador de milhares à portuguesa (1.204). */
export const numero = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString('de-DE') : '—');

const TOKENS = `:root{--bg:#0C1715;--panel:#12211E;--line:#1F3330;--ink:#F5F3EE;--muted:#9FB3AC;--faint:#5E7670;
--mig:#8DB8FF;--atk:#FF8A7A;--def:#7DD3A8;--chf:#C9D3CF;--ok:#7DD3A8;--bad:#FF8A7A;
--sans:'Geist',system-ui,sans-serif;--mono:'Geist Mono',ui-monospace,monospace;--serif:'Instrument Serif',Georgia,serif}
*{box-sizing:border-box}html,body{margin:0}body{background:var(--bg);color:var(--ink);font-family:var(--sans)}
.mono{font-family:var(--mono)}.serif{font-family:var(--serif);font-weight:400}
.kicker{font-family:var(--mono);font-size:16px;letter-spacing:2px;color:var(--muted);text-transform:uppercase}`;

export function cabecalho(titulo: string, css: string, claro = false): string {
  return `<!doctype html><html lang="pt"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapar(titulo)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;600;700&family=Geist+Mono:wght@400;700&family=Instrument+Serif&display=swap" rel="stylesheet">
<style>${TOKENS}${claro ? 'body{background:#F5F3EE;color:#15171C}' : ''}${css}</style></head><body>`;
}
