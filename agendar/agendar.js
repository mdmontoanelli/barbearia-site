/* Agendamento pelo cliente: agendar/?b=codigo-do-estabelecimento (barbearia, manicure ou salão)
   O cliente entra só com o celular, sem senha. Por isso esta página não lê nenhuma
   tabela: usa as funções cliente_* do banco (supabase/area_cliente.sql), que devolvem
   o mínimo e validam expediente, folga e choque de horário antes de gravar.
   A primeira tela é a página do estabelecimento (vitrine): apresentação, fotos, serviços,
   horário e contato, com o logo e a cor dele. O cliente pode cancelar e remarcar pelo site
   se o estabelecimento permitir, até a antecedência configurada. */
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
  <div class="brand">${CLI.info ? logoEstab(CLI.info, 72) : `<div class="icones-login">${Object.keys(TIPOS).map((t) => logoTipo(t, null, 48)).join('')}</div>`}<h1>${esc(titulo)}</h1>${sub ? `<p>${esc(sub)}</p>` : ''}</div>`;

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
  document.title = CLI.info.barbearia;
  aplicarCor(corDe(CLI.info));
  return telaVitrine();
}

/* ---------------- Página do estabelecimento (vitrine) ---------------- */
const NOMES_DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
/* Horário de funcionamento: junta o expediente da equipe (do primeiro início ao último fim de cada dia). */
function funcionamento() {
  const dias = {};
  CLI.info.profissionais.forEach((p) => {
    let h = null;
    try { h = p.horario ? JSON.parse(p.horario) : null; } catch (e) { h = null; }
    if (!h) h = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, ['08:00', '20:00']]));
    Object.entries(h).forEach(([d, [a, b]]) => {
      const x = dias[d];
      dias[d] = x ? [a < x[0] ? a : x[0], b > x[1] ? b : x[1]] : [a, b];
    });
  });
  return [1, 2, 3, 4, 5, 6, 0].map((d) => ({ d, h: dias[d] }));
}

function telaVitrine() {
  const i = CLI.info;
  const t = tipoDe(i.tipo);
  const hojeDia = new Date().getDay();
  const fotos = Array.isArray(i.fotos) ? i.fotos.filter((u) => /^https:\/\//.test(u)) : [];
  const wa = i.telefone ? waLink(i.telefone, `Olá! Vim pela página d${t.artigo} ${i.barbearia}.`) : null;
  const mapa = i.endereco ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(i.endereco)}` : null;
  const temTel = lerLocal(`cliente:${CLI.codigo}`);
  tela(`${cabecalho(i.barbearia, [t.nome, i.cidade].filter(Boolean).join(' · '))}
    ${i.sobre ? `<p class="vit-sobre">${esc(i.sobre)}</p>` : ''}
    <button class="btn" id="agendar">Agendar horário</button>
    ${temTel ? '<button class="btn ghost" id="meus" style="margin-top:10px">Ver meus horários</button>' : ''}

    ${fotos.length ? `<div class="vit-fotos">${fotos.map((u, n) => `<button data-foto="${n}" aria-label="Ver foto"><img src="${esc(u)}" alt="" loading="lazy"></button>`).join('')}</div>` : ''}

    ${i.servicos.length ? `<div class="section-title">Serviços</div>
    <div class="list">${i.servicos.map((x) => `
      <div class="item"><div class="main"><div class="t">${esc(x.nome)}</div></div><div class="right">${money(x.preco)}</div></div>`).join('')}</div>` : ''}

    ${i.profissionais.length ? `<div class="section-title">Horário de funcionamento</div>
    <div class="list">${funcionamento().map(({ d, h }) => `
      <div class="item vit-dia${d === hojeDia ? ' hoje' : ''}"><div class="main"><div class="t">${NOMES_DIAS[d]}${d === hojeDia ? ' · hoje' : ''}</div></div>
        <div class="right">${h ? `${esc(h[0])} às ${esc(h[1])}` : '<span class="hint">Fechado</span>'}</div></div>`).join('')}</div>` : ''}

    ${mapa || wa || i.instagram ? `<div class="section-title">Contato</div>
    ${i.endereco ? `<p class="vit-end">${esc(i.endereco)}</p>` : ''}
    <div class="btns vit-contato">
      ${mapa ? `<a class="btn ghost" href="${esc(mapa)}" target="_blank" rel="noopener">Ver no mapa</a>` : ''}
      ${wa ? `<a class="btn ghost" href="${esc(wa)}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
      ${i.instagram ? `<a class="btn ghost" href="https://instagram.com/${esc(encodeURIComponent(i.instagram))}" target="_blank" rel="noopener">@${esc(i.instagram)}</a>` : ''}
    </div>` : ''}`);
  $('#agendar').onclick = () => telaEntrada();
  if ($('#meus')) $('#meus').onclick = () => telaEntrada();
  document.querySelectorAll('[data-foto]').forEach((b) => (b.onclick = () => {
    const f = sheet(`<img src="${esc(fotos[Number(b.dataset.foto)])}" alt="" style="width:100%;border-radius:12px;display:block">
      <button class="btn ghost" id="fechar" style="margin-top:12px">Fechar</button>`, { center: true });
    $('#fechar', f).onclick = closeSheet;
  }));
}

function telaEntrada() {
  const ultimo = lerLocal(`cliente:${CLI.codigo}`);
  tela(`${cabecalho(CLI.info.barbearia, 'Digite seu celular com DDD para agendar')}
    <form id="f" autocomplete="off">
      <div class="field"><label>Celular / WhatsApp</label><input id="tel" type="tel" inputmode="tel" placeholder="(17) 99999-9999" value="${esc(fmtPhone(ultimo))}" required></div>
      <div class="err" id="err"></div>
      <button class="btn" type="submit">Continuar</button>
    </form>
    <button class="btn ghost" id="voltar-vit" style="margin-top:10px">Voltar</button>`);
  $('#voltar-vit').onclick = () => telaVitrine();
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

/* Pode cancelar ou remarcar pelo site? (o servidor confere de novo) */
const podeMexer = (a) => CLI.info.cancela
  && parseDate(a.data).getTime() + toMin(a.hora) * 60000 - Date.now() >= CLI.info.antecedencia * 3600000;
const textoAntecedencia = (h) => (h < 24 ? `${h} hora${h > 1 ? 's' : ''}` : `${h / 24} dia${h > 24 ? 's' : ''}`);

async function telaArea() {
  tela(`${cabecalho(`Olá, ${CLI.nome}!`, CLI.info.barbearia)}<div id="corpo"><p class="hint" style="text-align:center">Carregando…</p></div>`);
  const meus = await chamar('cliente_meus_horarios', { p_codigo: CLI.codigo, p_telefone: CLI.telefone });
  const wa = CLI.info.telefone ? waLink(CLI.info.telefone, `Olá! Sou ${CLI.nome} e queria falar sobre meu horário.`) : null;
  $('#corpo').innerHTML = `
    <button class="btn" id="agendar">Agendar horário</button>
    <div class="section-title">Seus próximos horários</div>
    ${meus.length ? `<div class="list">${meus.map((a) => `
      <div class="item" style="flex-wrap:wrap">
        <div class="time">${esc(a.hora)}</div>
        <div class="main"><div class="t">${esc(a.data === today() ? 'Hoje' : fmtDay(a.data))}</div>
          <div class="s">${esc([a.servico, a.profissional && `com ${a.profissional}`].filter(Boolean).join(' · '))}</div></div>
        ${podeMexer(a) ? `<div class="acoes-ag"><button class="btn small ghost" data-remarcar="${a.id}">Remarcar</button>
          <button class="btn small danger" data-cancelar="${a.id}">Cancelar</button></div>` : ''}
      </div>`).join('')}</div>` : '<div class="card empty">Você não tem horários marcados.</div>'}
    <p class="hint" style="text-align:center;margin-top:12px">${CLI.info.cancela
      ? `Dá para cancelar ou remarcar por aqui até ${esc(textoAntecedencia(CLI.info.antecedencia))} antes. Depois disso, fale com ${esc(CLI.info.barbearia)}.`
      : `Para cancelar ou remarcar, fale com ${esc(CLI.info.barbearia)}.`}</p>
    ${wa ? `<a class="btn ghost" style="display:block;text-align:center;text-decoration:none" href="${esc(wa)}" target="_blank" rel="noopener">Falar no WhatsApp</a>` : ''}
    <button class="link-btn" id="inicio" style="display:block;margin:18px auto 0">Ver a página d${tipoDe(CLI.info.tipo).artigo} ${esc(tipoDe(CLI.info.tipo).nome.toLowerCase())}</button>
    <button class="link-btn" id="sair" style="display:block;margin:6px auto 0">Sair (usar outro número)</button>`;
  $('#agendar').onclick = safe(() => telaAgendar());
  $('#inicio').onclick = () => telaVitrine();
  $('#sair').onclick = () => { gravarLocal(`cliente:${CLI.codigo}`, ''); telaVitrine(); };
  document.querySelectorAll('[data-remarcar]').forEach((b) => (b.onclick = safe(() => telaAgendar(meus.find((a) => a.id === Number(b.dataset.remarcar))))));
  document.querySelectorAll('[data-cancelar]').forEach((b) => (b.onclick = safe(async () => {
    const a = meus.find((x) => x.id === Number(b.dataset.cancelar));
    if (!(await confirmBox(`Cancelar seu horário de ${a.data === today() ? 'hoje' : fmtDay(a.data)} às ${a.hora}?`, 'Cancelar horário'))) return;
    await chamar('cliente_cancelar', { p_codigo: CLI.codigo, p_telefone: CLI.telefone, p_agendamento: a.id });
    toast('Horário cancelado');
    await telaArea();
  })));
}

/* Agendar um horário novo ou, com remarcar, mudar o dia/hora de um que já existe
   (o serviço e o profissional continuam os mesmos). */
function telaAgendar(remarcar = null) {
  const { servicos, profissionais } = CLI.info;
  if (!servicos.length || !profissionais.length) return toast('Agendamento indisponível no momento. Fale com o estabelecimento.', true);
  if (remarcar && !profissionais.some((p) => p.id === remarcar.profissional_id)) {
    return toast(`Este profissional não está disponível. Fale com ${CLI.info.barbearia}.`, true);
  }
  const max = addDays(today(), DIAS_ANTECEDENCIA);
  const s = sheet(`
    <h3>${remarcar ? 'Remarcar horário' : 'Agendar horário'}</h3>
    ${remarcar ? `<div class="kv"><span>Agora</span><span>${esc(remarcar.data === today() ? 'Hoje' : fmtDay(remarcar.data))} às ${esc(remarcar.hora)}</span></div>
      <div class="kv"><span>Serviço</span><span>${esc([remarcar.servico, remarcar.profissional && `com ${remarcar.profissional}`].filter(Boolean).join(' · '))}</span></div>
      <div class="field" style="margin-top:14px"><label>Novo dia</label><input type="date" id="data" value="${esc(remarcar.data)}" min="${today()}" max="${max}"></div>`
    : `<div class="field"><label>Serviço</label>
      <select id="srv">${servicos.map((x) => opt(x.id, `${x.nome} — ${money(x.preco)}`, servicos[0].id)).join('')}</select></div>
    <div class="row2">
      <div class="field"><label>Profissional</label>
        <select id="prof">${profissionais.map((p) => opt(p.id, p.nome, profissionais[0].id)).join('')}</select></div>
      <div class="field"><label>Dia</label><input type="date" id="data" value="${today()}" min="${today()}" max="${max}"></div>
    </div>`}
    <div class="field"><label id="dia-rotulo">Horários livres</label><div id="slots" class="slots grade"></div></div>
    <div class="err" id="err"></div>
    <div class="btns two"><button class="btn ghost" id="cancel">Voltar</button><button class="btn green" id="ok">${remarcar ? 'Remarcar' : 'Confirmar'}</button></div>`);
  let hora = '';
  const srv = () => servicos.find((x) => x.id === Number($('#srv', s).value));
  const prof = () => profissionais.find((p) => p.id === (remarcar ? remarcar.profissional_id : Number($('#prof', s).value)));
  // Tempo do profissional, senão a duração do serviço (o servidor usa a mesma regra); ao remarcar, a mesma duração.
  const duracao = () => (remarcar ? remarcar.duracao : prof().tempo_atendimento || srv().duracao);
  const err = (m) => ($('#err', s).textContent = m);

  const drawSlots = serial(async () => {
    const box = $('#slots', s);
    const data = $('#data', s).value;
    err('');
    if (!data || data < today() || data > max) { box.innerHTML = `<div class="hint">Escolha um dia entre hoje e os próximos ${DIAS_ANTECEDENCIA} dias.</div>`; return; }
    const p = prof();
    const dur = duracao();
    $('#dia-rotulo', s).textContent = `Horários livres · ${data === today() ? 'hoje' : fmtDay(data)} · ${dur >= 60 ? `${Math.floor(dur / 60)} h${dur % 60 ? ` ${dur % 60} min` : ''}` : `${dur} min`}`;
    const r = await chamar('cliente_ocupados', { p_codigo: CLI.codigo, p_profissional: p.id, p_data: data });
    let ocup = r.ocupados;
    // Ao remarcar no mesmo dia, o próprio horário não conta como ocupado.
    if (remarcar && data === remarcar.data) {
      const i = ocup.findIndex((o) => o.hora === remarcar.hora && o.duracao === remarcar.duracao);
      if (i >= 0) ocup = ocup.filter((_, j) => j !== i);
    }
    const exp = r.folga ? { folga: 'folga' } : expedienteDoHorario(p.horario, data);
    const res = calcularLivres(exp, ocup.map(comIntervalo), data, dur);
    if (!res.livres.includes(hora)) hora = '';
    box.innerHTML = res.folga ? `<div class="hint neg">${esc(p.nome)} não atende neste dia.</div>`
      : res.livres.length ? res.livres.map((h) => `<button type="button" data-h="${h}" class="${h === hora ? 'on' : ''}">${h}</button>`).join('')
      : '<div class="hint">Nenhum horário livre neste dia. Tente outro dia ou profissional.</div>';
    box.querySelectorAll('[data-h]').forEach((b) => (b.onclick = () => {
      hora = b.dataset.h;
      box.querySelectorAll('[data-h]').forEach((x) => x.classList.toggle('on', x === b));
    }));
  });
  ['#srv', '#prof', '#data'].forEach((k) => { if ($(k, s)) $(k, s).onchange = () => { hora = ''; drawSlots(); }; });
  drawSlots();

  $('#cancel', s).onclick = closeSheet;
  $('#ok', s).onclick = safe(async () => {
    if (!hora) return err('Escolha um horário.');
    const data = $('#data', s).value;
    if (remarcar && data === remarcar.data && hora === remarcar.hora) return err('Escolha um dia ou horário diferente do atual.');
    try {
      if (remarcar) {
        await chamar('cliente_remarcar', { p_codigo: CLI.codigo, p_telefone: CLI.telefone, p_agendamento: remarcar.id, p_data: data, p_hora: hora });
      } else {
        await chamar('cliente_agendar', { p_codigo: CLI.codigo, p_telefone: CLI.telefone, p_servico: srv().id, p_profissional: prof().id, p_data: data, p_hora: hora });
      }
    } catch (e) {
      err(mensagemErro(e));
      drawSlots(); // o horário pode ter sido ocupado por outra pessoa
      return;
    }
    closeSheet();
    toast(`${remarcar ? 'Remarcado' : 'Agendado'}: ${data === today() ? 'hoje' : fmtDay(data)} às ${hora}`);
    await telaArea();
  });
  return undefined;
}

safe(iniciar)();
