// 엔진 회귀 테스트: node --test tests/
// 빈도는 근사 모델이라 정확한 값 대신 기준값과 포커 상식에 맞는 방향·범위를 확인한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const E = createRequire(import.meta.url)('../webapp/engine.js');
const C = E.parseCards;

const post = (hero, board, o = {}) => {
  const street = { 6: 'flop', 8: 'turn', 10: 'river' }[board.length];
  return E.analyze({ street, table: 6, heroPos: 'BTN', oppPos: 'BB', oppType: 'unknown', hero: C(hero), board: C(board), line: 'hero_open_call', pot: 6, stack: 97, curAct: 'check', ...o });
};
const freqOf = (r, who, pred) => r.actions.reduce((s, a, i) => s + (pred(a) ? who.freq[i] : 0), 0);
const isAllin = (a) => a.kind === 'allin';
const topLabel = (r, who) => r.actions[who.freq.indexOf(Math.max(...who.freq))].label;
const AIR = ['7h2d', '8h2d', '7h6d', '8d6h', 'Jh2s', 'Th7d', '6h5h', 'Qh2d'];
const AIR_BOARD = 'AsKd9c4h3c';
const avgAirJam = (oppType) => {
  let s = 0;
  for (const h of AIR) { const r = post(h, AIR_BOARD, { oppType, pot: 30, stack: 80 }); s += freqOf(r, r.consensus, isAllin); }
  return s / AIR.length;
};

// ── 기준값
test('프리플랍 에퀴티 기준값', () => {
  const eqVs = (h, range) => {
    const hero = C(h);
    const v = E.rangeCombos(E.parseRange(range), new Set(hero));
    const q = E.comboEquities(hero, [], v.idx, 7);
    return q.reduce((a, b) => a + b, 0) / q.length;
  };
  assert.ok(Math.abs(eqVs('AsAh', 'KK') - 0.82) < 0.015);
  assert.ok(Math.abs(eqVs('AsKs', 'QQ') - 0.46) < 0.015);
});

test('족보 순서', () => {
  const ev = (s) => { const c = C(s); return E.evaluate(c, c.length); };
  const ladder = ['2c3d5h7s9cJdKh', 'AcAd2h5s7c9dJh', 'AcAd2h2s7c9dJh', 'AcAdAh5s7c9dJh', 'Ac2d3h4s5c9dKh', '2c3d4h5s6c9dKh', 'TcJdQhKsAc2d3h', '2c5c7c9cJcAdKh', 'AcAdAh5s5c9dJh', 'AcAdAhAs5c9dJh', 'Ac2c3c4c5c9dKh', '9cTcJcQcKc2d3h', 'TcJcQcKcAc2d3h'];
  for (let i = 1; i < ladder.length; i++) assert.ok(ev(ladder[i]) > ev(ladder[i - 1]), ladder[i]);
});

test('169 핸드 순위가 빠짐없이 있다', () => {
  assert.equal(E.RANK_LIST.length, 169);
  assert.equal(new Set(E.RANK_LIST).size, 169);
});

test('예시 스팟: 균형형 최다 빈도는 Bet 25%', () => {
  const r = post('AcKc', 'Ad8h5c', { stack: 97.5 });
  assert.equal(topLabel(r, r.balanced), 'Bet 25%');
});

test('빈도는 항상 유한하고 합이 1이다', () => {
  const lines = ['hero_open_call', 'opp_3bet_call', 'limp', 'hero_4bet_call'];
  for (const oppType of Object.keys(E.OPP_TYPES)) for (const line of lines) for (const curAct of ['first', 'check', 'bet', 'raise', 'allin']) for (const [h, b] of [['AcKc', 'Ad8h5c'], ['7h2d', AIR_BOARD]]) {
    const r = post(h, b, { oppType, line, curAct, pot: 20, call: curAct === 'first' || curAct === 'check' ? 0 : 10, stack: 90 });
    if (r.error) continue;
    for (const who of [r.tight, r.balanced, r.consensus]) {
      assert.ok(who.freq.every((x) => Number.isFinite(x) && x >= 0));
      assert.ok(Math.abs(who.freq.reduce((a, b2) => a + b2, 0) - 1) < 1e-6);
    }
  }
});

// ── 상대 방어 모델: 큰 벳 블러프
test('상대 폴드율은 벳이 커질수록 줄지 않는다 (올인 포함)', () => {
  for (const oppType of Object.keys(E.OPP_TYPES)) {
    const r = post('7h2d', AIR_BOARD, { oppType, pot: 30, stack: 80 });
    for (const who of [r.tight, r.balanced]) {
      const folds = r.actions.filter((a) => who.info[a.key]).map((a) => who.info[a.key].fold);
      for (let i = 1; i < folds.length; i++) assert.ok(folds[i] >= folds[i - 1] - 0.01, `${oppType} ${folds}`);
    }
  }
});

test('에어 올인은 드물고, 콜링스테이션 상대로는 거의 없다', () => {
  assert.ok(avgAirJam('unknown') < 0.2, `unknown ${avgAirJam('unknown')}`);
  assert.ok(avgAirJam('reg') < 0.2, `reg ${avgAirJam('reg')}`);
  assert.ok(avgAirJam('station') < 0.03, `station ${avgAirJam('station')}`);
});

test('콜링스테이션은 니트보다 큰 벳에 덜 접는다', () => {
  const fold = (oppType) => post('7h2d', AIR_BOARD, { oppType, pot: 30, stack: 80 }).balanced.info.allin.fold;
  assert.ok(fold('station') < fold('nit') - 0.1, `${fold('station')} vs ${fold('nit')}`);
});

// 리버 시험 풀이 기준: 에어 하위 에퀴티는 대부분 블러프하고, 쇼다운 가치가 조금 있는 에어는 체크한다
test('리버 블러프는 에퀴티가 가장 낮은 에어로 한다', () => {
  const r = post('7h2d', AIR_BOARD, { pot: 30, stack: 80 });
  const q = post('Qh2d', AIR_BOARD, { pot: 30, stack: 80 });
  const check = (a) => a.kind === 'check';
  assert.ok(freqOf(r, r.balanced, check) < 0.3, `균형형이 최하위 에어를 블러프해야 한다 ${freqOf(r, r.balanced, check)}`);
  assert.ok(freqOf(q, q.balanced, check) > 0.6, `Q하이는 체크가 많아야 한다 ${freqOf(q, q.balanced, check)}`);
  assert.ok(freqOf(r, r.consensus, check) > 0.2, '합의는 에어를 전부 블러프하지 않는다');
  assert.ok(freqOf(r, r.tight, check) > 0.8, '타이트는 블러프를 최소화한다');
});

test('플랍 IP 공격자는 탑페어는 벳하고 약한 에어는 체크를 섞는다', () => {
  const check = (a) => a.kind === 'check';
  const spot = { pot: 5.5, stack: 97.5 };
  const ak = post('AcKc', 'Ad8h5c', spot);
  assert.ok(freqOf(ak, ak.balanced, check) < 0.15, `AK 체크 ${freqOf(ak, ak.balanced, check)}`);
  assert.equal(topLabel(ak, ak.balanced), 'Bet 25%');
  const qj = post('QcJc', 'Ad8h5c', spot);
  assert.equal(qj.info.heroCls, '에어');
  assert.ok(freqOf(qj, qj.balanced, check) > 0.3, `QJ 체크 ${freqOf(qj, qj.balanced, check)}`);
});

test('플랍 큰 벳을 받으면 레이즈보다 콜·폴드가 많다', () => {
  const r = E.analyze({ street: 'flop', table: 6, heroPos: 'BB', oppPos: 'BTN', oppType: 'unknown', hero: C('Kh8c'), board: C('Ad8h5c'), line: 'opp_open_call', pot: 9.5, call: 4, stack: 97.5, curAct: 'bet', ip: false });
  assert.ok(freqOf(r, r.balanced, (a) => a.kind === 'raise' || a.kind === 'allin') < 0.25);
});

test('턴 중간 메이드는 벳보다 체크가 많고 넛은 벳한다', () => {
  const check = (a) => a.kind === 'check';
  const mid = post('8s7s', 'Ad8h5c2s', { pot: 9, stack: 95, history: [{ street: 'flop', act: 'check' }, { street: 'flop', act: 'call' }] });
  assert.equal(mid.info.heroCls, '중간 메이드');
  assert.ok(freqOf(mid, mid.balanced, check) > 0.5, `중간 메이드 체크 ${freqOf(mid, mid.balanced, check)}`);
  const nut = post('8s8d', 'Ad8h5c2s', { pot: 9, stack: 95, history: [{ street: 'flop', act: 'check' }, { street: 'flop', act: 'call' }] });
  assert.ok(freqOf(nut, nut.balanced, check) < 0.1, `셋 체크 ${freqOf(nut, nut.balanced, check)}`);
});

test('리버 약한 페어는 벳보다 체크한다', () => {
  const check = (a) => a.kind === 'check';
  for (const h of ['Qh4d', 'Th4s', 'JhJd']) {
    const r = post(h, AIR_BOARD, { pot: 30, stack: 80 });
    assert.equal(r.info.heroCls, '약한 페어');
    assert.ok(freqOf(r, r.balanced, check) > 0.8, `${h} 체크 ${freqOf(r, r.balanced, check)}`);
  }
});

test('벳을 받았을 때 에어 올인 레이즈를 하지 않는다', () => {
  const r = post('7h2d', AIR_BOARD, { pot: 40, call: 20, stack: 80, curAct: 'bet' });
  assert.ok(freqOf(r, r.balanced, isAllin) < 0.2, `balanced ${freqOf(r, r.balanced, isAllin)}`);
  assert.equal(topLabel(r, r.consensus), 'Fold');
});

// ── 타이트 전문가 사이징
test('깊은 스택 원페어로 플랍 올인하지 않는다', () => {
  for (const [h, b] of [['JhJd', 'Td6s2c'], ['AcKc', 'Ad8h5c'], ['KhQh', 'Kd7s2c']]) {
    const r = post(h, b, { pot: 5.5, stack: 97.5 });
    assert.ok(freqOf(r, r.tight, isAllin) < 0.03, `tight ${h}`);
    assert.ok(freqOf(r, r.balanced, isAllin) < 0.03, `balanced ${h}`);
  }
});

test('깊은 스택에서는 셋도 플랍 올인이 주력이 아니다', () => {
  const r = post('8s8d', 'Ad8h5c', { pot: 5.5, stack: 97.5 });
  assert.ok(freqOf(r, r.consensus, isAllin) < 0.25, `${freqOf(r, r.consensus, isAllin)}`);
  assert.ok(freqOf(r, r.consensus, (a) => a.kind === 'check') < 0.1, '그래도 벳은 한다');
});

test('드라이 보드 탑페어: 타이트도 작은·중간 사이즈가 오버벳보다 많다', () => {
  const r = post('AcKc', 'Ad8h5c', { pot: 5.5, stack: 97.5 });
  const small = freqOf(r, r.tight, (a) => a.prior === 25 || a.prior === 50);
  const big = freqOf(r, r.tight, (a) => a.prior === 100 || a.prior === 150);
  assert.ok(small > big, `small ${small} big ${big}`);
});

test('예시 스팟의 의견 일치도는 50% 이상이다', () => {
  const r = post('AcKc', 'Ad8h5c', { stack: 97.5 });
  assert.ok(r.consensus.agreement >= 0.5, `${r.consensus.agreement}`);
});

// ── 상대 벳 크기와 레인지
test('상대 벳이 커지면 에퀴티와 콜 빈도가 줄어든다', () => {
  const at = (s) => { const b = 20 * s; return post('AcTd', 'Ad8h5c2s9h', { pot: 20 + b, call: b, stack: 90, curAct: 'bet' }); };
  const small = at(0.6), huge = at(4);
  assert.ok(huge.tight.equity < small.tight.equity - 0.1, `tight ${small.tight.equity} → ${huge.tight.equity}`);
  assert.ok(huge.balanced.equity < small.balanced.equity - 0.1, `balanced ${small.balanced.equity} → ${huge.balanced.equity}`);
  const call = (r) => freqOf(r, r.consensus, (a) => a.kind === 'call');
  assert.ok(call(huge) < call(small), `${call(small)} → ${call(huge)}`);
  assert.ok(freqOf(huge, huge.tight, (a) => a.kind === 'call') < 0.5, '타이트는 약한 키커 탑페어로 4배 오버벳을 대부분 접는다');
});

// ── 팟 계산
test('내 스택보다 큰 벳은 초과분을 돌려받은 팟으로 계산한다', () => {
  const r = post('AcKc', 'Ad8h5c', { pot: 206, call: 200, stack: 97, curAct: 'allin' });
  assert.equal(r.info.call, 97);
  assert.equal(r.info.pot, 103);
  assert.ok(Math.abs(r.info.required - 97 / 200) < 1e-9);
});

test('프리플랍 팟은 상대 블라인드를 이중 계산하지 않는다', () => {
  const pot = (o) => E.analyze({ street: 'preflop', table: 6, game: 'cash', eff: 100, hero: C('AcKc'), ...o }).info.pot;
  assert.equal(pot({ heroPos: 'BB', oppPos: 'BTN', pfAction: 'open', raiseSize: 2.5 }), 4);
  assert.equal(pot({ heroPos: 'BB', oppPos: 'SB', pfAction: 'open', raiseSize: 3 }), 4);
  assert.equal(pot({ heroPos: 'BTN', oppPos: 'BB', pfAction: '3bet', raiseSize: 12, heroOpen: 2.5 }), 15);
  assert.equal(pot({ heroPos: 'BTN', oppPos: 'SB', pfAction: '3bet', raiseSize: 11, heroOpen: 2.5 }), 14.5);
  assert.equal(pot({ heroPos: 'BB', oppPos: 'SB', pfAction: '4bet', raiseSize: 25, heroOpen: 11 }), 36);
});

test('플랍 시작 팟은 포지션과 유효 스택을 반영한다', () => {
  const f = E.estimateFlopPot;
  assert.equal(f('hero_open_call', 'cash', 2.5, 'BTN', 'BB', 100), 5.5);
  assert.equal(f('hero_open_call', 'cash', 2.5, 'CO', 'BTN', 100), 6.5);
  assert.equal(f('hero_open_call', 'cash', 0, 'SB', 'BB', 100), 6);
  assert.equal(f('limp', 'cash', 0, 'BTN', 'BB', 100), 2.5);
  assert.equal(f('opp_4bet_call', 'cash', 0, 'BB', 'BTN', 20), 40.5);
  assert.equal(f('hero_3bet_call', 'cash', 0, 'BTN', 'BB', 5), 10.5);
});

// ── 입력 검증
test('불가능한 포지션 순서는 계산하지 않고 이유를 알려 준다', () => {
  const pre = (o) => E.analyze({ street: 'preflop', table: 6, hero: C('AcKc'), ...o });
  for (const o of [
    { heroPos: 'BTN', oppPos: 'BB', pfAction: 'open' },
    { heroPos: 'UTG', oppPos: 'BTN', pfAction: 'open' },
    { heroPos: 'BB', oppPos: 'BTN', pfAction: '3bet' },
    { heroPos: 'BTN', oppPos: 'BB', pfAction: '4bet' },
  ]) assert.match(pre(o).error || '', /먼저 오픈/, JSON.stringify(o));
  assert.match(post('AcKc', 'Ad8h5c', { line: 'opp_open_call' }).error || '', /먼저 오픈/);
  assert.match(post('AcKc', 'Ad8h5c', { heroPos: 'BB', oppPos: 'BTN', line: 'hero_open_call' }).error || '', /먼저 오픈/);
});

test('가능한 순서는 그대로 계산한다', () => {
  const pre = (o) => E.analyze({ street: 'preflop', table: 6, hero: C('AcKc'), ...o });
  for (const o of [
    { heroPos: 'BB', oppPos: 'BTN', pfAction: 'open' },
    { heroPos: 'BTN', oppPos: 'BB', pfAction: '3bet' },
    { heroPos: 'BB', oppPos: 'SB', pfAction: '4bet' },
    { heroPos: 'BTN', oppPos: 'BB', pfAction: 'limp' },
    { heroPos: 'BTN', oppPos: 'BB', pfAction: 'allin' },
    { heroPos: 'BB', oppPos: 'BTN', pfAction: 'allin' },
  ]) assert.equal(pre(o).error, undefined, JSON.stringify(o));
  assert.equal(post('AcKc', 'Ad8h5c', { heroPos: 'BB', oppPos: 'BTN', line: 'opp_open_call' }).error, undefined);
});

// ── 4벳 팟 공격자
test('4벳 팟의 공격자는 4벳을 한 쪽이다', () => {
  const p = (line, heroPos, oppPos) => post('AcKc', 'Ad8h5c', { line, heroPos, oppPos, pot: 45, stack: 55 }).info.aggressor;
  assert.equal(p('hero_4bet_call', 'BTN', 'BB'), true);
  assert.equal(p('opp_4bet_call', 'BB', 'BTN'), false);
});

// ── 보드 플레이와 라벨
test('보드로 찹이 확정이면 올인을 추천하지 않는다', () => {
  const first = post('2c3d', 'AsKsQsJsTs', { pot: 40, stack: 80 });
  assert.ok(freqOf(first, first.consensus, isAllin) < 0.1, `${freqOf(first, first.consensus, isAllin)}`);
  assert.equal(topLabel(first, first.consensus), 'Check');
  const facing = post('2c3d', 'AsKsQsJsTs', { pot: 40, call: 20, stack: 80, curAct: 'bet' });
  assert.equal(facing.actions[facing.consensus.top].kind, 'call');
});

test('보드 라벨은 장수에 맞게 표시한다', () => {
  const tag = (b) => E.boardTexture(C(b)).tags[0];
  assert.equal(tag('Ad8h5c'), '레인보우');
  assert.equal(tag('Ad8d5h'), '투톤');
  assert.equal(tag('Ad8d5d'), '모노톤');
  assert.equal(tag('Ad8d5dJs'), '3플러시');
  assert.equal(tag('Ad8d5dJs2c'), '3플러시');
  assert.equal(tag('Ad8h5cJd'), '투톤');
  assert.equal(tag('Ad8h5cJd2s'), '플러시 없음');
  assert.equal(tag('Ad8d5dJd2c'), '4플러시');
  assert.equal(tag('Ad8d5dJd2d'), '5플러시');
});

// ── 인원과 핸드 진행
const F = (type, to) => ({ type, to });
const hand = (actions, cfg = {}) => E.replayHand({ table: 9, eff: 100, game: 'cash', heroPos: 'BTN', ...cfg }, actions);
const folds = (n) => Array.from({ length: n }, () => F('fold'));

test('3~9인 자리가 모두 있고 차트가 비어 있지 않다', () => {
  for (let n = 3; n <= 9; n++) {
    assert.equal(E.POSITIONS[n].length, n);
    assert.deepEqual(E.POSITIONS[n].slice(-3), ['BTN', 'SB', 'BB']);
    for (const pos of E.POSITIONS[n].slice(0, -1)) for (const style of ['tight', 'balanced']) assert.ok(E.rangePct(E.rfiRange(style, n, pos)) > 0.05, `${n} ${pos}`);
    const r = E.analyze({ street: 'preflop', table: n, game: 'cash', eff: 100, heroPos: 'BTN', oppPos: 'BB', hero: C('AcKc'), pfAction: 'none' });
    assert.equal(r.error, undefined);
  }
});

test('자리가 앞일수록 오픈 범위가 좁다', () => {
  for (let n = 3; n <= 9; n++) {
    const pcts = E.POSITIONS[n].slice(0, -2).map((pos) => E.rangePct(E.rfiRange('balanced', n, pos)));
    for (let i = 1; i < pcts.length; i++) assert.ok(pcts[i] >= pcts[i - 1], `${n}: ${pcts}`);
  }
});

test('시작: 블라인드가 걸리고 UTG부터 액션한다', () => {
  const s = hand([]);
  assert.equal(s.toAct, 'UTG');
  assert.equal(s.pot, 1.5);
  assert.equal(s.players.BB.stack, 99);
  assert.equal(hand([], { game: 'mtt' }).pot, 2.5);
  assert.equal(hand([], { table: 3 }).toAct, 'BTN');
});

test('모두 폴드하면 내 차례가 오고 첫 액션 스팟이 된다', () => {
  const s = hand(folds(6));
  assert.equal(s.toAct, 'BTN');
  const c = E.flowContext(s);
  assert.equal(c.pfAction, 'none');
  assert.equal(c.potOverride, 1.5);
});

test('오픈과 콜이 있으면 팟·콜 금액·콜러 수가 맞다', () => {
  const s = hand([...folds(3), F('raise', 2.5), F('call'), F('fold')]);
  assert.equal(s.toAct, 'BTN');
  const c = E.flowContext(s);
  assert.equal(c.pfAction, 'open');
  assert.equal(c.oppPos, 'LJ');
  assert.equal(c.raiseSize, 2.5);
  assert.equal(c.callers, 1);
  assert.equal(c.potOverride, 6.5);
  assert.equal(c.callOverride, 2.5);
  assert.equal(E.analyze({ ...c, hero: C('AcAd') }).actions.find((a) => a.kind === 'call').label, 'Call 2.5BB');
});

test('내 오픈 뒤 3벳을 받으면 다시 내 차례가 오고 3벳 스팟이 된다', () => {
  const s = hand([...folds(6), F('raise', 2.5), F('fold'), F('raise', 11)]);
  assert.equal(s.toAct, 'BTN');
  const c = E.flowContext(s);
  assert.equal(c.pfAction, '3bet');
  assert.equal(c.oppPos, 'BB');
  assert.equal(c.heroOpen, 2.5);
  assert.equal(c.cold, false);
  assert.equal(c.potOverride, 14);
  assert.equal(c.callOverride, 8.5);
});

test('내 3벳 뒤 4벳, 상대 올인, 콜드 3벳을 구분한다', () => {
  const fourBet = E.flowContext(hand([...folds(5), F('raise', 2.5), F('raise', 8), F('fold'), F('fold'), F('raise', 20)]));
  assert.equal(fourBet.pfAction, '4bet');
  assert.equal(fourBet.cold, false);
  const jam = E.flowContext(hand([...folds(6), F('raise', 2.5), F('fold'), F('allin')]));
  assert.equal(jam.pfAction, 'allin');
  assert.equal(jam.callOverride, 97.5);
  const cold = E.flowContext(hand([...folds(4), F('raise', 2.5), F('raise', 8)]));
  assert.equal(cold.pfAction, '3bet');
  assert.equal(cold.cold, true);
  assert.equal(cold.openerPos, 'HJ');
});

test('림프 팟: BB는 체크할 수 있고 레이즈 없이 플랍으로 간다', () => {
  const s = hand([...folds(6), F('call'), F('call'), F('check')], { heroPos: 'BB' });
  assert.equal(s.street, 'flop');
  assert.equal(s.pot, 3);
  assert.equal(s.toAct, 'SB');
  const atBB = hand([...folds(6), F('call'), F('call')], { heroPos: 'BB' });
  assert.equal(atBB.toAct, 'BB');
  assert.equal(E.flowContext(atBB).pfAction, 'limp');
  assert.equal(E.flowOptions(atBB).canCheck, true);
});

test('프리플랍이 끝나면 포스트플랍 순서로 넘어가고 라인과 공격자를 정한다', () => {
  const s = hand([...folds(6), F('raise', 2.5), F('fold'), F('call')]);
  assert.equal(s.street, 'flop');
  assert.equal(s.pot, 5.5);
  assert.equal(s.toAct, 'BB');
  const afterCheck = hand([...folds(6), F('raise', 2.5), F('fold'), F('call'), F('check')]);
  assert.equal(afterCheck.toAct, 'BTN');
  const c = E.flowContext(afterCheck);
  assert.equal(c.line, 'hero_open_call');
  assert.equal(c.oppPos, 'BB');
  assert.equal(c.curAct, 'check');
  assert.equal(c.ip, true);
  assert.equal(c.stack, 97.5);
  const r = E.analyze({ ...c, hero: C('AcKc'), board: C('Ad8h5c'), oppType: 'unknown' });
  assert.equal(r.info.aggressor, true);
  assert.equal(r.actions[r.balanced.freq.indexOf(Math.max(...r.balanced.freq))].label, 'Bet 25%');
});

test('내 벳 뒤 상대가 레이즈하면 다시 내 차례가 오고 콜 금액이 맞다', () => {
  const pf = [...folds(6), F('raise', 2.5), F('fold'), F('call')];
  const s = hand([...pf, F('check'), F('bet', 3), F('raise', 12)]);
  assert.equal(s.toAct, 'BTN');
  const c = E.flowContext(s);
  assert.equal(c.curAct, 'raise');
  assert.equal(c.call, 9);
  assert.equal(c.pot, 20.5);
  assert.equal(c.stack, 94.5);
  const r = E.analyze({ ...c, hero: C('AcKc'), board: C('Ad8h5c'), oppType: 'unknown' });
  assert.equal(r.error, undefined);
  assert.equal(r.info.call, 9);
});

test('다음 스트리트에는 앞 스트리트 상대 액션이 히스토리로 넘어간다', () => {
  const s = hand([...folds(6), F('raise', 2.5), F('fold'), F('call'), F('check'), F('bet', 3), F('call'), F('bet', 8)]);
  assert.equal(s.street, 'turn');
  assert.equal(s.toAct, 'BTN');
  const c = E.flowContext(s);
  assert.deepEqual(c.history.map((h) => [h.street, h.act]), [['flop', 'check'], ['flop', 'call']]);
  assert.equal(c.curAct, 'bet');
  assert.equal(c.call, 8);
});

test('멀티웨이: 상대 수와 인포지션을 모든 상대 기준으로 본다', () => {
  const s = hand([...folds(3), F('raise', 2.5), F('call'), F('fold'), F('call'), F('fold'), F('call'), F('check'), F('check'), F('check')], { heroPos: 'BB' });
  assert.equal(s.toAct, 'BTN');
  const atHero = hand([...folds(3), F('raise', 2.5), F('call'), F('fold'), F('call'), F('fold'), F('call')], { heroPos: 'BB' });
  assert.equal(atHero.street, 'flop');
  assert.equal(atHero.toAct, 'BB');
  const c = E.flowContext(atHero);
  assert.equal(c.multiway, 3);
  assert.equal(c.ip, false);
  assert.equal(c.curAct, 'first');
});

test('핸드 종료: 내 폴드, 전원 폴드, 올인 런아웃, 쇼다운', () => {
  assert.equal(hand([...folds(6), F('fold')]).status, 'hero_folded');
  assert.equal(hand([...folds(6), F('raise', 2.5), F('fold'), F('fold')]).status, 'won');
  const run = hand([...folds(6), F('allin'), F('fold'), F('call')]);
  assert.equal(run.status, 'runout');
  assert.equal(run.pot, 200.5);
  const xx = [F('check'), F('check')];
  assert.equal(hand([...folds(6), F('raise', 2.5), F('fold'), F('call'), ...xx, ...xx, ...xx]).status, 'showdown');
});

test('금액은 규칙에 맞게 고친다', () => {
  const s = hand([...folds(6), F('raise', 1.2)]); // 최소 레이즈 2
  assert.equal(s.cur, 2);
  const over = hand([...folds(6), F('raise', 500)]);
  assert.equal(over.cur, 100);
  assert.equal(over.players.BTN.allin, true);
  const minRe = hand([...folds(6), F('raise', 3), F('raise', 4)]); // 3 → 최소 5
  assert.equal(minRe.cur, 5);
});

test('선택지: 콜 금액과 사이즈가 합법 범위 안에 있다', () => {
  const o = E.flowOptions(hand([...folds(6), F('raise', 2.5), F('raise', 11)]));
  assert.equal(o.pos, 'BB');
  assert.equal(o.toCall, 10);
  assert.ok(o.sizes.every((x) => x.to >= o.min && x.to < o.max));
  const facingJam = E.flowOptions(hand([...folds(6), F('allin'), F('fold')]));
  assert.equal(facingJam.canRaise, false);
  const post2 = E.flowOptions(hand([...folds(6), F('raise', 2.5), F('fold'), F('call')]));
  assert.equal(post2.canCheck, true);
  assert.equal(post2.raiseType, 'bet');
  assert.equal(post2.sizes.length, 5);
});

test('모든 진행 지점에서 분석이 유한한 빈도를 낸다', () => {
  const seqs = [[...folds(6)], [...folds(3), F('raise', 2.5), F('call'), F('raise', 12)], [F('call'), F('call'), F('call'), ...folds(3)], [...folds(4), F('raise', 2.5), F('raise', 8), F('raise', 20), F('raise', 45)]];
  for (let n = 3; n <= 9; n++) for (const seq of seqs) for (const heroPos of E.POSITIONS[n]) {
    const s = E.replayHand({ table: n, eff: 100, game: 'cash', heroPos }, []);
    for (const a of seq) {
      if (s.status === 'playing' && s.toAct === heroPos && s.street === 'preflop') {
        const r = E.analyze({ ...E.flowContext(s), hero: C('AcKc'), oppType: 'unknown' });
        if (!r.walk) { assert.equal(r.error, undefined, `${n} ${heroPos}`); assert.ok(Math.abs(r.consensus.freq.reduce((x, y) => x + y, 0) - 1) < 1e-6); }
      }
      E.applyAction(s, a);
    }
  }
});

test('자리와 핸드로 플레이 여부를 판정한다', () => {
  const v = (h, heroPos, table = 9, o = {}) => E.playVerdict(E.analyze({ street: 'preflop', table, game: 'cash', eff: 100, heroPos, oppPos: 'BB', hero: C(h), pfAction: 'none', ...o }));
  assert.equal(v('AcAd', 'UTG').level, 'play');
  assert.equal(v('7c2d', 'UTG').level, 'fold');
  assert.equal(v('7c2d', 'BTN').level, 'fold');
  assert.equal(v('Kc9d', 'UTG').level, 'fold');
  assert.equal(v('Kc9d', 'BTN').level, 'play');
  assert.equal(v('AcKd', 'BB', 9, { pfAction: 'open', oppPos: 'BTN' }).level, 'play');
  assert.equal(v('7c2d', 'BB', 9, { pfAction: 'open', oppPos: 'UTG' }).level, 'fold');
});

// ── 고쳐도 무너지면 안 되는 것
test('넛은 올인에 콜하고, 얕은 스택 탑페어는 스택을 넣는다', () => {
  const nut = post('AcKc', 'Qc7c2c9d3h', { pot: 194, call: 97, stack: 97, curAct: 'allin' });
  assert.ok(freqOf(nut, nut.consensus, (a) => a.kind === 'call') > 0.95);
  const shallow = post('AcKd', 'Ad8h5c', { pot: 30, stack: 25 });
  assert.ok(freqOf(shallow, shallow.consensus, (a) => a.kind !== 'check') > 0.8);
});

test('리버 넛은 스테이션에게 크게 벳한다', () => {
  const r = post('AcKc', 'Qc7c2c9d3h', { oppType: 'station', pot: 30, stack: 80 });
  assert.ok(freqOf(r, r.consensus, (a) => a.prior === 75 || a.prior === 100 || a.prior === 150 || a.kind === 'allin') > 0.7);
  assert.ok(freqOf(r, r.consensus, (a) => a.kind === 'check') < 0.1);
});

test('약한 핸드로 큰 벳에 콜하지 않는다', () => {
  const r = post('7h2d', AIR_BOARD, { pot: 40, call: 20, stack: 80, curAct: 'bet' });
  assert.ok(freqOf(r, r.consensus, (a) => a.kind === 'call') < 0.1);
});

// 3벳 팟 턴 (BTN 3벳·CO 콜, 플랍 33% 벳-콜, SPR 약 2.7). 솔버 시험 풀이와 비교해 맞춘 방향
const tb = (hero, o) => E.analyze({ street: 'turn', game: 'cash', table: 6, eff: 100, board: C('Ad8h5c2s'), oppType: 'unknown', pot: 31.54, stack: 84.98, hero: C(hero), ...o });
const DONK = { heroPos: 'CO', oppPos: 'BTN', line: 'opp_3bet_call', curAct: 'first', history: [{ street: 'flop', act: 'bet', frac: 0.33 }], pfa: 'opp', ip: false };
const BARREL = { heroPos: 'BTN', oppPos: 'CO', line: 'hero_3bet_call', curAct: 'check', history: [{ street: 'flop', act: 'check' }, { street: 'flop', act: 'call' }], pfa: 'hero', ip: true };

test('앞 스트리트에 콜한 OOP는 셋으로도 동크하지 않는다', () => {
  for (const h of ['8c8d', 'AsJs']) {
    const r = tb(h, DONK);
    assert.ok(freqOf(r, r.balanced, (a) => a.kind !== 'check') < 0.1, h);
  }
});

test('낮은 SPR 턴의 공격자는 중간 메이드로도 배럴하고 작은 사이즈를 쓴다', () => {
  const r = tb('QsQd', BARREL);
  assert.ok(freqOf(r, r.balanced, (a) => a.kind !== 'check') > 0.6);
  assert.ok(freqOf(r, r.balanced, (a) => a.prior === 25 || a.prior === 50) > freqOf(r, r.balanced, (a) => a.prior === 100 || a.prior === 150 || a.kind === 'allin'));
});

test('3벳 팟 플랍: 콜러는 탑페어로 동크하지 않고, IP 3벳터는 중간 메이드로도 컨티뉴벳한다', () => {
  const fb = (hero, o) => E.analyze({ street: 'flop', game: 'cash', table: 6, eff: 100, board: C('Ad8h5c'), oppType: 'unknown', pot: 19, stack: 91.25, hero: C(hero), ...o });
  const donk = fb('AsJs', { heroPos: 'CO', oppPos: 'BTN', line: 'opp_3bet_call', curAct: 'first', pfa: 'opp', ip: false });
  assert.ok(freqOf(donk, donk.balanced, (a) => a.kind !== 'check') < 0.15);
  const cb = fb('QsQd', { heroPos: 'BTN', oppPos: 'CO', line: 'hero_3bet_call', curAct: 'check', pfa: 'hero', ip: true });
  assert.ok(freqOf(cb, cb.balanced, (a) => a.kind !== 'check') > 0.6);
});

test('4벳 팟 플랍: IP 4벳터는 오버페어로 올인보다 작은 벳을 많이 쓴다', () => {
  const r = E.analyze({ street: 'flop', game: 'cash', table: 6, eff: 100, board: C('Td7c2s'), oppType: 'unknown', pot: 44.5, stack: 78, hero: C('QhQs'), heroPos: 'BTN', oppPos: 'BB', line: 'hero_4bet_call', curAct: 'check', pfa: 'hero', ip: true });
  assert.ok(freqOf(r, r.balanced, (a) => a.prior === 25 || a.prior === 50) > freqOf(r, r.balanced, isAllin));
  assert.ok(freqOf(r, r.balanced, isAllin) < 0.3);
});

test('올인 콜 스팟도 13×13 표를 내고, 강한 핸드일수록 콜이 많다', () => {
  const g = E.preflopGrid({ table: 6, game: 'cash', heroPos: 'BB', oppPos: 'BTN', pfAction: 'allin', eff: 20, oppType: 'unknown' });
  assert.ok(g && g.allin);
  assert.equal(Object.keys(g.balanced).length, 169);
  assert.ok(g.balanced.AA.call > 0.95 && g.balanced['72o'].call < 0.1);
  assert.ok(g.balanced.AJo.call > g.balanced.T9s.call);
  // 실제 핸드 분석과 표의 콜 빈도가 크게 다르지 않다
  const a = E.analyze({ street: 'preflop', table: 6, game: 'cash', heroPos: 'BB', oppPos: 'BTN', pfAction: 'allin', eff: 20, oppType: 'unknown', hero: C('AhJc') });
  assert.ok(Math.abs(freqOf(a, a.balanced, (x) => x.kind === 'call') - g.balanced.AJo.call) < 0.15);
});

test('멀티웨이 에퀴티 샘플러: 상대 1명이면 헤즈업 전수 계산과 같고, 드로우는 예전 거듭제곱 근사보다 에퀴티가 높다', () => {
  const hero = C('AcKc'), board = C('Ad8h5c');
  const vr = E.rangeCombos(E.parseRange('22+, A2s+, KTs+, QTs+, JTs, ATo+, KJo+'), new Set([...hero, ...board]));
  const eq = E.comboEquities(hero, board, vr.idx, 7);
  let s = 0, t = 0; for (let i = 0; i < eq.length; i++) { s += eq[i] * vr.w[i]; t += vr.w[i]; }
  assert.ok(Math.abs(E.multiwayEquityMC(hero, board, vr.idx, vr.w, 1, 6000, 3) - s / t) < 0.025);
  const r1 = post('9h8h', 'Th7c2d'), r3 = post('9h8h', 'Th7c2d', { multiway: 3 });
  const m1 = post('AcAd', 'Kh8s3d'), m3 = post('AcAd', 'Kh8s3d', { multiway: 3 });
  assert.ok(m3.balanced.equity < m1.balanced.equity - 0.1);
  // 예전 근사(헤즈업 에퀴티^(1+0.8(N-1)))는 드로우의 다자 에퀴티를 크게 낮춰 봤다
  assert.ok(r3.balanced.equity > Math.pow(r1.balanced.equity, 2.6) + 0.1);
});
