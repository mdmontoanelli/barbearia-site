/* Funções comuns das páginas web (agendamento do cliente e painel da plataforma).
   Várias são cópias das do app (web/app/app.js): mantenha as duas iguais. */
'use strict';

const SUPABASE_URL = 'https://shligovobghpcxixwqup.supabase.co';
const SUPABASE_KEY = 'sb_publishable_LJltSFp7WESGSleC33Y3Tg_YqJqAtRW';
const DOMINIO_LOGIN = 'barbearia.local';
// Igual ao app: login + código da barbearia viram o e-mail interno do Supabase Auth.
const emailDe = (login, codigo) => `${String(login).trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9._-]/g, '_')}.${codigo}@${DOMINIO_LOGIN}`;

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const PASSO_HORARIO = 15;

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => isoDate(new Date());
const parseDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseDate(s); d.setDate(d.getDate() + n); return isoDate(d); };
const fmtDate = (s) => { if (!s) return ''; const [y, m, d] = s.split('-'); return `${d}/${m}/${y}`; };
const fmtDay = (s) => { const d = parseDate(s); return `${DIAS[d.getDay()]}, ${pad(d.getDate())}/${pad(d.getMonth() + 1)}`; };
const monthLabel = (k) => { const [y, m] = k.split('-'); return `${MESES[Number(m) - 1]} ${y}`; };
const money = (v) => (Number(v) < 0 ? '−R$ ' : 'R$ ') + Math.abs(Number(v || 0)).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const moneyIn = (v) => (v == null || v === '' ? '' : Number(v).toFixed(2).replace('.', ','));
const parseMoney = (s) => {
  s = String(s || '').trim().replace(/[R$\s]/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? NaN : Math.round(n * 100) / 100;
};
const digits = (s) => String(s || '').replace(/\D/g, '');
const fmtPhone = (s) => {
  const d = digits(s);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return s || '';
};
const waLink = (phone, msg) => {
  let d = digits(phone);
  if (!d) return null;
  if (d.length <= 11) d = '55' + d;
  return `https://wa.me/${d}${msg ? '?text=' + encodeURIComponent(msg) : ''}`;
};
const opt = (value, label, sel) => `<option value="${esc(value)}"${String(value) === String(sel) ? ' selected' : ''}>${esc(label)}</option>`;
const toMin = (h) => { const [a, b] = String(h).split(':').map(Number); return a * 60 + (b || 0); };
const fromMin = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const agora = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const lerLocal = (k) => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } };
const gravarLocal = (k, v) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) { /* sem storage */ } };

function mensagemErro(e) {
  const m = (e && e.message) || String(e);
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(m)) return 'Sem conexão com a internet. Verifique e tente de novo.';
  if (/Invalid login credentials/i.test(m)) return 'E-mail ou senha incorretos.';
  if (/row-level security|Acesso negado/i.test(m)) return 'Sem permissão para isso.';
  return m;
}

let toastTimer;
function toast(msg, bad) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show' + (bad ? ' bad' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = 'toast'), 3000);
}
const falha = (e) => { console.error(e); toast(mensagemErro(e), true); };

/* Ações de botão: mostra o erro e ignora toques repetidos enquanto grava. */
function safe(fn) {
  let ocupado = false;
  return (...a) => {
    if (ocupado) { const e = a[0]; if (e && e.preventDefault) e.preventDefault(); return undefined; }
    try {
      const r = fn(...a);
      if (r && typeof r.then === 'function') { ocupado = true; return r.catch(falha).finally(() => { ocupado = false; }); }
      return r;
    } catch (e) { falha(e); return undefined; }
  };
}
/* Redesenhos: um de cada vez, sempre com o estado mais recente. */
function serial(fn) {
  let rodando = null;
  let denovo = false;
  return () => {
    if (rodando) { denovo = true; return rodando; }
    rodando = (async () => { do { denovo = false; await fn(); } while (denovo); })().catch(falha).finally(() => { rodando = null; });
    return rodando;
  };
}

/* Janelas por cima da página. */
const overlays = [];
function sheet(html, { center = false } = {}) {
  const ov = document.createElement('div');
  ov.className = 'overlay' + (center ? ' center' : '');
  ov.innerHTML = `<div class="sheet">${center ? '' : '<div class="grab"></div>'}${html}</div>`;
  ov.addEventListener('click', (e) => { if (e.target === ov) closeSheet(); });
  $('#overlays').appendChild(ov);
  overlays.push(ov);
  return ov.firstElementChild;
}
function closeSheet() { const ov = overlays.pop(); if (ov) ov.remove(); }
function closeAll() { while (overlays.length) closeSheet(); }
function confirmBox(msg, okLabel = 'Confirmar', danger = true) {
  return new Promise((resolve) => {
    const s = sheet(`<h3>${esc(msg)}</h3><div class="btns two"><button class="btn ghost" data-a="no">Voltar</button>
      <button class="btn ${danger ? 'danger' : ''}" data-a="yes">${esc(okLabel)}</button></div>`, { center: true });
    s.querySelector('[data-a=no]').onclick = () => { closeSheet(); resolve(false); };
    s.querySelector('[data-a=yes]').onclick = () => { closeSheet(); resolve(true); };
  });
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && overlays.length) closeSheet(); });

/* Barra fina de carregamento enquanto conversa com o servidor. */
let pendentes = 0;
const carregando = (d) => { pendentes += d; document.body.classList.toggle('carregando', pendentes > 0); };
async function rpc(cliente, fn, args) {
  carregando(1);
  try {
    const { data, error } = await cliente.rpc(fn, args);
    if (error) throw new Error(error.message);
    return data;
  } finally { carregando(-1); }
}

/* ---- Agenda: mesma regra do app ---- */
function expedienteDoHorario(horario, data) {
  let h = null;
  try { h = horario ? JSON.parse(horario) : null; } catch (e) { h = null; }
  if (!h) return { inicio: '08:00', fim: '20:00' };
  const dia = h[String(parseDate(data).getDay())];
  if (!dia) return { folga: 'dia de folga' };
  return { inicio: dia[0], fim: dia[1] };
}
const comIntervalo = (a) => ({ ...a, ini: toMin(a.hora), fim: toMin(a.hora) + (a.duracao || 30) });
function calcularLivres(exp, ocup, data, duracao) {
  if (exp.folga) return { folga: exp.folga, livres: [] };
  const agoraMin = data === today() ? toMin(agora()) : -1;
  const livres = [];
  for (let m = toMin(exp.inicio); m + duracao <= toMin(exp.fim); m += PASSO_HORARIO) {
    if (m < agoraMin) continue;
    if (!ocup.some((o) => m < o.fim && m + duracao > o.ini)) livres.push(fromMin(m));
  }
  return { livres, exp };
}

/* ---- Data de nascimento em três listas (igual ao app) ---- */
function campoNascimento(rotulo, valor) {
  const [a, m, d] = (valor || '').split('-');
  const anoAtual = new Date().getFullYear();
  const anos = Array.from({ length: anoAtual - 1919 }, (_, i) => anoAtual - i);
  return `<div class="field"><label>${esc(rotulo)}</label><div class="row3 nasc">
    <select id="nasc-d" aria-label="Dia"><option value="">Dia</option>${Array.from({ length: 31 }, (_, i) => opt(pad(i + 1), i + 1, d)).join('')}</select>
    <select id="nasc-m" aria-label="Mês"><option value="">Mês</option>${MESES.map((nome, i) => opt(pad(i + 1), nome, m)).join('')}</select>
    <select id="nasc-a" aria-label="Ano"><option value="">Ano</option>${anos.map((ano) => opt(ano, ano, a)).join('')}</select>
  </div></div>`;
}
function lerNascimento(root) {
  const d = $('#nasc-d', root).value;
  const m = $('#nasc-m', root).value;
  const a = $('#nasc-a', root).value;
  if (!d && !m && !a) return null;
  if (!d || !m || !a) throw new Error('Preencha dia, mês e ano do nascimento (ou deixe os três em branco).');
  const data = new Date(Number(a), Number(m) - 1, Number(d));
  if (data.getDate() !== Number(d)) throw new Error(`O dia ${Number(d)} não existe em ${MESES[Number(m) - 1].toLowerCase()} de ${a}.`);
  return `${a}-${m}-${d}`;
}

window.addEventListener('unhandledrejection', (e) => { e.preventDefault(); falha(e.reason); });
