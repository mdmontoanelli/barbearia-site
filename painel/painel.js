/* Painel da plataforma (só para quem está em plataforma_admins).
   Cadastra barbearias e o primeiro administrador de cada uma, controla o aluguel
   (pagamentos manuais) e mostra o link e o QR code de agendamento de cada barbearia.
   O painel não enxerga os dados internos das barbearias (clientes, agenda, financeiro). */
'use strict';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, storageKey: 'painel-barbearias' } });
const chamar = (fn, args) => rpc(sb, fn, args);
const P = { lista: [], busca: '', filtro: 'todas' };
const FORMAS = ['Pix', 'Dinheiro', 'Transferência', 'Boleto', 'Cartão'];
const STATUS = { em_dia: 'Em dia', a_vencer: 'Vence em breve', vencida: 'Vencida', inativa: 'Desativada' };

/* Endereço público da página de agendamento (fica ao lado do painel). */
const linkAgendar = (codigo) => new URL(`../agendar/?b=${encodeURIComponent(codigo)}`, location.href).href;

async function tabela(consulta) {
  carregando(1);
  try {
    const { data, error } = await consulta;
    if (error) throw new Error(error.message);
    return data;
  } finally { carregando(-1); }
}

/* ---------------- Entrada ---------------- */
async function iniciar() {
  const { data } = await sb.auth.getSession();
  if (!data.session) return telaLogin();
  const ehDono = await tabela(sb.from('plataforma_admins').select('nome').eq('auth_id', data.session.user.id));
  if (!ehDono.length) {
    await sb.auth.signOut();
    return telaLogin('Esta conta não tem acesso ao painel.');
  }
  P.nome = ehDono[0].nome;
  return telaLista();
}

function telaLogin(aviso = '') {
  closeAll();
  $('#app').className = 'pagina';
  $('#app').innerHTML = `
    <div class="brand"><div class="pole"></div><h1>Painel</h1><p>Barbearias e aluguel do sistema</p></div>
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

/* ---------------- Lista de barbearias ---------------- */
const statusDe = (b) => (b.ativo ? b.situacao.status : 'inativa');
function textoSituacao(b) {
  if (!b.ativo) return 'Desativada';
  const s = b.situacao;
  if (s.status === 'vencida') return `Vencida há ${-s.dias} dia(s) · ${monthLabel(s.referencia)}`;
  if (s.dias === 0) return `Vence hoje · ${monthLabel(s.referencia)}`;
  return `Vence ${fmtDate(s.vencimento)} (${s.dias} dia(s)) · ${monthLabel(s.referencia)}`;
}

async function telaLista() {
  $('#app').className = 'pagina larga';
  P.lista = await chamar('plataforma_barbearias');
  const ativas = P.lista.filter((b) => b.ativo);
  const conta = (st) => ativas.filter((b) => b.situacao.status === st).length;
  const receita = ativas.reduce((t, b) => t + Number(b.valor_mensal), 0);
  $('#app').innerHTML = `
    <div class="topo-web">
      <div><h1>Barbearias</h1><div class="sub">Olá, ${esc(P.nome)}</div></div>
      <button class="link-btn" id="sair">Sair</button>
    </div>
    <div class="stats">
      <div class="stat"><div class="lbl">Barbearias ativas</div><div class="val">${ativas.length}</div></div>
      <div class="stat gold"><div class="lbl">Aluguel por mês</div><div class="val">${money(receita)}</div></div>
      <div class="stat"><div class="lbl">Vencendo em até 5 dias</div><div class="val">${conta('a_vencer')}</div></div>
      <div class="stat"><div class="lbl">Vencidas</div><div class="val ${conta('vencida') ? 'neg' : ''}">${conta('vencida')}</div></div>
    </div>
    <div class="filtros">
      <input class="search" id="busca" type="search" placeholder="Buscar por nome, código, cidade ou responsável" value="${esc(P.busca)}" style="margin:0">
      <button class="btn small" id="nova">+ Nova barbearia</button>
    </div>
    <div class="seg" id="filtro">${[['todas', 'Todas'], ['vencida', 'Vencidas'], ['a_vencer', 'A vencer'], ['em_dia', 'Em dia'], ['inativa', 'Desativadas']]
      .map(([k, l]) => `<button data-f="${k}" class="${P.filtro === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div id="lista"></div>`;
  $('#sair').onclick = safe(async () => { await sb.auth.signOut(); telaLogin(); });
  $('#nova').onclick = () => formBarbearia();
  $('#busca').oninput = (e) => { P.busca = e.target.value; desenharLista(); };
  document.querySelectorAll('[data-f]').forEach((b) => (b.onclick = () => {
    P.filtro = b.dataset.f;
    document.querySelectorAll('[data-f]').forEach((x) => x.classList.toggle('on', x === b));
    desenharLista();
  }));
  desenharLista();
}

function desenharLista() {
  const termo = P.busca.trim().toLowerCase();
  const ordem = { vencida: 0, a_vencer: 1, em_dia: 2, inativa: 3 };
  const rows = P.lista
    .filter((b) => P.filtro === 'todas' || statusDe(b) === P.filtro)
    .filter((b) => !termo || [b.nome, b.codigo, b.cidade, b.responsavel].some((x) => String(x || '').toLowerCase().includes(termo)))
    .sort((a, b) => ordem[statusDe(a)] - ordem[statusDe(b)] || (a.ativo ? a.situacao.dias - b.situacao.dias : 0) || a.nome.localeCompare(b.nome));
  $('#lista').innerHTML = rows.length ? `<div class="list">${rows.map((b) => `
    <button class="item" data-b="${b.id}">
      <div class="main">
        <div class="t">${esc(b.nome)} <span class="hint">· ${esc(b.codigo)}</span></div>
        <div class="s">${esc([b.cidade, b.responsavel, `${b.usuarios} usuário(s)`].filter(Boolean).join(' · '))}</div>
        <div class="s">${esc(textoSituacao(b))}</div>
      </div>
      <div class="right"><div>${money(b.valor_mensal)}</div><span class="chip-st st-${statusDe(b)}">${STATUS[statusDe(b)]}</span></div>
    </button>`).join('')}</div>`
    : `<div class="card empty">${P.lista.length ? 'Nenhuma barbearia neste filtro.' : 'Nenhuma barbearia cadastrada ainda. Toque em “Nova barbearia”.'}</div>`;
  document.querySelectorAll('[data-b]').forEach((el) => (el.onclick = safe(() => detalhe(Number(el.dataset.b)))));
}

const recarregar = async () => { await telaLista(); };

/* ---------------- Nova / editar barbearia ---------------- */
function camposBarbearia(b) {
  return `
    <div class="row2">
      <div class="field"><label>Nome da barbearia</label><input id="nome" value="${esc(b.nome || '')}"></div>
      <div class="field"><label>Cidade</label><input id="cidade" value="${esc(b.cidade || '')}"></div>
    </div>
    <div class="row2">
      <div class="field"><label>Responsável</label><input id="responsavel" value="${esc(b.responsavel || '')}"></div>
      <div class="field"><label>Telefone / WhatsApp</label><input id="telefone" type="tel" value="${esc(fmtPhone(b.telefone || ''))}"></div>
    </div>
    <div class="field"><label>E-mail (opcional)</label><input id="email" type="email" value="${esc(b.email || '')}"></div>
    <div class="row3" style="grid-template-columns:1fr 1fr 1.2fr">
      <div class="field"><label>Aluguel (R$/mês)</label><input id="valor" inputmode="decimal" value="${esc(moneyIn(b.valor_mensal ?? ''))}"></div>
      <div class="field"><label>Dia do vencimento</label><input id="dia" type="number" min="1" max="31" value="${esc(b.dia_vencimento ?? 10)}"></div>
      <div class="field"><label>Início do contrato</label><input id="inicio" type="date" value="${esc(b.inicio || today())}"></div>
    </div>
    <div class="field"><label>Observações</label><textarea id="obs">${esc(b.observacoes || '')}</textarea></div>`;
}
function lerCampos(s) {
  const d = {
    nome: $('#nome', s).value.trim(),
    cidade: $('#cidade', s).value.trim() || null,
    responsavel: $('#responsavel', s).value.trim() || null,
    telefone: fmtPhone($('#telefone', s).value.trim()) || null,
    email: $('#email', s).value.trim() || null,
    valor_mensal: parseMoney($('#valor', s).value),
    dia_vencimento: Number($('#dia', s).value),
    inicio: $('#inicio', s).value,
    observacoes: $('#obs', s).value.trim() || null,
  };
  if (!d.nome) throw new Error('Informe o nome da barbearia.');
  if (isNaN(d.valor_mensal) || d.valor_mensal < 0) throw new Error('Informe o valor do aluguel.');
  if (!Number.isInteger(d.dia_vencimento) || d.dia_vencimento < 1 || d.dia_vencimento > 31) throw new Error('Dia do vencimento entre 1 e 31.');
  if (!d.inicio) throw new Error('Informe o início do contrato.');
  return d;
}

const sugerirCodigo = (nome) => nome.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/^barbearia\s+(d[aoe]s?\s+)?/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);

function formBarbearia() {
  const s = sheet(`
    <h3>Nova barbearia</h3>
    ${camposBarbearia({})}
    <div class="field"><label>Código (vai no link e no login do app; não dá para mudar depois)</label>
      <input id="codigo" autocapitalize="none" autocorrect="off" placeholder="ex.: barbeariadoze"></div>
    <p class="hint" id="link-prev" style="margin-top:-6px"></p>
    <div class="section-title">Administrador da barbearia</div>
    <div class="row2">
      <div class="field"><label>Nome</label><input id="anome"></div>
      <div class="field"><label>Usuário (login no app)</label><input id="alogin" autocapitalize="none" autocorrect="off"></div>
    </div>
    <div class="field"><label>Senha inicial (mínimo 6)</label><input id="asenha" type="text" autocomplete="off"></div>
    <div class="err" id="err"></div>
    <div class="btns two"><button class="btn ghost" id="c">Cancelar</button><button class="btn" id="ok">Cadastrar</button></div>`);
  let codigoMexido = false;
  const prever = () => { const c = $('#codigo', s).value.trim().toLowerCase(); $('#link-prev', s).textContent = c ? `Link de agendamento: ${linkAgendar(c)}` : ''; };
  $('#nome', s).oninput = () => { if (!codigoMexido) { $('#codigo', s).value = sugerirCodigo($('#nome', s).value); prever(); } };
  $('#responsavel', s).oninput = () => { if (!$('#anome', s).dataset.mexido) $('#anome', s).value = $('#responsavel', s).value; };
  $('#anome', s).oninput = () => { $('#anome', s).dataset.mexido = '1'; };
  $('#codigo', s).oninput = () => { codigoMexido = true; prever(); };
  $('#c', s).onclick = closeSheet;
  $('#ok', s).onclick = safe(async () => {
    const err = (m) => ($('#err', s).textContent = m);
    let d;
    try { d = lerCampos(s); } catch (e) { return err(e.message); }
    d.codigo = $('#codigo', s).value.trim().toLowerCase();
    const admin = { nome: $('#anome', s).value.trim(), login: $('#alogin', s).value.trim(), senha: $('#asenha', s).value };
    if (!/^[a-z0-9][a-z0-9-]{1,29}$/.test(d.codigo)) return err('Código: de 2 a 30 letras minúsculas, números ou hífen, sem espaço.');
    if (!admin.nome || !admin.login) return err('Informe nome e usuário do administrador.');
    if (admin.senha.length < 6) return err('A senha inicial precisa ter pelo menos 6 caracteres.');
    if (P.lista.some((b) => b.codigo === d.codigo)) return err('Já existe uma barbearia com este código.');
    // 1) conta de acesso do administrador (sem trocar a sessão do painel)
    const tmp = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false, storageKey: 'cadastro' } });
    carregando(1);
    let conta;
    try { conta = await tmp.auth.signUp({ email: emailDe(admin.login, d.codigo), password: admin.senha }); } finally { carregando(-1); }
    if (conta.error) return err(/already registered/i.test(conta.error.message) ? 'Já existe uma conta com este usuário nesta barbearia.' : mensagemErro(conta.error));
    // 2) barbearia + administrador + serviços iniciais
    await chamar('plataforma_criar_barbearia', { p_dados: d, p_admin_auth: conta.data.user.id, p_admin_nome: admin.nome, p_admin_login: admin.login });
    closeSheet();
    toast('Barbearia cadastrada');
    await recarregar();
    const nova = P.lista.find((b) => b.codigo === d.codigo);
    if (nova) await detalhe(nova.id, { boasVindas: admin });
  });
  setTimeout(() => $('#nome', s).focus(), 50);
}

/* ---------------- Detalhe ---------------- */
async function detalhe(id, { boasVindas = null } = {}) {
  const b = P.lista.find((x) => x.id === id);
  if (!b) return;
  const pagamentos = await tabela(sb.from('pagamentos_aluguel').select('*').eq('barbearia_id', id).order('referencia', { ascending: false }));
  const link = linkAgendar(b.codigo);
  const qr = window.qrcode ? (() => { const q = window.qrcode(0, 'M'); q.addData(link); q.make(); return q.createSvgTag({ cellSize: 6, margin: 2, scalable: true }); })() : '';
  const msgBoasVindas = boasVindas ? [
    `Olá! Sua barbearia ${b.nome} já está no sistema.`,
    '', '1) Instale o app da Barbearia no celular.',
    `2) Código da barbearia: ${b.codigo}`,
    `3) Usuário: ${boasVindas.login}`, `4) Senha: ${boasVindas.senha} (troque em Mais → Alterar minha senha)`,
    '', `Link para seus clientes agendarem: ${link}`].join('\n') : '';
  const s = sheet(`
    <h3>${esc(b.nome)} <span class="chip-st st-${statusDe(b)}">${STATUS[statusDe(b)]}</span></h3>
    ${boasVindas ? `<div class="card alert"><div><b>Dados de acesso para enviar ao responsável</b>
      <textarea id="bv" class="search" style="min-height:150px;margin-top:8px" readonly>${esc(msgBoasVindas)}</textarea>
      <div class="btns two"><button class="btn ghost" id="bv-copiar">Copiar</button>
      ${b.telefone ? `<a class="btn green" style="text-align:center;text-decoration:none" target="_blank" rel="noopener" href="${esc(waLink(b.telefone, msgBoasVindas))}">Enviar no WhatsApp</a>` : '<span></span>'}</div></div></div>` : ''}
    <div class="kv"><span>Código</span><span>${esc(b.codigo)}</span></div>
    <div class="kv"><span>Responsável</span><span>${esc(b.responsavel || '—')}${b.telefone ? ` · ${esc(b.telefone)}` : ''}</span></div>
    <div class="kv"><span>Aluguel</span><span>${money(b.valor_mensal)} · todo dia ${b.dia_vencimento}</span></div>
    <div class="kv"><span>Situação</span><span>${esc(textoSituacao(b))}</span></div>
    <div class="kv"><span>Desde</span><span>${esc(fmtDate(b.inicio))} · ${b.usuarios} usuário(s) ativo(s)</span></div>

    <div class="section-title">Link de agendamento dos clientes</div>
    <div class="copiar"><input class="search" id="link" value="${esc(link)}" readonly style="margin:0"><button class="btn small ghost" id="copiar">Copiar</button></div>
    ${qr ? `<div class="qr">${qr}</div><p class="hint" style="text-align:center">Imprima o QR code para o balcão da barbearia.</p>` : ''}

    <div class="section-title">Aluguel <button class="link" id="pagar">+ Registrar pagamento</button></div>
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
    const msg = b.ativo ? `Desativar ${b.nome}? A equipe não consegue mais entrar no app e o link de agendamento para de funcionar. Os dados ficam guardados.`
      : `Reativar ${b.nome}?`;
    if (!(await confirmBox(msg, b.ativo ? 'Desativar' : 'Reativar', !!b.ativo))) return;
    await tabela(sb.from('barbearias').update({ ativo: b.ativo ? 0 : 1 }).eq('id', b.id));
    toast(b.ativo ? 'Barbearia desativada' : 'Barbearia reativada');
    await reabrir(b.id);
  });
}

async function reabrir(id) {
  closeAll();
  await recarregar();
  await detalhe(id);
}

function copiar(texto) {
  const ok = () => toast('Copiado');
  if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(texto).then(ok, () => toast('Não foi possível copiar', true));
  else toast('Selecione o texto e copie', true);
}

function formEditar(b) {
  const s = sheet(`<h3>Editar ${esc(b.nome)}</h3>${camposBarbearia(b)}
    <div class="err" id="err"></div>
    <div class="btns two"><button class="btn ghost" id="c">Cancelar</button><button class="btn" id="ok">Salvar</button></div>`);
  $('#c', s).onclick = closeSheet;
  $('#ok', s).onclick = safe(async () => {
    let d;
    try { d = lerCampos(s); } catch (e) { return ($('#err', s).textContent = e.message); }
    await tabela(sb.from('barbearias').update(d).eq('id', b.id));
    toast('Dados salvos');
    await reabrir(b.id);
  });
}

function formPagamento(b) {
  const s = sheet(`
    <h3>Registrar pagamento · ${esc(b.nome)}</h3>
    <div class="row2">
      <div class="field"><label>Mês pago</label><input id="ref" type="month" value="${esc(b.situacao.referencia)}"></div>
      <div class="field"><label>Valor (R$)</label><input id="valor" inputmode="decimal" value="${esc(moneyIn(b.valor_mensal))}"></div>
    </div>
    <div class="row2">
      <div class="field"><label>Pago em</label><input id="em" type="date" value="${today()}"></div>
      <div class="field"><label>Forma</label><select id="forma">${FORMAS.map((f) => opt(f, f, 'Pix')).join('')}</select></div>
    </div>
    <div class="field"><label>Observação</label><input id="obs"></div>
    <p class="hint">O mês sugerido é o primeiro ainda não pago.</p>
    <div class="err" id="err"></div>
    <div class="btns two"><button class="btn ghost" id="c">Cancelar</button><button class="btn green" id="ok">Registrar</button></div>`, { center: true });
  $('#c', s).onclick = closeSheet;
  $('#ok', s).onclick = safe(async () => {
    const err = (m) => ($('#err', s).textContent = m);
    const valor = parseMoney($('#valor', s).value);
    const ref = $('#ref', s).value;
    if (!/^\d{4}-\d{2}$/.test(ref)) return err('Informe o mês pago.');
    if (isNaN(valor) || valor < 0) return err('Informe o valor.');
    const { error } = await sb.from('pagamentos_aluguel').insert({
      barbearia_id: b.id, referencia: ref, valor, pago_em: $('#em', s).value || today(), forma: $('#forma', s).value, observacoes: $('#obs', s).value.trim() || null,
    });
    if (error) return err(/duplicate|unique/i.test(error.message) ? `${monthLabel(ref)} já está registrado como pago.` : mensagemErro(error));
    toast(`Pagamento de ${monthLabel(ref)} registrado`);
    return reabrir(b.id);
  });
}

function formSenha(b, u) {
  const s = sheet(`
    <h3>Nova senha para ${esc(u.nome)}</h3>
    <p class="hint" style="margin-top:-8px">Barbearia ${esc(b.nome)} · usuário ${esc(u.login)}</p>
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

safe(iniciar)();
