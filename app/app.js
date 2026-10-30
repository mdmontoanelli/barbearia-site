/* =========================================================
   Sistema da equipe (barbearia, manicure ou salão de beleza) — clientes, agenda e financeiro.
   Página web responsiva (web/app/?b=codigo): menu embaixo no celular, à esquerda no computador.
   Os dados ficam no Supabase (Postgres na nuvem); planilhas e backups viram downloads.
   ========================================================= */
'use strict';

/* ---------------- Banco de dados ---------------- */
const SUPABASE_URL = 'https://shligovobghpcxixwqup.supabase.co';
const SUPABASE_KEY = 'sb_publishable_LJltSFp7WESGSleC33Y3Tg_YqJqAtRW';
// O Supabase Auth entra por e-mail; o app pede só "usuário" e completa com o código da barbearia
// (o mesmo usuário pode existir em barbearias diferentes): joao + ze → joao.ze@barbearia.local
const DOMINIO_LOGIN = 'barbearia.local';
const emailDe = (login, codigo) => `${String(login).trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9._-]/g, '_')}.${codigo}@${DOMINIO_LOGIN}`;

// A sessão fica guardada no navegador: recarregar a página não pede login de novo ("Sair" encerra).
const sbOpcoes = { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'sistema-equipe' } };
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, sbOpcoes);

/* Troca cada ? pelo valor já escapado como literal SQL (ignorando ? dentro de 'textos'). */
function literal(v) {
  if (v == null) return 'NULL';
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error('Número inválido');
    return v < 0 ? `(${v})` : String(v);
  }
  return `'${String(v).replace(/'/g, "''")}'`;
}
function montarSql(sql, params = []) {
  let i = 0;
  let dentro = false;
  let out = '';
  for (const ch of sql) {
    if (ch === "'") dentro = !dentro;
    if (ch === '?' && !dentro) {
      if (i >= params.length) throw new Error('Parâmetros insuficientes na consulta');
      out += literal(params[i++]);
    } else out += ch;
  }
  if (i !== params.length) throw new Error('Parâmetros a mais na consulta');
  return out;
}

function mensagemErro(e) {
  const m = (e && e.message) || String(e);
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(m)) return 'Sem conexão com a internet. Verifique e tente de novo.';
  if (/row-level security/i.test(m)) return 'Seu usuário não tem permissão para isso.';
  if (/JWT|Sessão expirada/i.test(m)) return 'Sessão expirada. Entre novamente.';
  return m;
}

let pendentes = 0;
const carregando = (d) => { pendentes += d; document.body.classList.toggle('carregando', pendentes > 0); };

const DB = {
  async rpc(fn, args) {
    if (navigator.onLine === false) throw new Error('Sem conexão com a internet. Verifique e tente de novo.');
    carregando(1);
    try {
      const { data, error } = await sb.rpc(fn, args);
      if (error) throw error;
      return data;
    } catch (e) {
      const msg = mensagemErro(e);
      if (msg.startsWith('Sessão expirada') && S.user) setTimeout(logout, 0);
      throw new Error(msg);
    } finally {
      carregando(-1);
    }
  },
  async q(sql, p = []) { return (await this.rpc('app_consulta', { q: montarSql(sql, p) })) || []; },
  async one(sql, p = []) { return (await this.q(sql, p))[0] || null; },
  async val(sql, p = []) { const r = await this.one(sql, p); return r ? Object.values(r)[0] : null; },
  /* INSERT devolve o id criado em lastId (exceto na config, que não tem id). */
  async x(sql, p = []) {
    const ret = /^\s*INSERT/i.test(sql) && !/RETURNING/i.test(sql) && !/INTO\s+config\b/i.test(sql);
    return this.rpc('app_executar', { cmds: [{ sql: montarSql(sql, p) + (ret ? ' RETURNING id' : ''), ret }] });
  },
  /* Vários comandos numa transação só: ou grava tudo, ou nada. */
  async batch(cmds) {
    return this.rpc('app_executar', {
      cmds: cmds.map((c) => ({ sql: montarSql(c.sql, c.params || []), requireChanges: !!c.requireChanges, error: c.error })),
    });
  },
};

/* ---------------- Constantes ---------------- */
const FORMAS = ['Dinheiro', 'Pix', 'Débito', 'Crédito'];
const CAT_ENTRADA = ['Serviço', 'Produto', 'Pacote', 'Outros'];
const CAT_SAIDA = ['Aluguel', 'Produtos', 'Estoque', 'Energia/Água', 'Internet/Telefone', 'Salários', 'Comissões', 'Manutenção', 'Impostos', 'Outros'];
const STATUS = { agendado: 'Agendado', concluido: 'Concluído', cancelado: 'Cancelado', faltou: 'Faltou' };
const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const DIAS_LONGO = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const CORES = ['#c8963e', '#74b36f', '#6c9bd8', '#d8604f', '#a77bd8', '#47b5b0', '#e39a4f', '#d16ba5'];
const PASSO_HORARIO = 15; // minutos entre os horários sugeridos na agenda
const TEMPOS_ATENDIMENTO = [15, 20, 30, 40, 45, 50, 60, 75, 90, 105, 120, 150, 180, 210, 240];

/* Mensagens do WhatsApp. Podem ser editadas em Mais → Mensagens do WhatsApp. */
const MSG_PADRAO = {
  confirmacao: 'Olá, {nome}! Seu horário na {barbearia} está confirmado: {data} às {hora} ({servico}). Qualquer imprevisto, é só avisar por aqui.',
  lembrete: 'Olá, {nome}! Passando para lembrar do seu horário na {barbearia}: {data} às {hora} ({servico}). Até lá!',
  remarcado: 'Olá, {nome}! Seu horário na {barbearia} foi remarcado para {data} às {hora} ({servico}). Qualquer dúvida, é só chamar.',
  cancelado: 'Olá, {nome}! Seu horário de {data} às {hora} na {barbearia} foi cancelado. Quer marcar um novo horário?',
  sumido: 'Olá, {nome}! Faz tempo que não te vemos aqui na {barbearia}. Bora dar um trato no visual? Me fala o melhor dia e horário que eu reservo pra você!',
  aniversario: 'Parabéns, {nome}! 🎉 A equipe da {barbearia} te deseja um ótimo aniversário!',
};
const MSG_ROTULO = {
  confirmacao: 'Confirmação do agendamento', lembrete: 'Lembrete do horário', remarcado: 'Horário remarcado',
  cancelado: 'Horário cancelado', sumido: 'Clientes sumidos', aniversario: 'Aniversário',
};

/* ---------------- Ícones ---------------- */
const I = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICON = {
  home: I('<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>'),
  cal: I('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
  users: I('<circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-6 7-6s7 2 7 6"/><path d="M16 4a4 4 0 010 8M22 21c0-3-2-5-4-5.5"/>'),
  box: I('<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/>'),
  cash: I('<rect x="2" y="6" width="20" height="13" rx="2"/><circle cx="12" cy="12.5" r="3"/><path d="M6 10v5M18 10v5"/>'),
  more: I('<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>'),
  edit: I('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>'),
  trash: I('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  plus: I('<path d="M12 5v14M5 12h14"/>'),
  left: I('<path d="M15 18l-6-6 6-6"/>'),
  right: I('<path d="M9 6l6 6-6 6"/>'),
  scissors: I('<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12"/>'),
  userplus: I('<circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-6 7-6s7 2 7 6M19 8v6M16 11h6"/>'),
  money: I('<path d="M12 2v20M17 6H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>'),
  chat: I('<path d="M21 12a8 8 0 01-11.8 7L4 20l1.1-4.6A8 8 0 1121 12z"/><path d="M9 10.5c.5 1.8 2 3.3 4 4"/>'),
  bolt: I('<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>'),
  report: I('<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/>'),
  percent: I('<path d="M19 5L5 19"/><circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/>'),
  lock: I('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/>'),
  chart: I('<path d="M4 20h16"/><path d="M7 16v-5M12 16V6M17 16v-8"/>'),
  repeat: I('<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 013-3h15M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 01-3 3H3"/>'),
};

/* ---------------- Utilidades ---------------- */
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => isoDate(new Date());
const parseDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseDate(s); d.setDate(d.getDate() + n); return isoDate(d); };
const fmtDate = (s) => { if (!s) return ''; const [y, m, d] = s.split('-'); return `${d}/${m}/${y}`; };
const fmtDay = (s) => { const d = parseDate(s); return `${DIAS[d.getDay()]}, ${pad(d.getDate())}/${pad(d.getMonth() + 1)}`; };
const monthKey = (s) => s.slice(0, 7);
const monthLabel = (k) => { const [y, m] = k.split('-'); return `${MESES[Number(m) - 1]} ${y}`; };
const addMonths = (k, n) => { const [y, m] = k.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const money = (v) => (Number(v) < 0 ? '−R$ ' : 'R$ ') + Math.abs(Number(v || 0)).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const moneyIn = (v) => (v == null || v === '' ? '' : Number(v).toFixed(2).replace('.', ','));
const parseMoney = (s) => {
  s = String(s || '').trim().replace(/[R$\s]/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? NaN : Math.round(n * 100) / 100;
};
const initials = (n) => String(n || '?').trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
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
/* Data de nascimento em três listas (dia, mês, ano): bem mais rápido que o calendário
   para datas antigas. valor = 'AAAA-MM-DD' ou vazio. */
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
/* Lê o campo acima: devolve 'AAAA-MM-DD', null (tudo vazio) ou lança erro com a mensagem para o usuário. */
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

const opt = (value, label, sel) => `<option value="${esc(value)}"${String(value) === String(sel) ? ' selected' : ''}>${esc(label)}</option>`;
/* Configurações ficam em memória (CFG), recarregadas ao entrar e ao trocar de aba. */
let CFG = {};
const cfg = (k, def = '') => (CFG[k] == null ? def : CFG[k]);
async function carregarCfg() {
  CFG = Object.fromEntries((await DB.q('SELECT chave, valor FROM config')).map((r) => [r.chave, r.valor]));
}
const SQL_CFG = 'INSERT INTO config (chave, valor) VALUES (?, ?) ON CONFLICT (barbearia_id, chave) DO UPDATE SET valor=excluded.valor';
async function setCfg(k, v) {
  await DB.x(SQL_CFG, [k, v]);
  CFG[k] = v;
}
/* Várias configurações de uma vez (uma transação só). pares = [[chave, valor], ...] */
async function setCfgs(pares) {
  await DB.batch(pares.map(([k, v]) => ({ sql: SQL_CFG, params: [k, v] })));
  pares.forEach(([k, v]) => (CFG[k] = v));
}
const round2 = (n) => Math.round(Number(n) * 100) / 100;
const toMin = (h) => { const [a, b] = String(h).split(':').map(Number); return a * 60 + (b || 0); };
const fromMin = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const agora = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const diasEntre = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 86400000);
const corProf = (id, cor) => cor || (id ? CORES[(id - 1) % CORES.length] : 'var(--line)');

/* Taxa da maquininha: percentual por forma de pagamento, gravado no lançamento. */
function taxaDe(forma, valor) {
  const chave = { Débito: 'taxa_debito', Crédito: 'taxa_credito', Pix: 'taxa_pix' }[forma];
  const pct = chave ? Number(cfg(chave, '0')) || 0 : 0;
  return round2((Number(valor) || 0) * pct / 100);
}

/* Monta a mensagem a partir do modelo salvo, trocando {nome}, {data}, {hora}... */
function mensagem(tipo, v) {
  let txt = cfg('msg_' + tipo, MSG_PADRAO[tipo]) || MSG_PADRAO[tipo];
  const desconto = cfg('aniv_desconto', '').trim();
  if (tipo === 'aniversario' && desconto && !txt.includes('{desconto}')) {
    txt += ' Como presente, você ganha {desconto} de desconto no seu próximo atendimento neste mês.';
  }
  const vars = {
    barbearia: cfg('nome_barbearia', 'barbearia'),
    desconto,
    nome: String(v.nome || '').split(' ')[0],
    data: v.data ? fmtDay(v.data) : '',
    hora: v.hora || '',
    servico: v.servico || 'atendimento',
    profissional: v.profissional || '',
  };
  return txt.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}
const msgAgendamento = (tipo, a) => mensagem(tipo, { nome: a.cliente, data: a.data, hora: a.hora, servico: a.servico, profissional: a.profissional });

/* Abre a conversa no WhatsApp com a mensagem pronta (o envio é feito pelo usuário). */
function abrirWhats(telefone, texto) {
  const url = waLink(telefone, texto);
  if (!url) { toast('Este cliente não tem telefone cadastrado', true); return false; }
  window.open(url, '_blank', 'noopener');
  return true;
}

/* Comando para o histórico de exclusões, sempre no mesmo batch da exclusão. */
const cmdExclusao = (tabela, id, descricao, dados) => ({
  sql: 'INSERT INTO exclusoes (tabela, registro_id, descricao, dados, usuario_id, usuario_nome) VALUES (?,?,?,?,?,?)',
  params: [tabela, id, descricao, JSON.stringify(dados || {}), S.user.id, S.user.nome],
});

let toastTimer;
function toast(msg, bad) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show' + (bad ? ' bad' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = 'toast'), 2400);
}

const falha = (e) => { console.error(e); toast(mensagemErro(e) || 'Erro', true); };

/* Para ações (botões): mostra o erro e ignora novos toques enquanto a anterior
   ainda está gravando, para não salvar duas vezes. */
function safe(fn) {
  let ocupado = false;
  return (...a) => {
    if (ocupado) {
      const e = a[0];
      if (e && typeof e.preventDefault === 'function') { e.preventDefault(); e.stopPropagation(); }
      return undefined;
    }
    try {
      const r = fn(...a);
      if (r && typeof r.then === 'function') {
        ocupado = true;
        return r.catch(falha).finally(() => { ocupado = false; });
      }
      return r;
    } catch (e) { falha(e); return undefined; }
  };
}

/* Para redesenhar telas: uma de cada vez; pedidos feitos durante o desenho
   viram um único redesenho no final, sempre com o estado mais recente. */
function serial(fn) {
  let rodando = null;
  let denovo = false;
  return () => {
    if (rodando) { denovo = true; return rodando; }
    rodando = (async () => {
      do { denovo = false; await fn(); } while (denovo);
    })().catch(falha).finally(() => { rodando = null; });
    return rodando;
  };
}

/* ---------------- Janelas ---------------- */
const overlays = [];
function sheet(html, { center = false, onOpen } = {}) {
  const ov = document.createElement('div');
  ov.className = 'overlay' + (center ? ' center' : '');
  ov.innerHTML = `<div class="sheet">${center ? '' : '<div class="grab"></div>'}${html}</div>`;
  ov.addEventListener('click', (e) => { if (e.target === ov) closeSheet(); });
  $('#overlays').appendChild(ov);
  overlays.push(ov);
  if (onOpen) onOpen(ov.firstElementChild);
  return ov.firstElementChild;
}
function closeSheet() {
  const ov = overlays.pop();
  if (ov) ov.remove();
}
function closeAll() { while (overlays.length) closeSheet(); }

function confirmBox(msg, okLabel = 'Confirmar', danger = true) {
  return new Promise((resolve) => {
    const s = sheet(`
      <h3>${esc(msg)}</h3>
      <div class="btns two">
        <button class="btn ghost" data-a="no">Voltar</button>
        <button class="btn ${danger ? 'danger' : ''}" data-a="yes">${esc(okLabel)}</button>
      </div>`, { center: true });
    s.querySelector('[data-a=no]').onclick = () => { closeSheet(); resolve(false); };
    s.querySelector('[data-a=yes]').onclick = () => { closeSheet(); resolve(true); };
  });
}

/* ---------------- Estado ---------------- */
const S = {
  user: null,
  view: 'inicio',
  agendaDate: today(),
  finMonth: monthKey(today()),
  dashboardPeriod: 'day',
  clienteBusca: '',
  agendaModo: 'dia',
  sumidosDias: 30,
  analisePeriodo: 90,
  backupAviso: null,
};
const isAdmin = () => S.user && S.user.admin === 1;

/* ---------------- Autenticação ---------------- */
/* Login pelo Supabase Auth. O usuário só entra se também estiver ativo na tabela usuarios. */
async function erroAuth(error) {
  const m = mensagemErro(error);
  if (/Invalid login credentials/i.test(m)) return 'Usuário ou senha incorretos.';
  if (/Password should be at least/i.test(m)) return 'A senha precisa ter pelo menos 6 caracteres.';
  if (/already registered|already been registered/i.test(m)) return 'Este usuário (login) já existe.';
  if (/rate limit/i.test(m)) return 'Muitas tentativas seguidas. Aguarde alguns minutos.';
  return m;
}

async function entrar(codigo, login, senha) {
  const { error } = await sb.auth.signInWithPassword({ email: emailDe(login, codigo), password: senha });
  if (error) throw new Error(await erroAuth(error));
  const u = await DB.one('SELECT id, nome, login, admin FROM usuarios WHERE auth_id = auth.uid() AND ativo = 1').catch(() => null);
  if (!u) {
    await sb.auth.signOut();
    throw new Error('Usuário inativo ou sem acesso a esta barbearia.');
  }
  return u;
}

/* O estabelecimento vem do link (?b=codigo) ou é digitado uma vez e fica guardado no navegador. */
const lerLocal = (k) => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } };
const gravarLocal = (k, v) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) { /* sem storage */ } };

/* Cabeçalho das telas de entrada, com o logo do tipo e a cor do estabelecimento. */
const marca = (b, titulo, sub) => `<div class="brand">${logoTipo(b && b.tipo, b && corDe(b), 64)}<h1>${esc(titulo)}</h1>${sub ? `<p>${esc(sub)}</p>` : ''}</div>`;

function aplicarEstabelecimento(b) {
  S.estab = b;
  aplicarCor(b ? corDe(b) : '');
  document.title = b ? b.nome : 'Sistema';
}

async function renderLogin() {
  closeAll();
  const codigo = lerLocal('barbeariaCodigo');
  if (!codigo) return renderCodigoBarbearia();
  $('#app').className = '';
  $('#app').innerHTML = `<div class="login">${marca(S.estab, 'Entrando', 'Conectando…')}</div>`;
  let barb;
  try {
    barb = await DB.rpc('barbearia_por_codigo', { p_codigo: codigo });
  } catch (e) {
    $('#app').innerHTML = `
      <div class="login">
        ${marca(S.estab, 'Sem conexão', mensagemErro(e))}
        <button class="btn" id="retry">Tentar de novo</button>
      </div>`;
    $('#retry').onclick = () => renderLogin();
    return;
  }
  if (!barb) {
    gravarLocal('barbeariaCodigo', '');
    return renderCodigoBarbearia('Este estabelecimento não está mais disponível. Confira o código.');
  }
  aplicarEstabelecimento(barb);
  // Sessão guardada no navegador: entra direto.
  const salvo = await sessaoGuardada(codigo);
  if (salvo) return iniciarSessao(codigo, salvo);
  const ultimo = lerLocal('ultimoLogin');

  $('#app').innerHTML = `
    <div class="login">
      ${marca(barb, barb.nome, 'Entre para continuar')}
      <form id="f" autocomplete="off">
        <div class="field"><label>Usuário</label><input id="login" autocapitalize="none" value="${esc(ultimo)}" required></div>
        <div class="field"><label>Senha</label><input id="senha" type="password" required></div>
        <div class="err" id="err"></div>
        <button class="btn" type="submit">Entrar</button>
      </form>
      <button class="link" id="trocar" style="margin:22px auto 0;display:block">Trocar de estabelecimento (código ${esc(codigo)})</button>
    </div>`;
  $('#trocar').onclick = () => { gravarLocal('barbeariaCodigo', ''); aplicarEstabelecimento(null); renderCodigoBarbearia(); };

  const err = (m) => ($('#err').textContent = m);
  $('#f').onsubmit = safe(async (e) => {
    e.preventDefault();
    err('');
    const login = $('#login').value.trim();
    const senha = $('#senha').value;
    let u;
    try {
      u = await entrar(codigo, login, senha);
    } catch (e2) {
      $('#senha').value = '';
      return err(e2.message);
    }
    gravarLocal('ultimoLogin', u.login);
    await iniciarSessao(codigo, u);
  });
  setTimeout(() => { const f = ultimo ? $('#senha') : $('#login'); if (f) f.focus(); }, 50);
}

async function iniciarSessao(codigo, u) {
  S.codigo = codigo;
  S.user = { id: u.id, nome: u.nome, login: u.login, admin: u.admin };
  S.view = 'inicio';
  await carregarCfg();
  renderShell();
}

/* Usuário da sessão guardada, se ela for deste estabelecimento e ele continuar ativo. */
async function sessaoGuardada(codigo) {
  const { data } = await sb.auth.getSession();
  const email = data.session && data.session.user.email;
  if (!email) return null;
  if (!email.endsWith(`.${codigo}@${DOMINIO_LOGIN}`)) { await sb.auth.signOut({ scope: 'local' }); return null; }
  const u = await DB.one('SELECT id, nome, login, admin FROM usuarios WHERE auth_id = auth.uid() AND ativo = 1').catch(() => null);
  if (!u) await sb.auth.signOut({ scope: 'local' });
  return u;
}

function renderCodigoBarbearia(aviso = '') {
  closeAll();
  $('#app').className = '';
  $('#app').innerHTML = `
    <div class="login">
      ${marca(null, 'Sistema de agendamento', 'Barbearia, manicure e salão de beleza')}
      <form id="f" autocomplete="off">
        <div class="field"><label>Código do estabelecimento</label><input id="codigo" autocapitalize="none" autocorrect="off" placeholder="ex.: studiodaana" required></div>
        <div class="err" id="err">${esc(aviso)}</div>
        <button class="btn" type="submit">Continuar</button>
      </form>
      <p class="hint" style="text-align:center;margin-top:18px">O código é informado por quem contratou o sistema.</p>
    </div>`;
  $('#f').onsubmit = safe(async (e) => {
    e.preventDefault();
    const codigo = $('#codigo').value.trim().toLowerCase();
    if (!codigo) return;
    const barb = await DB.rpc('barbearia_por_codigo', { p_codigo: codigo });
    if (!barb) return ($('#err').textContent = 'Código não encontrado. Confira com quem contratou o sistema.');
    aplicarEstabelecimento(barb);
    gravarLocal('barbeariaCodigo', barb.codigo);
    return renderLogin();
  });
  setTimeout(() => $('#codigo') && $('#codigo').focus(), 50);
}

function logout() {
  S.user = null;
  CFG = {};
  sb.auth.signOut().catch(() => {});
  renderLogin();
}

/* ---------------- Estrutura principal ---------------- */
const VIEWS = {
  inicio: { label: 'Início', icon: 'home', render: viewInicio },
  agenda: { label: 'Agenda', icon: 'cal', render: viewAgenda, fab: () => formAgendamento() },
  clientes: { label: 'Clientes', icon: 'users', render: viewClientes, fab: () => formCliente() },
  produtos: { label: 'Produtos', icon: 'box', render: viewProdutos, fab: () => formProduto(), admin: true },
  caixa: { label: 'Financeiro', icon: 'cash', render: viewCaixa, fab: () => formLancamento(), admin: true },
  mais: { label: 'Mais', icon: 'more', render: viewMais },
};

function renderShell() {
  const tabs = Object.entries(VIEWS).filter(([, v]) => !v.admin || isAdmin());
  $('#app').className = 'shell';
  $('#app').innerHTML = `
    <div class="topbar">
      <div><h2 id="title"></h2><div class="sub" id="subtitle"></div></div>
      <span class="chip">${esc(S.user.nome.split(' ')[0])}</span>
    </div>
    <div class="content" id="content"></div>
    <button class="fab" id="fab" aria-label="Adicionar">${ICON.plus}</button>
    <nav class="nav"><div class="nav-marca">${logoTipo(S.estab && S.estab.tipo, S.estab && corDe(S.estab), 34)}<span>${esc(cfg('nome_barbearia', S.estab ? S.estab.nome : ''))}</span></div>${tabs.map(([k, v]) => `<button data-v="${k}">${ICON[v.icon]}<span>${v.label}</span></button>`).join('')}</nav>`;
  document.querySelectorAll('.nav button').forEach((b) => (b.onclick = () => go(b.dataset.v)));
  go(S.view);
  // Despesas fixas e backup automático só para o administrador (o profissional não vê o financeiro).
  if (isAdmin()) {
    safe(async () => {
      const lancou = await lancarDespesasFixas();
      const lembrar = await lembreteBackup();
      if (lancou || lembrar) refresh();
    })();
  }
}

/* Lança no financeiro as despesas fixas que venceram neste mês e ainda não foram lançadas. */
async function lancarDespesasFixas() {
  const hoje = today();
  const mes = monthKey(hoje);
  const ultimoDia = new Date(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0).getDate();
  const pendentes = (await DB.q('SELECT * FROM despesas_fixas WHERE ativo=1 AND (ultimo_mes IS NULL OR ultimo_mes<?)', [mes]))
    .filter((d) => Math.min(d.dia, ultimoDia) <= Number(hoje.slice(8, 10)));
  if (!pendentes.length) return false;
  const cmds = [];
  pendentes.forEach((d) => {
    cmds.push({ sql: 'UPDATE despesas_fixas SET ultimo_mes=? WHERE id=? AND (ultimo_mes IS NULL OR ultimo_mes<?)', params: [mes, d.id, mes], requireChanges: true });
    cmds.push({ sql: "INSERT INTO lancamentos (tipo, descricao, categoria, valor, data, forma_pagamento, usuario_id, despesa_fixa_id) VALUES ('saida',?,?,?,?,?,?,?)",
      params: [d.descricao, d.categoria, d.valor, `${mes}-${pad(Math.min(d.dia, ultimoDia))}`, d.forma_pagamento, S.user.id, d.id] });
  });
  await DB.batch(cmds);
  toast(`${pendentes.length} despesa(s) fixa(s) lançada(s) no financeiro`);
  return true;
}

/* Contas fixas que vencem nos próximos dias (aviso na tela inicial). */
async function despesasAVencer(dias = 3) {
  const hoje = today();
  const mes = monthKey(hoje);
  const ultimoDia = new Date(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0).getDate();
  return (await DB.q('SELECT * FROM despesas_fixas WHERE ativo=1 AND (ultimo_mes IS NULL OR ultimo_mes<?)', [mes]))
    .map((d) => ({ ...d, vence: `${mes}-${pad(Math.min(d.dia, ultimoDia))}` }))
    .map((d) => ({ ...d, faltam: diasEntre(hoje, d.vence) }))
    .filter((d) => d.faltam >= 0 && d.faltam <= dias)
    .sort((a, b) => a.faltam - b.faltam);
}

/* Lembrete semanal de baixar o backup (o navegador não deixa salvar arquivo sem um clique). */
async function lembreteBackup() {
  if (cfg('backup_auto', '1') !== '1') return false;
  const ultimo = cfg('backup_ultimo', '');
  if (ultimo && diasEntre(ultimo, today()) < 7) return false;
  if (!(await DB.val('SELECT (SELECT COUNT(*) FROM clientes) + (SELECT COUNT(*) FROM lancamentos)'))) return false;
  S.backupAviso = ultimo ? `Último backup em ${fmtDate(ultimo)}` : 'Nenhum backup baixado ainda';
  return true;
}

let recarregarCfg = false;
function go(view) {
  if (VIEWS[view].admin && !isAdmin()) view = 'inicio';
  S.view = view;
  closeAll();
  recarregarCfg = true; // pega mudanças feitas em outro aparelho
  refresh();
  window.scrollTo(0, 0);
}

const refresh = serial(async () => {
  if (!S.user) return;
  if (recarregarCfg) { recarregarCfg = false; await carregarCfg(); }
  const v = VIEWS[S.view];
  document.querySelectorAll('.nav button').forEach((b) => b.classList.toggle('on', b.dataset.v === S.view));
  $('#title').textContent = v.label === 'Início' ? cfg('nome_barbearia', S.estab ? S.estab.nome : 'Início') : v.label;
  const fab = $('#fab');
  fab.style.display = v.fab ? '' : 'none';
  fab.onclick = v.fab ? safe(v.fab) : null;
  await v.render($('#content'));
});

/* Esc fecha a janela aberta. */
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && overlays.length) closeSheet(); });

/* ---------------- Consultas comuns ---------------- */
const SQL_AG = `
  SELECT a.*, c.nome AS cliente, c.telefone, s.nome AS servico, u.nome AS profissional, u.cor AS prof_cor
  FROM agendamentos a
  JOIN clientes c ON c.id = a.cliente_id
  LEFT JOIN servicos s ON s.id = a.servico_id
  LEFT JOIN usuarios u ON u.id = a.profissional_id`;

function agItem(a, showDate) {
  const sub = [a.servico, a.profissional].filter(Boolean).join(' · ');
  return `
    <button class="item ag" data-ag="${a.id}" style="--prof:${esc(corProf(a.profissional_id, a.prof_cor))}">
      <div class="time">${esc(a.hora)}<small>${esc(fromMin(toMin(a.hora) + (a.duracao || 30)))}</small></div>
      <div class="main">
        <div class="t">${esc(a.cliente)}</div>
        <div class="s">${showDate ? esc(fmtDay(a.data)) + ' · ' : ''}${esc(sub || 'Sem serviço')}</div>
        ${a.status === 'agendado' && (a.confirmacao_em || a.lembrete_em) ? `<div class="s ok">✓ ${a.lembrete_em ? 'lembrete enviado' : 'confirmação enviada'}</div>` : ''}
      </div>
      <div class="right">
        <div>${money(a.valor)}</div>
        <span class="badge b-${a.status}">${STATUS[a.status] || a.status}</span>
      </div>
    </button>`;
}
function bindAgItems(root) {
  root.querySelectorAll('[data-ag]').forEach((b) => (b.onclick = safe(() => detalheAgendamento(Number(b.dataset.ag)))));
}

/* ======================= INÍCIO ======================= */
async function viewInicio(el) {
  const hoje = today();
  const mes = monthKey(hoje);
  const ano = hoje.slice(0, 4);

  const [ags, entHoje, m, aniv, estoqueBaixo, contas, amanha, aluguel] = await Promise.all([
    DB.q(`${SQL_AG} WHERE a.data = ? AND a.status <> 'cancelado' ORDER BY a.hora`, [hoje]),
    isAdmin() ? DB.val(`SELECT COALESCE(SUM(valor),0) FROM lancamentos WHERE tipo='entrada' AND data=?`, [hoje]) : 0,
    isAdmin() ? DB.one(`SELECT
        COALESCE(SUM(CASE WHEN tipo='entrada' THEN valor-taxa END),0) AS ent,
        COALESCE(SUM(CASE WHEN tipo='saida' THEN valor END),0) AS sai
      FROM lancamentos WHERE substr(data,1,7)=?`, [mes]) : { ent: 0, sai: 0 },
    DB.q(`SELECT id, nome, telefone, nascimento, parabens_ano FROM clientes WHERE substr(nascimento,6,2)=? ORDER BY substr(nascimento,9,2)`, [hoje.slice(5, 7)]),
    isAdmin() ? DB.q('SELECT id, nome, estoque, estoque_minimo FROM produtos WHERE ativo=1 AND estoque<=estoque_minimo ORDER BY estoque, nome') : [],
    isAdmin() ? despesasAVencer() : [],
    DB.val("SELECT COUNT(*) FROM agendamentos WHERE data=? AND status='agendado' AND lembrete_em IS NULL", [addDays(hoje, 1)]),
    isAdmin() ? DB.rpc('minha_assinatura').catch(() => null) : null,
  ]);
  const pendentes = ags.filter((a) => a.status === 'agendado').length;
  // Aviso do aluguel do sistema: só perto do vencimento ou vencido (não bloqueia nada).
  const avisoAluguel = aluguel && aluguel.status !== 'em_dia' ? `
      <div class="card alert">
        <div><b>${aluguel.status === 'vencida' ? 'Mensalidade do sistema vencida' : 'Mensalidade do sistema vence em breve'}</b>
          <div class="hint">${aluguel.status === 'vencida' ? `Venceu em ${esc(fmtDate(aluguel.vencimento))} (há ${-aluguel.dias} dia(s))`
            : aluguel.dias === 0 ? 'Vence hoje' : `Vence em ${esc(fmtDate(aluguel.vencimento))} (${aluguel.dias} dia(s))`} · ${money(aluguel.valor)}. Se já pagou, desconsidere.</div></div>
      </div>` : '';
  const concluidos = ags.filter((a) => a.status === 'concluido').length;
  $('#subtitle').textContent = `Olá, ${S.user.nome.split(' ')[0]} · ${fmtDay(hoje)}`;

  el.innerHTML = `
    ${avisoAluguel}
    ${S.backupAviso ? `
      <div class="card alert">
        <div><b>Hora do backup semanal</b><div class="hint">${esc(S.backupAviso)}. Os dados já ficam na nuvem; o backup é uma cópia extra num arquivo.</div></div>
        <div class="btns two"><button class="btn ghost" id="bk-fechar">Depois</button><button class="btn" id="bk-enviar">Baixar backup</button></div>
      </div>` : ''}
    <div class="stats">
      <div class="stat"><div class="lbl">Agendados hoje</div><div class="val">${pendentes}</div></div>
      <div class="stat"><div class="lbl">Atendidos hoje</div><div class="val">${concluidos}</div></div>
      ${isAdmin() ? `
      <div class="stat gold"><div class="lbl">Entradas hoje</div><div class="val">${money(entHoje)}</div></div>
      <div class="stat"><div class="lbl">Saldo do mês</div><div class="val ${m.ent - m.sai >= 0 ? 'pos' : 'neg'}">${money(m.ent - m.sai)}</div></div>` : ''}
    </div>

    <div class="section-title">Atalhos</div>
    <div class="quick">
      <button id="qe">${ICON.bolt}Atender agora</button>
      <button id="qa">${ICON.scissors}Agendar</button>
      <button id="qc">${ICON.userplus}Cliente</button>
      <button id="qlem">${ICON.chat}Lembretes${amanha ? ` <span class="badge b-agendado">${amanha}</span>` : ''}</button>
      <button id="qs">${ICON.users}Sumidos</button>
      ${isAdmin() ? `<button id="ql">${ICON.money}Lançamento</button>` : `<button id="qg">${ICON.cal}Agenda</button>`}
    </div>

    ${contas.length ? `
      <div class="section-title">Contas a vencer</div>
      <div class="list">${contas.map((d) => `
        <div class="item">
          <div class="main"><div class="t">${esc(d.descricao)}</div><div class="s">${d.faltam === 0 ? 'Vence hoje' : `Vence em ${d.faltam} dia(s)`} · ${esc(fmtDate(d.vence))} · lançada automaticamente no vencimento</div></div>
          <div class="right neg">${money(d.valor)}</div>
        </div>`).join('')}</div>` : ''}

    ${estoqueBaixo.length ? `
      <div class="section-title">Estoque baixo</div>
      <div class="list">${estoqueBaixo.map((p) => `
        <button class="item" data-estoque="${p.id}">
          <div class="main"><div class="t">${esc(p.nome)}</div><div class="s">Mínimo: ${p.estoque_minimo} un.</div></div>
          <div class="right neg">${p.estoque} un.</div>
        </button>`).join('')}</div>` : ''}

    <div class="section-title">Hoje</div>
    ${ags.length ? `<div class="list">${ags.map((a) => agItem(a)).join('')}</div>` : '<div class="card empty">Nenhum atendimento marcado para hoje.</div>'}

    ${aniv.length ? `
      <div class="section-title">Aniversariantes do mês</div>
      <div class="list">${aniv.map((c) => {
        const ehHoje = c.nascimento.slice(5) === hoje.slice(5);
        const enviado = c.parabens_ano === ano;
        return `
        <div class="item" role="button" data-cli="${c.id}">
          <div class="avatar">${esc(initials(c.nome))}</div>
          <div class="main"><div class="t">${esc(c.nome)}${ehHoje ? ' 🎂' : ''}</div>
            <div class="s">${ehHoje ? 'Hoje!' : esc(fmtDate(c.nascimento).slice(0, 5))}${enviado ? ' · ✓ parabéns enviado' : ''}</div></div>
          ${c.telefone ? `<button class="icon-btn wa" data-parabens="${c.id}" aria-label="Enviar parabéns">${ICON.chat}</button>` : ''}
        </div>`;
      }).join('')}</div>` : ''}
  `;
  $('#qe').onclick = safe(() => formEncaixe());
  $('#qa').onclick = safe(() => formAgendamento());
  $('#qc').onclick = safe(() => formCliente());
  $('#qlem').onclick = safe(() => lembretesAmanha());
  $('#qs').onclick = safe(() => clientesSumidos());
  if ($('#ql')) $('#ql').onclick = safe(() => formLancamento());
  if ($('#qg')) $('#qg').onclick = () => go('agenda');
  if ($('#bk-fechar')) $('#bk-fechar').onclick = () => { S.backupAviso = null; refresh(); };
  if ($('#bk-enviar')) $('#bk-enviar').onclick = safe(async () => { S.backupAviso = null; await baixarBackup(false); refresh(); });
  bindAgItems(el);
  el.querySelectorAll('[data-estoque]').forEach((b) => (b.onclick = () => go('produtos')));
  el.querySelectorAll('[data-cli]').forEach((b) => (b.onclick = safe(() => detalheCliente(Number(b.dataset.cli)))));
  el.querySelectorAll('[data-parabens]').forEach((b) => (b.onclick = safe(async (e) => {
    e.stopPropagation();
    const c = aniv.find((x) => x.id === Number(b.dataset.parabens));
    await DB.x('UPDATE clientes SET parabens_ano=? WHERE id=?', [ano, c.id]);
    refresh();
    abrirWhats(c.telefone, mensagem('aniversario', { nome: c.nome }));
  })));
}

/* ======================= AGENDA ======================= */
async function viewAgenda(el) {
  if (S.agendaModo === 'semana') return viewSemana(el);
  const d = S.agendaDate;
  const [ags, amanha] = await Promise.all([
    DB.q(`${SQL_AG} WHERE a.data = ? ORDER BY a.hora`, [d]),
    DB.val("SELECT COUNT(*) FROM agendamentos WHERE data=? AND status='agendado' AND lembrete_em IS NULL", [addDays(today(), 1)]),
  ]);
  const total = ags.filter((a) => a.status !== 'cancelado').reduce((s, a) => s + a.valor, 0);
  $('#subtitle').textContent = `${ags.filter((a) => a.status !== 'cancelado').length} atendimento(s) · ${money(total)}`;

  el.innerHTML = `
    ${segModoAgenda()}
    <div class="datebar">
      <button class="iconbtn" id="prev">${ICON.left}</button>
      <div class="d">${d === today() ? 'Hoje, ' : ''}${esc(fmtDay(d))}<input type="date" id="dpick" value="${d}"></div>
      <button class="iconbtn" id="next">${ICON.right}</button>
    </div>
    ${d !== today() ? '<button class="btn ghost" id="hoje" style="margin-bottom:12px">Voltar para hoje</button>' : ''}
    <div class="btns two" style="margin:0 0 12px">
      <button class="btn ghost" id="encaixe">Atender agora</button>
      <button class="btn ghost" id="lembretes">Lembretes de amanhã${amanha ? ` (${amanha})` : ''}</button>
    </div>
    ${ags.length ? `<div class="list">${ags.map((a) => agItem(a)).join('')}</div>` : '<div class="card empty">Nenhum agendamento neste dia.<br>Toque no + para agendar.</div>'}
  `;
  bindModoAgenda(el);
  $('#prev').onclick = () => { S.agendaDate = addDays(d, -1); refresh(); };
  $('#next').onclick = () => { S.agendaDate = addDays(d, 1); refresh(); };
  $('#dpick').onchange = (e) => { if (e.target.value) { S.agendaDate = e.target.value; refresh(); } };
  if ($('#hoje')) $('#hoje').onclick = () => { S.agendaDate = today(); refresh(); };
  $('#encaixe').onclick = safe(() => formEncaixe());
  $('#lembretes').onclick = safe(() => lembretesAmanha());
  bindAgItems(el);
}

const segModoAgenda = () => `<div class="seg" id="modo">${[['dia', 'Dia'], ['semana', 'Semana']].map(([k, l]) =>
  `<button data-modo="${k}" class="${S.agendaModo === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
function bindModoAgenda(el) {
  el.querySelectorAll('[data-modo]').forEach((b) => (b.onclick = () => { S.agendaModo = b.dataset.modo; refresh(); }));
}

/* Semana de segunda a domingo, com a cor de cada profissional. */
async function viewSemana(el) {
  const ref = parseDate(S.agendaDate);
  ref.setDate(ref.getDate() - ((ref.getDay() + 6) % 7));
  const ini = isoDate(ref);
  const fim = addDays(ini, 6);
  const [ags, profs] = await Promise.all([
    DB.q(`${SQL_AG} WHERE a.data BETWEEN ? AND ? AND a.status <> 'cancelado' ORDER BY a.data, a.hora`, [ini, fim]),
    DB.q('SELECT id, nome, cor FROM usuarios WHERE ativo=1 ORDER BY nome'),
  ]);
  $('#subtitle').textContent = `${ags.length} atendimento(s) · ${money(ags.reduce((t, a) => t + a.valor, 0))}`;
  const dias = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(ini, i));
  el.innerHTML = `
    ${segModoAgenda()}
    <div class="datebar">
      <button class="iconbtn" id="prev">${ICON.left}</button>
      <div class="d">${esc(fmtDate(ini).slice(0, 5))} a ${esc(fmtDate(fim).slice(0, 5))}<input type="date" id="dpick" value="${S.agendaDate}"></div>
      <button class="iconbtn" id="next">${ICON.right}</button>
    </div>
    <div class="legend">${profs.map((p) => `<span><i style="background:${esc(corProf(p.id, p.cor))}"></i>${esc(p.nome.split(' ')[0])}</span>`).join('')}</div>
    ${dias.map((d) => {
      const doDia = ags.filter((a) => a.data === d);
      return `
        <button class="dayhead ${d === today() ? 'today' : ''}" data-dia="${d}">
          <span>${esc(fmtDay(d))}${d === today() ? ' · hoje' : ''}</span>
          <span class="hint">${doDia.length ? `${doDia.length} · ${money(doDia.reduce((t, a) => t + a.valor, 0))}` : 'livre'}</span>
        </button>
        ${doDia.length ? `<div class="list">${doDia.map((a) => agItem(a)).join('')}</div>` : ''}`;
    }).join('')}`;
  bindModoAgenda(el);
  $('#prev').onclick = () => { S.agendaDate = addDays(S.agendaDate, -7); refresh(); };
  $('#next').onclick = () => { S.agendaDate = addDays(S.agendaDate, 7); refresh(); };
  $('#dpick').onchange = (e) => { if (e.target.value) { S.agendaDate = e.target.value; refresh(); } };
  el.querySelectorAll('[data-dia]').forEach((b) => (b.onclick = () => { S.agendaDate = b.dataset.dia; S.agendaModo = 'dia'; refresh(); }));
  bindAgItems(el);
}

/* ---- Horário de trabalho ---- */
/* horario (JSON) = {"1":["09:00","19:00"], ...} por dia da semana (0 = domingo); dia ausente = folga.
   Sem horário configurado, o profissional atende das 08:00 às 20:00 todos os dias. */
/* Expediente pelo horário cadastrado (sem olhar folgas). */
function expedienteDoHorario(horario, data) {
  let h = null;
  try { h = horario ? JSON.parse(horario) : null; } catch (e) { h = null; }
  if (!h) return { inicio: '08:00', fim: '20:00' };
  const dia = h[String(parseDate(data).getDay())];
  if (!dia) return { folga: 'dia de folga' };
  return { inicio: dia[0], fim: dia[1] };
}

async function expediente(prof, data) {
  const folga = await DB.one('SELECT motivo FROM folgas WHERE usuario_id=? AND data=?', [prof.id, data]);
  if (folga) return { folga: folga.motivo || 'folga' };
  return expedienteDoHorario(prof.horario, data);
}

/* Duração do atendimento: o tempo do profissional (Horários e folgas), senão a duração do serviço. */
const duracaoDe = (prof, srv) => (prof && prof.tempo_atendimento) || (srv ? srv.duracao : 30);
const textoTempo = (min) => (min >= 60 ? `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}` : `${min} min`);
const comIntervalo = (a) => ({ ...a, ini: toMin(a.hora), fim: toMin(a.hora) + (a.duracao || 30) });

async function ocupados(profId, data, ignorarId) {
  return (await DB.q(`${SQL_AG} WHERE a.profissional_id=? AND a.data=? AND a.status IN ('agendado','concluido') AND a.id<>?`, [profId, data, ignorarId || 0]))
    .map(comIntervalo);
}

/* Horários de início livres no expediente, de PASSO_HORARIO em PASSO_HORARIO (hoje, só daqui pra frente). */
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

async function horariosLivres(prof, data, duracao, ignorarId) {
  const [exp, ocup] = await Promise.all([expediente(prof, data), ocupados(prof.id, data, ignorarId)]);
  return calcularLivres(exp, ocup, data, duracao);
}

async function formAgendamento(ag = null, preset = {}) {
  const [clientes, servicos, profs] = await Promise.all([
    DB.q('SELECT id, nome, telefone FROM clientes ORDER BY lower(nome)'),
    DB.q('SELECT * FROM servicos WHERE ativo = 1 ORDER BY nome'),
    DB.q('SELECT id, nome, horario, tempo_atendimento FROM usuarios WHERE ativo = 1 ORDER BY nome'),
  ]);
  if (!clientes.length) {
    toast('Cadastre um cliente primeiro');
    return formCliente(null, (id) => formAgendamento(null, { cliente_id: id }));
  }
  const a = ag || {
    cliente_id: preset.cliente_id || '',
    servico_id: servicos[0] ? servicos[0].id : '',
    profissional_id: S.user.id,
    data: S.view === 'agenda' ? S.agendaDate : today(),
    hora: '',
    valor: servicos[0] ? servicos[0].preco : 0,
    duracao: duracaoDe(profs.find((p) => p.id === S.user.id), servicos[0]),
    observacoes: '',
  };

  const s = sheet(`
    <h3>${ag ? 'Editar agendamento' : 'Novo agendamento'}</h3>
    <div class="field"><label>Cliente</label>
      <select id="cli">${ag ? '' : '<option value="">Selecione…</option>'}${clientes.map((c) => opt(c.id, c.nome + (c.telefone ? ' · ' + fmtPhone(c.telefone) : ''), a.cliente_id)).join('')}</select>
    </div>
    <div class="field"><label>Serviço</label>
      <select id="srv">${servicos.map((x) => opt(x.id, `${x.nome} — ${money(x.preco)} · ${x.duracao} min`, a.servico_id)).join('')}${a.servico_id && !servicos.some((x) => x.id === a.servico_id) ? opt('', '(serviço removido)', '') : ''}</select>
    </div>
    <div class="row2">
      <div class="field"><label>Profissional</label>
        <select id="prof">${profs.map((p) => opt(p.id, p.nome, a.profissional_id)).join('')}</select>
      </div>
      <div class="field"><label>Data</label><input type="date" id="data" value="${esc(a.data)}"></div>
    </div>
    <div class="row2">
      <div class="field"><label>Hora</label><input type="time" id="hora" value="${esc(a.hora)}"></div>
      <div class="field"><label>Duração (min)</label><input type="number" id="dur" min="5" step="5" inputmode="numeric" value="${esc(a.duracao || 30)}"></div>
    </div>
    <div class="field"><label>Horários livres</label><div id="slots" class="slots"></div></div>
    <div class="row2">
      <div class="field"><label>Valor (R$)</label><input id="valor" inputmode="decimal" value="${esc(moneyIn(a.valor))}"></div>
      <div class="field"><label>Observações</label><input id="obs" value="${esc(a.observacoes || '')}"></div>
    </div>
    <div class="err" id="err"></div>
    <div class="btns two">
      <button class="btn ghost" id="cancel">Cancelar</button>
      <button class="btn" id="save">Salvar</button>
    </div>`);

  const prof = () => profs.find((p) => p.id === Number($('#prof', s).value));
  const duracao = () => Math.max(5, parseInt($('#dur', s).value, 10) || 30);
  const drawSlots = serial(async () => {
    const box = $('#slots', s);
    const p = prof();
    const data = $('#data', s).value;
    if (!p || !data) { box.innerHTML = ''; return; }
    const r = await horariosLivres(p, data, duracao(), ag && ag.id);
    if (r.folga) { box.innerHTML = `<div class="hint neg">${esc(p.nome.split(' ')[0])} não atende neste dia (${esc(r.folga)}).</div>`; return; }
    const hora = $('#hora', s).value;
    box.innerHTML = r.livres.length
      ? r.livres.map((h) => `<button type="button" data-h="${h}" class="${h === hora ? 'on' : ''}">${h}</button>`).join('')
      : '<div class="hint">Nenhum horário livre neste dia.</div>';
    box.querySelectorAll('[data-h]').forEach((b) => (b.onclick = () => { $('#hora', s).value = b.dataset.h; drawSlots(); }));
    const sel = $('button.on', box);
    if (sel) box.scrollLeft = sel.offsetLeft - box.offsetLeft - 40;
  });
  const srvAtual = () => servicos.find((v) => String(v.id) === $('#srv', s).value);
  $('#srv', s).onchange = () => {
    const x = srvAtual();
    if (x) { $('#valor', s).value = moneyIn(x.preco); $('#dur', s).value = duracaoDe(prof(), x); }
    drawSlots();
  };
  $('#prof', s).onchange = () => { $('#dur', s).value = duracaoDe(prof(), srvAtual()); drawSlots(); };
  ['#data', '#dur', '#hora'].forEach((k) => ($(k, s).onchange = drawSlots));
  drawSlots();

  $('#cancel', s).onclick = closeSheet;
  $('#save', s).onclick = safe(async () => {
    const err = (m) => ($('#err', s).textContent = m);
    const v = {
      cliente_id: Number($('#cli', s).value),
      servico_id: $('#srv', s).value ? Number($('#srv', s).value) : null,
      profissional_id: Number($('#prof', s).value) || null,
      data: $('#data', s).value,
      hora: $('#hora', s).value,
      duracao: duracao(),
      valor: parseMoney($('#valor', s).value),
      obs: $('#obs', s).value.trim(),
    };
    if (!v.cliente_id) return err('Selecione o cliente.');
    if (!v.data || !v.hora) return err('Informe data e hora.');
    if (isNaN(v.valor) || v.valor < 0) return err('Valor inválido.');

    const p = prof();
    if (p) {
      const exp = await expediente(p, v.data);
      const ini = toMin(v.hora);
      let aviso = '';
      if (exp.folga) aviso = `${p.nome} não atende neste dia (${exp.folga}).`;
      else if (ini < toMin(exp.inicio) || ini + v.duracao > toMin(exp.fim)) aviso = `O horário fica fora do expediente de ${p.nome} (${exp.inicio} às ${exp.fim}).`;
      else {
        const choque = (await ocupados(p.id, v.data, ag && ag.id)).find((o) => ini < o.fim && ini + v.duracao > o.ini);
        if (choque) aviso = `Choca com ${choque.cliente} (${choque.hora} às ${fromMin(choque.fim)}).`;
      }
      if (aviso && !(await confirmBox(`${aviso} Agendar mesmo assim?`, 'Agendar', false))) return;
    }

    let id = ag && ag.id;
    const remarcou = ag && ag.status === 'agendado' && (ag.data !== v.data || ag.hora !== v.hora);
    if (ag) {
      await DB.x(`UPDATE agendamentos SET cliente_id=?, servico_id=?, profissional_id=?, data=?, hora=?, duracao=?, valor=?, observacoes=? WHERE id=?`,
        [v.cliente_id, v.servico_id, v.profissional_id, v.data, v.hora, v.duracao, v.valor, v.obs, ag.id]);
      toast('Agendamento atualizado');
    } else {
      id = (await DB.x(`INSERT INTO agendamentos (cliente_id, servico_id, profissional_id, data, hora, duracao, valor, observacoes) VALUES (?,?,?,?,?,?,?,?)`,
        [v.cliente_id, v.servico_id, v.profissional_id, v.data, v.hora, v.duracao, v.valor, v.obs])).lastId;
      toast('Agendado!');
    }
    closeAll();
    if (S.view === 'agenda') S.agendaDate = v.data;
    refresh();

    if (!ag || remarcou) {
      const novo = await DB.one(`${SQL_AG} WHERE a.id=?`, [id]);
      if (novo && novo.telefone && (await confirmBox(`${remarcou ? 'Avisar' : 'Enviar confirmação para'} ${novo.cliente.split(' ')[0]} no WhatsApp?`, 'Abrir WhatsApp', false))) {
        await DB.x('UPDATE agendamentos SET confirmacao_em=agora_local(), lembrete_em=NULL WHERE id=?', [id]);
        refresh();
        abrirWhats(novo.telefone, msgAgendamento(remarcou ? 'remarcado' : 'confirmacao', novo));
      }
    }
  });
}

/* Lista dos horários de amanhã para mandar o lembrete um por um. */
function lembretesAmanha() {
  const dia = addDays(today(), 1);
  const s = sheet(`<h3>Lembretes de amanhã</h3><p class="hint" style="margin-top:-8px">${esc(fmtDay(dia))}. Toque em “Enviar” para abrir o WhatsApp com a mensagem pronta.</p><div id="lista"></div>`);
  const draw = serial(async () => {
    const rows = await DB.q(`${SQL_AG} WHERE a.data=? AND a.status='agendado' ORDER BY a.hora`, [dia]);
    $('#lista', s).innerHTML = rows.length ? `<div class="list">${rows.map((a) => `
      <div class="item">
        <div class="time">${esc(a.hora)}</div>
        <div class="main"><div class="t">${esc(a.cliente)}</div>
          <div class="s">${a.lembrete_em ? `<span class="ok">✓ enviado ${esc(a.lembrete_em.slice(11, 16))}</span>` : esc(a.telefone ? fmtPhone(a.telefone) : 'sem telefone')}</div></div>
        ${a.telefone ? `<button class="btn ${a.lembrete_em ? 'ghost' : 'green'} small" data-env="${a.id}">${a.lembrete_em ? 'Reenviar' : 'Enviar'}</button>` : ''}
      </div>`).join('')}</div>` : '<div class="card empty">Nenhum horário agendado para amanhã.</div>';
    s.querySelectorAll('[data-env]').forEach((b) => (b.onclick = safe(async () => {
      const a = rows.find((x) => x.id === Number(b.dataset.env));
      await DB.x('UPDATE agendamentos SET lembrete_em=agora_local() WHERE id=?', [a.id]);
      draw(); refresh();
      abrirWhats(a.telefone, msgAgendamento('lembrete', a));
    })));
  });
  draw();
}

async function detalheAgendamento(id) {
  const a = await DB.one(`${SQL_AG} WHERE a.id = ?`, [id]);
  if (!a) return;
  const [lanc, pacote] = await Promise.all([
    DB.one('SELECT * FROM lancamentos WHERE agendamento_id = ?', [id]),
    a.cliente_pacote_id ? DB.one('SELECT nome FROM clientes_pacotes WHERE id=?', [a.cliente_pacote_id]) : null,
  ]);
  const pagamento = lanc ? lanc.forma_pagamento : pacote ? `Pacote: ${pacote.nome}` : a.brinde ? 'Cortesia (fidelidade)' : '';
  const envio = a.lembrete_em ? `Lembrete enviado em ${fmtDate(a.lembrete_em.slice(0, 10))} ${a.lembrete_em.slice(11, 16)}`
    : a.confirmacao_em ? `Confirmação enviada em ${fmtDate(a.confirmacao_em.slice(0, 10))} ${a.confirmacao_em.slice(11, 16)}` : '';

  const s = sheet(`
    <h3>${esc(a.cliente)}</h3>
    <div class="kv"><span>Data</span><span>${esc(fmtDay(a.data))} · ${esc(a.hora)} às ${esc(fromMin(toMin(a.hora) + (a.duracao || 30)))}</span></div>
    <div class="kv"><span>Serviço</span><span>${esc(a.servico || '—')}</span></div>
    <div class="kv"><span>Profissional</span><span>${esc(a.profissional || '—')}</span></div>
    <div class="kv"><span>Valor</span><span>${money(a.valor)}</span></div>
    <div class="kv"><span>Situação</span><span><span class="badge b-${a.status}">${STATUS[a.status]}</span>${pagamento ? ' · ' + esc(pagamento) : ''}</span></div>
    ${a.observacoes ? `<div class="kv"><span>Obs.</span><span>${esc(a.observacoes)}</span></div>` : ''}
    ${envio && a.status === 'agendado' ? `<p class="hint ok">✓ ${esc(envio)}</p>` : ''}
    <div class="btns" style="margin-top:16px">
      ${a.status === 'agendado' ? '<button class="btn green" id="concluir">Concluir e receber</button>' : ''}
      ${a.telefone && a.status === 'agendado' ? '<button class="btn ghost" id="lembrete">Enviar lembrete no WhatsApp</button>' : ''}
      <div class="btns two">
        <button class="btn ghost" id="editar">Editar</button>
        <button class="btn ghost" id="cliente">Ver cliente</button>
      </div>
      ${a.status === 'agendado' ? `
        <div class="btns two">
          <button class="btn ghost" id="faltou">Faltou</button>
          <button class="btn danger" id="cancelar">Cancelar</button>
        </div>` : '<button class="btn ghost" id="reabrir">Voltar para "Agendado"</button>'}
      ${isAdmin() ? '<button class="btn danger" id="excluir">Excluir</button>' : ''}
    </div>`);

  // Desfaz o recebimento e devolve o uso do pacote, se houver.
  const desfazer = () => [
    { sql: 'DELETE FROM lancamentos WHERE agendamento_id=?', params: [id] },
    ...(a.cliente_pacote_id ? [{ sql: 'UPDATE clientes_pacotes SET usados=usados-1 WHERE id=? AND usados>0', params: [a.cliente_pacote_id] }] : []),
  ];
  const setStatus = async (st) => { await DB.x('UPDATE agendamentos SET status=? WHERE id=?', [st, id]); closeAll(); refresh(); };
  if ($('#concluir', s)) $('#concluir', s).onclick = safe(() => concluirAtendimento(a));
  if ($('#lembrete', s)) $('#lembrete', s).onclick = safe(async () => {
    await DB.x('UPDATE agendamentos SET lembrete_em=agora_local() WHERE id=?', [id]);
    closeAll(); refresh();
    abrirWhats(a.telefone, msgAgendamento('lembrete', a));
  });
  $('#editar', s).onclick = safe(() => { closeSheet(); return formAgendamento(a); });
  $('#cliente', s).onclick = safe(() => { closeSheet(); return detalheCliente(a.cliente_id); });
  if ($('#faltou', s)) $('#faltou', s).onclick = safe(async () => { await setStatus('faltou'); toast('Marcado como falta'); });
  if ($('#cancelar', s)) $('#cancelar', s).onclick = safe(async () => {
    if (!(await confirmBox('Cancelar este agendamento?', 'Cancelar agendamento'))) return;
    await setStatus('cancelado'); toast('Agendamento cancelado');
    if (a.telefone && (await confirmBox(`Avisar ${a.cliente.split(' ')[0]} do cancelamento no WhatsApp?`, 'Abrir WhatsApp', false))) {
      abrirWhats(a.telefone, msgAgendamento('cancelado', a));
    }
  });
  if ($('#reabrir', s)) $('#reabrir', s).onclick = safe(async () => {
    if (lanc && !(await confirmBox('O recebimento lançado no caixa para este atendimento será removido. Continuar?', 'Continuar'))) return;
    await DB.batch([...desfazer(), { sql: "UPDATE agendamentos SET status='agendado', cliente_pacote_id=NULL, brinde=0 WHERE id=?", params: [id] }]);
    closeAll(); refresh();
  });
  if ($('#excluir', s)) $('#excluir', s).onclick = safe(async () => {
    if (!(await confirmBox('Excluir este agendamento definitivamente?', 'Excluir'))) return;
    const cmds = [];
    if (lanc && (await confirmBox('Excluir também o recebimento no caixa?', 'Excluir recebimento'))) cmds.push(...desfazer());
    else if (a.cliente_pacote_id) cmds.push(desfazer()[1]);
    cmds.push(cmdExclusao('agendamentos', id, `Agendamento: ${a.cliente} · ${fmtDate(a.data)} ${a.hora}${a.servico ? ' · ' + a.servico : ''}`, a));
    cmds.push({ sql: 'DELETE FROM agendamentos WHERE id=?', params: [id] });
    await DB.batch(cmds);
    closeAll(); refresh(); toast('Excluído');
  });
}

/* ---- Pacotes e fidelidade do cliente ---- */
function pacotesAtivos(clienteId) {
  return DB.q('SELECT * FROM clientes_pacotes WHERE cliente_id=? AND usados<quantidade AND fim>=? ORDER BY fim', [clienteId, today()]);
}
async function fidelidade(clienteId) {
  if (cfg('fid_ativo', '0') !== '1') return null;
  const meta = Math.max(1, Number(cfg('fid_meta', '10')) || 10);
  const r = await DB.one(`SELECT
      COALESCE(SUM(CASE WHEN brinde=0 AND cliente_pacote_id IS NULL THEN 1 ELSE 0 END),0) AS pagos,
      COALESCE(SUM(CASE WHEN brinde=1 THEN 1 ELSE 0 END),0) AS brindes
    FROM agendamentos WHERE cliente_id=? AND status='concluido'`, [clienteId]);
  return { meta, progresso: r.pagos % meta, disponiveis: Math.floor(r.pagos / meta) - r.brindes };
}

/* "Atender agora": cliente que chegou sem horário marcado. */
async function formEncaixe() {
  const [clientes, servicos, profs] = await Promise.all([
    DB.q('SELECT id, nome, telefone FROM clientes ORDER BY lower(nome)'),
    DB.q('SELECT * FROM servicos WHERE ativo = 1 ORDER BY nome'),
    DB.q('SELECT id, nome, tempo_atendimento FROM usuarios WHERE ativo = 1 ORDER BY nome'),
  ]);
  const s = sheet(`
    <h3>Atender agora</h3>
    <p class="hint" style="margin-top:-8px">Para quem chegou sem horário: registra o atendimento de hoje e o pagamento de uma vez.</p>
    <div class="field"><label>Cliente</label>
      <select id="cli"><option value="novo">+ Cliente novo</option>${clientes.map((c) => opt(c.id, c.nome + (c.telefone ? ' · ' + fmtPhone(c.telefone) : ''), '')).join('')}</select>
    </div>
    <div id="novo" class="row2">
      <div class="field"><label>Nome</label><input id="nome" autocapitalize="words"></div>
      <div class="field"><label>Telefone</label><input id="tel" type="tel" inputmode="tel"></div>
    </div>
    <div class="field"><label>Serviço</label><select id="srv">${servicos.map((x) => opt(x.id, `${x.nome} — ${money(x.preco)}`, '')).join('')}</select></div>
    <div class="field"><label>Profissional</label><select id="prof">${profs.map((p) => opt(p.id, p.nome, S.user.id)).join('')}</select></div>
    <div class="err" id="err"></div>
    <div class="btns two"><button class="btn ghost" id="cancel">Cancelar</button><button class="btn green" id="ok">Ir para pagamento</button></div>`);
  const toggle = () => ($('#novo', s).style.display = $('#cli', s).value === 'novo' ? '' : 'none');
  $('#cli', s).onchange = toggle;
  toggle();
  $('#cancel', s).onclick = closeSheet;
  $('#ok', s).onclick = safe(async () => {
    let clienteId = $('#cli', s).value;
    let nome;
    let telefone;
    if (clienteId === 'novo') {
      nome = $('#nome', s).value.trim();
      telefone = fmtPhone($('#tel', s).value.trim());
      if (!nome) return ($('#err', s).textContent = 'Informe o nome do cliente.');
      clienteId = (await DB.x('INSERT INTO clientes (nome, telefone) VALUES (?,?)', [nome, telefone])).lastId;
    } else {
      const c = clientes.find((x) => x.id === Number(clienteId));
      nome = c.nome; telefone = c.telefone; clienteId = c.id;
    }
    const srv = servicos.find((x) => x.id === Number($('#srv', s).value));
    const prof = profs.find((p) => p.id === Number($('#prof', s).value));
    closeSheet();
    await concluirAtendimento({
      id: null, cliente_id: clienteId, cliente: nome, telefone,
      servico_id: srv ? srv.id : null, servico: srv ? srv.nome : null,
      profissional_id: prof ? prof.id : null, profissional: prof ? prof.nome : null,
      data: today(), hora: agora(), duracao: duracaoDe(prof, srv), valor: srv ? srv.preco : 0,
    });
  });
}

/* Concluir o atendimento: pagamento normal, uso de pacote ou cortesia da fidelidade,
   e venda de produtos na mesma conta. Com a.id vazio, cria o atendimento (encaixe). */
async function concluirAtendimento(a) {
  const [pacotes, fid, produtos] = await Promise.all([
    pacotesAtivos(a.cliente_id),
    fidelidade(a.cliente_id),
    DB.q('SELECT * FROM produtos WHERE ativo=1 AND estoque>0 ORDER BY lower(nome)'),
  ]);
  const pacote = pacotes.find((p) => !p.servico_id || p.servico_id === a.servico_id);
  const modos = [['pago', 'Pagar'],
    ...(pacote ? [['pacote', `Pacote (${pacote.quantidade - pacote.usados} rest.)`]] : []),
    ...(fid && fid.disponiveis > 0 ? [['brinde', 'Cortesia']] : [])];
  const s = sheet(`
    <h3>Receber de ${esc(a.cliente.split(' ')[0])}</h3>
    ${modos.length > 1 ? `<div class="seg" id="modo">${modos.map(([k, l]) => `<button data-m="${k}">${l}</button>`).join('')}</div>` : ''}
    <p class="hint" id="modo-info"></p>
    <div id="pago-box" class="field"><label>Valor do serviço (R$)</label><input id="valor" inputmode="decimal" value="${esc(moneyIn(a.valor))}"></div>
    ${produtos.length ? `
      <div class="field"><label>Produtos vendidos junto</label><div id="itens"></div>
        <button class="btn ghost small" id="add-prod" type="button">+ Adicionar produto</button></div>` : ''}
    <div class="field" id="forma-box"><label>Forma de pagamento</label>
      <div class="seg" id="forma">${FORMAS.map((f, i) => `<button data-f="${f}" class="${i === 1 ? 'on' : ''}">${f}</button>`).join('')}</div>
    </div>
    <div class="total" id="total"></div>
    <div class="err" id="err"></div>
    <div class="btns two">
      <button class="btn ghost" id="cancel">Voltar</button>
      <button class="btn green" id="ok">Confirmar</button>
    </div>`);
  let modo = 'pago';
  let forma = FORMAS[1];
  const itens = [];
  const valorServico = () => (modo === 'pago' ? parseMoney($('#valor', s).value) : 0);
  const totalProdutos = () => itens.reduce((t, i) => t + i.qtd * i.preco, 0);
  const atualizar = () => {
    s.querySelectorAll('[data-m]').forEach((b) => b.classList.toggle('on', b.dataset.m === modo));
    $('#pago-box', s).style.display = modo === 'pago' ? '' : 'none';
    $('#modo-info', s).textContent = modo === 'pacote' ? `Usa 1 de ${pacote.quantidade} do pacote “${pacote.nome}” (válido até ${fmtDate(pacote.fim)}).`
      : modo === 'brinde' ? `Cortesia do cartão fidelidade (${fid.disponiveis} disponível).`
      : fid ? `Fidelidade: ${fid.progresso} de ${fid.meta} para ganhar uma cortesia.` : '';
    const total = (valorServico() || 0) + totalProdutos();
    $('#forma-box', s).style.display = total > 0 ? '' : 'none';
    $('#total', s).innerHTML = `Total a receber: <b>${money(total)}</b>`;
  };
  const drawItens = () => {
    const box = $('#itens', s);
    if (!box) return;
    box.innerHTML = itens.map((it, i) => `
      <div class="prod-row">
        <select data-i="${i}" data-k="prod">${produtos.map((p) => opt(p.id, `${p.nome} · ${money(p.preco_venda)} · ${p.estoque} un.`, it.id)).join('')}</select>
        <input data-i="${i}" data-k="qtd" type="number" min="1" step="1" value="${it.qtd}">
        <button type="button" class="icon-btn danger" data-rm="${i}" aria-label="Remover">${ICON.trash}</button>
      </div>`).join('');
    box.querySelectorAll('[data-k=prod]').forEach((el) => (el.onchange = () => {
      const p = produtos.find((x) => x.id === Number(el.value));
      Object.assign(itens[el.dataset.i], { id: p.id, nome: p.nome, preco: p.preco_venda, custo: p.preco_compra, estoque: p.estoque });
      atualizar();
    }));
    box.querySelectorAll('[data-k=qtd]').forEach((el) => (el.oninput = () => { itens[el.dataset.i].qtd = Number(el.value) || 0; atualizar(); }));
    box.querySelectorAll('[data-rm]').forEach((el) => (el.onclick = () => { itens.splice(Number(el.dataset.rm), 1); drawItens(); atualizar(); }));
  };
  if ($('#add-prod', s)) $('#add-prod', s).onclick = () => {
    const p = produtos[0];
    itens.push({ id: p.id, nome: p.nome, preco: p.preco_venda, custo: p.preco_compra, estoque: p.estoque, qtd: 1 });
    drawItens(); atualizar();
  };
  s.querySelectorAll('[data-m]').forEach((b) => (b.onclick = () => { modo = b.dataset.m; atualizar(); }));
  s.querySelectorAll('[data-f]').forEach((b) => (b.onclick = () => {
    forma = b.dataset.f;
    s.querySelectorAll('[data-f]').forEach((x) => x.classList.toggle('on', x === b));
  }));
  $('#valor', s).oninput = atualizar;
  atualizar();

  $('#cancel', s).onclick = closeSheet;
  $('#ok', s).onclick = safe(async () => {
    const err = (m) => ($('#err', s).textContent = m);
    const valor = valorServico();
    if (isNaN(valor) || valor < 0) return err('Valor inválido.');
    for (const it of itens) {
      if (!Number.isInteger(it.qtd) || it.qtd < 1) return err(`Quantidade inválida para ${it.nome}.`);
      const somado = itens.filter((x) => x.id === it.id).reduce((t, x) => t + x.qtd, 0);
      if (somado > it.estoque) return err(`Estoque insuficiente de ${it.nome}. Disponível: ${it.estoque}.`);
    }
    // No encaixe o atendimento é criado no mesmo batch; currval devolve o id que esta transação acabou de gerar.
    const agRef = a.id ? '?' : "currval(pg_get_serial_sequence('agendamentos','id'))";
    const agParam = a.id ? [a.id] : [];
    const valorAg = modo === 'pacote' ? round2(pacote.preco / pacote.quantidade) : valor;
    const cmds = [];
    if (!a.id) {
      cmds.push({ sql: `INSERT INTO agendamentos (cliente_id, servico_id, profissional_id, data, hora, duracao, valor, status, observacoes)
        VALUES (?,?,?,?,?,?,?,'agendado','Atendimento sem horário marcado')`,
        params: [a.cliente_id, a.servico_id, a.profissional_id, a.data, a.hora, a.duracao, valorAg] });
    }
    if (modo === 'pacote') {
      cmds.push({ sql: 'UPDATE clientes_pacotes SET usados=usados+1 WHERE id=? AND usados<quantidade', params: [pacote.id],
        requireChanges: true, error: 'Este pacote não tem mais usos disponíveis.' });
      cmds.push({ sql: `UPDATE agendamentos SET status='concluido', valor=?, cliente_pacote_id=? WHERE id=${agRef}`, params: [valorAg, pacote.id, ...agParam] });
    } else if (modo === 'brinde') {
      cmds.push({ sql: `UPDATE agendamentos SET status='concluido', valor=0, brinde=1 WHERE id=${agRef}`, params: agParam });
    } else {
      cmds.push({ sql: `UPDATE agendamentos SET status='concluido', valor=? WHERE id=${agRef}`, params: [valor, ...agParam] });
      if (valor > 0) {
        cmds.push({ sql: `INSERT INTO lancamentos (tipo, descricao, categoria, valor, taxa, data, forma_pagamento, agendamento_id, usuario_id)
          VALUES ('entrada', ?, 'Serviço', ?, ?, ?, ?, ${agRef}, ?)`,
          params: [`${a.servico || 'Atendimento'} — ${a.cliente}`, valor, taxaDe(forma, valor), today(), forma, ...agParam, S.user.id] });
      }
    }
    itens.forEach((it) => {
      const total = round2(it.preco * it.qtd);
      cmds.push(
        { sql: "INSERT INTO lancamentos (tipo, descricao, categoria, valor, taxa, data, forma_pagamento, usuario_id) VALUES ('entrada', ?, 'Produto', ?, ?, ?, ?, ?)",
          params: [`Venda: ${it.nome} (${it.qtd} un.) — ${a.cliente}`, total, taxaDe(forma, total), today(), forma, S.user.id] },
        { sql: `INSERT INTO vendas_produtos (lancamento_id, produto_id, produto_nome, quantidade, custo_unitario, preco_unitario) VALUES (currval(pg_get_serial_sequence('lancamentos','id')),?,?,?,?,?)`,
          params: [it.id, it.nome, it.qtd, it.custo, it.preco] },
        { sql: 'UPDATE produtos SET estoque=estoque-? WHERE id=? AND estoque>=?', params: [it.qtd, it.id, it.qtd],
          requireChanges: true, error: `Estoque insuficiente de ${it.nome}.` });
    });
    await DB.batch(cmds);
    closeAll(); refresh();
    const total = valor + totalProdutos();
    toast(modo === 'pacote' ? 'Atendimento lançado no pacote' : modo === 'brinde' ? 'Cortesia registrada' : `Recebido ${money(total)} (${forma})`);
  });
}

/* ======================= CLIENTES ======================= */
async function viewClientes(el) {
  const total = await DB.val('SELECT COUNT(*) FROM clientes');
  $('#subtitle').textContent = `${total} cadastrado(s)`;
  el.innerHTML = `
    <input class="search" id="busca" type="search" placeholder="Buscar por nome ou telefone" value="${esc(S.clienteBusca)}">
    <button class="btn ghost" id="sumidos" style="margin-bottom:12px">Clientes sumidos</button>
    <div id="lista"></div>`;
  const lista = $('#lista', el);
  const draw = serial(async () => {
    const termo = S.clienteBusca.trim();
    const dig = digits(termo);
    const rows = await DB.q(`
      SELECT c.*, (SELECT MAX(data) FROM agendamentos WHERE cliente_id=c.id AND status='concluido') AS ultima
      FROM clientes c
      WHERE ? = '' OR c.nome ILIKE ? OR (? <> '' AND replace(replace(replace(replace(replace(c.telefone,'(',''),')',''),'-',''),' ',''),'+','') LIKE ?)
      ORDER BY lower(c.nome) LIMIT 300`, [termo, `%${termo}%`, dig, `%${dig}%`]);
    lista.innerHTML = rows.length ? `<div class="list">${rows.map((c) => `
      <div class="item" role="button" data-cli="${c.id}">
        <div class="avatar">${esc(initials(c.nome))}</div>
        <div class="main">
          <div class="t">${esc(c.nome)}</div>
          <div class="s">${esc(fmtPhone(c.telefone) || 'Sem telefone')}${c.ultima ? ' · último: ' + fmtDate(c.ultima) : ''}</div>
        </div>
        <button class="icon-btn" data-edit="${c.id}" aria-label="Editar">${ICON.edit}</button>
        ${isAdmin() ? `<button class="icon-btn danger" data-del="${c.id}" aria-label="Excluir">${ICON.trash}</button>` : ''}
      </div>`).join('')}</div>` : `<div class="card empty">${termo ? 'Nenhum cliente encontrado.' : 'Nenhum cliente cadastrado ainda.<br>Toque no + para cadastrar.'}</div>`;
    const porId = (id) => rows.find((c) => c.id === Number(id));
    lista.querySelectorAll('[data-cli]').forEach((b) => (b.onclick = safe(() => detalheCliente(Number(b.dataset.cli)))));
    lista.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = safe((e) => { e.stopPropagation(); formCliente(porId(b.dataset.edit)); })));
    lista.querySelectorAll('[data-del]').forEach((b) => (b.onclick = safe((e) => { e.stopPropagation(); return excluirCliente(porId(b.dataset.del)); })));
  });
  $('#busca', el).oninput = (e) => { S.clienteBusca = e.target.value; draw(); };
  $('#sumidos', el).onclick = safe(() => clientesSumidos());
  await draw();
}

function formCliente(c = null, after = null) {
  const x = c || { nome: '', telefone: '', nascimento: '', observacoes: '' };
  const s = sheet(`
    <h3>${c ? 'Editar cliente' : 'Novo cliente'}</h3>
    <div class="field"><label>Nome</label><input id="nome" value="${esc(x.nome)}" autocapitalize="words"></div>
    <div class="field"><label>Telefone / WhatsApp</label><input id="tel" type="tel" inputmode="tel" placeholder="(17) 99999-9999" value="${esc(fmtPhone(x.telefone))}"></div>
    ${campoNascimento('Data de nascimento', x.nascimento)}
    <div class="field"><label>Observações (preferências, alergias…)</label><textarea id="obs">${esc(x.observacoes || '')}</textarea></div>
    <div class="err" id="err"></div>
    <div class="btns two">
      <button class="btn ghost" id="cancel">Cancelar</button>
      <button class="btn" id="save">Salvar</button>
    </div>`);
  $('#cancel', s).onclick = closeSheet;
  $('#save', s).onclick = safe(async () => {
    const nome = $('#nome', s).value.trim();
    if (!nome) return ($('#err', s).textContent = 'Informe o nome.');
    const tel = fmtPhone($('#tel', s).value.trim());
    let nasc;
    try { nasc = lerNascimento(s); } catch (e) { return ($('#err', s).textContent = e.message); }
    const obs = $('#obs', s).value.trim();
    let id = c && c.id;
    if (c) {
      await DB.x('UPDATE clientes SET nome=?, telefone=?, nascimento=?, observacoes=? WHERE id=?', [nome, tel, nasc, obs, c.id]);
      toast('Cliente atualizado');
    } else {
      id = (await DB.x('INSERT INTO clientes (nome, telefone, nascimento, observacoes) VALUES (?,?,?,?)', [nome, tel, nasc, obs])).lastId;
      toast('Cliente cadastrado');
    }
    closeAll();
    refresh();
    if (after) await after(id);
  });
  setTimeout(() => $('#nome', s).focus(), 80);
}

async function detalheCliente(id) {
  const c = await DB.one('SELECT * FROM clientes WHERE id=?', [id]);
  if (!c) return;
  const [hist, st, pacotes, temPacotes, fid] = await Promise.all([
    DB.q(`${SQL_AG} WHERE a.cliente_id=? ORDER BY a.data DESC, a.hora DESC LIMIT 15`, [id]),
    DB.one(`SELECT COUNT(*) AS n, COALESCE(SUM(valor),0) AS total FROM agendamentos WHERE cliente_id=? AND status='concluido'`, [id]),
    DB.q('SELECT * FROM clientes_pacotes WHERE cliente_id=? ORDER BY fim DESC LIMIT 5', [id]),
    DB.val('SELECT COUNT(*) FROM pacotes WHERE ativo=1').then((n) => n > 0),
    fidelidade(id),
  ]);
  const aniversario = c.nascimento && c.nascimento.slice(5, 7) === today().slice(5, 7);

  const s = sheet(`
    <h3>${esc(c.nome)}</h3>
    <div class="kv"><span>Telefone</span><span>${esc(fmtPhone(c.telefone) || '—')}</span></div>
    ${c.nascimento ? `<div class="kv"><span>Nascimento</span><span>${fmtDate(c.nascimento)}${aniversario ? ' 🎂' : ''}</span></div>` : ''}
    <div class="kv"><span>Atendimentos</span><span>${st.n}</span></div>
    <div class="kv"><span>Total gasto</span><span>${money(st.total)}</span></div>
    ${c.observacoes ? `<div class="kv"><span>Obs.</span><span>${esc(c.observacoes)}</span></div>` : ''}
    ${fid ? `
      <div class="card fid">
        <div class="t">Cartão fidelidade · ${fid.progresso} de ${fid.meta}</div>
        <div class="stamps">${Array.from({ length: fid.meta }, (_, i) => `<i class="${i < fid.progresso ? 'on' : ''}"></i>`).join('')}</div>
        ${fid.disponiveis > 0 ? `<div class="hint ok">🎁 ${fid.disponiveis} cortesia(s) disponível(is): use ao concluir o próximo atendimento.</div>` : ''}
      </div>` : ''}
    <div class="btns" style="margin-top:16px">
      <button class="btn" id="agendar">Agendar horário</button>
      ${c.telefone ? `<div class="btns two">
        <button class="btn ghost" id="wa">WhatsApp</button>
        <a class="btn ghost" style="display:block;text-align:center;text-decoration:none" href="tel:${esc(digits(c.telefone))}">Ligar</a>
      </div>` : ''}
      ${aniversario && c.telefone ? '<button class="btn ghost" id="parabens">Enviar parabéns 🎉</button>' : ''}
      <div class="btns ${isAdmin() ? 'two' : ''}">
        <button class="btn ghost" id="editar">Editar</button>
        ${isAdmin() ? '<button class="btn danger" id="excluir">Excluir</button>' : ''}
      </div>
    </div>
    ${temPacotes || pacotes.length ? `
      <div class="section-title">Pacotes ${temPacotes ? '<button class="link" id="vender">+ Vender pacote</button>' : ''}</div>
      ${pacotes.length ? `<div class="list">${pacotes.map((p) => {
        const ativo = p.usados < p.quantidade && p.fim >= today();
        return `<div class="item"><div class="main"><div class="t">${esc(p.nome)}</div>
          <div class="s">${p.usados} de ${p.quantidade} usados · ${ativo ? 'válido até' : p.usados >= p.quantidade ? 'concluído em' : 'venceu em'} ${fmtDate(p.fim)}</div></div>
          <span class="badge ${ativo ? 'b-concluido' : 'b-faltou'}">${ativo ? `${p.quantidade - p.usados} rest.` : 'encerrado'}</span></div>`;
      }).join('')}</div>` : '<div class="empty">Nenhum pacote.</div>'}` : ''}
    <div class="section-title">Histórico</div>
    ${hist.length ? `<div class="list">${hist.map((a) => agItem(a, true)).join('')}</div>` : '<div class="empty">Sem atendimentos ainda.</div>'}
  `);
  $('#agendar', s).onclick = safe(() => { closeSheet(); return formAgendamento(null, { cliente_id: id }); });
  if ($('#wa', s)) $('#wa', s).onclick = () => abrirWhats(c.telefone, '');
  if ($('#parabens', s)) $('#parabens', s).onclick = safe(async () => {
    await DB.x('UPDATE clientes SET parabens_ano=? WHERE id=?', [today().slice(0, 4), id]);
    abrirWhats(c.telefone, mensagem('aniversario', { nome: c.nome }));
  });
  if ($('#vender', s)) $('#vender', s).onclick = safe(() => venderPacote(c));
  $('#editar', s).onclick = safe(() => { closeSheet(); formCliente(c); });
  if ($('#excluir', s)) $('#excluir', s).onclick = safe(() => excluirCliente(c));
  bindAgItems(s);
}

async function excluirCliente(c) {
  if (!isAdmin()) return toast('Só o administrador pode excluir clientes', true);
  if (!(await confirmBox(`Excluir ${c.nome}? Os agendamentos dele também serão apagados (os lançamentos do caixa ficam).`, 'Excluir'))) return;
  const [dados, nAg] = await Promise.all([
    DB.one('SELECT * FROM clientes WHERE id=?', [c.id]),
    DB.val('SELECT COUNT(*) FROM agendamentos WHERE cliente_id=?', [c.id]),
  ]);
  await DB.batch([
    cmdExclusao('clientes', c.id, `Cliente: ${c.nome}${nAg ? ` (com ${nAg} agendamento(s))` : ''}`, dados),
    { sql: 'DELETE FROM clientes WHERE id=?', params: [c.id] },
  ]);
  closeAll(); refresh(); toast('Cliente excluído');
}

/* Quem não aparece há N dias e não tem horário marcado. */
function clientesSumidos() {
  const s = sheet(`
    <h3>Clientes sumidos</h3>
    <p class="hint" style="margin-top:-8px">Sem atendimento há mais tempo que o período escolhido e sem horário marcado.</p>
    <div class="seg" id="dias">${[30, 45, 60, 90].map((d) => `<button data-d="${d}">${d} dias</button>`).join('')}</div>
    <div id="lista"></div>`);
  const draw = serial(async () => {
    s.querySelectorAll('[data-d]').forEach((b) => b.classList.toggle('on', Number(b.dataset.d) === S.sumidosDias));
    const hoje = today();
    const rows = await DB.q(`SELECT c.id, c.nome, c.telefone, c.contato_sumido_em, MAX(a.data) AS ultima
      FROM clientes c JOIN agendamentos a ON a.cliente_id=c.id AND a.status='concluido'
      WHERE NOT EXISTS (SELECT 1 FROM agendamentos f WHERE f.cliente_id=c.id AND f.status='agendado' AND f.data>=?)
      GROUP BY c.id HAVING MAX(a.data) <= ?
      ORDER BY (c.contato_sumido_em IS NOT NULL AND c.contato_sumido_em >= MAX(a.data)), MAX(a.data) DESC`, [hoje, addDays(hoje, -S.sumidosDias)]);
    $('#lista', s).innerHTML = rows.length ? `<div class="list">${rows.map((c) => {
      const contatado = c.contato_sumido_em && c.contato_sumido_em >= c.ultima;
      return `
      <div class="item" role="button" data-cli="${c.id}">
        <div class="avatar">${esc(initials(c.nome))}</div>
        <div class="main"><div class="t">${esc(c.nome)}</div>
          <div class="s">Última visita ${esc(fmtDate(c.ultima))} · há ${diasEntre(c.ultima, hoje)} dias</div>
          ${contatado ? `<div class="s ok">✓ chamado em ${esc(fmtDate(c.contato_sumido_em))}</div>` : ''}</div>
        ${c.telefone ? `<button class="icon-btn wa" data-wa="${c.id}" aria-label="Chamar no WhatsApp">${ICON.chat}</button>` : ''}
      </div>`;
    }).join('')}</div>` : '<div class="card empty">Nenhum cliente sumido neste período. 👏</div>';
    s.querySelectorAll('[data-cli]').forEach((b) => (b.onclick = safe(() => detalheCliente(Number(b.dataset.cli)))));
    s.querySelectorAll('[data-wa]').forEach((b) => (b.onclick = safe(async (e) => {
      e.stopPropagation();
      const c = rows.find((x) => x.id === Number(b.dataset.wa));
      await DB.x('UPDATE clientes SET contato_sumido_em=? WHERE id=?', [today(), c.id]);
      draw();
      abrirWhats(c.telefone, mensagem('sumido', { nome: c.nome }));
    })));
  });
  s.querySelectorAll('[data-d]').forEach((b) => (b.onclick = () => { S.sumidosDias = Number(b.dataset.d); draw(); }));
  return draw();
}

async function venderPacote(c) {
  const pacotes = await DB.q(`SELECT p.*, s.nome AS servico FROM pacotes p LEFT JOIN servicos s ON s.id=p.servico_id
    WHERE p.ativo=1 ORDER BY p.nome`);
  if (!pacotes.length) return toast('Cadastre um pacote em Mais → Pacotes e planos', true);
  const s = sheet(`
    <h3>Vender pacote para ${esc(c.nome.split(' ')[0])}</h3>
    <div class="field"><label>Pacote</label><select id="pac">${pacotes.map((p) => opt(p.id, `${p.nome} — ${money(p.preco)}`, '')).join('')}</select></div>
    <p class="hint" id="info"></p>
    <div class="row2">
      <div class="field"><label>Início</label><input id="ini" type="date" value="${today()}"></div>
      <div class="field"><label>Forma de pagamento</label><select id="forma">${FORMAS.map((f) => opt(f, f, 'Pix')).join('')}</select></div>
    </div>
    <div class="err" id="err"></div>
    <div class="btns two"><button class="btn ghost" id="cancel">Cancelar</button><button class="btn green" id="ok">Confirmar venda</button></div>`);
  const sel = () => pacotes.find((p) => p.id === Number($('#pac', s).value));
  const info = () => {
    const p = sel();
    const ini = $('#ini', s).value || today();
    $('#info', s).textContent = `${p.quantidade}× ${p.servico || 'qualquer serviço'} · ${money(p.preco / p.quantidade)} por atendimento · válido até ${fmtDate(addDays(ini, p.validade_dias - 1))}`;
  };
  $('#pac', s).onchange = info;
  $('#ini', s).onchange = info;
  info();
  $('#cancel', s).onclick = closeSheet;
  $('#ok', s).onclick = safe(async () => {
    const p = sel();
    const ini = $('#ini', s).value;
    if (!ini) return ($('#err', s).textContent = 'Informe a data de início.');
    const forma = $('#forma', s).value;
    await DB.batch([
      { sql: "INSERT INTO lancamentos (tipo, descricao, categoria, valor, taxa, data, forma_pagamento, usuario_id) VALUES ('entrada', ?, 'Pacote', ?, ?, ?, ?, ?)",
        params: [`Pacote: ${p.nome} — ${c.nome}`, p.preco, taxaDe(forma, p.preco), today(), forma, S.user.id] },
      { sql: `INSERT INTO clientes_pacotes (cliente_id, pacote_id, nome, servico_id, quantidade, preco, inicio, fim, lancamento_id)
        VALUES (?,?,?,?,?,?,?,?,currval(pg_get_serial_sequence('lancamentos','id')))`,
        params: [c.id, p.id, p.nome, p.servico_id, p.quantidade, p.preco, ini, addDays(ini, p.validade_dias - 1)] },
    ]);
    closeAll(); refresh(); toast(`Pacote vendido: ${money(p.preco)}`);
    await detalheCliente(c.id);
  });
}

/* ======================= CAIXA (FINANCEIRO) ======================= */
async function viewCaixa(el) {
  const mk = S.finMonth;
  const periodo = dashboardRange(S.dashboardPeriod);
  const [dashboard, produtosDashboard, tot, produtosMes, porForma, porProf, porCat, lancs] = await Promise.all([
    DB.one(`SELECT
      COALESCE(SUM(CASE WHEN tipo='entrada' THEN valor ELSE 0 END),0) AS ent,
      COALESCE(SUM(CASE WHEN tipo='entrada' THEN taxa ELSE 0 END),0) AS taxas,
      COALESCE(SUM(CASE WHEN tipo='saida' AND (categoria IS NULL OR categoria<>'Estoque') THEN valor ELSE 0 END),0) AS despesas,
      COALESCE(SUM(CASE WHEN tipo='saida' THEN valor ELSE 0 END),0) AS sai
    FROM lancamentos WHERE data>=? AND data<?`, [periodo.inicio, periodo.fim]),
    DB.one(`SELECT
      COALESCE(SUM(v.quantidade*v.preco_unitario),0) AS receita,
      COALESCE(SUM(v.quantidade*v.custo_unitario),0) AS custo
    FROM vendas_produtos v JOIN lancamentos l ON l.id=v.lancamento_id
    WHERE l.data>=? AND l.data<?`, [periodo.inicio, periodo.fim]),
    DB.one(`SELECT
      COALESCE(SUM(CASE WHEN tipo='entrada' THEN valor END),0) AS ent,
      COALESCE(SUM(CASE WHEN tipo='entrada' THEN taxa END),0) AS taxas,
      COALESCE(SUM(CASE WHEN tipo='saida' THEN valor END),0) AS sai
    FROM lancamentos WHERE substr(data,1,7)=?`, [mk]),
    DB.val(`SELECT COALESCE(SUM(v.quantidade*(v.preco_unitario-v.custo_unitario)),0)
    FROM vendas_produtos v JOIN lancamentos l ON l.id=v.lancamento_id
    WHERE substr(l.data,1,7)=?`, [mk]),
    DB.q(`SELECT COALESCE(forma_pagamento,'—') AS k, SUM(valor) AS v FROM lancamentos
    WHERE tipo='entrada' AND substr(data,1,7)=? GROUP BY k ORDER BY v DESC`, [mk]),
    DB.q(`SELECT COALESCE(u.nome,'Sem profissional') AS k, COUNT(*) AS n, SUM(l.valor) AS v
    FROM lancamentos l JOIN agendamentos a ON a.id=l.agendamento_id LEFT JOIN usuarios u ON u.id=a.profissional_id
    WHERE l.tipo='entrada' AND substr(l.data,1,7)=? GROUP BY k ORDER BY v DESC`, [mk]),
    DB.q(`SELECT COALESCE(categoria,'Outros') AS k, SUM(valor) AS v FROM lancamentos
    WHERE tipo='saida' AND substr(data,1,7)=? GROUP BY k ORDER BY v DESC`, [mk]),
    DB.q(`SELECT * FROM lancamentos WHERE substr(data,1,7)=? ORDER BY data DESC, id DESC`, [mk]),
  ]);
  const lucroProdutos = produtosDashboard.receita - produtosDashboard.custo;
  const resultado = dashboard.ent - dashboard.taxas - dashboard.despesas - produtosDashboard.custo;
  const fluxo = dashboard.ent - dashboard.taxas - dashboard.sai;
  const periodos = [
    ['day', 'Dia'], ['week', 'Semana'], ['month', 'Mês'], ['year', 'Ano'],
  ];

  const saldo = tot.ent - tot.taxas - tot.sai;
  let lastDate = '';
  const lista = lancs.map((l) => {
    const head = l.data !== lastDate ? `<div class="item" style="background:var(--surface-2);padding:6px 14px"><span class="s">${esc(fmtDay(l.data))}</span></div>` : '';
    lastDate = l.data;
    return head + lancItem(l);
  }).join('');

  el.innerHTML = `
    <div class="section-title" style="margin-top:8px">Dashboard · ${esc(periodo.rotulo)}</div>
    <div class="seg" id="dashperiod">${periodos.map(([key, label]) => `
      <button data-period="${key}" class="${S.dashboardPeriod === key ? 'on' : ''}">${label}</button>`).join('')}</div>
    <div class="stats">
      <div class="stat"><div class="lbl">Faturamento</div><div class="val pos">${money(dashboard.ent)}</div></div>
      <div class="stat"><div class="lbl">Despesas operacionais</div><div class="val neg">${money(dashboard.despesas)}</div></div>
      <div class="stat"><div class="lbl">Lucro dos produtos</div><div class="val pos">${money(lucroProdutos)}</div></div>
      <div class="stat"><div class="lbl">Taxas da maquininha</div><div class="val neg">${money(dashboard.taxas)}</div></div>
      <div class="stat"><div class="lbl">Compras de estoque</div><div class="val">${money(dashboard.sai - dashboard.despesas)}</div></div>
      <div class="stat"><div class="lbl">Fluxo de caixa</div><div class="val ${fluxo >= 0 ? 'pos' : 'neg'}">${money(fluxo)}</div></div>
      <div class="stat gold wide"><div class="lbl">Resultado (já descontadas taxas e custo dos produtos)</div><div class="val ${resultado >= 0 ? 'pos' : 'neg'}">${money(resultado)}</div></div>
    </div>
    <div class="section-title">Ferramentas</div>
    <div class="quick">
      <button id="t-rel">${ICON.report}Relatório</button>
      <button id="t-graf">${ICON.chart}Gráficos</button>
      <button id="t-com">${ICON.percent}Comissões</button>
      <button id="t-fech">${ICON.lock}Fechar caixa</button>
      <button id="t-fixas">${ICON.repeat}Despesas fixas</button>
      <button id="t-lanc">${ICON.money}Lançamento</button>
    </div>
    <div class="datebar" style="margin-top:22px">
      <button class="iconbtn" id="prev">${ICON.left}</button>
      <div class="d">${esc(monthLabel(mk))}<input type="month" id="mpick" value="${mk}"></div>
      <button class="iconbtn" id="next">${ICON.right}</button>
    </div>
    <div class="stats">
      <div class="stat"><div class="lbl">Entradas</div><div class="val pos">${money(tot.ent)}</div></div>
      <div class="stat"><div class="lbl">Saídas</div><div class="val neg">${money(tot.sai)}</div></div>
      <div class="stat"><div class="lbl">Taxas da maquininha</div><div class="val neg">${money(tot.taxas)}</div></div>
      <div class="stat"><div class="lbl">Lucro dos produtos</div><div class="val pos">${money(produtosMes)}</div></div>
      <div class="stat wide"><div class="lbl">Saldo do caixa (líquido)</div><div class="val ${saldo >= 0 ? 'pos' : 'neg'}">${money(saldo)}</div></div>
    </div>
    ${porForma.length ? `<div class="section-title">Entradas por forma de pagamento</div><div class="card">${barras(porForma, money)}</div>` : ''}
    ${porProf.length ? `<div class="section-title">Atendimentos por profissional</div><div class="card">${barras(porProf, (v, r) => `${money(v)}<br><span class="hint">${r.n} atend.</span>`)}</div>` : ''}
    ${porCat.length ? `<div class="section-title">Despesas por categoria</div><div class="card">${barras(porCat, money)}</div>` : ''}
    <div class="section-title">Lançamentos</div>
    ${lancs.length ? `<div class="list">${lista}</div>` : '<div class="card empty">Nenhum lançamento neste mês.</div>'}
  `;
  $('#subtitle').textContent = `${lancs.length} lançamento(s)`;
  $('#dashperiod').querySelectorAll('[data-period]').forEach((b) => (b.onclick = () => {
    S.dashboardPeriod = b.dataset.period;
    refresh();
  }));
  $('#prev').onclick = () => { S.finMonth = addMonths(mk, -1); refresh(); };
  $('#next').onclick = () => { S.finMonth = addMonths(mk, 1); refresh(); };
  $('#mpick').onchange = (e) => { if (e.target.value) { S.finMonth = e.target.value; refresh(); } };
  $('#t-rel').onclick = safe(() => relatorioFinanceiro());
  $('#t-graf').onclick = safe(() => telaGraficos());
  $('#t-com').onclick = safe(() => telaComissoes());
  $('#t-fech').onclick = safe(() => fechamentoCaixa());
  $('#t-fixas').onclick = safe(() => listaDespesasFixas());
  $('#t-lanc').onclick = safe(() => formLancamento());
  el.querySelectorAll('[data-l]').forEach((b) => (b.onclick = safe(() => abrirLancamento(Number(b.dataset.l)))));
}

/* Barras horizontais de uma série só (cor única), com o valor escrito ao lado. */
function barras(rows, fmt = money) {
  const max = Math.max(...rows.map((r) => r.v), 0);
  return `<div class="bars">${rows.map((r) => `
    <div class="row"><span class="n">${esc(r.k)}</span><span class="bar"><i style="width:${max && r.v ? Math.max(3, (r.v / max) * 100) : 0}%"></i></span><span class="v">${fmt(r.v, r)}</span></div>`).join('')}</div>`;
}

function lancItem(l, extra = '') {
  return `
    <button class="item" data-l="${l.id}">
      <div class="main">
        <div class="t">${esc(l.descricao)}</div>
        <div class="s">${esc([l.categoria, l.forma_pagamento, extra, l.taxa > 0 ? `taxa ${money(l.taxa)}` : ''].filter(Boolean).join(' · '))}</div>
      </div>
      <div class="right ${l.tipo === 'entrada' ? 'pos' : 'neg'}">${l.tipo === 'entrada' ? '+' : '−'} ${money(l.valor)}</div>
    </button>`;
}

/* Relatório de todos os lançamentos entre duas datas, com exportação para planilha */
function relatorioFinanceiro() {
  if (!S.relInicio) { S.relInicio = `${monthKey(today())}-01`; S.relFim = today(); S.relTipo = 'todos'; }
  const tipos = [['todos', 'Todos'], ['entrada', 'Entradas'], ['saida', 'Saídas']];
  const s = sheet(`
    <h3>Relatório de entradas e saídas</h3>
    <div class="row2">
      <div class="field"><label>Início</label><input id="ini" type="date" value="${S.relInicio}"></div>
      <div class="field"><label>Fim</label><input id="fim" type="date" value="${S.relFim}"></div>
    </div>
    <div class="seg" id="tipo">${tipos.map(([k, label]) => `<button data-t="${k}">${label}</button>`).join('')}</div>
    <div id="corpo"></div>`);

  let rows = [];
  const draw = serial(async () => {
    s.querySelectorAll('[data-t]').forEach((b) => b.classList.toggle('on', b.dataset.t === S.relTipo));
    const corpo = $('#corpo', s);
    if (!S.relInicio || !S.relFim || S.relInicio > S.relFim) {
      corpo.innerHTML = '<div class="err">A data de início precisa ser anterior ou igual à data de fim.</div>';
      return;
    }
    rows = await DB.q(`SELECT l.*, u.nome AS usuario FROM lancamentos l LEFT JOIN usuarios u ON u.id=l.usuario_id
      WHERE l.data>=? AND l.data<=? AND (?='todos' OR l.tipo=?) ORDER BY l.data, l.id`,
      [S.relInicio, S.relFim, S.relTipo, S.relTipo]);
    const ent = rows.filter((l) => l.tipo === 'entrada').reduce((t, l) => t + l.valor, 0);
    const taxas = rows.filter((l) => l.tipo === 'entrada').reduce((t, l) => t + l.taxa, 0);
    const sai = rows.filter((l) => l.tipo === 'saida').reduce((t, l) => t + l.valor, 0);
    let lastDate = '';
    const lista = rows.map((l) => {
      const head = l.data !== lastDate ? `<div class="item" style="background:var(--surface-2);padding:6px 14px"><span class="s">${esc(fmtDay(l.data))}</span></div>` : '';
      lastDate = l.data;
      return head + lancItem(l, l.usuario);
    }).join('');
    corpo.innerHTML = `
      <div class="stats">
        <div class="stat"><div class="lbl">Entradas</div><div class="val pos">${money(ent)}</div></div>
        <div class="stat"><div class="lbl">Saídas</div><div class="val neg">${money(sai)}</div></div>
        ${taxas > 0 ? `<div class="stat wide"><div class="lbl">Taxas da maquininha</div><div class="val neg">${money(taxas)}</div></div>` : ''}
        <div class="stat wide"><div class="lbl">Saldo do período · ${rows.length} lançamento(s)</div><div class="val ${ent - taxas - sai >= 0 ? 'pos' : 'neg'}">${money(ent - taxas - sai)}</div></div>
      </div>
      ${rows.length ? `<div class="btns two" style="margin:14px 0"><button class="btn ghost" id="csv">Salvar planilha</button><button class="btn" id="enviar">Enviar planilha</button></div><div class="list">${lista}</div>`
        : '<div class="card empty" style="margin-top:14px">Nenhum lançamento neste período.</div>'}`;
    corpo.querySelectorAll('[data-l]').forEach((b) => (b.onclick = safe(() => abrirLancamento(Number(b.dataset.l)))));
    if (rows.length) {
      $('#csv', corpo).onclick = safe(() => salvarRelatorioCsv(rows, false));
      $('#enviar', corpo).onclick = safe(() => salvarRelatorioCsv(rows, true));
    }
  });

  $('#ini', s).onchange = (e) => { S.relInicio = e.target.value; draw(); };
  $('#fim', s).onchange = (e) => { S.relFim = e.target.value; draw(); };
  s.querySelectorAll('[data-t]').forEach((b) => (b.onclick = () => { S.relTipo = b.dataset.t; draw(); }));
  return draw();
}

function salvarRelatorioCsv(rows, enviar) {
  // Ponto e vírgula e vírgula decimal: o Excel em português abre direto em colunas.
  const cel = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const num = (v) => Number(v).toFixed(2).replace('.', ',');
  const ent = rows.filter((l) => l.tipo === 'entrada').reduce((t, l) => t + l.valor, 0);
  const taxas = rows.reduce((t, l) => t + (l.taxa || 0), 0);
  const sai = rows.filter((l) => l.tipo === 'saida').reduce((t, l) => t + l.valor, 0);
  const linhas = [
    ['Data', 'Tipo', 'Descrição', 'Categoria', 'Forma de pagamento', 'Registrado por', 'Valor', 'Taxa maquininha'],
    ...rows.map((l) => [fmtDate(l.data), l.tipo === 'entrada' ? 'Entrada' : 'Saída', l.descricao, l.categoria,
      l.forma_pagamento, l.usuario, num(l.tipo === 'entrada' ? l.valor : -l.valor), num(l.taxa || 0)]),
    [],
    ['', '', 'Total de entradas', '', '', '', num(ent)],
    ['', '', 'Total de saídas', '', '', '', num(-sai)],
    ['', '', 'Taxas da maquininha', '', '', '', num(-taxas)],
    ['', '', 'Saldo do período', '', '', '', num(ent - taxas - sai)],
  ];
  const csv = '﻿' + linhas.map((r) => r.map(cel).join(';')).join('\r\n');
  const nome = `relatorio-${S.relInicio}-a-${S.relFim}-${Date.now().toString().slice(-5)}.csv`;
  return arquivo(nome, csv, enviar);
}

/* Baixa o arquivo; com enviar=true abre o "Compartilhar" do celular quando o navegador permite. */
async function arquivo(nome, conteudo, enviar) {
  const tipo = nome.endsWith('.csv') ? 'text/csv' : 'application/json';
  const blob = new Blob([conteudo], { type: `${tipo};charset=utf-8` });
  if (enviar && navigator.canShare) {
    const f = new File([blob], nome, { type: tipo });
    if (navigator.canShare({ files: [f] })) {
      try { await navigator.share({ files: [f], title: nome }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
  }
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: nome });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  toast(`${nome} baixado`);
}

function dashboardRange(period) {
  const start = parseDate(today());
  let end;
  let rotulo;
  if (period === 'day') {
    end = new Date(start); end.setDate(end.getDate() + 1);
    rotulo = fmtDate(today());
  } else if (period === 'week') {
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    end = new Date(start); end.setDate(end.getDate() + 7);
    const ultimoDia = new Date(start); ultimoDia.setDate(ultimoDia.getDate() + 6);
    rotulo = `${fmtDate(isoDate(start))} a ${fmtDate(isoDate(ultimoDia))}`;
  } else if (period === 'month') {
    start.setDate(1);
    end = new Date(start); end.setMonth(end.getMonth() + 1);
    rotulo = monthLabel(monthKey(today()));
  } else {
    start.setMonth(0, 1);
    end = new Date(start); end.setFullYear(end.getFullYear() + 1);
    rotulo = String(start.getFullYear());
  }
  return { inicio: isoDate(start), fim: isoDate(end), rotulo };
}

async function abrirLancamento(id) {
  const [l, venda, compra, pacote] = await Promise.all([
    DB.one('SELECT * FROM lancamentos WHERE id=?', [id]),
    DB.one('SELECT produto_nome, quantidade, custo_unitario, preco_unitario FROM vendas_produtos WHERE lancamento_id=?', [id]),
    DB.one('SELECT produto_nome, quantidade, custo_unitario FROM compras_estoque WHERE lancamento_id=?', [id]),
    DB.one('SELECT nome, usados, quantidade FROM clientes_pacotes WHERE lancamento_id=?', [id]),
  ]);
  if (!l) return;
  if (!venda && !compra && !pacote) return formLancamento(l);
  const s = sheet(pacote ? `
    <h3>Venda de pacote</h3>
    <div class="kv"><span>Pacote</span><span>${esc(pacote.nome)}</span></div>
    <div class="kv"><span>Usados</span><span>${pacote.usados} de ${pacote.quantidade}</span></div>
    <div class="kv"><span>Valor</span><span>${money(l.valor)}</span></div>
    <p class="hint">Este lançamento está vinculado ao pacote do cliente e não pode ser editado separadamente.</p>
    <button class="btn ghost" id="close">Fechar</button>` : `
    <h3>${venda ? 'Venda de produto' : 'Entrada de estoque'}</h3>
    <div class="kv"><span>Produto</span><span>${esc((venda || compra).produto_nome)}</span></div>
    <div class="kv"><span>Quantidade</span><span>${(venda || compra).quantidade}</span></div>
    ${venda ? `<div class="kv"><span>Lucro nesta venda</span><span>${money((venda.preco_unitario - venda.custo_unitario) * venda.quantidade)}</span></div>` : `<div class="kv"><span>Custo unitário</span><span>${money(compra.custo_unitario)}</span></div>`}
    <div class="kv"><span>Valor financeiro</span><span>${money(l.valor)}</span></div>
    ${l.taxa > 0 ? `<div class="kv"><span>Taxa da maquininha</span><span>${money(l.taxa)}</span></div>` : ''}
    <p class="hint">Este lançamento está vinculado ao estoque e não pode ser editado separadamente.</p>
    <button class="btn ghost" id="close">Fechar</button>`);
  $('#close', s).onclick = closeSheet;
}

function formLancamento(l = null) {
  let tipo = l ? l.tipo : 'entrada';
  const x = l || { descricao: '', categoria: '', valor: '', data: today(), forma_pagamento: 'Pix' };
  const s = sheet(`
    <h3>${l ? 'Editar lançamento' : 'Novo lançamento'}</h3>
    <div class="seg" id="tipo">
      <button data-t="entrada">Entrada</button>
      <button data-t="saida">Saída / despesa</button>
    </div>
    <div class="field"><label>Descrição</label><input id="desc" value="${esc(x.descricao)}" placeholder="Ex.: Venda de pomada, aluguel…"></div>
    <div class="row2">
      <div class="field"><label>Valor (R$)</label><input id="valor" inputmode="decimal" value="${esc(moneyIn(x.valor))}"></div>
      <div class="field"><label>Data</label><input id="data" type="date" value="${esc(x.data)}"></div>
    </div>
    <div class="row2">
      <div class="field"><label>Categoria</label><select id="cat"></select></div>
      <div class="field"><label>Forma de pagamento</label><select id="forma">${FORMAS.map((f) => opt(f, f, x.forma_pagamento)).join('')}</select></div>
    </div>
    ${l && l.agendamento_id ? '<p class="hint">Este lançamento veio de um atendimento concluído na agenda.</p>' : ''}
    ${l && l.despesa_fixa_id ? '<p class="hint">Lançado automaticamente pelas despesas fixas.</p>' : ''}
    <div class="err" id="err"></div>
    <div class="btns two">
      <button class="btn ghost" id="cancel">Cancelar</button>
      <button class="btn" id="save">Salvar</button>
    </div>
    ${l ? '<div class="btns" style="margin-top:10px"><button class="btn danger" id="del">Excluir lançamento</button></div>' : ''}`);

  const setTipo = (t) => {
    tipo = t;
    const seg = $('#tipo', s);
    seg.className = 'seg ' + (t === 'entrada' ? 'in' : 'out');
    seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.t === t));
    const cats = t === 'entrada' ? CAT_ENTRADA : CAT_SAIDA;
    const atual = $('#cat', s).value || x.categoria;
    $('#cat', s).innerHTML = cats.map((c) => opt(c, c, cats.includes(atual) ? atual : cats[0])).join('');
  };
  s.querySelectorAll('[data-t]').forEach((b) => (b.onclick = () => setTipo(b.dataset.t)));
  setTipo(tipo);

  $('#cancel', s).onclick = closeSheet;
  $('#save', s).onclick = safe(async () => {
    const err = (m) => ($('#err', s).textContent = m);
    const desc = $('#desc', s).value.trim();
    const valor = parseMoney($('#valor', s).value);
    const data = $('#data', s).value;
    const forma = $('#forma', s).value;
    if (!desc) return err('Informe a descrição.');
    if (isNaN(valor) || valor <= 0) return err('Informe um valor maior que zero.');
    if (!data) return err('Informe a data.');
    const taxa = tipo === 'entrada' ? taxaDe(forma, valor) : 0;
    const p = [tipo, desc, $('#cat', s).value, valor, taxa, data, forma];
    if (l) {
      await DB.x('UPDATE lancamentos SET tipo=?, descricao=?, categoria=?, valor=?, taxa=?, data=?, forma_pagamento=? WHERE id=?', [...p, l.id]);
      toast('Lançamento atualizado');
    } else {
      await DB.x('INSERT INTO lancamentos (tipo, descricao, categoria, valor, taxa, data, forma_pagamento, usuario_id) VALUES (?,?,?,?,?,?,?,?)', [...p, S.user.id]);
      toast('Lançamento salvo');
    }
    closeAll();
    if (S.view === 'caixa') S.finMonth = monthKey(data);
    refresh();
  });
  if (l) $('#del', s).onclick = safe(async () => {
    if (!(await confirmBox('Excluir este lançamento?', 'Excluir'))) return;
    await DB.batch([
      cmdExclusao('lancamentos', l.id, `Lançamento: ${l.descricao} · ${l.tipo === 'entrada' ? '+' : '−'}${money(l.valor)} · ${fmtDate(l.data)}`, l),
      { sql: 'DELETE FROM lancamentos WHERE id=?', params: [l.id] },
    ]);
    closeAll(); refresh(); toast('Lançamento excluído');
  });
}

/* ---- Comissões ---- */
function telaComissoes() {
  if (!S.comIni) { S.comIni = `${monthKey(today())}-01`; S.comFim = today(); }
  const s = sheet(`
    <h3>Comissões</h3>
    <p class="hint" style="margin-top:-8px">Calculada sobre o valor dos atendimentos concluídos no período. O percentual de cada um fica em Mais → Usuários.</p>
    <div class="row2">
      <div class="field"><label>Início</label><input id="ini" type="date" value="${S.comIni}"></div>
      <div class="field"><label>Fim</label><input id="fim" type="date" value="${S.comFim}"></div>
    </div>
    <div id="corpo"></div>`);
  const draw = serial(async () => {
    const corpo = $('#corpo', s);
    if (!S.comIni || !S.comFim || S.comIni > S.comFim) { corpo.innerHTML = '<div class="err">Período inválido.</div>'; return; }
    const rows = (await DB.q(`SELECT u.id, u.nome, u.comissao,
        (SELECT COUNT(*) FROM agendamentos a WHERE a.profissional_id=u.id AND a.status='concluido' AND a.data BETWEEN ? AND ?) AS n,
        (SELECT COALESCE(SUM(a.valor),0) FROM agendamentos a WHERE a.profissional_id=u.id AND a.status='concluido' AND a.data BETWEEN ? AND ?) AS base,
        (SELECT COALESCE(SUM(l.valor),0) FROM lancamentos l WHERE l.tipo='saida' AND l.categoria='Comissões' AND l.profissional_id=u.id
           AND l.ref_inicio>=? AND l.ref_fim<=?) AS pago
      FROM usuarios u WHERE u.ativo=1 OR u.id IN (SELECT profissional_id FROM agendamentos WHERE data BETWEEN ? AND ?)
      ORDER BY u.nome`, [S.comIni, S.comFim, S.comIni, S.comFim, S.comIni, S.comFim, S.comIni, S.comFim]))
      .map((r) => ({ ...r, devido: round2(r.base * r.comissao / 100) }))
      .map((r) => ({ ...r, falta: round2(r.devido - r.pago) }));
    corpo.innerHTML = `<div class="list">${rows.map((r) => `
      <div class="item">
        <div class="main"><div class="t">${esc(r.nome)} · ${String(r.comissao).replace('.', ',')}%</div>
          <div class="s">${r.n} atend. · base ${money(r.base)} · comissão ${money(r.devido)}</div>
          <div class="s">${r.pago ? `Pago ${money(r.pago)} · ` : ''}${r.falta > 0 ? `<b class="neg">A pagar ${money(r.falta)}</b>` : r.devido > 0 ? '<span class="ok">✓ quitado</span>' : ''}</div></div>
        ${r.falta > 0 ? `<button class="btn green small" data-pagar="${r.id}">Pagar</button>` : ''}
      </div>`).join('')}</div>`;
    corpo.querySelectorAll('[data-pagar]').forEach((b) => (b.onclick = safe(() => pagarComissao(rows.find((r) => r.id === Number(b.dataset.pagar)), draw))));
  });
  $('#ini', s).onchange = (e) => { S.comIni = e.target.value; draw(); };
  $('#fim', s).onchange = (e) => { S.comFim = e.target.value; draw(); };
  return draw();
}

function pagarComissao(r, depois) {
  const s = sheet(`
    <h3>Pagar comissão de ${esc(r.nome.split(' ')[0])}</h3>
    <p class="hint" style="margin-top:-8px">${esc(fmtDate(S.comIni))} a ${esc(fmtDate(S.comFim))}. O pagamento entra como saída no financeiro.</p>
    <div class="row2">
      <div class="field"><label>Valor (R$)</label><input id="valor" inputmode="decimal" value="${esc(moneyIn(r.falta))}"></div>
      <div class="field"><label>Forma</label><select id="forma">${FORMAS.map((f) => opt(f, f, 'Pix')).join('')}</select></div>
    </div>
    <div class="err" id="err"></div>
    <div class="btns two"><button class="btn ghost" id="c">Cancelar</button><button class="btn green" id="ok">Registrar pagamento</button></div>`, { center: true });
  $('#c', s).onclick = closeSheet;
  $('#ok', s).onclick = safe(async () => {
    const valor = parseMoney($('#valor', s).value);
    if (isNaN(valor) || valor <= 0) return ($('#err', s).textContent = 'Valor inválido.');
    await DB.x(`INSERT INTO lancamentos (tipo, descricao, categoria, valor, data, forma_pagamento, usuario_id, profissional_id, ref_inicio, ref_fim)
      VALUES ('saida', ?, 'Comissões', ?, ?, ?, ?, ?, ?, ?)`,
      [`Comissão ${r.nome} (${fmtDate(S.comIni)} a ${fmtDate(S.comFim)})`, valor, today(), $('#forma', s).value, S.user.id, r.id, S.comIni, S.comFim]);
    closeSheet(); refresh(); depois(); toast(`Comissão paga: ${money(valor)}`);
  });
}

/* ---- Fechamento de caixa do dia ---- */
async function fechamentoCaixa() {
  const data = today();
  const porForma = await DB.q(`SELECT COALESCE(forma_pagamento,'—') AS forma,
      COALESCE(SUM(CASE WHEN tipo='entrada' THEN valor END),0) AS ent,
      COALESCE(SUM(CASE WHEN tipo='saida' THEN valor END),0) AS sai
    FROM lancamentos WHERE data=? GROUP BY forma ORDER BY forma`, [data]);
  const din = porForma.find((f) => f.forma === 'Dinheiro') || { ent: 0, sai: 0 };
  const historico = await DB.q('SELECT f.*, u.nome AS usuario FROM fechamentos f LEFT JOIN usuarios u ON u.id=f.usuario_id ORDER BY f.id DESC LIMIT 10');
  const s = sheet(`
    <h3>Fechamento de caixa · ${esc(fmtDay(data))}</h3>
    <div class="list">${porForma.length ? porForma.map((f) => `
      <div class="item"><div class="main"><div class="t">${esc(f.forma)}</div>${f.sai ? `<div class="s">saídas ${money(f.sai)}</div>` : ''}</div>
        <div class="right pos">${money(f.ent)}</div></div>`).join('') : '<div class="empty">Nenhum lançamento hoje.</div>'}</div>
    <div class="section-title">Conferir o dinheiro da gaveta</div>
    <div class="row2">
      <div class="field"><label>Fundo de troco (R$)</label><input id="fundo" inputmode="decimal" value="${esc(moneyIn(Number(cfg('fundo_troco', '0'))))}"></div>
      <div class="field"><label>Contado na gaveta (R$)</label><input id="contado" inputmode="decimal" placeholder="0,00"></div>
    </div>
    <div class="kv"><span>Esperado em dinheiro</span><span id="esperado"></span></div>
    <div class="kv"><span>Diferença</span><span id="dif">—</span></div>
    <div class="field" style="margin-top:12px"><label>Observações</label><input id="obs" placeholder="Ex.: troco a mais, sangria…"></div>
    <div class="err" id="err"></div>
    <div class="btns two"><button class="btn ghost" id="c">Fechar</button><button class="btn" id="ok">Salvar fechamento</button></div>
    ${historico.length ? `<div class="section-title">Fechamentos anteriores</div><div class="list">${historico.map((f) => {
      const d = round2(f.contado - f.esperado);
      return `<div class="item"><div class="main"><div class="t">${esc(fmtDay(f.data))}</div>
        <div class="s">Esperado ${money(f.esperado)} · contado ${money(f.contado)}${f.usuario ? ' · ' + esc(f.usuario) : ''}${f.observacoes ? ' · ' + esc(f.observacoes) : ''}</div></div>
        <div class="right ${Math.abs(d) < 0.005 ? 'ok' : d > 0 ? 'pos' : 'neg'}">${Math.abs(d) < 0.005 ? '✓ certo' : (d > 0 ? '+' : '') + money(d)}</div></div>`;
    }).join('')}</div>` : ''}`);
  const esperado = () => round2((parseMoney($('#fundo', s).value) || 0) + din.ent - din.sai);
  const atualizar = () => {
    $('#esperado', s).textContent = money(esperado());
    const contado = parseMoney($('#contado', s).value);
    const el = $('#dif', s);
    if (isNaN(contado)) { el.textContent = '—'; el.className = ''; return; }
    const d = round2(contado - esperado());
    el.textContent = Math.abs(d) < 0.005 ? '✓ bateu certinho' : `${d > 0 ? 'sobrando' : 'faltando'} ${money(Math.abs(d))}`;
    el.className = Math.abs(d) < 0.005 ? 'ok' : d > 0 ? 'pos' : 'neg';
  };
  $('#fundo', s).oninput = atualizar;
  $('#contado', s).oninput = atualizar;
  atualizar();
  $('#c', s).onclick = closeSheet;
  $('#ok', s).onclick = safe(async () => {
    const fundo = parseMoney($('#fundo', s).value) || 0;
    const contado = parseMoney($('#contado', s).value);
    if (isNaN(contado) || contado < 0) return ($('#err', s).textContent = 'Informe quanto foi contado na gaveta.');
    await setCfg('fundo_troco', String(fundo));
    await DB.x('INSERT INTO fechamentos (data, fundo, esperado, contado, observacoes, usuario_id) VALUES (?,?,?,?,?,?)',
      [data, fundo, esperado(), contado, $('#obs', s).value.trim(), S.user.id]);
    closeSheet(); toast('Fechamento salvo');
    await fechamentoCaixa();
  });
}

/* ---- Despesas fixas ---- */
async function listaDespesasFixas() {
  const rows = await DB.q('SELECT * FROM despesas_fixas ORDER BY ativo DESC, dia');
  const mes = monthKey(today());
  const s = sheet(`
    <h3>Despesas fixas</h3>
    <p class="hint" style="margin-top:-8px">Lançadas sozinhas como saída no dia do vencimento de cada mês. A tela inicial avisa 3 dias antes.</p>
    <div class="list">${rows.map((d) => `
      <button class="item" data-d="${d.id}">
        <div class="main"><div class="t">${esc(d.descricao)}${d.ativo ? '' : ' <span class="badge b-faltou">pausada</span>'}</div>
          <div class="s">Todo dia ${d.dia} · ${esc(d.categoria || '')}${d.ultimo_mes === mes ? ' · ✓ lançada este mês' : ''}</div></div>
        <div class="right neg">${money(d.valor)}</div>
      </button>`).join('') || '<div class="empty">Nenhuma despesa fixa cadastrada.</div>'}</div>
    <div class="btns" style="margin-top:14px"><button class="btn" id="novo">Nova despesa fixa</button></div>`);
  s.querySelectorAll('[data-d]').forEach((b) => (b.onclick = safe(() => formDespesaFixa(rows.find((r) => r.id === Number(b.dataset.d))))));
  $('#novo', s).onclick = safe(() => formDespesaFixa());
}

function formDespesaFixa(d = null) {
  const v = d || { descricao: '', categoria: 'Aluguel', valor: '', dia: 10, forma_pagamento: 'Pix', ativo: 1 };
  const hoje = Number(today().slice(8, 10));
  const s = sheet(`
    <h3>${d ? 'Editar despesa fixa' : 'Nova despesa fixa'}</h3>
    <div class="field"><label>Descrição</label><input id="desc" value="${esc(v.descricao)}" placeholder="Ex.: Aluguel do salão"></div>
    <div class="row2">
      <div class="field"><label>Valor (R$)</label><input id="valor" inputmode="decimal" value="${esc(moneyIn(v.valor))}"></div>
      <div class="field"><label>Dia do vencimento</label><input id="dia" type="number" min="1" max="31" value="${esc(v.dia)}"></div>
    </div>
    <div class="row2">
      <div class="field"><label>Categoria</label><select id="cat">${CAT_SAIDA.map((c) => opt(c, c, v.categoria)).join('')}</select></div>
      <div class="field"><label>Forma de pagamento</label><select id="forma">${FORMAS.map((f) => opt(f, f, v.forma_pagamento)).join('')}</select></div>
    </div>
    ${d ? `<div class="field"><label>Situação</label><select id="ativo">${opt(1, 'Ativa', v.ativo)}${opt(0, 'Pausada', v.ativo)}</select></div>` : `
    <div class="field" id="este-mes-box"><label>Neste mês</label><select id="este">${opt('pago', 'Já paguei este mês (começar no próximo)', '')}${opt('lancar', 'Lançar no vencimento deste mês', '')}</select></div>`}
    <div class="err" id="err"></div>
    <div class="btns two"><button class="btn ghost" id="c">Cancelar</button><button class="btn" id="ok">Salvar</button></div>
    ${d ? '<div class="btns" style="margin-top:10px"><button class="btn danger" id="del">Excluir</button></div>' : ''}`);
  if (!d) {
    const ajustar = () => { $('#este', s).value = (Number($('#dia', s).value) || 1) <= hoje ? 'pago' : 'lancar'; };
    $('#dia', s).oninput = ajustar;
    ajustar();
  }
  $('#c', s).onclick = closeSheet;
  $('#ok', s).onclick = safe(async () => {
    const err = (m) => ($('#err', s).textContent = m);
    const desc = $('#desc', s).value.trim();
    const valor = parseMoney($('#valor', s).value);
    const dia = Number($('#dia', s).value);
    if (!desc) return err('Informe a descrição.');
    if (isNaN(valor) || valor <= 0) return err('Informe um valor maior que zero.');
    if (!Number.isInteger(dia) || dia < 1 || dia > 31) return err('Dia do vencimento entre 1 e 31.');
    const p = [desc, $('#cat', s).value, valor, dia, $('#forma', s).value];
    if (d) await DB.x('UPDATE despesas_fixas SET descricao=?, categoria=?, valor=?, dia=?, forma_pagamento=?, ativo=? WHERE id=?', [...p, Number($('#ativo', s).value), d.id]);
    else await DB.x('INSERT INTO despesas_fixas (descricao, categoria, valor, dia, forma_pagamento, ultimo_mes) VALUES (?,?,?,?,?,?)',
      [...p, $('#este', s).value === 'pago' ? monthKey(today()) : null]);
    closeSheet(); closeSheet();
    await lancarDespesasFixas();
    refresh(); toast('Despesa fixa salva');
    await listaDespesasFixas();
  });
  if (d) $('#del', s).onclick = safe(async () => {
    if (!(await confirmBox(`Excluir a despesa fixa “${d.descricao}”? Os lançamentos já feitos continuam no financeiro.`, 'Excluir'))) return;
    await DB.batch([cmdExclusao('despesas_fixas', d.id, `Despesa fixa: ${d.descricao} · ${money(d.valor)}`, d),
      { sql: 'DELETE FROM despesas_fixas WHERE id=?', params: [d.id] }]);
    closeSheet(); closeSheet(); toast('Despesa fixa excluída');
    await listaDespesasFixas();
  });
}

/* ---- Gráficos ---- */
async function telaGraficos() {
  const s = sheet(`
    <h3>Gráficos</h3>
    <div class="section-title" style="margin-top:0">Faturamento dos últimos 12 meses</div>
    <div class="card"><div id="meses"></div><div class="hint" id="mes-info" style="margin-top:8px">Toque numa barra para ver o mês.</div></div>
    <div class="seg" id="per" style="margin-top:22px">${[[30, '30 dias'], [90, '3 meses'], [365, '12 meses']].map(([k, l]) => `<button data-p="${k}">${l}</button>`).join('')}</div>
    <div id="corpo"></div>`);
  // Faturamento mensal: série única, cor única (o dourado do app), valor no toque.
  const mesAtual = monthKey(today());
  const meses = Array.from({ length: 12 }, (_, i) => addMonths(mesAtual, i - 11));
  const dados = await DB.q(`SELECT substr(data,1,7) AS m,
      COALESCE(SUM(CASE WHEN tipo='entrada' THEN valor END),0) AS ent,
      COALESCE(SUM(CASE WHEN tipo='entrada' THEN taxa END),0) AS taxas,
      COALESCE(SUM(CASE WHEN tipo='saida' THEN valor END),0) AS sai
    FROM lancamentos WHERE data>=? GROUP BY m`, [`${meses[0]}-01`]);
  const serie = meses.map((m) => dados.find((d) => d.m === m) || { m, ent: 0, taxas: 0, sai: 0 });
  const max = Math.max(...serie.map((d) => d.ent), 1);
  const W = 320; const H = 150; const bw = W / 12;
  $('#meses', s).innerHTML = `
    <svg viewBox="0 0 ${W} ${H + 18}" class="colchart" role="img" aria-label="Faturamento mensal">
      <line x1="0" y1="${H}" x2="${W}" y2="${H}" class="axis"/>
      ${serie.map((d, i) => {
        const h = d.ent ? Math.max(2, (d.ent / max) * (H - 18)) : 0;
        return `<g data-m="${i}" class="col ${d.m === mesAtual ? 'cur' : ''}">
          <rect x="${i * bw}" y="0" width="${bw}" height="${H}" class="hit"/>
          <path d="${h ? `M${i * bw + 4},${H} V${H - h + 4} q0,-4 4,-4 h${bw - 16} q4,0 4,4 V${H} Z` : ''}" class="bar"/>
          <text x="${i * bw + bw / 2}" y="${H + 13}" text-anchor="middle">${MESES[Number(d.m.slice(5)) - 1].slice(0, 3)}</text>
        </g>`;
      }).join('')}
    </svg>`;
  const info = (i) => {
    const d = serie[i];
    s.querySelectorAll('.col').forEach((g) => g.classList.toggle('sel', Number(g.dataset.m) === i));
    $('#mes-info', s).innerHTML = `<b>${esc(monthLabel(d.m))}</b> · faturamento ${money(d.ent)} · saídas ${money(d.sai)} · saldo <span class="${d.ent - d.taxas - d.sai >= 0 ? 'pos' : 'neg'}">${money(d.ent - d.taxas - d.sai)}</span>`;
  };
  s.querySelectorAll('.col').forEach((g) => (g.onclick = () => info(Number(g.dataset.m))));
  info(11);

  const draw = serial(async () => {
    s.querySelectorAll('[data-p]').forEach((b) => b.classList.toggle('on', Number(b.dataset.p) === S.analisePeriodo));
    const desde = addDays(today(), -S.analisePeriodo + 1);
    const base = `FROM agendamentos a WHERE a.status='concluido' AND a.data>=?`;
    const [servicos, semana, horas] = await Promise.all([
      DB.q(`SELECT COALESCE(s.nome,'Sem serviço') AS k, COUNT(*) AS n, SUM(a.valor) AS v
        FROM agendamentos a LEFT JOIN servicos s ON s.id=a.servico_id WHERE a.status='concluido' AND a.data>=? GROUP BY k ORDER BY n DESC LIMIT 8`, [desde]),
      DB.q(`SELECT EXTRACT(DOW FROM a.data::date)::int AS d, COUNT(*) AS n ${base} GROUP BY d`, [desde]),
      DB.q(`SELECT substr(a.hora,1,2) AS h, COUNT(*) AS n ${base} GROUP BY h ORDER BY h`, [desde]),
    ]);
    const ordemSemana = [1, 2, 3, 4, 5, 6, 0].map((d) => ({ k: DIAS_LONGO[d], v: (semana.find((x) => x.d === d) || { n: 0 }).n }));
    const qtd = (v) => `${v} atend.`;
    $('#corpo', s).innerHTML = servicos.length ? `
      <div class="section-title">Serviços que mais saem</div>
      <div class="card">${barras(servicos.map((r) => ({ k: r.k, v: r.n, valor: r.v })), (v, r) => `${v}× <span class="hint">${money(r.valor)}</span>`)}</div>
      <div class="section-title">Movimento por dia da semana</div>
      <div class="card">${barras(ordemSemana, qtd)}</div>
      <div class="section-title">Movimento por horário</div>
      <div class="card">${barras(horas.map((r) => ({ k: `${r.h}h`, v: r.n })), qtd)}</div>`
      : '<div class="card empty">Ainda não há atendimentos concluídos neste período.</div>';
  });
  s.querySelectorAll('[data-p]').forEach((b) => (b.onclick = () => { S.analisePeriodo = Number(b.dataset.p); draw(); }));
  await draw();
}

/* ======================= MAIS ======================= */
function viewMais(el) {
  const ultimoBackup = cfg('backup_ultimo', '');
  const items = [
    ['servicos', 'Serviços e preços', 'Cadastre os serviços oferecidos e a duração'],
    ...(isAdmin() ? [
      ['pacotes', 'Pacotes e planos', 'Ex.: 4 atendimentos por mês com preço fechado'],
      ['fidelidade', 'Cartão fidelidade', cfg('fid_ativo', '0') === '1' ? `Ativo · a cada ${cfg('fid_meta', '10')} atendimentos, 1 cortesia` : 'Desativado'],
      ['usuarios', 'Usuários e profissionais', 'Acesso, comissão e cor na agenda'],
      ['horarios', 'Horários e folgas', 'Expediente de cada profissional'],
      ['mensagens', 'Mensagens do WhatsApp', 'Confirmação, lembrete, parabéns…'],
      ['taxas', 'Taxas da maquininha', `Débito ${cfg('taxa_debito', '0')}% · Crédito ${cfg('taxa_credito', '0')}% · Pix ${cfg('taxa_pix', '0')}%`],
      ['barbearia', 'Nome do estabelecimento', cfg('nome_barbearia', '')],
      ['backup', 'Backup dos dados', ultimoBackup ? `Último: ${fmtDate(ultimoBackup)}` : 'Baixar uma cópia dos dados'],
      ['exclusoes', 'Histórico de exclusões', 'O que foi apagado, quando e por quem'],
    ] : []),
    ['senha', 'Alterar minha senha', S.user.login],
    ['sair', 'Sair', 'Encerrar a sessão'],
  ];
  $('#subtitle').textContent = isAdmin() ? 'Administrador' : 'Profissional';
  el.innerHTML = `<div class="list">${items.map(([k, t, sub]) => `
    <button class="item" data-k="${k}">
      <div class="main"><div class="t">${esc(t)}</div><div class="s">${esc(sub)}</div></div>
      <span style="color:var(--muted);width:18px">${ICON.right}</span>
    </button>`).join('')}</div>
    <p class="hint" style="text-align:center;margin-top:24px">Os dados ficam salvos na nuvem e aparecem em todos os aparelhos da equipe (celular ou computador).<br>Precisa de internet para usar.</p>`;
  const acts = {
    servicos: listaServicos, usuarios: listaUsuarios, barbearia: formNomeBarbearia,
    backup: telaBackup, senha: formMinhaSenha, sair: logout,
    pacotes: listaPacotes, fidelidade: formFidelidade, horarios: listaHorarios,
    mensagens: formMensagens, taxas: formTaxas, exclusoes: listaExclusoes,
  };
  el.querySelectorAll('[data-k]').forEach((b) => (b.onclick = safe(() => acts[b.dataset.k]())));
}

async function viewProdutos(el) {
  const rows = await DB.q('SELECT * FROM produtos ORDER BY ativo DESC, lower(nome)');
  const baixo = rows.filter((p) => p.ativo && p.estoque <= p.estoque_minimo).length;
  $('#subtitle').textContent = baixo ? `${baixo} com estoque baixo` : 'Cadastro, venda e estoque';
  const s = el;
  s.innerHTML = `
    <div class="btns two">
      <button class="btn green" id="venda">Registrar venda</button>
      <button class="btn ghost" id="compra">Entrada de estoque</button>
    </div>
    <div class="btns" style="margin:10px 0 14px"><button class="btn" id="novo">Cadastrar produto</button></div>
    <div class="list">${rows.map((p) => `
      <button class="item" data-product="${p.id}">
        <div class="main">
          <div class="t">${esc(p.nome)}${p.ativo ? '' : ' <span class="badge b-faltou">inativo</span>'}</div>
          <div class="s">Compra ${money(p.preco_compra)} · Venda ${money(p.preco_venda)}</div>
        </div>
        <div class="right ${p.estoque <= p.estoque_minimo ? 'neg' : ''}">${p.estoque} un.<div class="s">mín. ${p.estoque_minimo}</div></div>
      </button>`).join('') || '<div class="empty">Nenhum produto cadastrado.</div>'}</div>`;
  $('#venda', s).onclick = safe(() => formVendaProduto());
  $('#compra', s).onclick = safe(() => formCompraEstoque());
  $('#novo', s).onclick = safe(() => formProduto());
  s.querySelectorAll('[data-product]').forEach((b) => (b.onclick = safe(() => {
    formProduto(rows.find((p) => p.id === Number(b.dataset.product)));
  })));
}

function formProduto(p = null) {
  const v = p || { nome: '', preco_compra: '', preco_venda: '', estoque_minimo: 0, ativo: 1 };
  const s = sheet(`
    <h3>${p ? 'Editar produto' : 'Novo produto'}</h3>
    <div class="field"><label>Nome</label><input id="nome" value="${esc(v.nome)}"></div>
    <div class="row2">
      <div class="field"><label>Custo médio de compra (R$)</label><input id="compra" inputmode="decimal" value="${esc(moneyIn(v.preco_compra))}"></div>
      <div class="field"><label>Preço de venda (R$)</label><input id="venda" inputmode="decimal" value="${esc(moneyIn(v.preco_venda))}"></div>
    </div>
    <div class="row2">
      <div class="field"><label>Estoque mínimo</label><input id="minimo" type="number" min="0" step="1" value="${esc(v.estoque_minimo)}"></div>
      ${p ? `<div class="field"><label>Situação</label><select id="ativo">${opt(1, 'Ativo', v.ativo)}${opt(0, 'Inativo', v.ativo)}</select></div>` : ''}
    </div>
    ${p ? `<p class="hint">Estoque atual: ${p.estoque} unidade(s). Use “Entrada de estoque” para registrar compras.</p>` : ''}
    <div class="err" id="err"></div>
    <div class="btns two"><button class="btn ghost" id="cancel">Cancelar</button><button class="btn" id="save">Salvar</button></div>`);
  $('#cancel', s).onclick = closeSheet;
  $('#save', s).onclick = safe(async () => {
    const nome = $('#nome', s).value.trim();
    const custo = parseMoney($('#compra', s).value);
    const venda = parseMoney($('#venda', s).value);
    const minimo = Number($('#minimo', s).value);
    if (!nome) return ($('#err', s).textContent = 'Informe o nome do produto.');
    if (isNaN(custo) || custo < 0 || isNaN(venda) || venda < 0) return ($('#err', s).textContent = 'Informe preços válidos.');
    if (!Number.isInteger(minimo) || minimo < 0) return ($('#err', s).textContent = 'Estoque mínimo inválido.');
    if (p) await DB.x('UPDATE produtos SET nome=?, preco_compra=?, preco_venda=?, estoque_minimo=?, ativo=? WHERE id=?',
      [nome, custo, venda, minimo, Number($('#ativo', s).value), p.id]);
    else await DB.x('INSERT INTO produtos (nome, preco_compra, preco_venda, estoque_minimo) VALUES (?,?,?,?)',
      [nome, custo, venda, minimo]);
    go('produtos'); toast('Produto salvo');
  });
}

async function formVendaProduto(produtoId = null) {
  const produtos = await DB.q('SELECT * FROM produtos WHERE ativo=1 AND estoque>0 ORDER BY lower(nome)');
  if (!produtos.length) {
    toast('Não há produtos ativos com estoque disponível');
    return go('produtos');
  }
  const inicial = produtos.find((p) => p.id === produtoId) || produtos[0];
  const s = sheet(`
    <h3>Registrar venda</h3>
    <div class="field"><label>Produto</label><select id="produto">${produtos.map((p) => opt(p.id, `${p.nome} · ${p.estoque} un.`, inicial.id)).join('')}</select></div>
    <div class="row2">
      <div class="field"><label>Quantidade</label><input id="quantidade" type="number" min="1" step="1" value="1"></div>
      <div class="field"><label>Preço unitário (R$)</label><input id="preco" inputmode="decimal" value="${esc(moneyIn(inicial.preco_venda))}"></div>
    </div>
    <div class="field"><label>Forma de pagamento</label><select id="forma">${FORMAS.map((f) => opt(f, f, 'Pix')).join('')}</select></div>
    <p class="hint" id="disponivel">Disponível: ${inicial.estoque} unidade(s) · Total: ${money(inicial.preco_venda)}</p>
    <div class="err" id="err"></div>
    <div class="btns two"><button class="btn ghost" id="cancel">Cancelar</button><button class="btn green" id="save">Confirmar venda</button></div>`);
  const selecionado = () => produtos.find((p) => p.id === Number($('#produto', s).value));
  const atualizar = () => {
    const p = selecionado();
    $('#preco', s).value = moneyIn(p.preco_venda);
    $('#disponivel', s).textContent = `Disponível: ${p.estoque} unidade(s) · Total: ${money(p.preco_venda * (Number($('#quantidade', s).value) || 0))}`;
  };
  $('#produto', s).onchange = atualizar;
  $('#quantidade', s).oninput = atualizar;
  $('#preco', s).oninput = () => {
    const p = selecionado();
    $('#disponivel', s).textContent = `Disponível: ${p.estoque} unidade(s) · Total: ${money((parseMoney($('#preco', s).value) || 0) * (Number($('#quantidade', s).value) || 0))}`;
  };
  $('#cancel', s).onclick = closeSheet;
  $('#save', s).onclick = safe(async () => {
    const p = selecionado();
    const quantidade = Number($('#quantidade', s).value);
    const preco = parseMoney($('#preco', s).value);
    if (!Number.isInteger(quantidade) || quantidade < 1) return ($('#err', s).textContent = 'Quantidade inválida.');
    if (quantidade > p.estoque) return ($('#err', s).textContent = `Estoque insuficiente. Disponível: ${p.estoque}.`);
    if (isNaN(preco) || preco <= 0) return ($('#err', s).textContent = 'Preço de venda inválido.');
    const total = Math.round(preco * quantidade * 100) / 100;
    await DB.batch([
      { sql: "INSERT INTO lancamentos (tipo, descricao, categoria, valor, taxa, data, forma_pagamento, usuario_id) VALUES ('entrada', ?, 'Produto', ?, ?, ?, ?, ?)",
        params: [`Venda: ${p.nome} (${quantidade} un.)`, total, taxaDe($('#forma', s).value, total), today(), $('#forma', s).value, S.user.id] },
      { sql: `INSERT INTO vendas_produtos (lancamento_id, produto_id, produto_nome, quantidade, custo_unitario, preco_unitario) VALUES (currval(pg_get_serial_sequence('lancamentos','id')),?,?,?,?,?)`,
        params: [p.id, p.nome, quantidade, p.preco_compra, preco] },
      { sql: 'UPDATE produtos SET estoque=estoque-? WHERE id=? AND estoque>=?',
        params: [quantidade, p.id, quantidade], requireChanges: true,
        error: `Estoque insuficiente. Disponível: ${p.estoque}.` },
    ]);
    go('produtos'); toast(`Venda registrada: ${money(total)}`);
  });
}

async function formCompraEstoque(produtoId = null) {
  const produtos = await DB.q('SELECT * FROM produtos WHERE ativo=1 ORDER BY lower(nome)');
  if (!produtos.length) {
    toast('Cadastre um produto primeiro');
    return formProduto();
  }
  const inicial = produtos.find((p) => p.id === produtoId) || produtos[0];
  const s = sheet(`
    <h3>Entrada de estoque</h3>
    <p class="hint">A compra será registrada como saída no financeiro e atualizará o custo médio do produto.</p>
    <div class="field"><label>Produto</label><select id="produto">${produtos.map((p) => opt(p.id, `${p.nome} · estoque ${p.estoque}`, inicial.id)).join('')}</select></div>
    <div class="row2">
      <div class="field"><label>Quantidade comprada</label><input id="quantidade" type="number" min="1" step="1" value="1"></div>
      <div class="field"><label>Custo unitário (R$)</label><input id="custo" inputmode="decimal" value="${esc(moneyIn(inicial.preco_compra))}"></div>
    </div>
    <div class="field"><label>Forma de pagamento</label><select id="forma">${FORMAS.map((f) => opt(f, f, 'Pix')).join('')}</select></div>
    <p class="hint" id="total">Total da compra: ${money(inicial.preco_compra)}</p>
    <div class="err" id="err"></div>
    <div class="btns two"><button class="btn ghost" id="cancel">Cancelar</button><button class="btn" id="save">Registrar compra</button></div>`);
  const selecionado = () => produtos.find((p) => p.id === Number($('#produto', s).value));
  $('#produto', s).onchange = () => {
    const p = selecionado();
    $('#custo', s).value = moneyIn(p.preco_compra);
    atualizarTotal();
  };
  const atualizarTotal = () => $('#total', s).textContent =
    `Total da compra: ${money((parseMoney($('#custo', s).value) || 0) * (Number($('#quantidade', s).value) || 0))}`;
  $('#quantidade', s).oninput = atualizarTotal;
  $('#custo', s).oninput = atualizarTotal;
  $('#cancel', s).onclick = closeSheet;
  $('#save', s).onclick = safe(async () => {
    const p = selecionado();
    const quantidade = Number($('#quantidade', s).value);
    const custo = parseMoney($('#custo', s).value);
    if (!Number.isInteger(quantidade) || quantidade < 1) return ($('#err', s).textContent = 'Quantidade inválida.');
    if (isNaN(custo) || custo <= 0) return ($('#err', s).textContent = 'Custo unitário inválido.');
    const total = Math.round(custo * quantidade * 100) / 100;
    await DB.batch([
      { sql: "INSERT INTO lancamentos (tipo, descricao, categoria, valor, data, forma_pagamento, usuario_id) VALUES ('saida', ?, 'Estoque', ?, ?, ?, ?)",
        params: [`Compra de estoque: ${p.nome} (${quantidade} un.)`, total, today(), $('#forma', s).value, S.user.id] },
      { sql: `INSERT INTO compras_estoque (lancamento_id, produto_id, produto_nome, quantidade, custo_unitario) VALUES (currval(pg_get_serial_sequence('lancamentos','id')),?,?,?,?)`,
        params: [p.id, p.nome, quantidade, custo] },
      { sql: `UPDATE produtos SET
          preco_compra=CASE WHEN estoque+?>0 THEN ((preco_compra*estoque)+(?*?))/(estoque+?) ELSE ? END,
          estoque=estoque+? WHERE id=?`,
        params: [quantidade, custo, quantidade, quantidade, custo, quantidade, p.id] },
    ]);
    go('produtos'); toast(`Estoque atualizado · ${money(total)}`);
  });
}

function formNomeBarbearia() {
  const s = sheet(`
    <h3>Nome do estabelecimento</h3>
    <div class="field"><label>Nome exibido no sistema e nos lembretes</label><input id="n" value="${esc(cfg('nome_barbearia', ''))}"></div>
    <div class="btns two"><button class="btn ghost" id="c">Cancelar</button><button class="btn" id="ok">Salvar</button></div>`, { center: true });
  $('#c', s).onclick = closeSheet;
  $('#ok', s).onclick = safe(async () => { await setCfg('nome_barbearia', $('#n', s).value.trim() || (S.estab ? S.estab.nome : 'Estabelecimento')); closeAll(); renderShell(); toast('Salvo'); });
}

/* ---- Serviços ---- */
async function listaServicos() {
  const rows = await DB.q('SELECT * FROM servicos ORDER BY ativo DESC, nome');
  const s = sheet(`
    <h3>Serviços</h3>
    <div class="list">${rows.map((x) => `
      <button class="item" data-s="${x.id}">
        <div class="main"><div class="t">${esc(x.nome)}${x.ativo ? '' : ' <span class="badge b-faltou">inativo</span>'}</div><div class="s">${x.duracao} min</div></div>
        <div class="right">${money(x.preco)}</div>
      </button>`).join('') || '<div class="empty">Nenhum serviço</div>'}</div>
    <div class="btns" style="margin-top:14px"><button class="btn" id="novo">Novo serviço</button></div>`);
  s.querySelectorAll('[data-s]').forEach((b) => (b.onclick = safe(() => formServico(rows.find((r) => r.id === Number(b.dataset.s))))));
  $('#novo', s).onclick = safe(() => formServico());
}

function formServico(x = null) {
  const v = x || { nome: '', preco: '', duracao: 30, ativo: 1 };
  const s = sheet(`
    <h3>${x ? 'Editar serviço' : 'Novo serviço'}</h3>
    <div class="field"><label>Nome</label><input id="nome" value="${esc(v.nome)}"></div>
    <div class="row2">
      <div class="field"><label>Preço (R$)</label><input id="preco" inputmode="decimal" value="${esc(moneyIn(v.preco))}"></div>
      <div class="field"><label>Duração (min)</label><input id="dur" type="number" inputmode="numeric" value="${esc(v.duracao)}"></div>
    </div>
    <div class="field"><label>Situação</label><select id="ativo">${opt(1, 'Ativo', v.ativo)}${opt(0, 'Inativo (não aparece ao agendar)', v.ativo)}</select></div>
    <div class="err" id="err"></div>
    <div class="btns two"><button class="btn ghost" id="c">Cancelar</button><button class="btn" id="ok">Salvar</button></div>`);
  $('#c', s).onclick = closeSheet;
  $('#ok', s).onclick = safe(async () => {
    const nome = $('#nome', s).value.trim();
    const preco = parseMoney($('#preco', s).value);
    const dur = parseInt($('#dur', s).value, 10) || 30;
    const ativo = Number($('#ativo', s).value);
    if (!nome) return ($('#err', s).textContent = 'Informe o nome.');
    if (isNaN(preco) || preco < 0) return ($('#err', s).textContent = 'Preço inválido.');
    if (x) await DB.x('UPDATE servicos SET nome=?, preco=?, duracao=?, ativo=? WHERE id=?', [nome, preco, dur, ativo, x.id]);
    else await DB.x('INSERT INTO servicos (nome, preco, duracao, ativo) VALUES (?,?,?,?)', [nome, preco, dur, ativo]);
    closeSheet(); closeSheet(); toast('Serviço salvo');
    await listaServicos();
  });
}

/* ---- Usuários ---- */
async function listaUsuarios() {
  const rows = await DB.q('SELECT id, nome, login, admin, ativo, comissao, cor, auth_id FROM usuarios ORDER BY ativo DESC, nome');
  const s = sheet(`
    <h3>Usuários</h3>
    <p class="hint" style="margin-top:-8px">Administrador vê o financeiro, backup, gerencia usuários e é o único que pode excluir. Profissional vê agenda e clientes.</p>
    <div class="list">${rows.map((u) => `
      <button class="item" data-u="${u.id}">
        <div class="avatar" style="background:${esc(corProf(u.id, u.cor))};color:#1b150d">${esc(initials(u.nome))}</div>
        <div class="main"><div class="t">${esc(u.nome)}</div><div class="s">${esc(u.login)} · ${u.admin ? 'Administrador' : 'Profissional'}${u.comissao ? ` · comissão ${String(u.comissao).replace('.', ',')}%` : ''}${u.ativo ? '' : ' · inativo'}</div></div>
      </button>`).join('')}</div>
    <div class="btns" style="margin-top:14px"><button class="btn" id="novo">Novo usuário</button></div>`);
  s.querySelectorAll('[data-u]').forEach((b) => (b.onclick = safe(() => formUsuario(rows.find((r) => r.id === Number(b.dataset.u))))));
  $('#novo', s).onclick = safe(() => formUsuario());
}

/* Cria a conta de acesso no Supabase Auth sem trocar a sessão de quem está logado. */
async function criarContaAcesso(login, senha) {
  const tmp = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'cadastro' } });
  const { data, error } = await tmp.auth.signUp({ email: emailDe(login, S.codigo), password: senha });
  if (error) throw new Error(await erroAuth(error));
  if (!data.user || (data.user.identities && !data.user.identities.length)) throw new Error('Já existe uma conta com este usuário (login).');
  return data.user.id;
}

async function formUsuario(u = null) {
  const v = u || { nome: '', login: '', admin: 0, ativo: 1, comissao: 0, cor: null };
  const eu = u && u.id === S.user.id;
  let cor = v.cor || (u ? corProf(u.id) : CORES[(await DB.val('SELECT COUNT(*) FROM usuarios')) % CORES.length]);
  const semConta = u && !u.auth_id;
  const s = sheet(`
    <h3>${u ? 'Editar usuário' : 'Novo usuário'}</h3>
    <div class="field"><label>Nome</label><input id="nome" value="${esc(v.nome)}"></div>
    <div class="field"><label>Usuário (login)</label><input id="login" autocapitalize="none" value="${esc(v.login)}"></div>
    <div class="field"><label>${u && !semConta ? 'Nova senha (deixe em branco para manter)' : 'Senha'}</label><input id="senha" type="password"></div>
    ${semConta ? '<p class="hint">Este usuário ainda não tem acesso ao app na nuvem. Defina uma senha para liberar.</p>' : ''}
    <div class="row2">
      <div class="field"><label>Perfil</label><select id="admin" ${eu ? 'disabled' : ''}>${opt(0, 'Profissional', v.admin)}${opt(1, 'Administrador', v.admin)}</select></div>
      <div class="field"><label>Situação</label><select id="ativo" ${eu ? 'disabled' : ''}>${opt(1, 'Ativo', v.ativo)}${opt(0, 'Inativo', v.ativo)}</select></div>
    </div>
    <div class="field"><label>Comissão sobre os atendimentos (%)</label><input id="comissao" inputmode="decimal" value="${esc(String(v.comissao || 0).replace('.', ','))}"></div>
    <div class="field"><label>Cor na agenda</label><div class="swatches">${CORES.map((c) => `<button type="button" data-cor="${c}" style="background:${c}" aria-label="Cor ${c}"></button>`).join('')}</div></div>
    <div class="err" id="err"></div>
    <div class="btns two"><button class="btn ghost" id="c">Cancelar</button><button class="btn" id="ok">Salvar</button></div>`);
  const marcarCor = () => s.querySelectorAll('[data-cor]').forEach((b) => b.classList.toggle('on', b.dataset.cor === cor));
  s.querySelectorAll('[data-cor]').forEach((b) => (b.onclick = () => { cor = b.dataset.cor; marcarCor(); }));
  marcarCor();
  $('#c', s).onclick = closeSheet;
  $('#ok', s).onclick = safe(async () => {
    const err = (m) => ($('#err', s).textContent = m);
    const nome = $('#nome', s).value.trim();
    const login = $('#login', s).value.trim();
    const senha = $('#senha', s).value;
    const admin = Number($('#admin', s).value);
    const ativo = Number($('#ativo', s).value);
    const comissao = parseMoney($('#comissao', s).value || '0');
    if (!nome || !login) return err('Preencha nome e usuário.');
    if (isNaN(comissao) || comissao < 0 || comissao > 100) return err('Comissão deve estar entre 0 e 100%.');
    if ((!u || semConta || senha) && senha.length < 6) return err('A senha precisa ter pelo menos 6 caracteres.');
    if (await DB.one('SELECT id FROM usuarios WHERE lower(login)=lower(?) AND id<>?', [login, u ? u.id : 0])) return err('Este usuário (login) já existe.');
    if (u && u.admin && (!admin || !ativo) && (await DB.val('SELECT COUNT(*) FROM usuarios WHERE admin=1 AND ativo=1 AND id<>?', [u.id])) === 0) {
      return err('Precisa existir pelo menos um administrador ativo.');
    }
    if (u) {
      if (semConta) {
        const authId = await criarContaAcesso(login, senha);
        await DB.x('UPDATE usuarios SET auth_id=? WHERE id=?', [authId, u.id]);
      } else {
        const trocouLogin = emailDe(login, S.codigo) !== emailDe(u.login, S.codigo);
        if (trocouLogin || senha) {
          await DB.rpc('admin_definir_acesso', { p_usuario_id: u.id, p_email: trocouLogin ? emailDe(login, S.codigo) : null, p_senha: senha || null });
        }
      }
      await DB.x('UPDATE usuarios SET nome=?, login=?, admin=?, ativo=?, comissao=?, cor=? WHERE id=?', [nome, login, admin, ativo, comissao, cor, u.id]);
      if (eu) { S.user.nome = nome; S.user.login = login; }
    } else {
      const authId = await criarContaAcesso(login, senha);
      await DB.x('INSERT INTO usuarios (auth_id, nome, login, admin, ativo, comissao, cor) VALUES (?,?,?,?,?,?,?)', [authId, nome, login, admin, ativo, comissao, cor]);
    }
    closeSheet(); closeSheet(); toast('Usuário salvo');
    await listaUsuarios();
  });
}

function formMinhaSenha() {
  const s = sheet(`
    <h3>Alterar minha senha</h3>
    <div class="field"><label>Senha atual</label><input id="a" type="password"></div>
    <div class="field"><label>Nova senha</label><input id="b" type="password"></div>
    <div class="field"><label>Confirmar nova senha</label><input id="c2" type="password"></div>
    <div class="err" id="err"></div>
    <div class="btns two"><button class="btn ghost" id="c">Cancelar</button><button class="btn" id="ok">Salvar</button></div>`);
  $('#c', s).onclick = closeSheet;
  $('#ok', s).onclick = safe(async () => {
    const err = (m) => ($('#err', s).textContent = m);
    const nova = $('#b', s).value;
    if (nova.length < 6) return err('A nova senha precisa ter pelo menos 6 caracteres.');
    if (nova !== $('#c2', s).value) return err('As senhas não conferem.');
    // Confere a senha atual entrando de novo com ela.
    const { error: e1 } = await sb.auth.signInWithPassword({ email: emailDe(S.user.login, S.codigo), password: $('#a', s).value });
    if (e1) return err(/Invalid login credentials/i.test(e1.message) ? 'Senha atual incorreta.' : await erroAuth(e1));
    const { error: e2 } = await sb.auth.updateUser({ password: nova });
    if (e2) return err(await erroAuth(e2));
    closeSheet(); toast('Senha alterada');
  });
}

/* ---- Pacotes e planos ---- */
async function listaPacotes() {
  const rows = await DB.q(`SELECT p.*, s.nome AS servico,
      (SELECT COUNT(*) FROM clientes_pacotes cp WHERE cp.pacote_id=p.id AND cp.usados<cp.quantidade AND cp.fim>=?) AS ativos
    FROM pacotes p LEFT JOIN servicos s ON s.id=p.servico_id ORDER BY p.ativo DESC, p.nome`, [today()]);
  const s = sheet(`
    <h3>Pacotes e planos</h3>
    <p class="hint" style="margin-top:-8px">Venda o pacote na ficha do cliente. Ao concluir o atendimento, o app desconta um uso do pacote.</p>
    <div class="list">${rows.map((p) => `
      <button class="item" data-p="${p.id}">
        <div class="main"><div class="t">${esc(p.nome)}${p.ativo ? '' : ' <span class="badge b-faltou">inativo</span>'}</div>
          <div class="s">${p.quantidade}× ${esc(p.servico || 'qualquer serviço')} · ${p.validade_dias} dias · ${money(p.preco / p.quantidade)} cada${p.ativos ? ` · ${p.ativos} cliente(s) com pacote ativo` : ''}</div></div>
        <div class="right">${money(p.preco)}</div>
      </button>`).join('') || '<div class="empty">Nenhum pacote cadastrado.</div>'}</div>
    <div class="btns" style="margin-top:14px"><button class="btn" id="novo">Novo pacote</button></div>`);
  s.querySelectorAll('[data-p]').forEach((b) => (b.onclick = safe(() => formPacote(rows.find((r) => r.id === Number(b.dataset.p))))));
  $('#novo', s).onclick = safe(() => formPacote());
}

async function formPacote(p = null) {
  const servicos = await DB.q('SELECT id, nome, preco FROM servicos WHERE ativo=1 ORDER BY nome');
  const v = p || { nome: '', servico_id: servicos[0] ? servicos[0].id : '', quantidade: 4, preco: '', validade_dias: 30, ativo: 1 };
  const s = sheet(`
    <h3>${p ? 'Editar pacote' : 'Novo pacote'}</h3>
    <div class="field"><label>Nome</label><input id="nome" value="${esc(v.nome)}" placeholder="Ex.: Plano mensal com 4 atendimentos"></div>
    <div class="field"><label>Vale para</label><select id="srv">${opt('', 'Qualquer serviço', v.servico_id || '')}${servicos.map((x) => opt(x.id, `${x.nome} (avulso ${money(x.preco)})`, v.servico_id)).join('')}</select></div>
    <div class="row2">
      <div class="field"><label>Quantidade de usos</label><input id="qtd" type="number" min="1" step="1" value="${esc(v.quantidade)}"></div>
      <div class="field"><label>Validade (dias)</label><input id="val" type="number" min="1" step="1" value="${esc(v.validade_dias)}"></div>
    </div>
    <div class="row2">
      <div class="field"><label>Preço do pacote (R$)</label><input id="preco" inputmode="decimal" value="${esc(moneyIn(v.preco))}"></div>
      ${p ? `<div class="field"><label>Situação</label><select id="ativo">${opt(1, 'Ativo', v.ativo)}${opt(0, 'Inativo', v.ativo)}</select></div>` : ''}
    </div>
    <p class="hint" id="info"></p>
    <div class="err" id="err"></div>
    <div class="btns two"><button class="btn ghost" id="c">Cancelar</button><button class="btn" id="ok">Salvar</button></div>`);
  const info = () => {
    const qtd = Number($('#qtd', s).value) || 0;
    const preco = parseMoney($('#preco', s).value);
    const srv = servicos.find((x) => x.id === Number($('#srv', s).value));
    $('#info', s).textContent = qtd && !isNaN(preco) ? `${money(preco / qtd)} por atendimento${srv ? ` · economia de ${money(srv.preco * qtd - preco)} para o cliente` : ''}` : '';
  };
  ['#qtd', '#preco'].forEach((k) => ($(k, s).oninput = info));
  $('#srv', s).onchange = info;
  info();
  $('#c', s).onclick = closeSheet;
  $('#ok', s).onclick = safe(async () => {
    const err = (m) => ($('#err', s).textContent = m);
    const nome = $('#nome', s).value.trim();
    const qtd = Number($('#qtd', s).value);
    const validade = Number($('#val', s).value);
    const preco = parseMoney($('#preco', s).value);
    if (!nome) return err('Informe o nome do pacote.');
    if (!Number.isInteger(qtd) || qtd < 1) return err('Quantidade inválida.');
    if (!Number.isInteger(validade) || validade < 1) return err('Validade inválida.');
    if (isNaN(preco) || preco < 0) return err('Preço inválido.');
    const srv = $('#srv', s).value ? Number($('#srv', s).value) : null;
    if (p) await DB.x('UPDATE pacotes SET nome=?, servico_id=?, quantidade=?, preco=?, validade_dias=?, ativo=? WHERE id=?', [nome, srv, qtd, preco, validade, Number($('#ativo', s).value), p.id]);
    else await DB.x('INSERT INTO pacotes (nome, servico_id, quantidade, preco, validade_dias) VALUES (?,?,?,?,?)', [nome, srv, qtd, preco, validade]);
    closeSheet(); closeSheet(); toast('Pacote salvo');
    await listaPacotes();
  });
}

/* ---- Cartão fidelidade ---- */
function formFidelidade() {
  const s = sheet(`
    <h3>Cartão fidelidade</h3>
    <p class="hint" style="margin-top:-8px">Conta sozinho os atendimentos pagos de cada cliente. Ao atingir a meta, o próximo pode ser concluído como cortesia. Atendimentos de pacote não contam.</p>
    <div class="row2">
      <div class="field"><label>Situação</label><select id="ativo">${opt('1', 'Ativo', cfg('fid_ativo', '0'))}${opt('0', 'Desativado', cfg('fid_ativo', '0'))}</select></div>
      <div class="field"><label>A cada quantos atendimentos</label><input id="meta" type="number" min="2" step="1" value="${esc(cfg('fid_meta', '10'))}"></div>
    </div>
    <div class="err" id="err"></div>
    <div class="btns two"><button class="btn ghost" id="c">Cancelar</button><button class="btn" id="ok">Salvar</button></div>`, { center: true });
  $('#c', s).onclick = closeSheet;
  $('#ok', s).onclick = safe(async () => {
    const meta = Number($('#meta', s).value);
    if (!Number.isInteger(meta) || meta < 2) return ($('#err', s).textContent = 'A meta precisa ser 2 ou mais.');
    await setCfgs([['fid_ativo', $('#ativo', s).value], ['fid_meta', String(meta)]]);
    closeAll(); refresh(); toast('Cartão fidelidade salvo');
  });
}

/* ---- Taxas da maquininha ---- */
function formTaxas() {
  const campo = (k, l) => `<div class="field"><label>${l} (%)</label><input id="${k}" inputmode="decimal" value="${esc(String(cfg(k, '0')).replace('.', ','))}"></div>`;
  const s = sheet(`
    <h3>Taxas da maquininha</h3>
    <p class="hint" style="margin-top:-8px">A taxa é calculada em cada recebimento e descontada do resultado. Vale para os lançamentos a partir de agora.</p>
    <div class="row2">${campo('taxa_debito', 'Débito')}${campo('taxa_credito', 'Crédito')}</div>
    ${campo('taxa_pix', 'Pix')}
    <div class="err" id="err"></div>
    <div class="btns two"><button class="btn ghost" id="c">Cancelar</button><button class="btn" id="ok">Salvar</button></div>`, { center: true });
  $('#c', s).onclick = closeSheet;
  $('#ok', s).onclick = safe(async () => {
    const vals = ['taxa_debito', 'taxa_credito', 'taxa_pix'].map((k) => [k, parseMoney($('#' + k, s).value || '0')]);
    if (vals.some(([, v]) => isNaN(v) || v < 0 || v > 30)) return ($('#err', s).textContent = 'Informe taxas entre 0 e 30%.');
    await setCfgs(vals.map(([k, v]) => [k, String(v)]));
    closeAll(); refresh(); toast('Taxas salvas');
  });
}

/* ---- Mensagens do WhatsApp ---- */
function formMensagens() {
  const s = sheet(`
    <h3>Mensagens do WhatsApp</h3>
    <p class="hint" style="margin-top:-8px">Use {nome}, {data}, {hora}, {servico}, {profissional}, {barbearia} e {desconto}. Elas são trocadas pelos dados do cliente.</p>
    ${Object.keys(MSG_PADRAO).map((k) => `
      <div class="field"><label>${esc(MSG_ROTULO[k])}</label><textarea id="m-${k}">${esc(cfg('msg_' + k, MSG_PADRAO[k]))}</textarea></div>`).join('')}
    <div class="field"><label>Desconto de aniversário (deixe vazio para não oferecer)</label><input id="desc" value="${esc(cfg('aniv_desconto', ''))}" placeholder="Ex.: 10%"></div>
    <div class="btns two"><button class="btn ghost" id="padrao">Restaurar padrão</button><button class="btn" id="ok">Salvar</button></div>`);
  $('#padrao', s).onclick = () => Object.keys(MSG_PADRAO).forEach((k) => ($('#m-' + k, s).value = MSG_PADRAO[k]));
  $('#ok', s).onclick = safe(async () => {
    await setCfgs([...Object.keys(MSG_PADRAO).map((k) => ['msg_' + k, $('#m-' + k, s).value.trim() || MSG_PADRAO[k]]), ['aniv_desconto', $('#desc', s).value.trim()]]);
    closeAll(); refresh(); toast('Mensagens salvas');
  });
}

/* ---- Horários e folgas ---- */
async function listaHorarios() {
  const rows = await DB.q(`SELECT u.id, u.nome, u.cor, u.horario, u.tempo_atendimento,
      (SELECT COUNT(*) FROM folgas f WHERE f.usuario_id=u.id AND f.data>=?) AS prox
    FROM usuarios u WHERE u.ativo=1 ORDER BY u.nome`, [today()]);
  const resumo = (u) => {
    let h = null;
    try { h = u.horario ? JSON.parse(u.horario) : null; } catch (e) { h = null; }
    if (!h) return 'Sem horário definido (08:00 às 20:00 todos os dias)';
    const dias = [1, 2, 3, 4, 5, 6, 0].filter((d) => h[d]);
    return dias.length ? dias.map((d) => `${DIAS[d]} ${h[d][0]}–${h[d][1]}`).join(' · ') : 'Nenhum dia de trabalho';
  };
  const s = sheet(`
    <h3>Horários e folgas</h3>
    <div class="list">${rows.map((u) => {
      const prox = u.prox;
      return `<button class="item" data-u="${u.id}">
        <div class="avatar" style="background:${esc(corProf(u.id, u.cor))};color:#1b150d">${esc(initials(u.nome))}</div>
        <div class="main"><div class="t">${esc(u.nome)}</div><div class="s">${esc(resumo(u))}</div>
          <div class="s">${u.tempo_atendimento ? `Cada atendimento: ${esc(textoTempo(u.tempo_atendimento))}` : 'Tempo de atendimento: o de cada serviço'}</div>${prox ? `<div class="s">${prox} folga(s) marcada(s)</div>` : ''}</div>
        <span style="color:var(--muted);width:18px">${ICON.right}</span>
      </button>`;
    }).join('')}</div>`);
  s.querySelectorAll('[data-u]').forEach((b) => (b.onclick = safe(() => formHorario(rows.find((r) => r.id === Number(b.dataset.u))))));
}

function formHorario(u) {
  let h = null;
  try { h = u.horario ? JSON.parse(u.horario) : null; } catch (e) { h = null; }
  const base = h || { 1: ['09:00', '19:00'], 2: ['09:00', '19:00'], 3: ['09:00', '19:00'], 4: ['09:00', '19:00'], 5: ['09:00', '19:00'], 6: ['09:00', '17:00'] };
  const s = sheet(`
    <h3>Horário e tempo de ${esc(u.nome.split(' ')[0])}</h3>
    <div class="list">${[1, 2, 3, 4, 5, 6, 0].map((d) => `
      <div class="item hr-row">
        <label class="check"><input type="checkbox" data-on="${d}" ${base[d] ? 'checked' : ''}> ${DIAS_LONGO[d]}</label>
        <input type="time" data-ini="${d}" value="${esc(base[d] ? base[d][0] : '09:00')}">
        <input type="time" data-fim="${d}" value="${esc(base[d] ? base[d][1] : '19:00')}">
      </div>`).join('')}</div>
    <div class="field" style="margin-top:14px"><label>Tempo de cada atendimento</label>
      <select id="tempo">${opt('', 'Usar a duração de cada serviço', u.tempo_atendimento || '')}${TEMPOS_ATENDIMENTO.map((m) => opt(m, textoTempo(m), u.tempo_atendimento || '')).join('')}</select>
      <div class="hint" style="margin-top:6px">Ex.: manicure que leva 2 h com cada cliente, barbeiro 45 min. Vale para a agenda e para o agendamento pelo site.</div></div>
    <div class="section-title">Folgas e ausências</div>
    <div class="row2">
      <div class="field"><label>Data</label><input id="fdata" type="date" value="${today()}"></div>
      <div class="field"><label>Motivo</label><input id="fmot" placeholder="Ex.: férias, médico"></div>
    </div>
    <button class="btn ghost" id="fadd">Marcar folga</button>
    <div id="folgas" style="margin-top:10px"></div>
    <div class="err" id="err"></div>
    <div class="btns two" style="margin-top:14px"><button class="btn ghost" id="c">Cancelar</button><button class="btn" id="ok">Salvar horário</button></div>`);
  const drawFolgas = serial(async () => {
    const rows = await DB.q('SELECT * FROM folgas WHERE usuario_id=? AND data>=? ORDER BY data', [u.id, today()]);
    $('#folgas', s).innerHTML = rows.length ? `<div class="list">${rows.map((f) => `
      <div class="item"><div class="main"><div class="t">${esc(fmtDay(f.data))}</div><div class="s">${esc(f.motivo || 'folga')}</div></div>
        <button class="icon-btn danger" data-rm="${f.id}" aria-label="Remover folga">${ICON.trash}</button></div>`).join('')}</div>` : '<div class="hint">Nenhuma folga marcada.</div>';
    s.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = safe(async () => { await DB.x('DELETE FROM folgas WHERE id=?', [Number(b.dataset.rm)]); drawFolgas(); })));
  });
  drawFolgas();
  $('#fadd', s).onclick = safe(async () => {
    const data = $('#fdata', s).value;
    if (!data) return ($('#err', s).textContent = 'Escolha a data da folga.');
    if (await DB.one('SELECT id FROM folgas WHERE usuario_id=? AND data=?', [u.id, data])) return ($('#err', s).textContent = 'Já existe folga nesse dia.');
    const n = await DB.val("SELECT COUNT(*) FROM agendamentos WHERE profissional_id=? AND data=? AND status='agendado'", [u.id, data]);
    await DB.x('INSERT INTO folgas (usuario_id, data, motivo) VALUES (?,?,?)', [u.id, data, $('#fmot', s).value.trim()]);
    $('#fmot', s).value = '';
    $('#err', s).textContent = '';
    drawFolgas();
    toast(n ? `Folga marcada. Atenção: há ${n} horário(s) agendado(s) nesse dia.` : 'Folga marcada', n > 0);
  });
  $('#c', s).onclick = closeSheet;
  $('#ok', s).onclick = safe(async () => {
    const novo = {};
    for (const d of [0, 1, 2, 3, 4, 5, 6]) {
      if (!$(`[data-on="${d}"]`, s).checked) continue;
      const ini = $(`[data-ini="${d}"]`, s).value;
      const fim = $(`[data-fim="${d}"]`, s).value;
      if (!ini || !fim || toMin(fim) <= toMin(ini)) return ($('#err', s).textContent = `Horário inválido em ${DIAS_LONGO[d]}.`);
      novo[d] = [ini, fim];
    }
    const tempo = $('#tempo', s).value ? Number($('#tempo', s).value) : null;
    await DB.x('UPDATE usuarios SET horario=?, tempo_atendimento=? WHERE id=?', [JSON.stringify(novo), tempo, u.id]);
    closeSheet(); closeSheet(); toast('Horário salvo');
    await listaHorarios();
  });
}

/* ---- Histórico de exclusões ---- */
async function listaExclusoes() {
  const rows = await DB.q('SELECT * FROM exclusoes ORDER BY id DESC LIMIT 200');
  const s = sheet(`
    <h3>Histórico de exclusões</h3>
    <p class="hint" style="margin-top:-8px">Só administradores podem excluir. Cada exclusão fica registrada aqui com os dados apagados.</p>
    <div class="list">${rows.map((x) => `
      <button class="item" data-x="${x.id}">
        <div class="main"><div class="t">${esc(x.descricao)}</div>
          <div class="s">${esc(fmtDate(x.criado_em.slice(0, 10)))} ${esc(x.criado_em.slice(11, 16))} · por ${esc(x.usuario_nome || '—')}</div></div>
      </button>`).join('') || '<div class="empty">Nenhuma exclusão registrada.</div>'}</div>`);
  s.querySelectorAll('[data-x]').forEach((b) => (b.onclick = safe(() => {
    const x = rows.find((r) => r.id === Number(b.dataset.x));
    let dados = {};
    try { dados = JSON.parse(x.dados || '{}'); } catch (e) { dados = {}; }
    const campos = Object.entries(dados).filter(([k, v]) => v !== null && v !== '' && !/hash|salt/.test(k));
    const d = sheet(`
      <h3>${esc(x.descricao)}</h3>
      <div class="kv"><span>Excluído em</span><span>${esc(fmtDate(x.criado_em.slice(0, 10)))} ${esc(x.criado_em.slice(11, 16))}</span></div>
      <div class="kv"><span>Por</span><span>${esc(x.usuario_nome || '—')}</span></div>
      <div class="section-title">Dados apagados</div>
      ${campos.map(([k, v]) => `<div class="kv"><span>${esc(k.replace(/_/g, ' '))}</span><span>${esc(v)}</span></div>`).join('')}
      <button class="btn ghost" id="close" style="margin-top:14px">Fechar</button>`);
    $('#close', d).onclick = closeSheet;
  })));
}

/* ---- Backup ---- */
const TABELAS = ['config', 'usuarios', 'clientes', 'servicos', 'produtos', 'pacotes', 'clientes_pacotes', 'agendamentos', 'lancamentos',
  'vendas_produtos', 'compras_estoque', 'despesas_fixas', 'folgas', 'fechamentos', 'exclusoes'];

async function dadosBackup() {
  const dados = { app: 'barbearia', versao: 4, origem: 'supabase', gerado_em: new Date().toISOString(), tabelas: {} };
  const linhas = await Promise.all(TABELAS.map((t) => DB.q(`SELECT * FROM ${t}${t === 'config' ? '' : ' ORDER BY id'}`)));
  TABELAS.forEach((t, i) => (dados.tabelas[t] = linhas[i]));
  return dados;
}

async function baixarBackup(enviar) {
  const nome = `backup-${S.codigo}-${today()}-${Date.now().toString().slice(-5)}.json`;
  await arquivo(nome, JSON.stringify(await dadosBackup()), enviar);
  await setCfg('backup_ultimo', today());
}

function telaBackup() {
  const ultimo = cfg('backup_ultimo', '');
  const s = sheet(`
    <h3>Backup dos dados</h3>
    <p class="hint" style="margin-top:-6px">Os dados já ficam guardados na nuvem. O backup baixa uma cópia extra num arquivo (pasta <b>Downloads</b>). Guarde uma cópia no Google Drive ou envie para você no WhatsApp.</p>
    <div class="kv"><span>Último backup</span><span>${ultimo ? esc(fmtDate(ultimo)) : 'nunca'}</span></div>
    <div class="field" style="margin-top:12px"><label>Backup automático</label>
      <select id="auto">${opt('1', 'Lembrar toda semana', cfg('backup_auto', '1'))}${opt('0', 'Desligado', cfg('backup_auto', '1'))}</select></div>
    <div class="btns" style="margin-top:6px">
      <button class="btn" id="exp">Baixar backup</button>
      ${navigator.canShare ? '<button class="btn ghost" id="enviar">Enviar (WhatsApp, Drive…)</button>' : ''}
    </div>
    <p class="hint" style="margin-top:14px">O arquivo serve como cópia de segurança e para abrir os dados em outro programa.</p>`);
  $('#auto', s).onchange = safe(async (e) => {
    await setCfg('backup_auto', e.target.value);
    toast(e.target.value === '1' ? 'Lembrete de backup ligado' : 'Lembrete de backup desligado');
  });
  if ($('#enviar', s)) $('#enviar', s).onclick = safe(async () => { await baixarBackup(true); closeSheet(); });
  $('#exp', s).onclick = safe(async () => { await baixarBackup(false); closeSheet(); });
}

/* ---------------- Início ---------------- */
window.addEventListener('error', (e) => toast(e.message, true));
window.addEventListener('unhandledrejection', (e) => { e.preventDefault(); falha(e.reason); });
document.addEventListener('DOMContentLoaded', safe(async () => {
  // Link do estabelecimento: app/?b=codigo já escolhe o código.
  const doLink = (new URLSearchParams(location.search).get('b') || '').trim().toLowerCase();
  if (doLink && doLink !== lerLocal('barbeariaCodigo')) {
    gravarLocal('barbeariaCodigo', doLink);
    await sb.auth.signOut({ scope: 'local' }).catch(() => {});
  }
  await renderLogin();
}));
