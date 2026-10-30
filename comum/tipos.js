/* Tipos de estabelecimento (barbearia, manicure, salão de beleza): nome, logo e cor padrão.
   Usado pelo painel, pelo sistema da equipe e pela página de agendamento. */
'use strict';

const LOGO_TRACO = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const TIPOS = {
  barbearia: {
    nome: 'Barbearia', plural: 'Barbearias', artigo: 'a', cor: '#c8963e',
    // poste de barbeiro
    logo: LOGO_TRACO('<rect x="8.5" y="2" width="7" height="3" rx="1.2"/><rect x="8.5" y="19" width="7" height="3" rx="1.2"/><rect x="9.5" y="5" width="5" height="14"/><path d="M9.5 9l5-2.5M9.5 13l5-2.5M9.5 17l5-2.5"/>'),
  },
  manicure: {
    nome: 'Manicure', plural: 'Manicures', artigo: 'a', cor: '#d16ba5',
    // vidro de esmalte
    logo: LOGO_TRACO('<rect x="10" y="2" width="4" height="5.5" rx="1"/><path d="M8.5 7.5h7l1.2 3H7.3z"/><rect x="6" y="10.5" width="12" height="11.5" rx="3"/><path d="M9 15.5c1.2-1 4.8-1 6 0"/>'),
  },
  salao: {
    nome: 'Salão de beleza', plural: 'Salões de beleza', artigo: 'o', cor: '#a77bd8',
    // secador de cabelo
    logo: LOGO_TRACO('<circle cx="9" cy="9" r="6.2"/><circle cx="9" cy="9" r="2.2"/><path d="M15 6.5h5.5v5H15"/><path d="M8 15.2L7 22h3.8l1.3-6.6"/>'),
  },
};
const tipoDe = (t) => TIPOS[t] || TIPOS.barbearia;
const corDe = (b) => (b && b.cor) || tipoDe(b && b.tipo).cor;
const PALETA_CORES = ['#c8963e', '#e39a4f', '#d8604f', '#d16ba5', '#e07fb4', '#a77bd8', '#6c9bd8', '#47b5b0', '#74b36f', '#9c9183'];

/* Logo do tipo dentro de um quadrado com a cor do estabelecimento. */
const logoTipo = (tipo, cor, tam = 56) =>
  `<span class="logo-tipo" style="--c:${cor || tipoDe(tipo).cor};width:${tam}px;height:${tam}px">${tipoDe(tipo).logo}</span>`;

/* Texto escuro ou claro por cima da cor, conforme o contraste. */
function textoSobre(hex) {
  const n = parseInt(String(hex).slice(1), 16);
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const l = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return l > 0.2 ? '#1b150d' : '#ffffff';
}
/* Troca a cor de destaque da página inteira (botões, abas, valores). */
function aplicarCor(hex) {
  const r = document.documentElement.style;
  if (!/^#[0-9a-f]{6}$/i.test(hex || '')) { ['--gold', '--gold-soft', '--on-gold'].forEach((v) => r.removeProperty(v)); return; }
  const n = parseInt(hex.slice(1), 16);
  r.setProperty('--gold', hex);
  r.setProperty('--gold-soft', `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, .14)`);
  r.setProperty('--on-gold', textoSobre(hex));
}
