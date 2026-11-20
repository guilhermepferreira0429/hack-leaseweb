// node pitch/tempo.mjs: conta o guião a 150 palavras por minuto, mais as esperas, slide a slide.
// Falha (código 1) se o total passar do alvo de config.js ou se um slide não tiver guião.
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const pasta = new URL('./js/', import.meta.url);
const ctx = { window: {}, globalThis: {} };
ctx.globalThis = ctx.window;
for (const f of ['config.js', 'guiao.js', 'slides.js']) runInNewContext(readFileSync(new URL(f, pasta), 'utf8'), ctx);
const { CONFIG, GUIAO, SLIDES, PRIMEIRO_ANEXO } = ctx.window;

const PPM = 150;
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
let total = 0;
let previsto = 0;
let erro = false;
console.log('slide              palavras  falado  espera  real   previsto');
for (const s of SLIDES.slice(0, PRIMEIRO_ANEXO)) {
  const g = GUIAO[s.id];
  if (!g) {
    console.log(`${s.id.padEnd(18)} SEM GUIÃO`);
    erro = true;
    continue;
  }
  const texto = g.falas.map((f) => f.texto || '').join(' ').replace(/\{\w+\}/g, '999');
  const palavras = texto.split(/\s+/).filter(Boolean).length;
  const falado = (palavras / PPM) * 60;
  const espera = g.falas.reduce((t, f) => t + (f.espera || 0), 0);
  const real = falado + espera;
  total += real;
  previsto += g.segundos;
  const marca = real > g.segundos + 2 ? '  <- passa do previsto' : '';
  console.log(`${s.id.padEnd(18)} ${String(palavras).padStart(8)}  ${mmss(falado).padStart(6)}  ${mmss(espera).padStart(6)}  ${mmss(real).padStart(5)}  ${mmss(g.segundos).padStart(8)}${marca}`);
}
console.log(`\nTotal: ${mmss(total)} (previsto ${mmss(previsto)}, alvo ${mmss(CONFIG.alvoSegundos)}, limite 5:00)`);
if (total > CONFIG.alvoSegundos) {
  console.log('Passa do alvo: cortar falas no "como funciona" ou na tese, nunca na demo.');
  erro = true;
}
process.exit(erro ? 1 : 0);
