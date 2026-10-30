/* Agendamento pelo cliente: agendar/?b=codigo-do-estabelecimento (barbearia, manicure ou salão)
   O cliente entra só com o celular, sem senha. Por isso esta página não lê nenhuma
   tabela: usa as funções cliente_* do banco (supabase/area_cliente.sql), que devolvem
   o mínimo e validam expediente, folga e choque de horário antes de gravar.
   Cancelar ou remarcar continua sendo com o estabelecimento. A página usa o logo do tipo e a cor dele. */
'use strict';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const DIAS_ANTECEDENCIA = 60; // igual ao limite do servidor
const CLI = { codigo: '', telefone: '', nome: '', info: null };
const chamar = (fn, args) => rpc(sb, fn, args);

function tela(html) {
  closeAll();
  $('#app').innerHTML = html;
  window.scrollTo(0, 0);
}
const cabecalho = (titulo, sub) => `
  <div class="brand">${CLI.info ? logoTipo(CLI.info.tipo, corDe(CLI.info), 64) : `<div class="icones-login">${Object.keys(TIPOS).map((t) => logoTipo(t, null, 48)).join('')}</div>`}<h1>${esc(titulo)}</h1>${sub ? `<p>${esc(sub)}</p>` : ''}</div>`;

/* Sem código no link: o cliente digita o código que o estabelecimento divulgou. */
function telaCodigo(aviso = '') {
  tela(`${cabecalho('Agendar horário', 'Digite o código do estabelecimento')}
    <form id="f" autocomplete="off">
      <div class="field"><label>Código do estabelecimento</label><input id="codigo" autocapitalize="none" autocorrect="off" required></div>
      <div class="err" id="err">${esc(aviso)}</div>
      <button class="btn" type="submit">Continuar</button>
    </form>
    <p class="hint" style="text-align:center;margin-top:16px">Peça o link de agendamento para o estabelecimento.</p>`);
  $('#f').onsubmit = (e) => {
    e.preventDefault();
    const codigo = $('#codigo').value.trim().toLowerCase();
    if (codigo) location.search = `?b=${encodeURIComponent(codigo)}`;
  };
}

async function iniciar() {
  CLI.codigo = (new URLSearchParams(location.search).get('b') || '').trim().toLowerCase();
  if (!CLI.codigo) return telaCodigo();
  tela(`${cabecalho('Agendar horário', 'Carregando…')}`);
  try {
    CLI.info = await chamar('cliente_agenda_info', { p_codigo: CLI.codigo });
  } catch (e) {
    return telaCodigo(mensagemErro(e));
  }
  document.title = `Agendar · ${CLI.info.barbearia}`;
  aplicarCor(corDe(CLI.info));
  return telaEntrada();
}

function telaEntrada() {
  const ultimo = lerLocal(`cliente:${CLI.codigo}`);
  tela(`${cabecalho(CLI.info.barbearia, 'Digite seu celular com DDD para agendar')}
    <form id="f" autocomplete="off">
      <div class="field"><label>Celular / WhatsApp</label><input id="tel" type="tel" inputmode="tel" placeholder="(17) 99999-9999" value="${esc(fmtPhone(ultimo))}" required></div>
      <div class="err" id="err"></div>
      <button class="btn" type="submit">Continuar</button>
    </form>`);
  $('#f').onsubmit = safe(async (e) => {
    e.preventDefault();
    const tel = digits($('#tel').value);
    if (tel.length < 10 || tel.length > 11) return ($('#err').textContent = 'Informe o celular com DDD (10 ou 11 números).');
    const r = await chamar('cliente_entrar', { p_codigo: CLI.codigo, p_telefone: tel });
    return r ? entrou(tel, r.nome) : telaCadastro(tel);
  });
  setTimeout(() => $('#tel') && $('#tel').focus(), 50);
}

function telaCadastro(tel) {
  tela(`${cabecalho('Primeira vez por aqui?', `Faça seu cadastro na ${CLI.info.barbearia}`)}
    <form id="f" autocomplete="off">
      <div class="field"><label>Celular / WhatsApp</label><input value="${esc(fmtPhone(tel))}" disabled></div>
      <div class="field"><label>Seu nome</label><input id="nome" autocapitalize="words" autocomplete="name" required></div>
      ${campoNascimento('Data de nascimento (opcional)', '')}
      <div class="err" id="err"></div>
      <button class="btn" type="submit">Cadastrar e continuar</button>
    </form>
    <button class="btn ghost" id="voltar" style="margin-top:10px">Usar outro número</button>`);
  $('#voltar').onclick = () => telaEntrada();
  $('#f').onsubmit = safe(async (e) => {
    e.preventDefault();
    const nome = $('#nome').value.trim();
    if (nome.length < 2) return ($('#err').textContent = 'Informe seu nome.');
    let nasc;
    try { nasc = lerNascimento(document); } catch (e2) { return ($('#err').textContent = e2.message); }
    const r = await chamar('cliente_cadastrar', { p_codigo: CLI.codigo, p_nome: nome, p_telefone: tel, p_nascimento: nasc });
    toast('Cadastro feito!');
    return entrou(tel, r.nome);
  });
  setTimeout(() => $('#nome') && $('#nome').focus(), 50);
}

function entrou(tel, nome) {
  gravarLocal(`cliente:${CLI.codigo}`, tel);
  Object.assign(CLI, { telefone: tel, nome });
  return telaArea();
}

async function telaArea() {
  tela(`${cabecalho(`Olá, ${CLI.nome}!`, CLI.info.barbearia)}<div id="corpo"><p class="hint" style="text-align:center">Carregando…</p></div>`);
  const meus = await chamar('cliente_meus_horarios', { p_codigo: CLI.codigo, p_telefone: CLI.telefone });
  const wa = CLI.info.telefone ? waLink(CLI.info.telefone, `Olá! Sou ${CLI.nome} e queria falar sobre meu horário.`) : null;
  $('#corpo').innerHTML = `
    <button class="btn" id="agendar">Agendar horário</button>
    <div class="section-title">Seus próximos horários</div>
    ${meus.length ? `<div class="list">${meus.map((a) => `
      <div class="item">
        <div class="time">${esc(a.hora)}</div>
        <div class="main"><div class="t">${esc(a.data === today() ? 'Hoje' : fmtDay(a.data))}</div>
          <div class="s">${esc([a.servico, a.profissional && `com ${a.profissional}`].filter(Boolean).join(' · '))}</div></div>
      </div>`).join('')}</div>` : '<div class="card empty">Você não tem horários marcados.</div>'}
    <p class="hint" style="text-align:center;margin-top:12px">Para cancelar ou remarcar, fale com ${esc(CLI.info.barbearia)}.</p>
    ${wa ? `<a class="btn ghost" style="display:block;text-align:center;text-decoration:none" href="${esc(wa)}" target="_blank" rel="noopener">Falar no WhatsApp</a>` : ''}
    <button class="link-btn" id="sair" style="display:block;margin:18px auto 0">Sair (usar outro número)</button>`;
  $('#agendar').onclick = safe(() => telaAgendar());
  $('#sair').onclick = () => { gravarLocal(`cliente:${CLI.codigo}`, ''); telaEntrada(); };
}

function telaAgendar() {
  const { servicos, profissionais } = CLI.info;
  if (!servicos.length || !profissionais.length) return toast('Agendamento indisponível no momento. Fale com o estabelecimento.', true);
  const max = addDays(today(), DIAS_ANTECEDENCIA);
  const s = sheet(`
    <h3>Agendar horário</h3>
    <div class="field"><label>Serviço</label>
      <select id="srv">${servicos.map((x) => opt(x.id, `${x.nome} — ${money(x.preco)} · ${x.duracao} min`, servicos[0].id)).join('')}</select></div>
    <div class="row2">
      <div class="field"><label>Profissional</label>
        <select id="prof">${profissionais.map((p) => opt(p.id, p.nome, profissionais[0].id)).join('')}</select></div>
      <div class="field"><label>Dia</label><input type="date" id="data" value="${today()}" min="${today()}" max="${max}"></div>
    </div>
    <div class="field"><label id="dia-rotulo">Horários livres</label><div id="slots" class="slots grade"></div></div>
    <div class="err" id="err"></div>
    <div class="btns two"><button class="btn ghost" id="cancel">Cancelar</button><button class="btn green" id="ok">Confirmar</button></div>`);
  let hora = '';
  const srv = () => servicos.find((x) => x.id === Number($('#srv', s).value));
  const prof = () => profissionais.find((p) => p.id === Number($('#prof', s).value));
  const err = (m) => ($('#err', s).textContent = m);

  const drawSlots = serial(async () => {
    const box = $('#slots', s);
    const data = $('#data', s).value;
    err('');
    if (!data || data < today() || data > max) { box.innerHTML = `<div class="hint">Escolha um dia entre hoje e os próximos ${DIAS_ANTECEDENCIA} dias.</div>`; return; }
    $('#dia-rotulo', s).textContent = `Horários livres · ${data === today() ? 'hoje' : fmtDay(data)}`;
    const p = prof();
    const r = await chamar('cliente_ocupados', { p_codigo: CLI.codigo, p_profissional: p.id, p_data: data });
    const exp = r.folga ? { folga: 'folga' } : expedienteDoHorario(p.horario, data);
    const res = calcularLivres(exp, r.ocupados.map(comIntervalo), data, srv().duracao);
    if (!res.livres.includes(hora)) hora = '';
    box.innerHTML = res.folga ? `<div class="hint neg">${esc(p.nome)} não atende neste dia.</div>`
      : res.livres.length ? res.livres.map((h) => `<button type="button" data-h="${h}" class="${h === hora ? 'on' : ''}">${h}</button>`).join('')
      : '<div class="hint">Nenhum horário livre neste dia. Tente outro dia ou profissional.</div>';
    box.querySelectorAll('[data-h]').forEach((b) => (b.onclick = () => {
      hora = b.dataset.h;
      box.querySelectorAll('[data-h]').forEach((x) => x.classList.toggle('on', x === b));
    }));
  });
  ['#srv', '#prof', '#data'].forEach((k) => ($(k, s).onchange = () => { hora = ''; drawSlots(); }));
  drawSlots();

  $('#cancel', s).onclick = closeSheet;
  $('#ok', s).onclick = safe(async () => {
    if (!hora) return err('Escolha um horário.');
    const data = $('#data', s).value;
    try {
      await chamar('cliente_agendar', { p_codigo: CLI.codigo, p_telefone: CLI.telefone, p_servico: srv().id, p_profissional: prof().id, p_data: data, p_hora: hora });
    } catch (e) {
      err(mensagemErro(e));
      drawSlots(); // o horário pode ter sido ocupado por outra pessoa
      return;
    }
    closeSheet();
    toast(`Agendado: ${data === today() ? 'hoje' : fmtDay(data)} às ${hora}`);
    await telaArea();
  });
  return undefined;
}

safe(iniciar)();
