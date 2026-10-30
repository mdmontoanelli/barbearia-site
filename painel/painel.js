/* Painel da plataforma (só para quem está ativo em plataforma_admins).
   Menu lateral com: dashboard dos clientes (estabelecimentos), lista e cadastro de
   barbearias, manicures e salões de beleza, financeiro das mensalidades e despesas,
   e os usuários que podem entrar neste painel.
   O painel não enxerga os dados internos dos estabelecimentos (só contagens de uso). */
'use strict';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, storageKey: 'painel-barbearias' } });
const chamar = (fn, args) => rpc(sb, fn, args);
const P = { lista: [], pagamentos: [], lancamentos: [], busca: '', filtro: 'todas', filtroTipo: 'todos', finModo: 'mes', finRef: today().slice(0, 7) };
const FORMAS = ['Pix', 'Dinheiro', 'Transferência', 'Boleto', 'Cartão'];
const CAT_ENTRADA = ['Implantação', 'Treinamento', 'Serviço extra', 'Outros'];
const CAT_SAIDA = ['Servidor / Supabase', 'Domínio', 'Anúncios', 'Comissão de venda', 'Impostos', 'Ferramentas', 'Outros'];
const STATUS = { em_dia: 'Em dia', a_vencer: 'Vence em breve', vencida: 'Vencida', inativa: 'Desativado' };
const MESES_CURTOS = MESES.map((m) => m.slice(0, 3));

const linkAgendar = (codigo) => new URL(`../agendar/?b=${encodeURIComponent(codigo)}`, location.href).href;
const linkSistema = (codigo) => new URL(`../app/?b=${encodeURIComponent(codigo)}`, location.href).href;

const I = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICON = {
  dash: I('<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>'),
  lista: I('<path d="M3 21h18M5 21V8l7-5 7 5v13"/><path d="M9 21v-6h6v6"/>'),
  novo: I('<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>'),
  fin: I('<rect x="2" y="6" width="20" height="13" rx="2"/><circle cx="12" cy="12.5" r="3"/><path d="M6 10v5M18 10v5"/>'),
  usuarios: I('<circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-6 7-6s7 2 7 6"/><path d="M16 4a4 4 0 010 8M22 21c0-3-2-5-4-5.5"/>'),
  sair: I('<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11"/>'),
  menu: I('<path d="M4 6h16M4 12h16M4 18h16"/>'),
  esq: I('<path d="M15 18l-6-6 6-6"/>'),
  dir: I('<path d="M9 6l6 6-6 6"/>'),
};

async function tabela(consulta) {
  carregando(1);
  try {
    const { data, error } = await consulta;
    if (error) throw new Error(error.message);
    return data;
  } finally { carregando(-1); }
}

/* ---------------- Regras do aluguel (iguais às do banco: situacao_aluguel) ---------------- */
const ultimoDiaMes = (ref) => new Date(Number(ref.slice(0, 4)), Number(ref.slice(5, 7)), 0).getDate();
const vencimentoDe = (ref, dia) => `${ref}-${pad(Math.min(dia, ultimoDiaMes(ref)))}`;
const proxMes = (ref) => { const [y, m] = ref.split('-').map(Number); const d = new Date(y, m, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const somarMeses = (ref, n) => { const [y, m] = ref.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const diasAte = (data) => Math.round((parseDate(data) - parseDate(today())) / 86400000);

/* Mensalidades de um estabelecimento ativo: as vencidas sem pagamento e a próxima em aberto. */
function mensalidades(b) {
  const pagos = new Set(P.pagamentos.filter((p) => p.barbearia_id === b.id).map((p) => p.referencia));
  let ref = String(b.inicio).slice(0, 7);
  if (vencimentoDe(ref, b.dia_vencimento) < String(b.inicio)) ref = proxMes(ref);
  const vencidas = [];
  for (let i = 0; i < 240; i++, ref = proxMes(ref)) {
    if (pagos.has(ref)) continue;
    const venc = vencimentoDe(ref, b.dia_vencimento);
    if (venc >= today()) return { vencidas, proxima: { ref, venc } };
    vencidas.push({ ref, venc });
  }
  return { vencidas, proxima: null };
}

/* ---------------- Entrada ---------------- */
async function iniciar() {
  const { data } = await sb.auth.getSession();
  if (!data.session) return telaLogin();
  const eu = await tabela(sb.from('plataforma_admins').select('*').eq('auth_id', data.session.user.id));
  if (!eu.length || eu[0].ativo === 0) {
    await sb.auth.signOut();
    return telaLogin(eu.length ? 'Esta conta foi desativada.' : 'Esta conta não tem acesso ao painel.');
  }
  P.nome = eu[0].nome;
  P.email = data.session.user.email;
  montarPainel();
  return irPara();
}

function telaLogin(aviso = '') {
  closeAll();
  $('#app').className = 'pagina';
  $('#app').innerHTML = `
    <div class="brand"><div class="icones-login">${Object.keys(TIPOS).map((t) => logoTipo(t, null, 48)).join('')}</div>
      <h1>Painel</h1><p>Barbearias, manicures e salões de beleza</p></div>
    <form id="f">
      <div class="field"><label>E-mail</label><input id="email" type="email" autocomplete="username" required></div>
      <div class="field"><label>Senha</label><input id="senha" type="password" autocomplete="current-password" required></div>
      <div class="err" id="err">${esc(aviso)}</div>
      <button class="btn" type="submit">Entrar</button>
    </form>`;
  $('#f').onsubmit = safe(async (e) => {
    e.preventDefault();
    const { error } = await sb.auth.signInWithPassword({ email: $('#email').value.trim(), password: $('#senha').value });
    if (error) { $('#senha').value = ''; return ($('#err').textContent = mensagemErro(error)); }
    return iniciar();
  });
}

/* ---------------- Estrutura: menu lateral + área principal ---------------- */
const ROTAS = {
  dashboard: { rotulo: 'Dashboard', icone: 'dash', render: telaDashboard },
  estabelecimentos: { rotulo: 'Estabelecimentos', icone: 'lista', render: telaLista },
  novo: { rotulo: 'Novo cadastro', icone: 'novo', render: telaNovo },
  financeiro: { rotulo: 'Financeiro', icone: 'fin', render: telaFinanceiro },
  usuarios: { rotulo: 'Usuários do painel', icone: 'usuarios', render: telaUsuarios },
};

function montarPainel() {
  $('#app').className = 'painel';
  $('#app').innerHTML = `
    <aside class="menu" id="menu">
      <div class="marca"><div class="icones">${Object.keys(TIPOS).map((t) => logoTipo(t, null, 26)).join('')}</div>
        <div><b>Painel</b><small>Gestão dos estabelecimentos</small></div></div>
      ${Object.entries(ROTAS).map(([k, r]) => `<a href="#${k}" data-r="${k}">${ICON[r.icone]}<span>${r.rotulo}</span></a>`).join('')}
      <div class="rodape"><div style="color:var(--text);font-weight:600">${esc(P.nome)}</div><div>${esc(P.email)}</div>
        <a href="#" id="sair" style="padding:10px 0 0">${ICON.sair}<span>Sair</span></a></div>
    </aside>
    <div class="menu-fundo" id="fundo"></div>
    <main class="principal">
      <header class="topo-web">
        <div class="titulo"><button class="hamb" id="hamb" aria-label="Abrir menu">${ICON.menu}</button>
          <div><h1 id="titulo"></h1><div class="sub" id="subtitulo"></div></div></div>
        <div class="acoes" id="acoes"></div>
      </header>
      <div id="tela"></div>
    </main>`;
  const fechar = () => $('#app').classList.remove('aberto');
  $('#hamb').onclick = () => $('#app').classList.add('aberto');
  $('#fundo').onclick = fechar;
  document.querySelectorAll('[data-r]').forEach((a) => a.addEventListener('click', fechar));
  $('#sair').onclick = safe(async (e) => { e.preventDefault(); await sb.auth.signOut(); location.hash = ''; telaLogin(); });
}

const rotaAtual = () => (ROTAS[location.hash.slice(1)] ? location.hash.slice(1) : 'dashboard');
const irPara = serial(async () => {
  if (!$('#tela')) return;
  const r = rotaAtual();
  closeAll();
  document.querySelectorAll('[data-r]').forEach((a) => a.classList.toggle('on', a.dataset.r === r));
  $('#titulo').textContent = ROTAS[r].rotulo;
  $('#subtitulo').textContent = '';
  $('#acoes').innerHTML = '';
  document.title = `${ROTAS[r].rotulo} · Painel`;
  await ROTAS[r].render($('#tela'));
});
window.addEventListener('hashchange', () => irPara());

async function carregarTudo() {
  [P.lista, P.pagamentos, P.lancamentos] = await Promise.all([
    chamar('plataforma_barbearias'),
    tabela(sb.from('pagamentos_aluguel').select('*').order('pago_em', { ascending: false })),
    tabela(sb.from('plataforma_lancamentos').select('*').order('data', { ascending: false })),
  ]);
  P.pagamentos.forEach((p) => (p.valor = Number(p.valor)));
  P.lancamentos.forEach((l) => (l.valor = Number(l.valor)));
}
const porId = (id) => P.lista.find((b) => b.id === id);

/* Colunas de uma série só (HTML), com o valor no toque/hover e a última coluna destacada. */
function colunas(dados, fmt) {
  const max = Math.max(...dados.map((d) => d.v), 0) || 1;
  return `<div class="colunas" role="img" aria-label="${esc(dados.map((d) => `${d.k}: ${fmt(d.v)}`).join('; '))}">${dados.map((d, i) => {
    const h = Math.round((d.v / max) * 100);
    return `<div class="col${i === dados.length - 1 ? ' atual' : ''}" tabindex="0" style="--h:${h}%">
      <i style="height:${h}%"></i><span class="v">${esc(fmt(d.v))}</span><span class="tip"><b>${esc(d.k)}</b><br>${esc(fmt(d.v))}${d.extra ? `<br>${esc(d.extra)}` : ''}</span></div>`;
  }).join('')}</div>
  <div class="rotulos">${dados.map((d) => `<span>${esc(d.curto || d.k)}</span>`).join('')}</div>`;
}
const barras = (linhas, fmt) => `<div class="bars">${linhas.map((r) => {
  const max = Math.max(...linhas.map((x) => x.v), 0) || 1;
  return `<div class="row"><span class="n">${esc(r.k)}</span><span class="bar"><i style="width:${Math.round((r.v / max) * 100)}%"></i></span><span class="v">${fmt(r.v, r)}</span></div>`;
}).join('')}</div>`;
const ultimos12 = () => Array.from({ length: 12 }, (_, i) => somarMeses(today().slice(0, 7), i - 11));

/* ======================= DASHBOARD ======================= */
async function telaDashboard(el) {
  await carregarTudo();
  const ativos = P.lista.filter((b) => b.ativo);
  const mrr = ativos.reduce((t, b) => t + Number(b.valor_mensal), 0);
  const mes = today().slice(0, 7);
  const recebidoMes = P.pagamentos.filter((p) => p.pago_em.slice(0, 7) === mes).reduce((t, p) => t + p.valor, 0);
  const abertos = ativos.map((b) => ({ b, m: mensalidades(b) }));
  const atrasados = abertos.filter((x) => x.m.vencidas.length);
  const valorAtraso = atrasados.reduce((t, x) => t + x.m.vencidas.length * Number(x.b.valor_mensal), 0);
  const novosMes = P.lista.filter((b) => String(b.inicio).slice(0, 7) === mes).length;
  const meses = ultimos12();
  const novos = meses.map((k) => ({ k: monthLabel(k), curto: MESES_CURTOS[Number(k.slice(5)) - 1], v: P.lista.filter((b) => String(b.inicio).slice(0, 7) === k).length }));
  const vencendo = abertos.filter((x) => x.m.proxima && diasAte(x.m.proxima.venc) <= 7 && !x.m.vencidas.length)
    .sort((a, b) => a.m.proxima.venc.localeCompare(b.m.proxima.venc));
  const parados = ativos.filter((b) => !b.ultimo_acesso || diasAte(b.ultimo_acesso.slice(0, 10)) < -14);
  const maisAtivos = [...ativos].sort((a, b) => b.atendimentos_30d - a.atendimentos_30d).slice(0, 6);
  const cidades = Object.entries(ativos.reduce((o, b) => { const c = b.cidade || 'Sem cidade'; o[c] = (o[c] || 0) + 1; return o; }, {}))
    .map(([k, v]) => ({ k, v })).sort((a, b) => b.v - a.v).slice(0, 6);
  const totalClientes = ativos.reduce((t, b) => t + b.clientes, 0);
  const totalAtend = ativos.reduce((t, b) => t + b.atendimentos_30d, 0);

  $('#subtitulo').textContent = `Olá, ${P.nome.split(' ')[0]} · ${fmtDay(today())}`;
  $('#acoes').innerHTML = '<a class="btn small" href="#novo" style="text-decoration:none">+ Novo cadastro</a>';
  const linhaEstab = (b, dir) => `<button class="item" data-b="${b.id}">${logoTipo(b.tipo, corDe(b), 40)}
      <div class="main"><div class="t">${esc(b.nome)}</div><div class="s">${dir.s}</div></div><div class="right">${dir.r}</div></button>`;

  el.innerHTML = `
    <div class="grade k4">
      <div class="stat"><div class="lbl">Estabelecimentos ativos</div><div class="val">${ativos.length}</div><div class="det">${novosMes} novo(s) este mês</div></div>
      <div class="stat gold"><div class="lbl">Receita mensal (contratos)</div><div class="val">${money(mrr)}</div><div class="det">média ${money(ativos.length ? mrr / ativos.length : 0)} por cliente</div></div>
      <div class="stat"><div class="lbl">Recebido em ${esc(MESES[Number(mes.slice(5)) - 1].toLowerCase())}</div><div class="val">${money(recebidoMes)}</div><div class="det">mensalidades pagas no mês</div></div>
      <div class="stat"><div class="lbl">Em atraso</div><div class="val ${valorAtraso ? 'neg' : ''}">${money(valorAtraso)}</div><div class="det">${atrasados.length} cliente(s) com mensalidade vencida</div></div>
    </div>

    <div class="section-title">Clientes por tipo</div>
    <div class="grade k3">${Object.entries(TIPOS).map(([t, info]) => {
      const doTipo = ativos.filter((b) => b.tipo === t);
      return `<a class="card tipo-card" href="#estabelecimentos" data-tipo="${t}" style="text-decoration:none;color:inherit">${logoTipo(t, null, 52)}
        <div><div class="n">${doTipo.length}</div><div class="s">${esc(doTipo.length === 1 ? info.nome : info.plural)} · ${money(doTipo.reduce((x, b) => x + Number(b.valor_mensal), 0))}/mês</div></div></a>`;
    }).join('')}</div>

    <div class="grade k2" style="margin-top:12px">
      <div class="card"><h4>Novos clientes por mês</h4>${colunas(novos, (v) => `${v} novo(s)`)}
        <details class="tabela"><summary>Ver tabela</summary><table class="dados"><tr><th>Mês</th><th>Novos</th></tr>
          ${novos.map((n) => `<tr><td>${esc(n.k)}</td><td>${n.v}</td></tr>`).join('')}</table></details></div>
      <div class="card"><h4>Uso do sistema (últimos 30 dias)</h4>
        <div class="grade k2" style="gap:10px">
          <div class="stat"><div class="lbl">Atendimentos concluídos</div><div class="val">${totalAtend}</div></div>
          <div class="stat"><div class="lbl">Clientes cadastrados</div><div class="val">${totalClientes}</div></div>
        </div>
        <div class="section-title" style="margin-top:16px">Mais movimentados</div>
        ${maisAtivos.length ? barras(maisAtivos.map((b) => ({ k: b.nome, v: b.atendimentos_30d })), (v) => `${v} atend.`) : '<div class="empty">Sem dados ainda.</div>'}
      </div>
    </div>

    <div class="grade k2">
      <div>
        <div class="section-title">Mensalidades vencidas</div>
        ${atrasados.length ? `<div class="list">${atrasados.sort((a, b) => b.m.vencidas.length - a.m.vencidas.length).map((x) => linhaEstab(x.b, {
          s: `${x.m.vencidas.length} mês(es) · desde ${esc(fmtDate(x.m.vencidas[0].venc))}`,
          r: `<span class="neg">${money(x.m.vencidas.length * Number(x.b.valor_mensal))}</span>` })).join('')}</div>`
          : '<div class="card empty">Nenhuma mensalidade vencida. 🎉</div>'}
        <div class="section-title">Vencem nos próximos 7 dias</div>
        ${vencendo.length ? `<div class="list">${vencendo.map((x) => linhaEstab(x.b, {
          s: `${diasAte(x.m.proxima.venc) === 0 ? 'Vence hoje' : `Vence ${esc(fmtDate(x.m.proxima.venc))}`} · ${esc(monthLabel(x.m.proxima.ref))}`,
          r: money(x.b.valor_mensal) })).join('')}</div>` : '<div class="card empty">Nada vencendo esta semana.</div>'}
      </div>
      <div>
        <div class="section-title">Sem acesso há mais de 14 dias</div>
        ${parados.length ? `<div class="list">${parados.map((b) => linhaEstab(b, {
          s: b.ultimo_acesso ? `Último acesso ${esc(fmtDate(b.ultimo_acesso.slice(0, 10)))}` : 'Nunca entrou no sistema',
          r: '<span class="chip-st st-a_vencer">Atenção</span>' })).join('')}</div>`
          : '<div class="card empty">Todos os clientes estão usando o sistema.</div>'}
        <div class="section-title">Por cidade</div>
        <div class="card">${cidades.length ? barras(cidades, (v) => `${v}`) : '<div class="empty">Sem dados ainda.</div>'}</div>
      </div>
    </div>`;
  el.querySelectorAll('[data-b]').forEach((x) => (x.onclick = safe(() => detalhe(Number(x.dataset.b)))));
  el.querySelectorAll('[data-tipo]').forEach((x) => (x.onclick = () => { P.filtroTipo = x.dataset.tipo; P.filtro = 'todas'; }));
}

/* ======================= LISTA DE ESTABELECIMENTOS ======================= */
const statusDe = (b) => (b.ativo ? b.situacao.status : 'inativa');
function textoSituacao(b) {
  if (!b.ativo) return 'Desativado';
  const s = b.situacao;
  if (s.status === 'vencida') return `Vencida há ${-s.dias} dia(s) · ${monthLabel(s.referencia)}`;
  if (s.dias === 0) return `Vence hoje · ${monthLabel(s.referencia)}`;
  return `Vence ${fmtDate(s.vencimento)} (${s.dias} dia(s)) · ${monthLabel(s.referencia)}`;
}

async function telaLista(el) {
  await carregarTudo();
  $('#subtitulo').textContent = `${P.lista.filter((b) => b.ativo).length} ativo(s) de ${P.lista.length}`;
  $('#acoes').innerHTML = '<a class="btn small" href="#novo" style="text-decoration:none">+ Novo cadastro</a>';
  el.innerHTML = `
    <div class="filtros">
      <input class="search" id="busca" type="search" placeholder="Buscar por nome, código, cidade ou responsável" value="${esc(P.busca)}" style="margin:0">
    </div>
    <div class="seg" id="ftipo">${[['todos', 'Todos os tipos'], ...Object.entries(TIPOS).map(([k, t]) => [k, t.nome])]
      .map(([k, l]) => `<button data-t="${k}" class="${P.filtroTipo === k ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>
    <div class="seg" id="filtro">${[['todas', 'Todas'], ['vencida', 'Vencidas'], ['a_vencer', 'A vencer'], ['em_dia', 'Em dia'], ['inativa', 'Desativados']]
      .map(([k, l]) => `<button data-f="${k}" class="${P.filtro === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div id="lista"></div>`;
  $('#busca').oninput = (e) => { P.busca = e.target.value; desenharLista(); };
  const ligar = (attr, chave) => el.querySelectorAll(`[data-${attr}]`).forEach((b) => (b.onclick = () => {
    P[chave] = b.dataset[attr];
    el.querySelectorAll(`[data-${attr}]`).forEach((x) => x.classList.toggle('on', x === b));
    desenharLista();
  }));
  ligar('f', 'filtro');
  ligar('t', 'filtroTipo');
  desenharLista();
}

function desenharLista() {
  const termo = P.busca.trim().toLowerCase();
  const ordem = { vencida: 0, a_vencer: 1, em_dia: 2, inativa: 3 };
  const rows = P.lista
    .filter((b) => P.filtro === 'todas' || statusDe(b) === P.filtro)
    .filter((b) => P.filtroTipo === 'todos' || b.tipo === P.filtroTipo)
    .filter((b) => !termo || [b.nome, b.codigo, b.cidade, b.responsavel].some((x) => String(x || '').toLowerCase().includes(termo)))
    .sort((a, b) => ordem[statusDe(a)] - ordem[statusDe(b)] || (a.ativo ? a.situacao.dias - b.situacao.dias : 0) || a.nome.localeCompare(b.nome));
  $('#lista').innerHTML = rows.length ? `<div class="list">${rows.map((b) => `
    <button class="item" data-b="${b.id}">
      ${logoTipo(b.tipo, corDe(b), 40)}
      <div class="main">
        <div class="t">${esc(b.nome)} <span class="hint">· ${esc(tipoDe(b.tipo).nome)} · ${esc(b.codigo)}</span></div>
        <div class="s">${esc([b.cidade, b.responsavel, `${b.usuarios} usuário(s)`, `${b.clientes} cliente(s)`].filter(Boolean).join(' · '))}</div>
        <div class="s">${esc(textoSituacao(b))}</div>
      </div>
      <div class="right"><div>${money(b.valor_mensal)}</div><span class="chip-st st-${statusDe(b)}">${STATUS[statusDe(b)]}</span></div>
    </button>`).join('')}</div>`
    : `<div class="card empty">${P.lista.length ? 'Nenhum estabelecimento neste filtro.' : 'Nenhum estabelecimento cadastrado ainda. Use “Novo cadastro” no menu.'}</div>`;
  document.querySelectorAll('#lista [data-b]').forEach((el) => (el.onclick = safe(() => detalhe(Number(el.dataset.b)))));
}

/* ======================= CADASTRO (novo e editar) ======================= */
/* Tipo (com logo) e cor do estabelecimento, com prévia. Os valores ficam em root.dataset. */
function camposTipoCor(b) {
  const tipo = b.tipo || 'barbearia';
  const cor = b.cor || '';
  return `
    <div class="field"><label>Tipo de estabelecimento</label>
      <div class="tipos-escolha">${Object.entries(TIPOS).map(([k, t]) => `
        <button type="button" data-tipo="${k}" class="${k === tipo ? 'on' : ''}">${logoTipo(k, null, 48)}<span>${esc(t.nome)}</span></button>`).join('')}</div></div>
    <div class="field"><label>Cor do estabelecimento (aparece no sistema da equipe e na página de agendamento)</label>
      <div class="cores">${PALETA_CORES.map((c) => `<button type="button" class="cor" data-cor="${c}" style="background:${c}" aria-label="Cor ${c}"></button>`).join('')}
        <label class="outra"><input type="color" id="cor-livre" value="${esc(cor || tipoDe(tipo).cor)}">Escolher outra cor</label>
        <button type="button" class="link" id="cor-padrao">Usar a cor padrão do tipo</button></div></div>
    <div class="previa" id="previa"></div>`;
}
function ligarTipoCor(root, b, aoMudar = () => {}) {
  root.dataset.tipo = b.tipo || 'barbearia';
  root.dataset.cor = b.cor || '';
  const desenhar = () => {
    const t = root.dataset.tipo;
    const cor = root.dataset.cor || tipoDe(t).cor;
    root.querySelectorAll('[data-tipo]').forEach((x) => {
      x.classList.toggle('on', x.dataset.tipo === t);
      x.querySelector('.logo-tipo').style.setProperty('--c', x.dataset.tipo === t ? cor : tipoDe(x.dataset.tipo).cor);
    });
    root.querySelectorAll('[data-cor]').forEach((x) => x.classList.toggle('on', x.dataset.cor === cor));
    $('#cor-livre', root).value = cor;
    const nome = ($('#nome', root) && $('#nome', root).value.trim()) || `Nome d${tipoDe(t).artigo} ${tipoDe(t).nome.toLowerCase()}`;
    $('#previa', root).style.cssText = `--c:${cor};--on:${textoSobre(cor)}`;
    $('#previa', root).innerHTML = `${logoTipo(t, cor, 52)}<div><div class="nome">${esc(nome)}</div><div class="hint">${esc(tipoDe(t).nome)} · prévia</div></div><span class="bt">Agendar</span>`;
    aoMudar();
  };
  root.querySelectorAll('[data-tipo]').forEach((x) => (x.onclick = () => {
    // Trocar o tipo sem cor escolhida acompanha a cor padrão do novo tipo.
    root.dataset.tipo = x.dataset.tipo;
    desenhar();
  }));
  root.querySelectorAll('[data-cor]').forEach((x) => (x.onclick = () => { root.dataset.cor = x.dataset.cor; desenhar(); }));
  $('#cor-livre', root).oninput = (e) => { root.dataset.cor = e.target.value.toLowerCase(); desenhar(); };
  $('#cor-padrao', root).onclick = () => { root.dataset.cor = ''; desenhar(); };
  if ($('#nome', root)) $('#nome', root).addEventListener('input', desenhar);
  desenhar();
}

function camposEstabelecimento(b) {
  return `
    <div class="row2">
      <div class="field"><label>Nome do estabelecimento</label><input id="nome" value="${esc(b.nome || '')}"></div>
      <div class="field"><label>Cidade</label><input id="cidade" value="${esc(b.cidade || '')}"></div>
    </div>
    <div class="row2">
      <div class="field"><label>Responsável</label><input id="responsavel" value="${esc(b.responsavel || '')}"></div>
      <div class="field"><label>Telefone / WhatsApp</label><input id="telefone" type="tel" value="${esc(fmtPhone(b.telefone || ''))}"></div>
    </div>
    <div class="field"><label>E-mail (opcional)</label><input id="email" type="email" value="${esc(b.email || '')}"></div>
    <div class="row3" style="grid-template-columns:1fr 1fr 1.2fr">
      <div class="field"><label>Mensalidade (R$)</label><input id="valor" inputmode="decimal" value="${esc(moneyIn(b.valor_mensal ?? ''))}"></div>
      <div class="field"><label>Dia do vencimento</label><input id="dia" type="number" min="1" max="31" value="${esc(b.dia_vencimento ?? 10)}"></div>
      <div class="field"><label>Início do contrato</label><input id="inicio" type="date" value="${esc(b.inicio || today())}"></div>
    </div>
    <div class="field"><label>Observações</label><textarea id="obs">${esc(b.observacoes || '')}</textarea></div>`;
}
function lerCampos(s) {
  const d = {
    nome: $('#nome', s).value.trim(),
    tipo: s.dataset.tipo || 'barbearia',
    cor: s.dataset.cor || null,
    cidade: $('#cidade', s).value.trim() || null,
    responsavel: $('#responsavel', s).value.trim() || null,
    telefone: fmtPhone($('#telefone', s).value.trim()) || null,
    email: $('#email', s).value.trim() || null,
    valor_mensal: parseMoney($('#valor', s).value),
    dia_vencimento: Number($('#dia', s).value),
    inicio: $('#inicio', s).value,
    observacoes: $('#obs', s).value.trim() || null,
  };
  if (!d.nome) throw new Error('Informe o nome do estabelecimento.');
  if (isNaN(d.valor_mensal) || d.valor_mensal < 0) throw new Error('Informe o valor da mensalidade.');
  if (!Number.isInteger(d.dia_vencimento) || d.dia_vencimento < 1 || d.dia_vencimento > 31) throw new Error('Dia do vencimento entre 1 e 31.');
  if (!d.inicio) throw new Error('Informe o início do contrato.');
  return d;
}

const sugerirCodigo = (nome) => nome.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/^(barbearia|salao( de beleza)?|studio|estudio|espaco|esmalteria)\s+(d[aoe]s?\s+)?/, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);

async function telaNovo(el) {
  if (!P.lista.length) await carregarTudo();
  $('#subtitulo').textContent = 'Barbearia, manicure ou salão de beleza';
  el.innerHTML = `
    <div class="form-pagina" id="form">
      <div class="card"><h4>Tipo e cor</h4>${camposTipoCor({})}</div>
      <div class="card"><h4>Dados do estabelecimento</h4>${camposEstabelecimento({})}
        <div class="field"><label>Código (vai no link e no login da equipe; não dá para mudar depois)</label>
          <input id="codigo" autocapitalize="none" autocorrect="off" placeholder="ex.: studiodaana"></div>
        <p class="hint" id="link-prev" style="margin-top:-6px"></p></div>
      <div class="card"><h4>Administrador do estabelecimento</h4>
        <div class="row2">
          <div class="field"><label>Nome</label><input id="anome"></div>
          <div class="field"><label>Usuário (login no sistema)</label><input id="alogin" autocapitalize="none" autocorrect="off"></div>
        </div>
        <div class="field"><label>Senha inicial (mínimo 6)</label><input id="asenha" type="text" autocomplete="off"></div>
        <div class="err" id="err"></div>
        <div class="btns two"><a class="btn ghost" href="#estabelecimentos" style="text-align:center;text-decoration:none">Cancelar</a><button class="btn" id="ok">Cadastrar</button></div>
      </div>
    </div>`;
  const s = $('#form', el);
  ligarTipoCor(s, {});
  let codigoMexido = false;
  const prever = () => { const c = $('#codigo', s).value.trim().toLowerCase(); $('#link-prev', s).textContent = c ? `Sistema da equipe: ${linkSistema(c)} · Agendamento: ${linkAgendar(c)}` : ''; };
  $('#nome', s).addEventListener('input', () => { if (!codigoMexido) { $('#codigo', s).value = sugerirCodigo($('#nome', s).value); prever(); } });
  $('#responsavel', s).oninput = () => { if (!$('#anome', s).dataset.mexido) $('#anome', s).value = $('#responsavel', s).value; };
  $('#anome', s).oninput = () => { $('#anome', s).dataset.mexido = '1'; };
  $('#codigo', s).oninput = () => { codigoMexido = true; prever(); };
  $('#ok', s).onclick = safe(async () => {
    const err = (m) => { $('#err', s).textContent = m; };
    let d;
    try { d = lerCampos(s); } catch (e) { return err(e.message); }
    d.codigo = $('#codigo', s).value.trim().toLowerCase();
    const admin = { nome: $('#anome', s).value.trim(), login: $('#alogin', s).value.trim(), senha: $('#asenha', s).value };
    if (!/^[a-z0-9][a-z0-9-]{1,29}$/.test(d.codigo)) return err('Código: de 2 a 30 letras minúsculas, números ou hífen, sem espaço.');
    if (!admin.nome || !admin.login) return err('Informe nome e usuário do administrador.');
    if (admin.senha.length < 6) return err('A senha inicial precisa ter pelo menos 6 caracteres.');
    if (P.lista.some((b) => b.codigo === d.codigo)) return err('Já existe um estabelecimento com este código.');
    // 1) conta de acesso do administrador (sem trocar a sessão do painel)
    const conta = await criarConta(emailDe(admin.login, d.codigo), admin.senha);
    if (conta.erro) return err(/already registered|já existe/i.test(conta.erro) ? 'Já existe uma conta com este usuário neste estabelecimento.' : conta.erro);
    // 2) estabelecimento + administrador + serviços iniciais do tipo
    const id = await chamar('plataforma_criar_barbearia', { p_dados: d, p_admin_auth: conta.id, p_admin_nome: admin.nome, p_admin_login: admin.login });
    toast(`${tipoDe(d.tipo).nome} cadastrad${tipoDe(d.tipo).artigo}`);
    location.hash = '#estabelecimentos';
    await irPara();
    await detalhe(id, { boasVindas: admin });
  });
}

/* Cria uma conta no Supabase Auth sem trocar a sessão do painel. */
async function criarConta(email, senha) {
  const tmp = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false, storageKey: 'cadastro' } });
  carregando(1);
  try {
    const { data, error } = await tmp.auth.signUp({ email, password: senha });
    if (error) return { erro: mensagemErro(error) };
    if (!data.user || (data.user.identities && !data.user.identities.length)) return { erro: 'already registered' };
    return { id: data.user.id };
  } finally { carregando(-1); }
}

/* ---------------- Detalhe ---------------- */
async function detalhe(id, { boasVindas = null } = {}) {
  const b = porId(id);
  if (!b) return;
  const pagamentos = P.pagamentos.filter((p) => p.barbearia_id === id).sort((x, y) => y.referencia.localeCompare(x.referencia));
  const link = linkAgendar(b.codigo);
  const sistema = linkSistema(b.codigo);
  const qr = window.qrcode ? (() => { const q = window.qrcode(0, 'M'); q.addData(link); q.make(); return q.createSvgTag({ cellSize: 6, margin: 2, scalable: true }); })() : '';
  const t = tipoDe(b.tipo);
  const m = b.ativo ? mensalidades(b) : { vencidas: [] };
  const msgBoasVindas = boasVindas ? [
    `Olá! ${b.nome} já está no sistema.`,
    '', `1) Acesse pelo celular ou computador: ${sistema}`,
    `2) Usuário: ${boasVindas.login}`, `3) Senha: ${boasVindas.senha} (troque em Mais → Alterar minha senha)`,
    '', `Link para seus clientes agendarem: ${link}`].join('\n') : '';
  const msgCobranca = m.vencidas.length ? [
    `Olá${b.responsavel ? `, ${b.responsavel.split(' ')[0]}` : ''}! Tudo bem?`,
    `Consta em aberto a mensalidade do sistema de ${m.vencidas.map((v) => monthLabel(v.ref).toLowerCase()).join(', ')} (${money(m.vencidas.length * Number(b.valor_mensal))}).`,
    'Se já pagou, desconsidere e me envie o comprovante, por favor. Obrigado!'].join('\n') : '';
  const s = sheet(`
    <div style="display:flex;gap:12px;align-items:center;margin-bottom:14px">${logoTipo(b.tipo, corDe(b), 52)}
      <div style="min-width:0"><h3 style="margin:0">${esc(b.nome)}</h3><div class="hint">${esc(t.nome)} · <span class="chip-st st-${statusDe(b)}">${STATUS[statusDe(b)]}</span></div></div></div>
    ${boasVindas ? `<div class="card alert"><div><b>Dados de acesso para enviar ao responsável</b>
      <textarea id="bv" class="search" style="min-height:150px;margin-top:8px" readonly>${esc(msgBoasVindas)}</textarea>
      <div class="btns two"><button class="btn ghost" id="bv-copiar">Copiar</button>
      ${b.telefone ? `<a class="btn green" style="text-align:center;text-decoration:none" target="_blank" rel="noopener" href="${esc(waLink(b.telefone, msgBoasVindas))}">Enviar no WhatsApp</a>` : '<span></span>'}</div></div></div>` : ''}
    <div class="kv"><span>Código</span><span>${esc(b.codigo)}</span></div>
    <div class="kv"><span>Responsável</span><span>${esc(b.responsavel || '—')}${b.telefone ? ` · ${esc(b.telefone)}` : ''}</span></div>
    <div class="kv"><span>Mensalidade</span><span>${money(b.valor_mensal)} · todo dia ${b.dia_vencimento}</span></div>
    <div class="kv"><span>Situação</span><span>${esc(textoSituacao(b))}</span></div>
    <div class="kv"><span>Desde</span><span>${esc(fmtDate(b.inicio))}</span></div>
    <div class="kv"><span>Uso</span><span>${b.usuarios} usuário(s) · ${b.clientes} cliente(s) · ${b.atendimentos_30d} atendimento(s) em 30 dias · ${b.agendados} agendado(s)</span></div>
    <div class="kv"><span>Último acesso</span><span>${b.ultimo_acesso ? esc(`${fmtDate(b.ultimo_acesso.slice(0, 10))} ${b.ultimo_acesso.slice(11)}`) : 'nunca'}</span></div>
    ${m.vencidas.length ? `<div class="card alert" style="margin-top:14px"><div><b>${m.vencidas.length} mensalidade(s) vencida(s) · ${money(m.vencidas.length * Number(b.valor_mensal))}</b>
      <div class="hint">${m.vencidas.map((v) => esc(monthLabel(v.ref))).join(', ')}</div></div>
      ${b.telefone ? `<div class="btns"><a class="btn green" style="text-align:center;text-decoration:none" target="_blank" rel="noopener" href="${esc(waLink(b.telefone, msgCobranca))}">Cobrar no WhatsApp</a></div>` : ''}</div>` : ''}

    <div class="section-title">Sistema da equipe</div>
    <div class="copiar"><input class="search" id="sis" value="${esc(sistema)}" readonly style="margin:0"><button class="btn small ghost" id="copiar-sis">Copiar</button></div>
    <div class="section-title">Link de agendamento dos clientes</div>
    <div class="copiar"><input class="search" id="link" value="${esc(link)}" readonly style="margin:0"><button class="btn small ghost" id="copiar">Copiar</button></div>
    ${qr ? `<div class="qr">${qr}</div><p class="hint" style="text-align:center">Imprima o QR code para o balcão.</p>` : ''}

    <div class="section-title">Mensalidades pagas <button class="link" id="pagar">+ Registrar pagamento</button></div>
    ${pagamentos.length ? `<div class="list">${pagamentos.map((p) => `
      <div class="item"><div class="main"><div class="t">${esc(monthLabel(p.referencia))}</div>
        <div class="s">Pago em ${esc(fmtDate(p.pago_em))}${p.forma ? ` · ${esc(p.forma)}` : ''}${p.observacoes ? ` · ${esc(p.observacoes)}` : ''}</div></div>
        <div class="right">${money(p.valor)}</div>
        <button class="icon-btn danger" data-rm="${p.id}" aria-label="Apagar pagamento">✕</button></div>`).join('')}</div>`
      : '<div class="empty">Nenhum pagamento registrado.</div>'}

    <div class="section-title">Administradores</div>
    <div class="list">${(b.admins || []).map((u) => `
      <div class="item"><div class="main"><div class="t">${esc(u.nome)}</div><div class="s">usuário: ${esc(u.login)}</div></div>
        <button class="btn small ghost" data-senha="${u.id}">Nova senha</button></div>`).join('') || '<div class="empty">Nenhum administrador.</div>'}</div>

    <div class="btns two" style="margin-top:18px">
      <button class="btn ghost" id="editar">Editar dados</button>
      <button class="btn ${b.ativo ? 'danger' : 'green'}" id="ativo">${b.ativo ? 'Desativar' : 'Reativar'}</button>
    </div>`);
  if ($('#bv-copiar', s)) $('#bv-copiar', s).onclick = () => copiar(msgBoasVindas);
  $('#copiar', s).onclick = () => copiar(link);
  $('#copiar-sis', s).onclick = () => copiar(sistema);
  $('#pagar', s).onclick = () => formPagamento(b);
  s.querySelectorAll('[data-rm]').forEach((el) => (el.onclick = safe(async () => {
    const p = pagamentos.find((x) => x.id === Number(el.dataset.rm));
    if (!(await confirmBox(`Apagar o pagamento de ${monthLabel(p.referencia)} (${money(p.valor)})?`, 'Apagar'))) return;
    await tabela(sb.from('pagamentos_aluguel').delete().eq('id', p.id));
    toast('Pagamento apagado');
    await reabrir(b.id);
  })));
  s.querySelectorAll('[data-senha]').forEach((el) => (el.onclick = () => formSenha(b, (b.admins || []).find((u) => u.id === Number(el.dataset.senha)))));
  $('#editar', s).onclick = () => formEditar(b);
  $('#ativo', s).onclick = safe(async () => {
    const msg = b.ativo ? `Desativar ${b.nome}? A equipe não consegue mais entrar no sistema e o link de agendamento para de funcionar. Os dados ficam guardados.`
      : `Reativar ${b.nome}?`;
    if (!(await confirmBox(msg, b.ativo ? 'Desativar' : 'Reativar', !!b.ativo))) return;
    await tabela(sb.from('barbearias').update({ ativo: b.ativo ? 0 : 1 }).eq('id', b.id));
    toast(b.ativo ? 'Estabelecimento desativado' : 'Estabelecimento reativado');
    await reabrir(b.id);
  });
}

/* Recarrega a tela atual e, se pedido, abre de novo o detalhe. */
async function reabrir(id) {
  closeAll();
  await irPara();
  if (id) await detalhe(id);
}

function copiar(texto) {
  const ok = () => toast('Copiado');
  if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(texto).then(ok, () => toast('Não foi possível copiar', true));
  else toast('Selecione o texto e copie', true);
}

function formEditar(b) {
  const s = sheet(`<h3>Editar ${esc(b.nome)}</h3>${camposTipoCor(b)}${camposEstabelecimento(b)}
    <div class="err" id="err"></div>
    <div class="btns two"><button class="btn ghost" id="c">Cancelar</button><button class="btn" id="ok">Salvar</button></div>`);
  ligarTipoCor(s, b);
  $('#c', s).onclick = closeSheet;
  $('#ok', s).onclick = safe(async () => {
    let d;
    try { d = lerCampos(s); } catch (e) { return ($('#err', s).textContent = e.message); }
    await tabela(sb.from('barbearias').update(d).eq('id', b.id));
    toast('Dados salvos');
    await reabrir(b.id);
  });
}

/* Pagamento de mensalidade. Sem b: escolhe o estabelecimento na lista. */
function formPagamento(b, depois = () => reabrir(b && b.id)) {
  const ativos = P.lista.filter((x) => x.ativo).sort((x, y) => x.nome.localeCompare(y.nome));
  const s = sheet(`
    <h3>Registrar mensalidade${b ? ` · ${esc(b.nome)}` : ''}</h3>
    ${b ? '' : `<div class="field"><label>Estabelecimento</label><select id="estab">${ativos.map((x) => opt(x.id, `${x.nome} (${tipoDe(x.tipo).nome})`)).join('')}</select></div>`}
    <div class="row2">
      <div class="field"><label>Mês pago</label><input id="ref" type="month"></div>
      <div class="field"><label>Valor (R$)</label><input id="valor" inputmode="decimal"></div>
    </div>
    <div class="row2">
      <div class="field"><label>Pago em</label><input id="em" type="date" value="${today()}"></div>
      <div class="field"><label>Forma</label><select id="forma">${FORMAS.map((f) => opt(f, f, 'Pix')).join('')}</select></div>
    </div>
    <div class="field"><label>Observação</label><input id="obs"></div>
    <p class="hint">O mês sugerido é o primeiro ainda não pago.</p>
    <div class="err" id="err"></div>
    <div class="btns two"><button class="btn ghost" id="c">Cancelar</button><button class="btn green" id="ok">Registrar</button></div>`, { center: true });
  const atual = () => b || porId(Number($('#estab', s).value));
  const sugerir = () => { const x = atual(); if (!x) return; $('#ref', s).value = x.situacao.referencia; $('#valor', s).value = moneyIn(x.valor_mensal); };
  if ($('#estab', s)) $('#estab', s).onchange = sugerir;
  sugerir();
  $('#c', s).onclick = closeSheet;
  $('#ok', s).onclick = safe(async () => {
    const err = (m) => ($('#err', s).textContent = m);
    const x = atual();
    if (!x) return err('Escolha o estabelecimento.');
    const valor = parseMoney($('#valor', s).value);
    const ref = $('#ref', s).value;
    if (!/^\d{4}-\d{2}$/.test(ref)) return err('Informe o mês pago.');
    if (isNaN(valor) || valor < 0) return err('Informe o valor.');
    const { error } = await sb.from('pagamentos_aluguel').insert({
      barbearia_id: x.id, referencia: ref, valor, pago_em: $('#em', s).value || today(), forma: $('#forma', s).value, observacoes: $('#obs', s).value.trim() || null,
    });
    if (error) return err(/duplicate|unique/i.test(error.message) ? `${monthLabel(ref)} já está registrado como pago.` : mensagemErro(error));
    toast(`Mensalidade de ${monthLabel(ref)} registrada`);
    return depois();
  });
}

function formSenha(b, u) {
  const s = sheet(`
    <h3>Nova senha para ${esc(u.nome)}</h3>
    <p class="hint" style="margin-top:-8px">${esc(b.nome)} · usuário ${esc(u.login)}</p>
    <div class="field"><label>Nova senha (mínimo 6)</label><input id="senha" type="text" autocomplete="off"></div>
    <div class="err" id="err"></div>
    <div class="btns two"><button class="btn ghost" id="c">Cancelar</button><button class="btn" id="ok">Salvar</button></div>`, { center: true });
  $('#c', s).onclick = closeSheet;
  $('#ok', s).onclick = safe(async () => {
    const senha = $('#senha', s).value;
    if (senha.length < 6) return ($('#err', s).textContent = 'A senha precisa ter pelo menos 6 caracteres.');
    await chamar('plataforma_definir_senha', { p_usuario_id: u.id, p_senha: senha });
    closeSheet();
    toast('Senha alterada. Avise o responsável.');
  });
}

/* ======================= FINANCEIRO ======================= */
function periodoFin() {
  if (P.finModo === 'ano') {
    const a = P.finRef.slice(0, 4);
    return { ini: `${a}-01-01`, fim: `${a}-12-31`, rotulo: a, meses: Array.from({ length: 12 }, (_, i) => `${a}-${pad(i + 1)}`) };
  }
  return { ini: `${P.finRef}-01`, fim: `${P.finRef}-${pad(ultimoDiaMes(P.finRef))}`, rotulo: monthLabel(P.finRef), meses: [P.finRef] };
}

/* Mensalidades, outras entradas e despesas num formato só. */
function movimentos(ini, fim) {
  const dentro = (d) => d >= ini && d <= fim;
  return [
    ...P.pagamentos.filter((p) => dentro(p.pago_em)).map((p) => {
      const b = porId(p.barbearia_id);
      return { origem: 'mensalidade', id: p.id, tipo: 'entrada', data: p.pago_em, valor: p.valor, forma: p.forma, categoria: 'Mensalidade',
        descricao: `Mensalidade ${monthLabel(p.referencia).toLowerCase()} · ${b ? b.nome : 'estabelecimento apagado'}`, estab: b, obs: p.observacoes };
    }),
    ...P.lancamentos.filter((l) => dentro(l.data)).map((l) => ({ origem: 'lancamento', id: l.id, tipo: l.tipo, data: l.data, valor: l.valor, forma: l.forma,
      categoria: l.categoria, descricao: l.descricao, estab: l.barbearia_id ? porId(l.barbearia_id) : null, obs: l.observacoes })),
  ].sort((a, b) => b.data.localeCompare(a.data) || b.id - a.id);
}

async function telaFinanceiro(el) {
  await carregarTudo();
  $('#acoes').innerHTML = `<button class="btn small" id="n-mens">+ Mensalidade</button>
    <button class="btn small ghost" id="n-ent">+ Outra entrada</button><button class="btn small ghost" id="n-sai">+ Despesa</button>`;
  $('#n-mens').onclick = () => formPagamento(null, () => reabrir());
  $('#n-ent').onclick = () => formLancamento('entrada');
  $('#n-sai').onclick = () => formLancamento('saida');

  const per = periodoFin();
  $('#subtitulo').textContent = `Mensalidades, outras entradas e despesas · ${per.rotulo}`;
  const movs = movimentos(per.ini, per.fim);
  const soma = (f) => movs.filter(f).reduce((t, m) => t + m.valor, 0);
  const mensal = soma((m) => m.origem === 'mensalidade');
  const outras = soma((m) => m.origem === 'lancamento' && m.tipo === 'entrada');
  const despesas = soma((m) => m.tipo === 'saida');
  const resultado = mensal + outras - despesas;
  // Previsto: mensalidades dos ativos que vencem dentro do período (pagas ou não).
  const ativos = P.lista.filter((b) => b.ativo);
  let previsto = 0;
  let pagoPrev = 0;
  ativos.forEach((b) => per.meses.forEach((ref) => {
    if (vencimentoDe(ref, b.dia_vencimento) < String(b.inicio)) return;
    previsto += Number(b.valor_mensal);
    if (P.pagamentos.some((p) => p.barbearia_id === b.id && p.referencia === ref)) pagoPrev += Number(b.valor_mensal);
  }));
  const abertos = ativos.map((b) => ({ b, m: mensalidades(b) })).filter((x) => x.m.vencidas.length)
    .sort((a, b) => b.m.vencidas.length * b.b.valor_mensal - a.m.vencidas.length * a.b.valor_mensal);
  const atraso = abertos.reduce((t, x) => t + x.m.vencidas.length * Number(x.b.valor_mensal), 0);

  // 12 meses até o mês escolhido (ou os meses do ano)
  const meses = P.finModo === 'ano' ? per.meses : Array.from({ length: 12 }, (_, i) => somarMeses(P.finRef, i - 11));
  const porMes = meses.map((k) => {
    const mv = movimentos(`${k}-01`, `${k}-31`);
    const ent = mv.filter((m) => m.tipo === 'entrada').reduce((t, m) => t + m.valor, 0);
    const sai = mv.filter((m) => m.tipo === 'saida').reduce((t, m) => t + m.valor, 0);
    return { k: monthLabel(k), curto: MESES_CURTOS[Number(k.slice(5)) - 1], v: ent, sai, extra: `Despesas ${money(sai)} · resultado ${money(ent - sai)}` };
  });
  const porForma = Object.entries(movs.filter((m) => m.tipo === 'entrada').reduce((o, m) => { const f = m.forma || 'Não informada'; o[f] = (o[f] || 0) + m.valor; return o; }, {}))
    .map(([k, v]) => ({ k, v })).sort((a, b) => b.v - a.v);
  const porTipo = Object.entries(TIPOS).map(([t, info]) => ({ k: info.nome, v: movs.filter((m) => m.origem === 'mensalidade' && m.estab && m.estab.tipo === t).reduce((x, m) => x + m.valor, 0) }));
  const porCatSaida = Object.entries(movs.filter((m) => m.tipo === 'saida').reduce((o, m) => { const c = m.categoria || 'Outros'; o[c] = (o[c] || 0) + m.valor; return o; }, {}))
    .map(([k, v]) => ({ k, v })).sort((a, b) => b.v - a.v);

  el.innerHTML = `
    <div class="datebar" style="max-width:520px">
      <div class="seg" style="margin:0;flex:none">${[['mes', 'Mês'], ['ano', 'Ano']].map(([k, l]) => `<button data-m="${k}" class="${P.finModo === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <button class="iconbtn" id="ant" aria-label="Anterior">${ICON.esq}</button>
      <div class="d">${esc(per.rotulo)}</div>
      <button class="iconbtn" id="prox" aria-label="Próximo">${ICON.dir}</button>
    </div>
    <div class="grade k4">
      <div class="stat"><div class="lbl">Recebido</div><div class="val pos">${money(mensal + outras)}</div><div class="det">${money(mensal)} mensalidades · ${money(outras)} outras</div></div>
      <div class="stat"><div class="lbl">Despesas</div><div class="val neg">${money(despesas)}</div><div class="det">${movs.filter((m) => m.tipo === 'saida').length} lançamento(s)</div></div>
      <div class="stat gold"><div class="lbl">Resultado</div><div class="val ${resultado >= 0 ? '' : 'neg'}">${money(resultado)}</div><div class="det">recebido − despesas</div></div>
      <div class="stat"><div class="lbl">Mensalidades previstas</div><div class="val">${money(previsto)}</div><div class="det">${previsto ? Math.round((pagoPrev / previsto) * 100) : 0}% já pago · falta ${money(previsto - pagoPrev)}</div></div>
    </div>

    <div class="grade k2" style="margin-top:12px">
      <div class="card"><h4>Recebido por mês</h4>${colunas(porMes, (v) => money(v))}
        <details class="tabela"><summary>Ver tabela</summary><div class="rolar"><table class="dados"><tr><th>Mês</th><th>Recebido</th><th>Despesas</th><th>Resultado</th></tr>
          ${porMes.map((r) => `<tr><td>${esc(r.k)}</td><td>${money(r.v)}</td><td>${money(r.sai)}</td><td class="${r.v - r.sai < 0 ? 'neg' : ''}">${money(r.v - r.sai)}</td></tr>`).join('')}</table></div></details></div>
      <div class="card"><h4>Mensalidades em atraso · ${money(atraso)}</h4>
        ${abertos.length ? `<div class="list">${abertos.map((x) => `
          <div class="item">${logoTipo(x.b.tipo, corDe(x.b), 36)}
            <div class="main"><div class="t">${esc(x.b.nome)}</div><div class="s">${x.m.vencidas.length} mês(es) · desde ${esc(fmtDate(x.m.vencidas[0].venc))}</div></div>
            <div class="right neg">${money(x.m.vencidas.length * Number(x.b.valor_mensal))}</div>
            <button class="btn small ghost" data-pagar="${x.b.id}">Receber</button></div>`).join('')}</div>`
          : '<div class="empty">Nenhuma mensalidade em atraso.</div>'}</div>
    </div>

    <div class="grade k3" style="margin-top:12px">
      <div class="card"><h4>Entradas por forma</h4>${porForma.length ? barras(porForma, (v) => money(v)) : '<div class="empty">Sem entradas.</div>'}</div>
      <div class="card"><h4>Mensalidades por tipo</h4>${barras(porTipo, (v) => money(v))}</div>
      <div class="card"><h4>Despesas por categoria</h4>${porCatSaida.length ? barras(porCatSaida, (v) => money(v)) : '<div class="empty">Sem despesas.</div>'}</div>
    </div>

    <div class="section-title">Movimentações · ${esc(per.rotulo)} ${movs.length ? '<button class="link" id="csv">Baixar planilha</button>' : ''}</div>
    ${movs.length ? `<div class="list">${movs.map((m) => `
      <div class="item">
        <div class="main"><div class="t">${esc(m.descricao)}</div>
          <div class="s">${esc(fmtDate(m.data))} · ${esc(m.categoria || (m.tipo === 'entrada' ? 'Entrada' : 'Despesa'))}${m.forma ? ` · ${esc(m.forma)}` : ''}${m.obs ? ` · ${esc(m.obs)}` : ''}</div></div>
        <div class="right ${m.tipo === 'entrada' ? 'pos' : 'neg'}">${m.tipo === 'entrada' ? '' : '−'}${money(m.valor)}</div>
        <button class="icon-btn danger" data-rm="${m.origem}:${m.id}" aria-label="Apagar">✕</button>
      </div>`).join('')}</div>` : '<div class="card empty">Nenhuma movimentação neste período.</div>'}`;

  el.querySelectorAll('[data-m]').forEach((b) => (b.onclick = () => { P.finModo = b.dataset.m; irPara(); }));
  const passo = (n) => { P.finRef = P.finModo === 'ano' ? `${Number(P.finRef.slice(0, 4)) + n}-${P.finRef.slice(5, 7)}` : somarMeses(P.finRef, n); irPara(); };
  $('#ant').onclick = () => passo(-1);
  $('#prox').onclick = () => passo(1);
  el.querySelectorAll('[data-pagar]').forEach((x) => (x.onclick = () => formPagamento(porId(Number(x.dataset.pagar)), () => reabrir())));
  el.querySelectorAll('[data-rm]').forEach((x) => (x.onclick = safe(async () => {
    const [origem, id] = x.dataset.rm.split(':');
    const m = movs.find((y) => y.origem === origem && y.id === Number(id));
    if (!(await confirmBox(`Apagar “${m.descricao}” (${money(m.valor)})?`, 'Apagar'))) return;
    await tabela(sb.from(origem === 'mensalidade' ? 'pagamentos_aluguel' : 'plataforma_lancamentos').delete().eq('id', m.id));
    toast('Apagado');
    await reabrir();
  })));
  if ($('#csv')) $('#csv').onclick = () => baixarCsv(movs, per);
}

function formLancamento(tipo) {
  const ativos = P.lista.filter((x) => x.ativo).sort((x, y) => x.nome.localeCompare(y.nome));
  const cats = tipo === 'entrada' ? CAT_ENTRADA : CAT_SAIDA;
  const s = sheet(`
    <h3>${tipo === 'entrada' ? 'Outra entrada' : 'Nova despesa'}</h3>
    <div class="field"><label>Descrição</label><input id="desc" placeholder="${tipo === 'entrada' ? 'Ex.: Implantação do sistema' : 'Ex.: Plano do Supabase'}"></div>
    <div class="row2">
      <div class="field"><label>Valor (R$)</label><input id="valor" inputmode="decimal"></div>
      <div class="field"><label>Data</label><input id="data" type="date" value="${today()}"></div>
    </div>
    <div class="row2">
      <div class="field"><label>Categoria</label><select id="cat">${cats.map((c) => opt(c, c)).join('')}</select></div>
      <div class="field"><label>Forma</label><select id="forma"><option value="">—</option>${FORMAS.map((f) => opt(f, f)).join('')}</select></div>
    </div>
    ${tipo === 'entrada' ? `<div class="field"><label>Estabelecimento (opcional)</label><select id="estab"><option value="">—</option>${ativos.map((x) => opt(x.id, x.nome)).join('')}</select></div>` : ''}
    <div class="field"><label>Observação</label><input id="obs"></div>
    <div class="err" id="err"></div>
    <div class="btns two"><button class="btn ghost" id="c">Cancelar</button><button class="btn ${tipo === 'entrada' ? 'green' : 'danger'}" id="ok">Lançar</button></div>`, { center: true });
  $('#c', s).onclick = closeSheet;
  $('#ok', s).onclick = safe(async () => {
    const err = (m) => ($('#err', s).textContent = m);
    const d = {
      tipo, descricao: $('#desc', s).value.trim(), valor: parseMoney($('#valor', s).value), data: $('#data', s).value || today(),
      categoria: $('#cat', s).value, forma: $('#forma', s).value || null, observacoes: $('#obs', s).value.trim() || null,
      barbearia_id: $('#estab', s) && $('#estab', s).value ? Number($('#estab', s).value) : null,
    };
    if (!d.descricao) return err('Informe a descrição.');
    if (isNaN(d.valor) || d.valor <= 0) return err('Informe o valor.');
    await tabela(sb.from('plataforma_lancamentos').insert(d));
    toast(tipo === 'entrada' ? 'Entrada lançada' : 'Despesa lançada');
    return reabrir();
  });
  setTimeout(() => $('#desc', s).focus(), 50);
}

function baixarCsv(movs, per) {
  const cel = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const num = (v) => Number(v).toFixed(2).replace('.', ',');
  const ent = movs.filter((m) => m.tipo === 'entrada').reduce((t, m) => t + m.valor, 0);
  const sai = movs.filter((m) => m.tipo === 'saida').reduce((t, m) => t + m.valor, 0);
  const linhas = [
    ['Data', 'Tipo', 'Descrição', 'Categoria', 'Estabelecimento', 'Forma', 'Valor', 'Observação'],
    ...movs.map((m) => [fmtDate(m.data), m.tipo === 'entrada' ? 'Entrada' : 'Despesa', m.descricao, m.categoria, m.estab ? m.estab.nome : '',
      m.forma, num(m.tipo === 'entrada' ? m.valor : -m.valor), m.obs]),
    [], ['', '', 'Total de entradas', '', '', '', num(ent)], ['', '', 'Total de despesas', '', '', '', num(-sai)], ['', '', 'Resultado', '', '', '', num(ent - sai)],
  ];
  const blob = new Blob(['﻿' + linhas.map((r) => r.map(cel).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: `financeiro-${per.ini}-a-${per.fim}.csv` });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/* ======================= USUÁRIOS DO PAINEL ======================= */
async function telaUsuarios(el) {
  const rows = await chamar('plataforma_usuarios');
  $('#subtitulo').textContent = 'Quem pode entrar neste painel';
  $('#acoes').innerHTML = '<button class="btn small" id="novo-u">+ Novo usuário</button>';
  $('#novo-u').onclick = () => formUsuario();
  el.innerHTML = `
    <div class="list" style="max-width:860px">${rows.map((u) => `
      <button class="item" data-u="${esc(u.auth_id)}">
        <div class="avatar">${esc(u.nome.trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase())}</div>
        <div class="main"><div class="t">${esc(u.nome)}${u.eu ? ' <span class="hint">· você</span>' : ''}</div>
          <div class="s">${esc(u.email || '—')} · ${u.ultimo_acesso ? `último acesso ${esc(fmtDate(u.ultimo_acesso.slice(0, 10)))} ${esc(u.ultimo_acesso.slice(11))}` : 'nunca entrou'}</div></div>
        <div class="right"><span class="chip-st ${u.ativo ? 'st-em_dia' : 'st-inativa'}">${u.ativo ? 'Ativo' : 'Desativado'}</span></div>
      </button>`).join('')}</div>
    <p class="hint" style="max-width:860px;margin-top:14px">Os usuários do painel veem todos os estabelecimentos e o financeiro, e podem cadastrar, editar e registrar pagamentos.
      A equipe de cada estabelecimento é cadastrada dentro do próprio sistema (Mais → Usuários e profissionais).</p>`;
  el.querySelectorAll('[data-u]').forEach((b) => (b.onclick = () => formUsuario(rows.find((u) => u.auth_id === b.dataset.u))));
}

function formUsuario(u) {
  const s = sheet(`
    <h3>${u ? esc(u.nome) : 'Novo usuário do painel'}</h3>
    <div class="field"><label>Nome</label><input id="nome" value="${esc(u ? u.nome : '')}"></div>
    ${u ? `<div class="kv"><span>E-mail</span><span>${esc(u.email || '—')}</span></div>
      <div class="field" style="margin-top:12px"><label>Situação</label><select id="ativo" ${u.eu ? 'disabled' : ''}>${opt(1, 'Ativo', u.ativo)}${opt(0, 'Desativado (não entra mais no painel)', u.ativo)}</select></div>
      <div class="field"><label>Nova senha (deixe em branco para manter)</label><input id="senha" type="text" autocomplete="off"></div>`
    : `<div class="field"><label>E-mail (login)</label><input id="email" type="email" autocomplete="off"></div>
      <div class="field"><label>Senha inicial (mínimo 6)</label><input id="senha" type="text" autocomplete="off"></div>`}
    <div class="err" id="err"></div>
    <div class="btns two"><button class="btn ghost" id="c">Cancelar</button><button class="btn" id="ok">${u ? 'Salvar' : 'Cadastrar'}</button></div>`, { center: true });
  $('#c', s).onclick = closeSheet;
  $('#ok', s).onclick = safe(async () => {
    const err = (m) => ($('#err', s).textContent = m);
    const nome = $('#nome', s).value.trim();
    const senha = $('#senha', s).value;
    if (nome.length < 2) return err('Informe o nome.');
    if (senha && senha.length < 6) return err('A senha precisa ter pelo menos 6 caracteres.');
    if (u) {
      await chamar('plataforma_alterar_usuario', { p_auth: u.auth_id, p_nome: nome, p_ativo: u.eu ? 1 : Number($('#ativo', s).value) });
      if (senha) await chamar('plataforma_senha_usuario', { p_auth: u.auth_id, p_senha: senha });
      toast(senha ? 'Salvo. Senha alterada.' : 'Salvo');
    } else {
      const email = $('#email', s).value.trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return err('Informe um e-mail válido.');
      if (email.endsWith(`@${DOMINIO_LOGIN}`)) return err('Use um e-mail de verdade.');
      if (!senha) return err('Informe a senha inicial.');
      const conta = await criarConta(email, senha);
      if (conta.erro) return err(/already registered/i.test(conta.erro) ? 'Já existe uma conta com este e-mail.' : conta.erro);
      await chamar('plataforma_criar_usuario', { p_auth: conta.id, p_nome: nome, p_email: email });
      toast('Usuário cadastrado. Envie o e-mail e a senha para ele entrar.');
    }
    closeSheet();
    return irPara();
  });
}

safe(iniciar)();
