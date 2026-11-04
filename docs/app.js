/* 홀덤 듀얼 코치 — 화면 로직 */
(function () {
  'use strict';
  const H = window.HoldemEngine;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt1 = (x) => (Math.round(x * 10) / 10).toString();
  const pct0 = (x) => (x == null ? '—' : Math.round(x * 100) + '%');

  const STREETS = ['preflop', 'flop', 'turn', 'river'];
  const STREET_LABEL = { preflop: '프리플랍', flop: '플랍', turn: '턴', river: '리버' };
  const BOARD_N = { preflop: 0, flop: 3, turn: 4, river: 5 };
  const RESULT_OPTS = [
    ['xx', '체크-체크'], ['hb', '내 벳 → 상대 콜'], ['ob', '상대 벳 → 내 콜'], ['rc', '상대 레이즈 → 내 콜'], ['hr', '내 레이즈 → 상대 콜'],
  ];
  const RESULT_MULT = { xx: 1, hb: 2, ob: 2, rc: 4, hr: 4 };
  const RESULT_HISTORY = {
    xx: [{ act: 'check' }], hb: [{ act: 'call' }], ob: [{ act: 'bet', frac: 0.5 }],
    rc: [{ act: 'raise' }], hr: [{ act: 'bet', frac: 0.5 }, { act: 'call' }],
  };
  const LINE_FROM_PF = { open: 'opp_open_call', '3bet': 'opp_3bet_call', '4bet': 'opp_4bet_call', limp: 'limp' };
  const STORE_KEY = 'holdem-dual-coach:v1';

  const EXAMPLE = {
    game: 'cash', table: 6, stage: 'middle', eff: 100,
    heroPos: 'BTN', oppPos: 'BB', oppType: 'unknown',
    hero: ['Ac', 'Kc'], board: ['Ad', '8h', '5c', null, null],
    street: 'flop',
    pfAction: 'none', raiseSize: '', heroOpen: '', limpers: 1,
    line: null, multiway: 1,
    potManual: { flop: null, turn: null, river: null },
    results: { flop: 'hb', turn: 'hb' },
    curAct: { flop: 'check', turn: 'check', river: 'check' },
    amt: { flop: {}, turn: {}, river: {} },
    example: true,
    mode: 'flow', flowActs: [],
    variant: 'holdem', // 'holdem' | 'omaha' (오마하 = PLO, 카드 4장)
  };
  const clone = (o) => JSON.parse(JSON.stringify(o));
  let S = clone(EXAMPLE);
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (saved) for (const k of ['game', 'table', 'stage', 'eff', 'oppType', 'mode', 'variant']) if (saved[k] != null) S[k] = saved[k];
  } catch (e) { /* 저장소를 못 쓰면 기본값 */ }
  const isPLO = () => S.variant === 'omaha';
  const HN = () => (isPLO() ? 4 : 2); // 내 카드 장수
  function fitHero() {
    if (S.hero.length !== HN()) S.hero = isPLO() ? [null, null, null, null] : [null, null];
    if (isPLO() && S.mode === 'manual') S.mode = 'flow'; // 오마하는 핸드 진행·연습만
  }
  fitHero();
  function persist() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ game: S.game, table: S.table, stage: S.stage, eff: S.eff, oppType: S.oppType, mode: S.mode, variant: S.variant })); } catch (e) { /* 무시 */ }
  }

  // ───────── 핸드 진행 ─────────
  const isFlow = () => S.mode === 'flow';
  const isPractice = () => S.mode === 'practice';
  const flowState = () => H.replayHand({ table: S.table, eff: S.eff, game: S.game, heroPos: S.heroPos, variant: S.variant }, S.flowActs);
  const SEAT_ACT = { fold: '폴드', check: '체크', call: '콜', bet: '벳', raise: '레이즈', allin: '올인' };
  // 첫 화면 예시: 내 차례까지 모두 폴드한 상태
  S.flowActs = (function () {
    const s = flowState(), out = [];
    while (s.status === 'playing' && s.toAct !== s.heroPos) { H.applyAction(s, { type: 'fold' }); out.push({ type: 'fold' }); }
    return out;
  })();
  let actsReady = false;

  function flowMessage(st) {
    if (st.status === 'hero_folded') return '폴드했습니다. 핸드가 끝났습니다.';
    if (st.status === 'won') return `상대가 모두 폴드했습니다. 팟 ${fmt1(st.pot)}BB를 가져갑니다.`;
    if (st.status === 'runout') return `올인 — 더 결정할 것이 없습니다. 팟 ${fmt1(st.pot)}BB, 보드를 끝까지 봅니다.`;
    if (st.status === 'showdown') return `쇼다운입니다. 팟 ${fmt1(st.pot)}BB.`;
    return `${H.POS_LABEL[st.toAct]} 차례입니다. 상대 액션을 고르면 내 차례에 두 전문가의 빈도가 나옵니다.`;
  }
  function renderFlowTable(st) {
    const order = H.POSITIONS[st.table], n = order.length, hi = order.indexOf(st.heroPos);
    const seats = order.map((pos, i) => {
      const th = Math.PI / 2 + 2 * Math.PI * (i - hi) / n;
      const p = st.players[pos];
      const lastAct = st.log.filter((e) => e.pos === pos && e.street === st.street).pop();
      let act = '';
      if (!p.inHand) act = '폴드';
      else if (p.allin) act = '올인';
      else if (lastAct) act = SEAT_ACT[lastAct.type] + (p.bet > 0 ? ' ' + fmt1(p.bet) : '');
      else if (p.bet > 0) act = fmt1(p.bet);
      const cls = `seat ${pos === st.heroPos ? 'me' : ''} ${pos === st.toAct ? 'turn' : ''} ${p.inHand ? '' : 'out'}`;
      return `<div class="${cls}" style="left:${(50 + 42 * Math.cos(th)).toFixed(1)}%;top:${(50 + 39 * Math.sin(th)).toFixed(1)}%"><span class="p">${H.POS_LABEL[pos]}</span><span class="a">${esc(act)}</span></div>`;
    }).join('');
    $('#flowTable').innerHTML = `<div class="felt-center"><span>${STREET_LABEL[st.street]}<b>팟 ${fmt1(st.pot)}BB</b></span></div>${seats}`;
    const log = $('#flowLog');
    log.innerHTML = st.log.filter((e) => e.type !== 'fold').map((e) => `<li class="${e.hero ? 'me' : ''}">${STREET_LABEL[e.street]} · ${H.POS_LABEL[e.pos]} ${SEAT_ACT[e.type]}${e.to > 0 && e.type !== 'check' ? ' ' + fmt1(e.to) + 'BB' : ''}</li>`).join('');
    log.scrollTop = log.scrollHeight;
  }
  // 액션 바로 아래에 두는 되돌리기. 마지막 액션을 이름으로 보여 준다
  function undoHTML(st) {
    const e = st.log[st.log.length - 1];
    if (!S.flowActs.length || !e) return '';
    const what = S.flowActs[S.flowActs.length - 1].auto ? '모두 폴드' : `${H.POS_LABEL[e.pos]} ${SEAT_ACT[e.type] || '폴드'}`;
    return `<div class="flow-undo"><button class="ghost" type="button" id="flowUndo">↩ 되돌리기 · ${esc(what)}</button></div>`;
  }
  function renderFlowActs(st) {
    const box = $('#flowActs');
    if (st.status !== 'playing') {
      box.innerHTML = `<p class="flow-end">${esc(flowMessage(st))}</p><button class="btn" type="button" id="flowNew">새 핸드</button>${undoHTML(st)}`;
      return;
    }
    const o = H.flowOptions(st);
    const btn = (cls, type, to, label) => `<button type="button" class="act-btn ${cls}" data-ftype="${type}" ${to != null ? `data-fto="${to}"` : ''}>${esc(label)}</button>`;
    const custom = o.canRaise ? `<div class="row"><div class="num"><input id="flowAmt" type="number" inputmode="decimal" min="${o.min}" max="${o.max}" step="0.5" placeholder="${fmt1(o.min)}"><span>BB</span></div><button class="ghost" type="button" id="flowCustom">${o.raiseType === 'bet' ? '이 금액 벳' : '이 금액으로 레이즈'}</button></div>` : '';
    const base = (o.canCheck ? btn('call', 'check', null, '체크') : btn('fold', 'fold', null, '폴드') + btn('call', 'call', null, `콜 ${fmt1(o.toCall)}BB`));
    // 오마하(팟 리밋)는 팟 한도가 스택보다 작으면 올인 버튼을 두지 않는다
    const me0 = st.players[o.pos], canJam = !st.plo || o.max >= me0.bet + me0.stack - 1e-9;
    const allin = canJam ? btn('allin', 'allin', null, `올인 ${fmt1(o.max)}BB`) : '';
    if (o.hero) {
      const res = actsReady && last && last.res;
      if (res && res.actions) {
        const top = res.consensus.top;
        const rows = res.actions.map((a, i) => (res.consensus.freq[i] >= 0.004 || i === top || a.kind === 'fold' || a.kind === 'call' || a.kind === 'check' ? `<button type="button" class="act-btn ${a.kind === 'bet' ? 'raise' : a.kind === 'check' ? 'call' : a.kind} ${i === top ? 'top' : ''}" data-res="${i}">${esc(a.label)}${a.sub ? ' ' + esc(a.sub) : ''}<b>${(res.consensus.freq[i] * 100).toFixed(0)}%</b></button>` : '')).join('');
        box.innerHTML = `<p class="flow-head">내 차례 — 실제로 한 액션을 고르세요 (금색이 추천)</p><div class="flow-btns">${rows}</div>${custom}${undoHTML(st)}`;
      } else {
        box.innerHTML = `<p class="flow-head">내 차례 — ${esc(res && res.error ? res.error : '계산 중…')}</p><div class="flow-btns">${base}${allin}</div>${custom}${undoHTML(st)}`;
      }
      return;
    }
    const sizes = o.sizes.map((x) => btn('raise', o.raiseType, x.to, `${o.raiseType === 'bet' ? '벳' : '레이즈'} ${x.label}`)).join('');
    box.innerHTML = `<p class="flow-head">${H.POS_LABEL[o.pos]} 차례 — 상대 액션을 고르세요</p>
      <div class="flow-btns">${base}${sizes}${allin}</div>${custom}
      ${o.canCheck && st.street !== 'preflop' ? '' : '<div class="row" style="margin-top:6px"><button class="linkish" type="button" id="flowFoldAll">내 차례까지 모두 폴드</button></div>'}${undoHTML(st)}`;
  }
  function flowDo(a) {
    S.flowActs.push(a);
    S.example = false;
    const st = flowState();
    if (st.street !== 'preflop') {
      const empty = S.board.findIndex((c, i) => !c && i < BOARD_N[st.street]);
      if (empty >= 0) { active = { group: 'board', idx: empty }; pendingRank = null; }
    }
    update();
  }
  // 진행 상태를 기존 입력값에 옮겨, 결과 패널과 Claude 토론이 같은 값을 보게 한다
  function syncFlowToInputs() {
    const st = flowState();
    S.street = st.street;
    if (st.status !== 'playing' || st.toAct !== st.heroPos) return;
    const c = H.flowContext(st);
    S.oppPos = c.oppPos;
    if (st.street === 'preflop') Object.assign(S, { pfAction: c.pfAction, raiseSize: c.raiseSize || '', heroOpen: c.heroOpen || '', limpers: Math.max(1, c.limpers) });
    else { Object.assign(S, { line: c.line, multiway: c.multiway }); S.curAct[st.street] = c.curAct; }
  }

  // ───────── 파생 값 ─────────
  // 라인을 고르지 않았으면 프리플랍 액션에서 정하고, 그것도 없으면 먼저 액션하는 쪽이 오픈한 것으로 본다
  const effLine = () => S.line || LINE_FROM_PF[S.pfAction] || (posList().indexOf(S.heroPos) < posList().indexOf(S.oppPos) ? 'hero_open_call' : 'opp_open_call');
  function deadMoney() {
    const inHand = [S.heroPos, S.oppPos];
    return (inHand.includes('SB') ? 0 : 0.5) + (inHand.includes('BB') ? 0 : 1) + (S.game === 'mtt' ? 1 : 0);
  }
  function autoPot(street) {
    if (street === 'flop') {
      const line = effLine();
      let size = null;
      if (line === 'opp_open_call' && S.pfAction === 'open') size = S.raiseSize;
      if (line === 'hero_open_call') size = S.heroOpen;
      return H.estimateFlopPot(line, S.game, size, S.heroPos, S.oppPos, S.eff);
    }
    const prev = street === 'turn' ? 'flop' : 'turn';
    const start = startPot(prev);
    const r = S.results[prev] || 'xx';
    const bet = parseFloat(S.amt[prev] && S.amt[prev].bet);
    const grown = r === 'ob' && bet > 0 ? start + 2 * bet : start * RESULT_MULT[r];
    return Math.min(grown, 2 * S.eff + deadMoney()); // 두 사람의 유효 스택을 넘어 커질 수 없다
  }
  function startPot(street) {
    const m = S.potManual[street];
    return m != null && m > 0 ? m : Math.round(autoPot(street) * 10) / 10;
  }
  function stackAt(street) {
    return Math.max(0.5, Math.round((S.eff - (startPot(street) - deadMoney()) / 2) * 10) / 10);
  }
  const toCards = (arr) => arr.filter(Boolean).map(H.parseCard);

  function buildCtx() {
    if (isFlow()) {
      const st = flowState();
      if (st.status !== 'playing' || st.toAct !== st.heroPos) return null;
      return Object.assign(H.flowContext(st), {
        stage: S.stage, oppType: S.oppType,
        hero: S.hero.filter(Boolean).length === HN() ? toCards(S.hero) : null,
        board: toCards(S.board.slice(0, BOARD_N[st.street]).filter(Boolean)),
        variant: S.variant,
      });
    }
    const base = {
      game: S.game, stage: S.stage, table: S.table, eff: S.eff,
      heroPos: S.heroPos, oppPos: S.oppPos, oppType: S.oppType,
      hero: S.hero.filter(Boolean).length === 2 ? toCards(S.hero) : null,
      street: S.street, variant: S.variant,
      pfAction: S.pfAction, raiseSize: parseFloat(S.raiseSize) || 0, heroOpen: parseFloat(S.heroOpen) || 0, limpers: S.limpers,
    };
    if (S.street === 'preflop') return base;
    const n = BOARD_N[S.street];
    const board = S.board.slice(0, n);
    const st = S.street;
    const start = startPot(st);
    let stack = stackAt(st);
    const a = S.amt[st] || {};
    const act = S.curAct[st];
    let pot = start, call = 0;
    if (act === 'bet') { const b = parseFloat(a.bet) || Math.round(start * 0.5 * 10) / 10; pot = start + b; call = b; }
    else if (act === 'raise') {
      const mb = parseFloat(a.myBet) || Math.round(start * 0.5 * 10) / 10;
      const rt = parseFloat(a.raiseTo) || mb * 3;
      pot = start + mb + rt; call = Math.max(0, rt - mb); stack = Math.max(0.5, stack - mb);
    } else if (act === 'allin') { const al = parseFloat(a.allin) || stack; pot = start + al; call = al; }
    const history = [];
    for (const s of ['flop', 'turn']) {
      if (STREETS.indexOf(s) >= STREETS.indexOf(st)) break;
      for (const h of RESULT_HISTORY[S.results[s] || 'xx']) history.push(Object.assign({ street: s }, h));
    }
    return Object.assign(base, {
      board: board.every(Boolean) ? toCards(board) : toCards(board.filter(Boolean)),
      line: effLine(), multiway: S.multiway, history,
      curAct: act === 'first' ? 'first' : act, pot, call, stack,
    });
  }

  // ───────── 입력 패널 동기화 ─────────
  function posList() { return H.POSITIONS[S.table]; }
  function renderPositions() {
    for (const field of ['heroPos', 'oppPos']) {
      const box = $(`[data-field="${field}"]`);
      box.innerHTML = posList().map((p) => `<button class="chip" type="button" data-v="${p}">${H.POS_LABEL[p]}</button>`).join('');
    }
  }
  function renderResultChips() {
    for (const s of ['flop', 'turn']) {
      const box = $(`[data-result="${s}"]`);
      box.innerHTML = RESULT_OPTS.map(([v, l]) => `<button class="chip" type="button" data-v="${v}" aria-pressed="${S.results[s] === v}">${l}</button>`).join('');
    }
  }

  let active = null; // {group, idx}
  let pendingRank = null;
  function usedCards() { return new Set([...S.hero, ...S.board].filter(Boolean)); }
  function cardHTML(c, attrs, extra) {
    if (!c) return `<button type="button" class="card empty ${extra || ''}" ${attrs}>+</button>`;
    const suit = H.SUITS.indexOf(c[1]);
    return `<button type="button" class="card suit-${suit} ${extra || ''}" ${attrs} aria-label="${c}"><span>${c[0] === 'T' ? '10' : c[0]}<span class="s">${H.SUIT_SYM[suit]}</span></span></button>`;
  }
  function renderCards() {
    const hb = $('[data-cards="hero"]');
    hb.innerHTML = S.hero.map((c, i) => cardHTML(c, `data-group="hero" data-idx="${i}"`, active && active.group === 'hero' && active.idx === i ? 'active' : '')).join('');
    const bb = $('[data-cards="board"]');
    const n = Math.max(3, BOARD_N[S.street]);
    let html = '';
    for (let i = 0; i < n; i++) {
      if (i === 3 || i === 4) html += '<span class="gap"></span>';
      html += cardHTML(S.board[i], `data-group="board" data-idx="${i}"`, active && active.group === 'board' && active.idx === i ? 'active' : '');
    }
    bb.innerHTML = html;
  }
  function renderPicker() {
    const pk = $('#picker');
    if (!active) { pk.hidden = true; return; }
    const host = $(`[data-cards="${active.group}"]`);
    if (pk.previousElementSibling !== host) host.after(pk);
    pk.hidden = false;
    const used = usedCards();
    const cur = active.group === 'hero' ? S.hero[active.idx] : S.board[active.idx];
    const ranks = 'AKQJT98765432'.split('');
    $('#pkRanks').innerHTML = ranks.map((r) => {
      const all = H.SUITS.split('').every((s) => used.has(r + s) && r + s !== cur);
      return `<button type="button" class="pk" data-rank="${r}" aria-pressed="${pendingRank === r}" ${all ? 'disabled' : ''}>${r === 'T' ? '10' : r}</button>`;
    }).join('');
    $('#pkSuits').innerHTML = H.SUITS.split('').map((s, i) => {
      const dis = pendingRank && used.has(pendingRank + s) && pendingRank + s !== cur;
      return `<button type="button" class="pk s${i}" data-suit="${s}" ${dis ? 'disabled' : ''} aria-label="${['스페이드', '하트', '다이아', '클럽'][i]}">${H.SUIT_SYM[i]}</button>`;
    }).join('') + '<button type="button" class="pk clear" data-clear="1">지우기</button>';
  }
  function setCard(card) {
    if (!active) return;
    const arr = active.group === 'hero' ? S.hero : S.board;
    arr[active.idx] = card;
    S.example = false;
    pendingRank = null;
    // 다음 빈 칸으로
    const limit = active.group === 'hero' ? HN() : Math.max(3, BOARD_N[S.street]);
    let next = null;
    if (card) for (let i = 0; i < limit; i++) if (!arr[i]) { next = i; break; }
    if (next == null && card && active.group === 'hero' && S.street !== 'preflop' && S.board.slice(0, BOARD_N[S.street]).some((c) => !c)) {
      active = { group: 'board', idx: S.board.findIndex((c, i) => !c && i < BOARD_N[S.street]) };
    } else active = next == null ? null : { group: active.group, idx: next };
    update();
  }

  function sync() {
    $$('[data-field]').forEach((box) => {
      const f = box.dataset.field;
      const val = f === 'line' ? effLine() : f === 'curAct' ? S.curAct[S.street] : S[f];
      $$('[data-v]', box).forEach((b) => {
        const on = String(val) === b.dataset.v;
        if (b.getAttribute('role') === 'tab') b.setAttribute('aria-selected', on); else b.setAttribute('aria-pressed', on);
        if (f === 'oppPos') b.disabled = b.dataset.v === S.heroPos;
      });
    });
    $$('[data-show="mtt"]').forEach((e) => { e.hidden = S.game !== 'mtt'; });
    $('[data-pane="preflop"]').hidden = S.street !== 'preflop';
    $('[data-pane="post"]').hidden = S.street === 'preflop';
    $$('[data-show-pf]').forEach((e) => { e.hidden = !e.dataset.showPf.split(' ').includes(S.pfAction); });
    $$('[data-show-street]').forEach((e) => { e.hidden = !e.dataset.showStreet.split(' ').includes(S.street); });
    $$('[data-show-act]').forEach((e) => { e.hidden = S.street === 'preflop' || S.curAct[S.street] !== e.dataset.showAct; });
    $('#exampleTag').hidden = !S.example;
    const flow = isFlow();
    $('#flowGroup').hidden = !flow;
    $('#manualGroup').hidden = flow;
    $('#oppPosRow').hidden = flow;
    // 보드 칸은 하나라서 모드에 따라 옮겨 단다
    const boardField = $('#boardField');
    const boardHome = flow ? $('#flowBoardSlot') : $('[data-pane="post"]');
    if (boardField.parentElement !== boardHome) boardHome.prepend(boardField);
    // 연습 모드는 입력 칸 대신 연습 설정만 보여 준다
    const prac = isPractice();
    $('#practiceGroup').hidden = !prac;
    const manualBtn = $('[data-field="mode"] [data-v="manual"]'); if (manualBtn) manualBtn.hidden = isPLO();
    document.body.classList.toggle('plo', isPLO());
    document.body.classList.toggle('practice-mode', prac);
    $('[data-cards="hero"]').closest('.group').hidden = prac;
    $('#newHand').hidden = prac;
    if (prac) { $('#manualGroup').hidden = true; $('#oppPosRow').hidden = true; renderPracticePanel(); }
    if (flow) {
      const st = flowState();
      $('#flowBoardSlot').hidden = st.street === 'preflop';
      renderFlowTable(st);
      renderFlowActs(st);
    }
    setVal('#eff', S.eff);
    setVal('#raiseSize', S.raiseSize);
    setVal('#heroOpen', S.heroOpen);
    setVal('#limpers', S.limpers);
    if (S.street !== 'preflop') {
      const st = S.street;
      const auto = Math.round(autoPot(st) * 10) / 10;
      const pi = $('#pot');
      pi.placeholder = String(auto);
      setVal('#pot', S.potManual[st] != null ? S.potManual[st] : auto);
      $('#potAuto').hidden = S.potManual[st] == null;
      const a = S.amt[st] || {};
      setVal('#betAmt', a.bet || '');
      $('#betAmt').placeholder = fmt1(startPot(st) * 0.5);
      setVal('#myBet', a.myBet || '');
      $('#myBet').placeholder = fmt1(startPot(st) * 0.5);
      setVal('#raiseTo', a.raiseTo || '');
      setVal('#allinAmt', a.allin || '');
      const stack = stackAt(st);
      $('#stackHint').textContent = `스트리트 시작 시 내 남은 스택 ≈ ${fmt1(stack)}BB · SPR ${fmt1(stack / Math.max(startPot(st), 0.5))}`;
    }
    renderResultChips();
    renderCards();
    renderPicker();
  }
  function setVal(sel, v) {
    const e = $(sel);
    if (document.activeElement === e) return;
    e.value = v == null ? '' : v;
  }

  // ───────── 계산과 결과 ─────────
  let timer = null;
  let last = null;
  function update() {
    persist();
    actsReady = false;
    if (isFlow()) syncFlowToInputs();
    sync();
    clearTimeout(timer);
    if (isPractice()) { timer = setTimeout(renderPractice, 30); return; }
    timer = setTimeout(compute, 60);
  }
  function compute() {
    let res;
    const ctx = buildCtx();
    if (!ctx) { // 내 차례가 아니면 계산할 것이 없다
      const st = flowState();
      last = { res: { walk: true, message: flowMessage(st), preview: previewVerdict(st) }, ctx: {}, grid: null };
      actsReady = true;
      renderResults();
      return;
    }
    try { res = H.analyze(ctx); } catch (e) { res = { error: '계산 중 오류: ' + e.message }; console.error(e); }
    let grid = null;
    if (!res.error && !res.walk && S.street === 'preflop') { try { grid = H.preflopGrid(ctx); } catch (e) { grid = null; } }
    last = { res, ctx, grid };
    actsReady = true;
    renderResults();
    if (isFlow()) renderFlowActs(flowState());
  }

  function actColor(a, pot) {
    if (a.kind === 'fold') return 'var(--fold)';
    if (a.kind === 'check' || a.kind === 'call') return 'var(--call)';
    if (a.kind === 'allin') return 'var(--allin)';
    if (!a.amount || !pot) return 'var(--bet3)';
    const r = a.amount / pot;
    return r < 0.4 ? 'var(--bet1)' : r < 0.7 ? 'var(--bet2)' : r < 1.1 ? 'var(--bet3)' : 'var(--bet4)';
  }
  const miniCards = (cards) => `<span class="mini">${cards.map((c) => { const s = H.SUITS.indexOf(c[1]); return `<span class="mc suit-${s}">${c[0] === 'T' ? '10' : c[0]}${H.SUIT_SYM[s]}</span>`; }).join('')}</span>`;
  const WHO = { tight: ['T', '타이트 전문가'], balanced: ['B', '균형형 전문가'], judge: ['합', '합의'] };

  function freqRows(actions, freq, pot, topIdx, mineIdx) {
    return actions.map((a, i) => {
      const f = freq[i] * 100;
      return `<div class="fr ${i === topIdx ? 'top' : ''} ${i === mineIdx ? 'mine' : ''} ${f < 0.05 ? 'zero' : ''}">
        <div class="bar" style="width:${Math.min(100, f)}%;background:${actColor(a, pot)}"></div>
        <div class="name">${esc(a.label)}${a.sub ? `<small>${esc(a.sub)}</small>` : ''}</div>
        <div class="val">${f.toFixed(1)}</div></div>`;
    }).join('');
  }
  function miniRows(actions, freq, pot) {
    const top = freq.reduce((b, x, i) => (x > freq[b] ? i : b), 0);
    return actions.map((a, i) => `<div class="mr ${i === top ? 'top' : ''}"><div class="lab"><span>${esc(a.label)}${a.sub ? ' · ' + esc(a.sub) : ''}</span><div class="track"><i style="width:${(freq[i] * 100).toFixed(1)}%;background:${actColor(a, pot)}"></i></div></div><div class="pv">${(freq[i] * 100).toFixed(1)}</div></div>`).join('');
  }
  function mixBar(mix) {
    const cols = ['var(--bet3)', 'var(--gold)', 'var(--fold)', 'var(--ink-3)'];
    const names = ['강한 메이드', '중간·약한 페어', '드로우', '에어'];
    return `<div class="mix">${mix.map((m, i) => `<i style="width:${(m * 100).toFixed(1)}%;background:${cols[i]}"></i>`).join('')}</div>
      <div class="mix-legend">${mix.map((m, i) => `<span><b style="background:${cols[i]}"></b>${names[i]} ${pct0(m)}</span>`).join('')}</div>`;
  }

  let gridStyle = 'balanced';
  function gridHTML(grid, heroKey) {
    const g = grid[gridStyle];
    const cells = H.GRID.flat().map((k) => {
      const fr = g[k] || {};
      const r = (fr.raise || 0) * 100, al = (fr.allin || 0) * 100, c = (fr.call || 0) * 100;
      const bg = `linear-gradient(to right, var(--allin) 0 ${al}%, var(--bet3) ${al}% ${al + r}%, var(--call) ${al + r}% ${al + r + c}%, transparent ${al + r + c}% 100%)`;
      const strong = al + r + c > 50;
      return `<div class="${k === heroKey ? 'me' : ''}" style="background:${bg},var(--surface-2);${strong ? 'color:#fff' : ''}" title="${k}: 레이즈 ${r.toFixed(0)}% · 올인 ${al.toFixed(0)}% · 콜 ${c.toFixed(0)}%"><span>${k}</span></div>`;
    }).join('');
    // 올인 콜 스팟은 콜·폴드만 있고, 에퀴티는 핸드마다 샘플링한 근사값이다
    const legend = grid.allin
      ? '<span><b style="background:var(--call)"></b>콜</span><span><b style="background:var(--surface-2);border:1px solid var(--line)"></b>폴드</span><span>테두리 = 내 핸드</span><span>에퀴티는 핸드별 샘플링 근사</span>'
      : '<span><b style="background:var(--bet3)"></b>레이즈</span><span><b style="background:var(--allin)"></b>올인</span><span><b style="background:var(--call)"></b>콜·림프</span><span><b style="background:var(--surface-2);border:1px solid var(--line)"></b>폴드</span><span>테두리 = 내 핸드</span>';
    return `<div class="card-box"><div class="group-head" style="margin-bottom:8px"><h3 style="margin:0">${grid.allin ? '올인 콜 레인지' : '이 스팟의 레인지'}</h3>
      <div class="seg" id="gridSeg"><button type="button" data-g="tight" aria-pressed="${gridStyle === 'tight'}">타이트</button><button type="button" data-g="balanced" aria-pressed="${gridStyle === 'balanced'}">균형형</button></div></div>
      <div class="grid-wrap"><div class="rgrid">${cells}</div></div>
      <div class="legend">${legend}</div></div>`;
  }

  // 플레이 여부 판정 카드
  function verdictHTML(res, note) {
    const v = H.playVerdict(res);
    if (!v) return '';
    const i = res.consensus.top;
    return `<div class="card-box play-box ${v.level}"><div class="play-main">${esc(v.label)}<b>참여 빈도 ${pct0(v.play)}</b></div>
      <p class="hint">${esc(H.POS_LABEL[S.heroPos])} · ${esc(res.info.heroDesc)} · 추천 ${esc(res.actions[i].label)}${note ? ' · ' + esc(note) : ''}. 차트 기반 근사이며 실제 솔버 값이 아닙니다.</p></div>`;
  }
  // 내 차례 전이라도, 카드가 있고 아직 액션이 없으면 "모두 폴드로 올 때" 기준으로 미리 판정한다
  function previewVerdict(st) {
    if (st.status !== 'playing' || st.street !== 'preflop' || S.hero.filter(Boolean).length !== HN() || st.heroPos === 'BB') return null;
    if (st.log.some((e) => e.raised || e.type === 'call' || e.hero)) return null;
    try {
      return H.analyze({ street: 'preflop', table: st.table, game: S.game, stage: S.stage, eff: S.eff, heroPos: S.heroPos, oppPos: 'BB', oppType: S.oppType, hero: toCards(S.hero), pfAction: 'none', variant: S.variant });
    } catch (e) { return null; }
  }

  function renderResults() {
    const box = $('#results');
    const { res, ctx, grid } = last;
    if (res.error || res.walk) {
      const pre = res.preview ? verdictHTML(res.preview, '앞에서 모두 폴드로 올 때 기준') : '';
      box.innerHTML = pre + `<div class="card-box empty-state">${esc(res.error || res.message)}</div>` + aiShell();
      setDock('—', res.error ? '입력을 마저 채우세요' : '');
      wireResults();
      return;
    }
    const A = res.actions, Cn = res.consensus, info = res.info;
    const pot = info.pot;
    const boardCards = S.street === 'preflop' ? [] : S.board.slice(0, BOARD_N[S.street]).filter(Boolean);
    const sorted = Cn.freq.map((f, i) => [f, i]).sort((a, b) => b[0] - a[0]);
    const second = sorted[1] && sorted[1][0] >= 0.2 ? sorted[1] : null;
    const verdict = `추천 <em>${esc(A[Cn.top].label)}${A[Cn.top].sub ? ' (' + esc(A[Cn.top].sub) + ')' : ''}</em>${second ? ` · 혼합 ${esc(A[second[1]].label)} ${(second[0] * 100).toFixed(0)}%` : ''}`;
    const stats = [];
    stats.push(['팟', fmt1(pot) + 'BB']);
    if (info.call > 0) stats.push(['콜 금액', fmt1(info.call) + 'BB']);
    if (info.required != null) stats.push(['팟오즈 필요', pct0(info.required)]);
    const eqT = res.tight.equity, eqB = res.balanced.equity;
    if (eqB != null) stats.push(['에퀴티 T / B', eqT != null && Math.round(eqT * 100) !== Math.round(eqB * 100) ? `${pct0(eqT)} / ${pct0(eqB)}` : pct0(eqB)]);
    if (info.mdf != null) stats.push(['MDF', pct0(info.mdf)]);
    if (info.spr != null && info.spr > 0) stats.push(['SPR', fmt1(info.spr)]);
    if (info.villainPct != null) stats.push(['상대 레인지', pct0(info.villainPct)]);
    const spotMeta = `${STREET_LABEL[S.street]} · ${H.POS_LABEL[S.heroPos]} vs ${H.POS_LABEL[S.oppPos]} · ${S.game === 'mtt' ? '토너먼트 ' + H.STAGE_LABEL[S.stage] : '캐시'} ${fmt1(S.eff)}BB`;

    let html = S.street === 'preflop' ? verdictHTML(res) : '';
    html += `<div class="solver">
      <div class="solver-head"><div class="spot">${miniCards(S.hero)}${boardCards.length ? '<span class="meta">on</span>' + miniCards(boardCards) : ''}<span class="meta">${esc(spotMeta)}</span></div><span class="solver-title">두 전문가 합의 · %</span></div>
      <div class="freq-table">${freqRows(A, Cn.freq, pot, Cn.top)}</div>
      <div class="verdict">${verdict}</div>
      <div class="solver-foot"><span>의견 일치 <b>${pct0(Cn.agreement)}</b></span><span>가중 <b>균형형 ${Math.round(Cn.w * 100)} : 타이트 ${Math.round((1 - Cn.w) * 100)}</b></span></div>
    </div>`;
    html += `<div class="card-box"><div class="stats">${stats.map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('')}</div>
      <p class="handline">내 핸드: <b>${esc(info.heroDesc || '')}</b>${info.texture ? ` · 보드 ${esc(info.texture.label)} (${esc(info.texture.tags.join('·'))})` : ''}${info.ip != null ? ` · ${info.ip ? '인 포지션' : '아웃 오브 포지션'}` : ''}</p></div>`;
    html += `<div class="card-box"><h3>두 전문가의 토론</h3><div class="debate">${Cn.dialogue.map((d) => `<div class="msg ${d.who}"><div class="avatar ${d.who}">${WHO[d.who][0]}</div><div class="bubble"><div class="who">${WHO[d.who][1]}</div>${esc(d.text)}</div></div>`).join('')}</div></div>`;
    const expertCard = (key, e, label, tag) => `<div class="card-box expert ${key}"><div class="expert-head"><h3>${label}</h3><span class="tag">${tag}</span></div>
      <div class="mini-table">${miniRows(A, e.freq, pot)}</div>
      <p class="headline">${esc(e.headline || '')}</p>
      <ul class="facts">${(e.facts || []).map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
      ${S.street !== 'preflop' && e.mix ? mixBar(e.mix) : ''}</div>`;
    html += `<div class="experts">${expertCard('tight', res.tight, '타이트 전문가', 'TAG · 밸류 중심 착취')}${expertCard('balanced', res.balanced, '균형형 전문가', '솔버 기준선 · 스몰볼')}</div>`;
    if (grid) html += gridHTML(grid, info.heroKey);
    html += aiShell();
    box.innerHTML = html;
    setDock(A[Cn.top].label + (A[Cn.top].sub ? ' ' + A[Cn.top].sub : ''), `합의 ${(Cn.freq[Cn.top] * 100).toFixed(1)}% · 일치 ${pct0(Cn.agreement)}`);
    wireResults();
  }
  function setDock(act, sub) { $('#dockAct').textContent = act; $('#dockSub').textContent = sub || '합의 액션'; }
  function wireResults() {
    const seg = $('#gridSeg');
    if (seg) seg.addEventListener('click', (e) => { const b = e.target.closest('[data-g]'); if (!b) return; gridStyle = b.dataset.g; renderResults(); });
    wireAI();
  }

  // ───────── Claude 심층 토론 (sample 기능이 있을 때만) ─────────
  let sample = null;
  let aiState = { status: 'idle', data: null, error: null, key: null };
  let aiCtl = null;
  const aiKey = () => JSON.stringify(buildCtx());
  function aiShell() {
    if (!sample) return '';
    const stale = aiState.data && aiState.key !== aiKey();
    return `<div class="card-box ai" id="aiBox"><h3>Claude 심층 토론</h3>
      <p class="hint">두 전문가 페르소나가 이 상황을 각자 분석하고 서로 반박한 뒤 합의합니다. 내 Claude 사용량을 씁니다.</p>
      <div class="ai-actions"><button class="btn" type="button" id="aiRun" ${aiState.status === 'running' ? 'disabled' : ''}>${aiState.data ? '다시 토론' : '심층 토론 시작'}</button>
      ${aiState.status === 'running' ? '<button class="ghost" type="button" id="aiStop">중지</button>' : ''}
      <span class="ai-status" id="aiStatus">${aiState.status === 'running' ? esc(aiState.msg || '생각 중…') : stale ? '입력이 바뀌었습니다. 다시 토론하면 새 상황으로 분석합니다.' : ''}</span></div>
      <div class="ai-out" id="aiOut"></div></div>`;
  }
  function wireAI() {
    const run = $('#aiRun');
    if (!run) return;
    run.addEventListener('click', runAI);
    const stop = $('#aiStop');
    if (stop) stop.addEventListener('click', () => aiCtl && aiCtl.abort());
    renderAIOut();
  }
  function renderAIOut() {
    const out = $('#aiOut');
    if (!out) return;
    out.textContent = '';
    if (aiState.error) { const p = document.createElement('p'); p.className = 'err'; p.textContent = aiState.error; out.append(p); }
    const d = aiState.data;
    if (!d) return;
    const A = d.labels.map((l, i) => Object.assign({ label: l }, d.acts[i] || {}));
    const freq = d.labels.map((l) => (Number(d.final[l]) || 0) / 100);
    const sum = freq.reduce((a, b) => a + b, 0) || 1;
    const nf = freq.map((x) => x / sum);
    const top = nf.reduce((b, x, i) => (x > nf[b] ? i : b), 0);
    const panel = document.createElement('div');
    panel.className = 'solver';
    panel.innerHTML = `<div class="solver-head"><span class="solver-title">Claude 토론 합의 · %</span></div><div class="freq-table">${freqRows(A, nf, d.pot, top)}</div>`;
    const v = document.createElement('div'); v.className = 'verdict'; v.textContent = d.summary || ''; panel.append(v);
    out.append(panel);
    const deb = document.createElement('div'); deb.className = 'debate';
    for (const m of d.dialogue || []) {
      const who = WHO[m.who] ? m.who : 'judge';
      const row = document.createElement('div'); row.className = 'msg ' + who;
      const av = document.createElement('div'); av.className = 'avatar ' + who; av.textContent = WHO[who][0];
      const bub = document.createElement('div'); bub.className = 'bubble';
      const w = document.createElement('div'); w.className = 'who'; w.textContent = WHO[who][1];
      bub.append(w, document.createTextNode(String(m.text || '')));
      row.append(av, bub); deb.append(row);
    }
    out.append(deb);
  }

  const PERSONA = {
    tight: '너는 GTO를 완전히 이해하고 솔버로 수천 시간 공부한, 20년 경력의 타이트-어그레시브(TAG) 홀덤 프로다. 솔버 기준선을 정확히 알지만, 실전 풀이 블러프를 덜 하고 콜을 많이 한다는 근거로 의도적으로 타이트하게 이탈한다. 밸류 중심, 저분산, 원페어로 큰 팟을 만들지 않고, 토너먼트에선 ICM 생존 가치를 중시한다. 혼합은 최소화해 한두 액션에 빈도를 몰아준다.',
    balanced: '너는 GTO를 100% 이해하고 솔버로 깊게 학습한 균형형(스몰볼·핸드리딩) 홀덤 프로다. 솔버 빈도를 기준선으로 혼합 전략을 쓰고, 레인지 어드밴티지·넛 어드밴티지·MDF·블로커·사이징 이론으로 판단하며, 상대의 명확한 경향이 있을 때만 착취한다.',
  };
  function situationText() {
    const { res, ctx } = last;
    const L = [];
    L.push(`게임: ${isPLO() ? '팟 리밋 오마하(PLO) — 카드 4장, 쇼다운은 반드시 내 카드 2장 + 보드 3장, 레이즈는 팟까지. ' : '노리밋 홀덤. '}${S.game === 'mtt' ? `토너먼트(${H.STAGE_LABEL[S.stage]})` : '캐시'} ${S.table}-max, 유효 스택 ${fmt1(S.eff)}BB`);
    L.push(`내 포지션 ${H.POS_LABEL[S.heroPos]}, 내 카드 ${S.hero.join(' ')}`);
    L.push(`상대 포지션 ${H.POS_LABEL[S.oppPos]}, 성향 ${H.OPP_TYPES[S.oppType].label}, 팟에 남은 상대 ${S.multiway}명`);
    const pfMap = { none: '내가 첫 액션(앞에서 모두 폴드)', limp: `림프 ${S.limpers}명`, open: `상대 오픈 ${S.raiseSize || '기본'}BB`, '3bet': `내 오픈에 상대 3벳 ${S.raiseSize || '기본'}BB`, '4bet': `내 3벳에 상대 4벳 ${S.raiseSize || '기본'}BB`, allin: '상대 올인' };
    if (S.street === 'preflop') L.push(`프리플랍: ${pfMap[S.pfAction]}`);
    else {
      const lineMap = { hero_open_call: '내 오픈 → 상대 콜', opp_open_call: '상대 오픈 → 내 콜', hero_3bet_call: '내 3벳 → 상대 콜', opp_3bet_call: '상대 3벳 → 내 콜', limp: '림프 팟', hero_4bet_call: '내 4벳 → 상대 콜', opp_4bet_call: '상대 4벳 → 내 콜' };
      L.push(`프리플랍 라인: ${lineMap[effLine()]}`);
      L.push(`보드: ${S.board.slice(0, BOARD_N[S.street]).join(' ')} (${STREET_LABEL[S.street]})`);
      for (const h of ctx.history || []) L.push(`${STREET_LABEL[h.street]} 상대 액션: ${{ check: '체크', call: '콜', bet: '벳', raise: '레이즈', allin: '올인' }[h.act]}`);
      // 초과분을 돌려받은 뒤의 금액은 엔진 결과에 있다
      const call = res.info ? res.info.call : ctx.call, pot = res.info ? res.info.pot : ctx.pot;
      const actMap = { first: '내가 먼저 액션', check: '상대 체크', bet: `상대 벳 ${fmt1(call)}BB`, raise: `내 벳에 상대 레이즈 (콜 ${fmt1(call)}BB)`, allin: `상대 올인 (콜 ${fmt1(call)}BB)` };
      L.push(`지금: ${actMap[S.curAct[S.street]]}, 팟 ${fmt1(pot)}BB(상대 벳 포함), 내 남은 스택 ${fmt1(ctx.stack)}BB`);
    }
    if (isFlow()) L.push('진행: ' + flowState().log.filter((e) => e.type !== 'fold').map((e) => `${STREET_LABEL[e.street]} ${H.POS_LABEL[e.pos]}${e.hero ? '(나)' : ''} ${SEAT_ACT[e.type]}${e.to > 0 && e.type !== 'check' ? ' ' + fmt1(e.to) + 'BB' : ''}`).join(', '));
    if (res && res.actions) {
      L.push(`엔진 계산: 내 핸드 ${res.info.heroDesc}; 추정 에퀴티 타이트 ${pct0(res.tight.equity)} / 균형형 ${pct0(res.balanced.equity)}${res.info.required != null ? `; 필요 에퀴티 ${pct0(res.info.required)}` : ''}${res.info.spr != null ? `; SPR ${fmt1(res.info.spr)}` : ''}`);
      if (res.tight.mix && S.street !== 'preflop') L.push(`엔진 추정 상대 레인지(균형형): 강 ${pct0(res.balanced.mix[0])}, 중약 ${pct0(res.balanced.mix[1])}, 드로우 ${pct0(res.balanced.mix[2])}, 에어 ${pct0(res.balanced.mix[3])}`);
      L.push('엔진 빈도(타이트): ' + res.actions.map((a, i) => `${a.label} ${(res.tight.freq[i] * 100).toFixed(1)}`).join(', '));
      L.push('엔진 빈도(균형형): ' + res.actions.map((a, i) => `${a.label} ${(res.balanced.freq[i] * 100).toFixed(1)}`).join(', '));
    }
    return L.join('\n');
  }
  async function runAI() {
    if (!sample || !last || !last.res.actions) return;
    const labels = last.res.actions.map((a) => a.label + (a.sub ? ` (${a.sub})` : ''));
    const sit = situationText();
    const keyNow = aiKey();
    aiCtl = new AbortController();
    const signal = aiCtl.signal;
    aiState = { status: 'running', data: null, error: null, key: keyNow, msg: '두 전문가가 각자 분석 중… (최대 1분)' };
    renderResults();
    const fmtSpec = `액션 라벨은 정확히 다음 중에서 그대로 쓴다: ${JSON.stringify(labels)}.\n`;
    const r1 = (who) => `${PERSONA[who]}\n\n[상황]\n${sit}\n\n위 상황에서 내(히어로)가 할 액션을 솔버식 빈도로 정하라. 엔진 빈도는 참고만 하고 네 판단으로 고쳐도 된다.\n${fmtSpec}JSON 하나로만 답한다: {"freq": {"<라벨>": 숫자(합계 100)}, "best": "<라벨>", "reasons": ["한국어 한 문장", "한국어 한 문장", "한국어 한 문장"]}`;
    try {
      const [t, b] = await Promise.all([
        sample.json(r1('tight'), { signal }),
        sample.json(r1('balanced'), { signal }),
      ]);
      aiState.msg = '서로의 의견을 검토하고 합의하는 중…';
      const st = $('#aiStatus'); if (st) st.textContent = aiState.msg;
      const r2 = `너는 홀덤 토론 진행자다. 두 전문가가 같은 상황을 분석했다. 서로의 답을 본 뒤 토론하게 하고, 마지막에 합의 빈도를 정하라.\n\n[상황]\n${sit}\n\n[타이트 전문가 답]\n${JSON.stringify(t)}\n\n[균형형 전문가 답]\n${JSON.stringify(b)}\n\n규칙: 타이트(tight)와 균형형(balanced)이 번갈아 각 2번씩, 상대 주장에 동의하거나 반박하는 한국어 1~2문장을 말한다(구체적 숫자 사용). 그 다음 심판(judge)이 결론을 말한다. 합의 빈도는 두 답의 가중 평균을 기본으로 하되 더 설득력 있는 근거 쪽으로 조정한다. 상대 정보가 없거나 레귤러면 균형형 비중 60%, 니트 50%, 콜링스테이션 35%, LAG·매니악 60%, 토너먼트 버블·파이널의 올인 결정이면 균형형 최대 40%.\n${fmtSpec}JSON 하나로만 답한다: {"dialogue": [{"who": "tight|balanced|judge", "text": "..."}], "final": {"<라벨>": 숫자(합계 100)}, "best": "<라벨>", "summary": "최종 추천 한두 문장"}`;
      const j = await sample.json(r2, { signal });
      const final = j && j.final && typeof j.final === 'object' ? j.final : {};
      aiState = {
        status: 'done', error: null, key: keyNow,
        data: { labels, acts: last.res.actions, final, dialogue: Array.isArray(j.dialogue) ? j.dialogue : [], summary: String(j.summary || ''), pot: last.res.info.pot },
      };
    } catch (e) {
      const code = e && e.code;
      if (code === 'cancelled') aiState = { status: 'idle', data: null, error: null, key: keyNow };
      else if (code === 'not_granted' || code === 'sampling_disabled' || code === 'not_declared' || code === 'capability_disabled' || code === 'capability_removed') { sample = null; aiState = { status: 'idle' }; }
      else {
        const msg = { rate_limited: '요청이 너무 많습니다. 잠시 뒤 다시 눌러 주세요.', session_expired: '로그인이 만료되었습니다. 다시 로그인한 뒤 시도하세요.', invalid_json: '답을 해석하지 못했습니다. 다시 토론을 눌러 주세요.', refused: '이 요청에는 답할 수 없습니다.' }[code] || '연결 문제로 토론이 중단되었습니다. 다시 시도해 주세요.';
        aiState = { status: 'idle', data: null, error: msg, key: keyNow };
      }
    }
    renderResults();
  }
  if (window.claude && typeof window.claude.use === 'function') {
    window.claude.use('sample').then((s) => { if (s) { sample = s; if (last) renderResults(); } }).catch(() => {});
  }

  // ───────── 연습 모드 ─────────
  // 한 핸드를 처음부터 쇼다운까지 진행하며 내 차례마다 액션을 고르게 하고, 고를 때마다 합의 빈도로 채점한다.
  // 상대는 카드를 보지 않는 확률 정책으로 움직이고, 쇼다운에서 상대 카드를 공개한다
  const PRAC_KEY = 'holdem-dual-coach:practice';
  const NEW_SCORE = () => ({ hands: 0, n: 0, good: 0, mixed: 0, bad: 0, loss: 0, streak: 0 });
  const P = { hand: null, fb: null, busy: false, pos: 'any', playable: true, score: NEW_SCORE() };
  try {
    const sv = JSON.parse(localStorage.getItem(PRAC_KEY) || 'null');
    if (sv) { if (sv.score) Object.assign(P.score, sv.score); if (sv.pos) P.pos = sv.pos; if (sv.playable === false) P.playable = false; }
  } catch (e) { /* 저장소를 못 쓰면 기본값 */ }
  function savePractice() { try { localStorage.setItem(PRAC_KEY, JSON.stringify({ score: P.score, pos: P.pos, playable: P.playable })); } catch (e) { /* 무시 */ } }
  // 결정 기록 (통계용, 최근 3000개). 항목: 스트리트·포지션·벳을 받았는지·고른 액션 계열·추천 계열·판정·점수(내 빈도/추천 빈도)·EV 손실
  const LOG_KEY = 'holdem-dual-coach:practice-log';
  let PLOG = [];
  try { PLOG = JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); if (!Array.isArray(PLOG)) PLOG = []; } catch (e) { PLOG = []; }
  function saveLog() { try { localStorage.setItem(LOG_KEY, JSON.stringify(PLOG.slice(-3000))); } catch (e) { /* 무시 */ } }
  const KIND_GROUP = { fold: 'fold', check: 'pass', call: 'pass', bet: 'aggr', raise: 'aggr', allin: 'aggr' };
  const GRADE_LABEL = { good: '정답', mixed: '혼합', bad: '실수' };
  function renderPracticePanel() {
    if (P.pos !== 'any' && !posList().includes(P.pos)) P.pos = 'any';
    $('#pracPos').innerHTML = [['any', '무작위']].concat(posList().map((x) => [x, H.POS_LABEL[x]]))
      .map(([v, l]) => `<button class="chip" type="button" data-pp="${v}" aria-pressed="${P.pos === v}">${l}</button>`).join('');
    $$('#pracPlayable [data-pplay]').forEach((b) => b.setAttribute('aria-pressed', String(P.playable) === b.dataset.pplay));
    const sc = P.score, mine = PLOG.filter((d) => (d.v || 'holdem') === S.variant), cnt = (lv) => mine.filter((d) => d.lv === lv).length;
    $('#pracScore').innerHTML = `<span>${isPLO() ? '오마하' : '홀덤'}</span><span>핸드<b>${sc.hands}</b></span><span>결정<b>${mine.length}</b></span><span>정답<b>${cnt('good')}</b></span><span>혼합<b>${cnt('mixed')}</b></span><span>실수<b>${cnt('bad')}</b></span>`
      + `<span>연속 정답<b>${sc.streak}</b></span>`;
    $('#pracStats').innerHTML = statsHTML();
  }
  // 플레이 점수: 결정마다 (내 액션의 합의 빈도 ÷ 추천 액션 빈도, 최대 1)의 평균 × 100
  const scoreOf = (arr) => (arr.length ? Math.round(arr.reduce((t, d) => t + d.r, 0) / arr.length * 100) : null);
  const gradeOf = (x) => (x == null ? '—' : x >= 90 ? 'S' : x >= 80 ? 'A' : x >= 70 ? 'B' : x >= 60 ? 'C' : 'D');
  function statBar(label, arr, minN) {
    const sc = scoreOf(arr);
    const thin = arr.length < (minN || 10);
    return `<div class="sbar"><span class="sl">${esc(label)}</span><div class="st"><i style="width:${sc == null ? 0 : sc}%" class="g${gradeOf(sc)}"></i></div><span class="sv">${sc == null ? '—' : sc}<small>${arr.length ? ` · ${arr.length}${thin ? ' (적음)' : ''}` : ''}</small></span></div>`;
  }
  function statsHTML() {
    const L = PLOG.filter((d) => (d.v || 'holdem') === S.variant); // 게임 종류별 통계
    if (!L.length) return '<p class="hint">결정을 하면 여기에 통계가 쌓입니다.</p>';
    const total = scoreOf(L), recent = scoreOf(L.slice(-30));
    const withLoss = L.filter((d) => d.l != null), loss100 = withLoss.length ? withLoss.reduce((t, d) => t + d.l, 0) / withLoss.length * 100 : null;
    const cnt = (lv) => L.filter((d) => d.lv === lv).length;
    // 실수·혼합 결정의 경향: 추천과 비교해 어느 쪽으로 틀렸는지
    const off = L.filter((d) => d.lv !== 'good' && d.k !== d.tk);
    const tend = [
      ['폴드 과다', off.filter((d) => d.k === 'fold').length, '추천은 콜·레이즈인데 폴드'],
      ['콜·체크 과다', off.filter((d) => d.k === 'pass' && d.tk === 'fold').length, '추천은 폴드인데 콜'],
      ['소극적', off.filter((d) => d.k === 'pass' && d.tk === 'aggr').length, '추천은 벳·레이즈인데 콜·체크'],
      ['공격 과다', off.filter((d) => d.k === 'aggr').length, '추천은 폴드·콜·체크인데 벳·레이즈'],
    ];
    const tmax = Math.max(1, ...tend.map((x) => x[1]));
    const worst = tend.slice().sort((a, b) => b[1] - a[1])[0];
    const by = (key, vals, labels) => vals.map((v) => statBar(labels ? labels[v] : v, L.filter((d) => d[key] === v))).join('');
    const posVals = posList().filter((x) => L.some((d) => d.p === x));
    return `<div class="sbig"><div class="sgrade g${gradeOf(total)}">${gradeOf(total)}</div><div><div class="snum">${total}<small>점</small></div>
        <div class="hint">결정 ${L.length}개 · 정답 ${cnt('good')} · 혼합 ${cnt('mixed')} · 실수 ${cnt('bad')}${L.length < 50 ? ' · 50개 이상부터 믿을 만해요' : ''}</div>
        <div class="hint">최근 30결정 ${recent}점${L.length > 30 ? (recent > total ? ' ↑' : recent < total ? ' ↓' : '') : ''}${loss100 != null ? ` · EV 손실 ${fmt1(loss100)}BB/100결정(포스트플랍)` : ''}</div></div></div>
      <h4>스트리트별</h4>${by('s', STREETS.filter((x) => L.some((d) => d.s === x)), STREET_LABEL)}
      <h4>상황별</h4>${statBar('먼저 액션', L.filter((d) => !d.f))}${statBar('벳·레이즈를 받음', L.filter((d) => d.f))}
      <h4>포지션별</h4>${by('p', posVals, H.POS_LABEL)}
      <h4>틀린 방향</h4>${off.length ? tend.map(([n, c, d]) => `<div class="sbar" title="${esc(d)}"><span class="sl">${n}</span><div class="st"><i style="width:${c / tmax * 100}%" class="tend"></i></div><span class="sv">${c}</span></div>`).join('')
        + (worst[1] ? `<p class="hint">가장 많은 실수: <b>${worst[0]}</b> — ${esc(worst[2])}</p>` : '') : '<p class="hint">아직 틀린 결정이 없습니다.</p>'}
      <p class="hint">점수 = 결정마다 (내가 고른 액션의 합의 빈도 ÷ 추천 액션 빈도, 최대 1)의 평균. 근사 모델 기준입니다.</p>`;
  }
  function newProblem() {
    P.busy = true; P.fb = null;
    renderPractice();
    setTimeout(() => {
      try {
        // BB에서 모두 폴드로 끝나는 핸드처럼 내 결정이 하나도 없는 핸드는 다시 돌린다
        for (let t = 0; t < 10; t++) {
          P.hand = H.practiceNew({ table: S.table, eff: S.eff, game: S.game, stage: S.stage, oppType: S.oppType, heroPos: P.pos === 'any' ? null : P.pos, playable: P.playable, variant: S.variant }, (Math.random() * 4294967296) >>> 0);
          if (!P.hand.end) break;
        }
        P.score.hands++; savePractice(); renderPracticePanel();
      } catch (e) { console.error(e); P.hand = null; }
      P.busy = false;
      renderPractice();
    }, 20);
  }
  // 연습 테이블 그림: 내 자리를 아래 가운데에 두고, 자리마다 포지션·스택·이번 스트리트 액션·베팅 칩·카드를 그린다
  const ACT_CLS = { fold: 'fold', check: 'check', call: 'call', bet: 'raise', raise: 'raise', allin: 'allin' };
  function cardsHTML(cards, back, n) {
    if (back) return `<span class="mini">${'<span class="mc back"></span>'.repeat(n || 2)}</span>`;
    return miniCards(cards);
  }
  function practiceTableHTML(p) {
    const st = p.s, order = H.POSITIONS[st.table], n = order.length, hi = order.indexOf(st.heroPos);
    const sd = p.end && p.end.kind === 'showdown';
    const winners = sd ? p.end.winners : p.end && p.end.kind === 'won' ? [p.end.winner] : [];
    const seats = order.map((pos, i) => {
      const th = Math.PI / 2 + 2 * Math.PI * (i - hi) / n;
      const pl = st.players[pos], me = pos === st.heroPos;
      const last = st.log.filter((e) => e.pos === pos && e.street === st.street).pop();
      // 이번 스트리트 액션은 카드 위 말풍선으로 (금액 포함)
      let badge = '';
      const amt = last && last.type !== 'check' && last.type !== 'fold' && last.to > 0 ? ' ' + fmt1(last.to) : '';
      if (!pl.inHand) badge = ''; // 폴드한 자리는 흐리게 하고 스택 자리에 '폴드'를 쓴다 (말풍선이 옆자리를 가리지 않게)
      else if (pl.allin) badge = `<span class="pact allin">올인${amt}</span>`;
      else if (last) badge = `<span class="pact ${ACT_CLS[last.type]}">${SEAT_ACT[last.type]}${amt}</span>`;
      const cards = me ? cardsHTML(p.hero.map(cstr)) : pl.inHand ? (sd ? cardsHTML(p.opp[pos].map(cstr)) : cardsHTML(null, true, p.hero.length)) : '';
      // 좁은 화면은 자리를 안쪽으로 모아 양 끝이 잘리지 않게 한다
      const rx = window.innerWidth < 520 ? 37 : 43;
      const ry = window.innerWidth < 520 ? 43 : 40;
      const x = 50 + rx * Math.cos(th), y = 50 + ry * Math.sin(th);
      const cls = `pseat ${me ? 'me' : ''} ${pos === st.toAct && !p.end ? 'turn' : ''} ${pl.inHand ? '' : 'out'} ${winners.includes(pos) ? 'win' : ''}`;
      let html = `<div class="${cls} ${cards ? '' : 'nocards'}" style="left:${x.toFixed(1)}%;top:${y.toFixed(1)}%">${badge}<div class="pc">${cards}</div><span class="pp">${H.POS_LABEL[pos]}${me ? '<small> 나</small>' : ''}</span><span class="ps">${pl.inHand ? fmt1(pl.stack) + 'BB' : '폴드'}</span></div>`;
      // 이번 스트리트에 건 칩은 자리와 가운데 사이에 둔다
      // 칩은 자리와 가운데 사이. 내 칩만 옆으로 비껴 둬서 내 카드에 가리지 않게 한다
      if (pl.bet > 0 && !p.end) { const off = me ? 0.38 : 0; html += `<div class="pchip ${last ? ACT_CLS[last.type] : ''}" style="left:${(50 + 30 * Math.cos(th + off)).toFixed(1)}%;top:${(50 + 24 * Math.sin(th + off)).toFixed(1)}%">${fmt1(pl.bet)}</div>`; }
      if (pos === 'BTN') html += `<div class="pbtn" style="left:${(50 + 33 * Math.cos(th + 0.32)).toFixed(1)}%;top:${(50 + 30 * Math.sin(th + 0.32)).toFixed(1)}%">D</div>`;
      return html;
    }).join('');
    const shown = sd ? 5 : BOARD_N[st.street];
    const board = p.board.slice(0, shown).map(cstr);
    const slots = board.map((c) => miniCards([c])).join('') + Array.from({ length: 5 - board.length }, () => '<span class="mini"><span class="mc slot"></span></span>').join('');
    return `<div class="ptable ${n >= 8 ? 'many' : ''} ${p.hero.length === 4 ? 'plo' : ''}"><div class="pfelt"></div><div class="pcenter"><div class="pboard">${slots}</div><div class="ppot">${sd ? '쇼다운' : p.end ? '핸드 종료' : STREET_LABEL[st.street]} · 팟 <b>${fmt1(st.pot)}BB</b></div></div>${seats}</div>`;
  }
  // 앞 스트리트까지의 액션을 색깔 칩으로 (폴드는 뺀다)
  function practiceTimeline(st, ended) {
    const rows = [];
    for (const street of STREETS) {
      if (!ended && street === st.street) break; // 이번 스트리트는 자리 위 말풍선으로 보인다
      const es = st.log.filter((e) => e.street === street && e.type !== 'fold');
      if (!es.length) continue;
      rows.push(`<div class="ptl"><span class="ptl-s">${STREET_LABEL[street]}</span>${es.map((e) => `<span class="pa ${ACT_CLS[e.type]} ${e.hero ? 'me' : ''}">${H.POS_LABEL[e.pos]} ${SEAT_ACT[e.type]}${e.type === 'check' ? '' : ' ' + fmt1(e.to)}</span>`).join('')}</div>`);
    }
    return rows.length ? `<div class="ptls">${rows.join('')}</div>` : '';
  }
  const pickClass = (a) => (a.kind === 'fold' ? 'fold' : a.kind === 'check' || a.kind === 'call' ? 'call' : a.kind === 'allin' ? 'allin' : 'raise');
  // 두 전문가 설명: 각자 추천 액션·빈도, 내 선택을 얼마나 쓰는지, 이유, 그리고 둘의 토론
  function expertsExplainHTML(d) {
    const r = d.res, A = r.actions;
    const card = (key, e, label, tag) => {
      const top = e.freq.reduce((bi, x, i) => (x > e.freq[bi] ? i : bi), 0);
      const mine = e.freq[d.pick] || 0;
      const verdict = top === d.pick ? '내 선택과 같아요' : mine >= 0.1 ? `내 선택도 ${pct0(mine)} 섞어요` : `내 선택은 거의 안 써요 (${pct0(mine)})`;
      return `<div class="pex ${key}"><div class="pex-head"><span class="avatar ${key}">${WHO[key][0]}</span><b>${label}</b><span class="tag">${tag}</span></div>
        <div class="pex-rec">추천 <em>${esc(A[top].label)}${A[top].sub ? ' ' + esc(A[top].sub) : ''}</em> ${pct0(e.freq[top])} · ${verdict}</div>
        <p class="pex-why">${esc(e.headline || '')}</p>
        <ul class="pex-facts">${(e.facts || []).map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
        <div class="mini-table">${miniRows(A, e.freq, r.info.pot)}</div></div>`;
    };
    return `<div class="pex-wrap">${card('tight', r.tight, '타이트 전문가', '밸류 중심·저분산')}${card('balanced', r.balanced, '균형형 전문가', '솔버 기준선')}</div>
      <div class="pex-debate"><h4>두 전문가의 토론</h4><div class="debate">${r.consensus.dialogue.map((m) => `<div class="msg ${m.who}"><div class="avatar ${m.who}">${WHO[m.who][0]}</div><div class="bubble"><div class="who">${WHO[m.who][1]}</div>${esc(m.text)}</div></div>`).join('')}</div></div>`;
  }
  // 방금 고른 결정의 채점 카드
  function feedbackHTML(d) {
    const g = d.grade, r = d.res, A = r.actions, Cn = r.consensus;
    const lossTxt = g.loss != null && g.loss >= 0.05 ? ` · EV 손실 약 ${fmt1(g.loss)}BB(근사)` : '';
    return `<div class="prac-fb"><div class="prac-grade ${g.level}">${STREET_LABEL[d.street]} 결정: ${g.level === 'good' ? '정답!' : g.level === 'mixed' ? '혼합 가능' : '실수'}
        <small>내 선택 ${esc(d.label)} ${pct0(g.mine)} · 합의 추천 ${esc(d.top)} ${pct0(g.best)}${lossTxt}</small></div>
      <div class="solver"><div class="freq-table">${freqRows(A, Cn.freq, r.info.pot, Cn.top, d.pick)}</div>
      <div class="verdict">합의 빈도 · 점선 = 내 선택 · 내 핸드 ${esc(r.info.heroDesc || '')}${r.balanced.equity != null ? ` · 에퀴티 약 ${pct0(r.balanced.equity)}` : ''}${r.info.required != null ? ` · 필요 ${pct0(r.info.required)}` : ''}</div></div>
      ${expertsExplainHTML(d)}</div>`;
  }
  function endHTML(p) {
    const e = p.end, st = p.s;
    let msg;
    if (e.kind === 'fold') msg = `내가 폴드해서 핸드가 끝났습니다. (팟 ${fmt1(e.pot)}BB)`;
    else if (e.kind === 'won') msg = e.hero ? `상대가 모두 폴드 — 내가 팟 ${fmt1(e.pot)}BB를 가져갑니다.` : `승자 ${H.POS_LABEL[e.winner]} — 팟 ${fmt1(e.pot)}BB`;
    else if (e.kind === 'showdown') msg = (e.runout ? '올인 — 남은 카드를 모두 깔고 쇼다운. ' : '쇼다운. ') + (e.split ? `팟 ${fmt1(e.pot)}BB를 나눕니다.` : e.hero ? `내가 이겨서 팟 ${fmt1(e.pot)}BB를 가져갑니다.` : `승자 ${H.POS_LABEL[e.winners[0]]} — 팟 ${fmt1(e.pot)}BB`);
    else msg = e.message || '핸드가 끝났습니다.';
    let html = `<div class="card-box prac-end"><h3>핸드 종료</h3><p class="prac-result">${esc(msg)}</p>`;
    if (e.kind === 'showdown') {
      html += `<div class="prac-sd">${e.hands.map((h) => `<div class="${e.winners.includes(h.pos) ? 'win' : ''}"><b>${esc(H.POS_LABEL[h.pos])}${h.pos === st.heroPos ? '(나)' : ''}</b> <span>${esc(h.desc)}</span></div>`).join('')}</div>`;
    }
    const D = p.decisions;
    if (D.length) {
      const loss = D.reduce((t, d) => t + (d.grade.loss || 0), 0);
      html += `<h3>이번 핸드의 내 결정 <small class="hint">(누르면 두 전문가 설명)</small></h3><ol class="prac-decs">${D.map((d, k) => `<li><details${k === D.length - 1 ? '' : ''}><summary><span class="badge ${d.grade.level}">${GRADE_LABEL[d.grade.level]}</span> ${STREET_LABEL[d.street]} · ${esc(d.label)}${d.grade.level !== 'good' ? ` <small>(추천 ${esc(d.top)})</small>` : ''}</summary>${expertsExplainHTML(d)}</details></li>`).join('')}</ol>`;
      if (loss >= 0.05) html += `<p class="hint">이번 핸드 EV 손실 합계 약 ${fmt1(loss)}BB (포스트플랍만, 근사)</p>`;
    }
    const mine = PLOG.filter((d) => (d.v || 'holdem') === S.variant), tot = scoreOf(mine);
    if (tot != null) html += `<p class="prac-total">${isPLO() ? '오마하' : '홀덤'} 플레이 점수 <b>${tot}점</b> <span class="sgrade-mini g${gradeOf(tot)}">${gradeOf(tot)}</span> <small>결정 ${mine.length}개 기준 · 자세한 통계는 연습 모드 칸의 "내 플레이 통계"</small></p>`;
    html += `<div class="prac-picks"><button class="btn" type="button" data-pnext>다음 핸드</button></div></div>`;
    return html;
  }
  const cstr = (c) => H.RANKS[c >> 2] + H.SUITS[c & 3];
  function renderPractice() {
    if (!isPractice()) return;
    const box = $('#results');
    if (P.busy) { box.innerHTML = '<div class="card-box empty-state">핸드를 섞는 중…</div>'; setDock('연습', '핸드를 섞는 중'); return; }
    const p = P.hand;
    if (!p) {
      box.innerHTML = `<div class="card-box empty-state">한 핸드를 프리플랍부터 쇼다운까지 진행하며 내 차례마다 연습합니다.<div class="prac-picks"><button class="btn" type="button" data-pnext>핸드 시작</button></div></div>`;
      setDock('연습', '핸드를 시작하세요');
      return;
    }
    const st = p.s;
    const fbLine = P.fb ? `<div class="prac-grade ${P.fb.grade.level} slim">직전 ${STREET_LABEL[P.fb.street]} ${esc(P.fb.label)} → ${P.fb.grade.level === 'good' ? '정답!' : P.fb.grade.level === 'mixed' ? '혼합 가능' : '실수'} <small>추천 ${esc(P.fb.top)} ${pct0(P.fb.grade.best)}</small></div>` : '';
    let html = fbLine + `<div class="card-box prac-tablebox">${practiceTableHTML(p)}${practiceTimeline(st, !!p.end)}`;
    if (!p.end) {
      html += `<div class="prac-picks">${p.res.actions.map((a, i) => `<button class="act-btn ${pickClass(a)}" type="button" data-pick="${i}">${esc(a.label)}${a.sub ? `<small>${esc(a.sub)}</small>` : ''}</button>`).join('')}</div></div>`;
      if (P.fb) html += `<h3 class="prac-h">직전 결정 채점</h3>` + feedbackHTML(P.fb);
      box.innerHTML = html;
      setDock(STREET_LABEL[st.street] + ' 내 차례', P.fb ? `직전 ${GRADE_LABEL[P.fb.grade.level]}` : '액션을 고르세요');
    } else {
      html += '</div>' + endHTML(p);
      if (P.fb) html += `<h3 class="prac-h">마지막 결정 채점과 설명</h3>` + feedbackHTML(P.fb);
      box.innerHTML = html;
      setDock('핸드 종료', `결정 ${p.decisions.length}번`);
    }
  }
  function practicePick(i) {
    const p = P.hand;
    if (!p || p.end || !p.res) return;
    const facing = H.flowOptions(p.s).toCall > 0, street = p.s.street, pos = p.s.heroPos, acts = p.res.actions;
    const g = H.practicePlay(p, i), sc = P.score;
    PLOG.push({ v: S.variant, s: street, p: pos, f: facing ? 1 : 0, k: KIND_GROUP[acts[i].kind], tk: KIND_GROUP[acts[g.top].kind], lv: g.level, r: Math.round(Math.min(1, g.best > 0 ? g.mine / g.best : 1) * 1000) / 1000, l: g.loss == null ? null : Math.round(g.loss * 100) / 100, t: Date.now() });
    saveLog();
    P.fb = p.decisions[p.decisions.length - 1];
    sc.n++; sc[g.level]++;
    sc.streak = g.level === 'good' ? sc.streak + 1 : 0;
    if (g.loss != null) sc.loss = Math.round((sc.loss + g.loss) * 10) / 10;
    savePractice();
    renderPracticePanel();
    renderPractice();
    $('#results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ───────── 이벤트 ─────────
  function onFieldClick(e) {
    const b = e.target.closest('[data-v]');
    const box = e.target.closest('[data-field]');
    if (!b || !box || b.disabled) return;
    const f = box.dataset.field;
    let v = b.dataset.v;
    if (f === 'table' || f === 'multiway') v = Number(v);
    S.example = false;
    if (f === 'curAct') S.curAct[S.street] = v;
    else if (f === 'line') S.line = v;
    else S[f] = v;
    if (f === 'table') {
      renderPositions();
      if (!posList().includes(S.heroPos)) S.heroPos = 'BTN';
      if (!posList().includes(S.oppPos)) S.oppPos = 'BB';
    }
    if (f === 'heroPos' && S.oppPos === S.heroPos) S.oppPos = posList().find((p) => p !== S.heroPos && (p === 'BB' || p === 'BTN')) || posList().find((p) => p !== S.heroPos);
    if (f === 'pfAction' || f === 'heroPos' || f === 'oppPos' || f === 'table') S.line = null;
    if (f === 'heroPos' || f === 'table' || f === 'game' || f === 'variant') S.flowActs = []; // 자리·인원·게임이 바뀌면 진행을 처음부터
    if (f === 'variant') { S.board = [null, null, null, null, null]; S.street = 'preflop'; S.hero = []; fitHero(); active = null; S.example = false; if (P) { P.hand = null; P.fb = null; } }
    if (f === 'street' && v !== 'preflop') {
      const need = BOARD_N[v];
      const empty = S.board.findIndex((c, i) => !c && i < need);
      if (empty >= 0) { active = { group: 'board', idx: empty }; pendingRank = null; }
    }
    if (f === 'street' && v === 'preflop' && active && active.group === 'board') active = null;
    update();
  }
  document.addEventListener('click', (e) => {
    if (e.target.closest('.inputs [data-field]')) {
      const wasPractice = isPractice();
      onFieldClick(e);
      // 연습 모드로 들어오거나 설정이 바뀌면 새 문제
      if (isPractice() && (!wasPractice || !P.hand || e.target.closest('[data-field="table"], [data-field="game"], [data-field="stage"], [data-field="variant"]'))) newProblem();
      return;
    }
    const pk = e.target.closest('[data-pick]');
    if (pk) { practicePick(Number(pk.dataset.pick)); return; }
    if (e.target.closest('[data-pnext], #pracNext')) { newProblem(); return; }
    const pl = e.target.closest('[data-pplay]');
    if (pl) { P.playable = pl.dataset.pplay === 'true'; savePractice(); renderPracticePanel(); return; }
    const pp = e.target.closest('[data-pp]');
    if (pp) { P.pos = pp.dataset.pp; savePractice(); renderPracticePanel(); return; }
    if (e.target.closest('#pracReset')) { P.score = NEW_SCORE(); PLOG = []; saveLog(); savePractice(); renderPracticePanel(); return; }
    const fa = e.target.closest('[data-ftype]');
    if (fa) { flowDo({ type: fa.dataset.ftype, to: parseFloat(fa.dataset.fto) || undefined }); return; }
    const fr = e.target.closest('[data-res]');
    if (fr && last && last.res.actions) {
      const a = last.res.actions[Number(fr.dataset.res)], st = flowState(), o = H.flowOptions(st);
      if (a.kind === 'fold') flowDo({ type: 'fold' });
      else if (a.kind === 'check' || a.kind === 'call') flowDo({ type: o.canCheck ? 'check' : 'call' });
      else if (a.kind === 'allin') flowDo({ type: 'allin' });
      // 포스트플랍 레이즈 금액은 이번에 더 넣는 칩이고, 프리플랍은 총액이다
      else flowDo({ type: o.raiseType, to: (st.street === 'preflop' ? 0 : st.players[st.heroPos].bet) + (a.amount || o.min) });
      return;
    }
    if (e.target.closest('#flowCustom')) {
      const v = parseFloat($('#flowAmt').value);
      if (v > 0) flowDo({ type: H.flowOptions(flowState()).raiseType, to: v });
      return;
    }
    if (e.target.closest('#flowUndo')) {
      // "모두 폴드"로 들어간 폴드는 한 번에 되돌린다
      let a;
      do { a = S.flowActs.pop(); } while (a && a.auto && S.flowActs.length && S.flowActs[S.flowActs.length - 1].auto);
      if (active && active.group === 'board') { active = null; pendingRank = null; }
      update();
      return;
    }
    if (e.target.closest('#flowFoldAll')) {
      const st = flowState();
      while (st.status === 'playing' && st.toAct !== st.heroPos) { H.applyAction(st, { type: 'fold' }); S.flowActs.push({ type: 'fold', auto: true }); }
      S.example = false;
      update();
      return;
    }
    const res = e.target.closest('[data-result]');
    if (res) {
      const b = e.target.closest('[data-v]');
      if (b) { S.results[res.dataset.result] = b.dataset.v; S.example = false; update(); }
      return;
    }
    const q = e.target.closest('[data-quick]');
    if (q) {
      const b = e.target.closest('[data-v]');
      if (!b) return;
      if (q.dataset.quick === 'eff') { S.eff = Number(b.dataset.v); S.flowActs = []; }
      if (q.dataset.quick === 'bet') { const st = S.street; S.amt[st] = Object.assign({}, S.amt[st], { bet: fmt1(startPot(st) * Number(b.dataset.v)) }); }
      S.example = false;
      update();
      return;
    }
    const slot = e.target.closest('.card[data-group]');
    if (slot) {
      const g = slot.dataset.group, i = Number(slot.dataset.idx);
      active = active && active.group === g && active.idx === i ? null : { group: g, idx: i };
      pendingRank = null;
      sync();
      return;
    }
    const rk = e.target.closest('[data-rank]');
    if (rk) { pendingRank = rk.dataset.rank; renderPicker(); return; }
    const su = e.target.closest('[data-suit]');
    if (su) {
      if (!pendingRank) return;
      setCard(pendingRank + su.dataset.suit);
      return;
    }
    if (e.target.closest('[data-clear]')) { setCard(null); return; }
    if (e.target.closest('#pkClose')) { active = null; pendingRank = null; sync(); return; }
    if (e.target.closest('#potAuto')) { S.potManual[S.street] = null; update(); return; }
    if (e.target.closest('#newHand, #flowNew')) {
      const keep = { game: S.game, table: S.table, stage: S.stage, eff: S.eff, oppType: S.oppType, heroPos: S.heroPos, oppPos: S.oppPos, mode: S.mode, variant: S.variant };
      S = Object.assign(clone(EXAMPLE), keep, { hero: keep.variant === 'omaha' ? [null, null, null, null] : [null, null], board: [null, null, null, null, null], street: 'preflop', example: false, curAct: { flop: 'first', turn: 'first', river: 'first' }, results: { flop: 'xx', turn: 'xx' } });
      active = { group: 'hero', idx: 0 }; pendingRank = null;
      aiState = { status: 'idle' };
      update();
      return;
    }
    if (e.target.closest('#dockGo')) { $('#results').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  });

  const numBind = {
    eff: (v) => { if (v > 0) { S.eff = v; S.flowActs = []; } },
    raiseSize: (v, raw) => { S.raiseSize = raw; },
    heroOpen: (v, raw) => { S.heroOpen = raw; },
    limpers: (v) => { if (v >= 1) S.limpers = Math.round(v); },
    pot: (v) => { S.potManual[S.street] = v > 0 ? v : null; },
    betAmt: (v, raw) => { S.amt[S.street] = Object.assign({}, S.amt[S.street], { bet: raw }); },
    myBet: (v, raw) => { S.amt[S.street] = Object.assign({}, S.amt[S.street], { myBet: raw }); },
    raiseTo: (v, raw) => { S.amt[S.street] = Object.assign({}, S.amt[S.street], { raiseTo: raw }); },
    allinAmt: (v, raw) => { S.amt[S.street] = Object.assign({}, S.amt[S.street], { allin: raw }); },
  };
  document.addEventListener('input', (e) => {
    const id = e.target.id;
    if (!numBind[id]) return;
    numBind[id](parseFloat(e.target.value), e.target.value);
    S.example = false;
    update();
  });

  document.addEventListener('keydown', (e) => {
    if (!active) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toUpperCase();
    if ('AKQJT98765432'.includes(k) && k.length === 1) { pendingRank = k; renderPicker(); e.preventDefault(); return; }
    if (k === '1' || k === '0') { pendingRank = 'T'; renderPicker(); e.preventDefault(); return; }
    if ('SHDC'.includes(k) && k.length === 1 && pendingRank) {
      const card = pendingRank + k.toLowerCase();
      if (!usedCards().has(card)) setCard(card);
      e.preventDefault();
      return;
    }
    if (e.key === 'Backspace' || e.key === 'Delete') { setCard(null); e.preventDefault(); return; }
    if (e.key === 'Escape') { active = null; pendingRank = null; sync(); }
  });

  // 독립 배포판(GitHub Pages)에서만 오프라인용 서비스워커를 등록한다
  if (document.querySelector('meta[name="app-standalone"]') && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
  }

  // 화면 폭이 바뀌면 연습 테이블 자리 배치를 다시 그린다
  let rzT = null;
  window.addEventListener('resize', () => { clearTimeout(rzT); rzT = setTimeout(() => { if (isPractice() && !P.busy) renderPractice(); }, 150); });
  renderPositions();
  update();
  if (isPractice()) newProblem();
})();
