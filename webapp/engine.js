/* 홀덤 듀얼 코치 — 전략 엔진
 * 핸드 평가, 레인지, 콤보별 에퀴티, 두 전문가(타이트/균형형)의 솔버식 빈도 계산, 합의.
 * 브라우저에서는 window.HoldemEngine, Node에서는 module.exports 로 노출된다. */
(function (root) {
  'use strict';

  // ───────────────────────── 카드 ─────────────────────────
  const RANKS = '23456789TJQKA';
  const SUITS = 'shdc';
  const SUIT_SYM = ['♠', '♥', '♦', '♣'];

  function parseCard(s) {
    const r = RANKS.indexOf(String(s[0]).toUpperCase());
    const su = SUITS.indexOf(String(s[1]).toLowerCase());
    if (r < 0 || su < 0) throw new Error('bad card ' + s);
    return r * 4 + su;
  }
  function parseCards(str) {
    const out = [];
    const t = String(str).replace(/[\s,]/g, '');
    for (let i = 0; i + 1 < t.length; i += 2) out.push(parseCard(t.substr(i, 2)));
    return out;
  }
  const cardText = (c) => RANKS[c >> 2] + SUIT_SYM[c & 3];

  // ───────────────────────── 핸드 평가 (5~7장) ─────────────────────────
  const rc = new Int8Array(13);
  const sc = new Int8Array(4);
  const sm = new Int32Array(4);

  function straightHigh(mask) {
    for (let hi = 12; hi >= 4; hi--) if (((mask >> (hi - 4)) & 31) === 31) return hi;
    if ((mask & 0x100f) === 0x100f) return 3; // A-2-3-4-5
    return -1;
  }

  // 값이 클수록 강함. 카테고리 = v >> 20 (0 하이카드 … 8 스트레이트 플러시)
  function evaluate(cards, n) {
    rc.fill(0); sc.fill(0); sm.fill(0);
    let rmask = 0;
    for (let i = 0; i < n; i++) {
      const c = cards[i], r = c >> 2, s = c & 3;
      rc[r]++; sc[s]++; sm[s] |= 1 << r; rmask |= 1 << r;
    }
    let fs = -1;
    for (let s = 0; s < 4; s++) if (sc[s] >= 5) { fs = s; break; }
    if (fs >= 0) {
      const sh = straightHigh(sm[fs]);
      if (sh >= 0) return (8 << 20) | (sh << 16);
    }
    let quad = -1, t1 = -1, t2 = -1, p1 = -1, p2 = -1;
    for (let r = 12; r >= 0; r--) {
      const k = rc[r];
      if (k === 4) quad = r;
      else if (k === 3) { if (t1 < 0) t1 = r; else if (t2 < 0) t2 = r; }
      else if (k === 2) { if (p1 < 0) p1 = r; else if (p2 < 0) p2 = r; }
    }
    if (quad >= 0) {
      let k = 0;
      for (let r = 12; r >= 0; r--) if (r !== quad && rc[r] > 0) { k = r; break; }
      return (7 << 20) | (quad << 16) | (k << 12);
    }
    if (t1 >= 0 && (t2 >= 0 || p1 >= 0)) return (6 << 20) | (t1 << 16) | (Math.max(t2, p1) << 12);
    if (fs >= 0) {
      let v = 5 << 20, sh = 16;
      for (let r = 12; r >= 0 && sh >= 0; r--) if (sm[fs] & (1 << r)) { v |= r << sh; sh -= 4; }
      return v;
    }
    const st = straightHigh(rmask);
    if (st >= 0) return (4 << 20) | (st << 16);
    if (t1 >= 0) {
      let v = (3 << 20) | (t1 << 16), sh = 12;
      for (let r = 12; r >= 0 && sh >= 8; r--) if (r !== t1 && rc[r] > 0) { v |= r << sh; sh -= 4; }
      return v;
    }
    if (p1 >= 0 && p2 >= 0) {
      let k = 0;
      for (let r = 12; r >= 0; r--) if (r !== p1 && r !== p2 && rc[r] > 0) { k = r; break; }
      return (2 << 20) | (p1 << 16) | (p2 << 12) | (k << 8);
    }
    if (p1 >= 0) {
      let v = (1 << 20) | (p1 << 16), sh = 12;
      for (let r = 12; r >= 0 && sh >= 4; r--) if (r !== p1 && rc[r] > 0) { v |= r << sh; sh -= 4; }
      return v;
    }
    let v = 0, sh = 16;
    for (let r = 12; r >= 0 && sh >= 0; r--) if (rc[r] > 0) { v |= r << sh; sh -= 4; }
    return v;
  }

  // ───────────────────────── 169 핸드 / 1326 콤보 ─────────────────────────
  function keyOf(c1, c2) {
    let a = c1 >> 2, b = c2 >> 2;
    if (a < b) { const t = a; a = b; b = t; }
    if (a === b) return RANKS[a] + RANKS[b];
    return RANKS[a] + RANKS[b] + ((c1 & 3) === (c2 & 3) ? 's' : 'o');
  }
  const COMBOS = [];          // [c1, c2]
  const COMBO_KEY = [];
  const KEY_COMBOS = {};
  for (let a = 0; a < 52; a++) for (let b = a + 1; b < 52; b++) {
    const k = keyOf(a, b);
    COMBO_KEY.push(k);
    (KEY_COMBOS[k] = KEY_COMBOS[k] || []).push(COMBOS.length);
    COMBOS.push([a, b]);
  }
  // 13×13 그리드 (A→2). 대각선 페어, 오른쪽 위 수티드, 왼쪽 아래 오프수트
  const GRID = [];
  for (let i = 0; i < 13; i++) {
    const row = [];
    for (let j = 0; j < 13; j++) {
      const ri = 12 - i, rj = 12 - j;
      if (i === j) row.push(RANKS[ri] + RANKS[ri]);
      else if (i < j) row.push(RANKS[ri] + RANKS[rj] + 's');
      else row.push(RANKS[rj] + RANKS[ri] + 'o');
    }
    GRID.push(row);
  }
  const ALL_KEYS = GRID.flat();
  const keySize = (k) => (k.length === 2 ? 6 : k[2] === 's' ? 4 : 12);

  // 프리플랍 핸드 순위 (올인 에퀴티 기준 근사)
  const RANK_LIST = ('AA KK QQ JJ TT 99 88 AKs 77 AQs AJs AKo ATs AQo AJo KQs 66 A9s ATo KJs A8s KTs KQo A7s A9o KJo 55 QJs K9s A5s A6s A8o KTo QTs A4s A7o K8s A3s QJo K9o A5o A6o Q9s K7s JTs A2s QTo 44 A4o K6s K8o Q8s A3o K5s J9s Q9o JTo K7o A2o K4s Q7s K6o K3s T9s J8s 33 Q6s Q8o K5o J9o K2s Q5s T8s K4o J7s Q4s Q7o T9o J8o K3o Q6o Q3s 98s T7s J6s K2o 22 Q2s Q5o J5s T8o J7o Q4o 97s J4s T6s J3s Q3o 98o 87s T7o J6o 96s J2s Q2o T5s J5o T4s 97o 86s J4o T6o 95s T3s 76s J3o 87o T2s 85s 96o J2o T5o 94s 75s T4o 93s 86o 65s 84s 95o T3o 92s 76o 74s T2o 54s 85o 64s 83s 94o 75o 82s 73s 93o 65o 53s 63s 84o 92o 43s 74o 72s 54o 64o 52s 62s 83o 42s 82o 73o 53o 63o 32s 43o 72o 52o 62o 42o 32o').split(' ');
  (function completeRanking() {
    const seen = new Set();
    const list = [];
    for (const k of RANK_LIST) if (KEY_COMBOS[k] && !seen.has(k)) { seen.add(k); list.push(k); }
    const rest = ALL_KEYS.filter((k) => !seen.has(k));
    const score = (k) => {
      const a = RANKS.indexOf(k[0]), b = RANKS.indexOf(k[1]);
      return k.length === 2 ? 100 + a : a * 2 + b + (k[2] === 's' ? 4 : 0) - (a - b > 4 ? 3 : 0);
    };
    rest.sort((x, y) => score(y) - score(x));
    RANK_LIST.length = 0;
    RANK_LIST.push(...list, ...rest);
  })();
  const RANK_INDEX = {};
  const RANK_CUM = {}; // 이 핸드까지 누적 비율(상위 %)
  (function () {
    let cum = 0;
    RANK_LIST.forEach((k, i) => { RANK_INDEX[k] = i; cum += keySize(k); RANK_CUM[k] = cum / 1326; });
  })();

  function topPercent(p) {
    const out = {};
    const target = Math.max(0, Math.min(1, p)) * 1326;
    let cum = 0;
    for (const k of RANK_LIST) {
      const sz = keySize(k);
      if (cum >= target) break;
      out[k] = Math.min(1, (target - cum) / sz);
      cum += sz;
    }
    return out;
  }

  // ───────────────────────── 레인지 문자열 파서 ─────────────────────────
  // 지원: QQ+, 22-55, AKs, AKo, AK, ATs+, A2s-A5s, KJs-KTs, 65s:0.5
  function parseRange(str) {
    const out = {};
    if (!str) return out;
    const set = (k, w) => { if (KEY_COMBOS[k]) out[k] = Math.max(out[k] || 0, w); };
    for (let tok of str.split(',')) {
      tok = tok.trim();
      if (!tok) continue;
      let w = 1;
      const ci = tok.indexOf(':');
      if (ci > 0) { w = parseFloat(tok.slice(ci + 1)); tok = tok.slice(0, ci); }
      const plus = tok.endsWith('+');
      if (plus) tok = tok.slice(0, -1);
      const dash = tok.split('-');
      const hiR = (k) => RANKS.indexOf(k[0]);
      const loR = (k) => RANKS.indexOf(k[1]);
      if (dash.length === 2) {
        const [x, y] = dash;
        if (x.length === 2 && x[0] === x[1]) {
          const a = hiR(x), b = hiR(y);
          for (let r = Math.min(a, b); r <= Math.max(a, b); r++) set(RANKS[r] + RANKS[r], w);
        } else {
          const h = x[0], suf = x.slice(2);
          const a = loR(x), b = loR(y);
          for (let r = Math.min(a, b); r <= Math.max(a, b); r++) {
            const k = h + RANKS[r];
            if (suf) set(k + suf, w); else { set(k + 's', w); set(k + 'o', w); }
          }
        }
        continue;
      }
      if (tok.length === 2 && tok[0] === tok[1]) {
        const a = hiR(tok);
        if (plus) for (let r = a; r <= 12; r++) set(RANKS[r] + RANKS[r], w);
        else set(tok, w);
        continue;
      }
      const h = hiR(tok), l = loR(tok), suf = tok.slice(2);
      const lastLo = plus ? h - 1 : l;
      for (let r = l; r <= lastLo; r++) {
        const k = RANKS[h] + RANKS[r];
        if (suf) set(k + suf, w); else { set(k + 's', w); set(k + 'o', w); }
      }
    }
    return out;
  }
  function rangePct(range) {
    let s = 0;
    for (const k in range) s += keySize(k) * range[k];
    return s / 1326;
  }
  function rangeUnion(a, b) { const o = { ...a }; for (const k in b) o[k] = Math.min(1, Math.max(o[k] || 0, b[k])); return o; }
  function rangeScale(range, f) { const o = {}; for (const k in range) o[k] = Math.min(1, range[k] * f); return o; }

  // 상대 성향에 따라 레인지를 넓히거나 좁힌다
  function adjustRange(range, factor) {
    if (Math.abs(factor - 1) < 0.01) return range;
    const pct = rangePct(range);
    const top = topPercent(Math.min(1, pct * factor));
    const out = {};
    if (factor < 1) { for (const k in range) { const w = Math.min(range[k], top[k] || 0); if (w > 0) out[k] = w; } }
    else { for (const k in range) out[k] = range[k]; for (const k in top) out[k] = Math.max(out[k] || 0, top[k]); }
    return out;
  }

  // ───────────────────────── 차트 ─────────────────────────
  const P = parseRange;
  const CHARTS = {
    tight: {
      rfi6: {
        UTG: P('66+, ATs+, KTs+, QTs+, JTs, T9s, AJo+, KQo'),
        HJ: P('55+, A8s+, A5s, K9s+, Q9s+, J9s+, T9s, 98s, ATo+, KJo+'),
        CO: P('22+, A2s+, K8s+, Q9s+, J9s+, T8s+, 97s+, 87s, 76s, A9o+, KTo+, QJo'),
        BTN: P('22+, A2s+, K5s+, Q8s+, J8s+, T8s+, 97s+, 86s+, 75s+, 65s, 54s, A5o+, K9o+, Q9o+, J9o+, T9o'),
        SB: P('22+, A2s+, K7s+, Q8s+, J8s+, T8s+, 98s, 87s, 76s, A7o+, A5o, KTo+, QTo+, JTo'),
      },
      rfi9: {
        UTG: P('77+, AJs+, KQs, AQo+'),
        UTG1: P('66+, ATs+, KJs+, QJs, AJo+, KQo'),
        UTG2: P('66+, ATs+, KTs+, QJs, JTs, AJo+, KQo'),
      },
      vsOpen: {
        EP: { IP: { r3: P('QQ+, AKs, AKo'), call: P('JJ-66, AQs, AJs, KQs') },
              SB: { r3: P('JJ+, AKs, AKo, AQs'), call: {} },
              BB: { r3: P('QQ+, AKs, AKo'), call: P('JJ-22, AQs-ATs, KQs, KJs, QJs, JTs, T9s, 98s, AQo, KQo') } },
        MP: { IP: { r3: P('TT+, AQs+, AKo'), call: P('99-22, AJs-ATs, KQs, KJs, QJs, JTs, T9s, AQo') },
              SB: { r3: P('TT+, AJs+, KQs, AQo+'), call: {} },
              BB: { r3: P('JJ+, AQs+, AKo'), call: P('TT-22, A2s-AJs, K9s+, Q9s+, J9s+, T8s+, 98s, 87s, 76s, ATo-AQo, KJo+, QJo') } },
        BTN: { SB: { r3: P('99+, ATs+, KJs+, AJo+, KQo'), call: {} },
               BB: { r3: P('TT+, AJs+, KQs, AQo+'), call: P('99-22, A2s-ATs, K5s+, Q7s+, J7s+, T7s+, 97s+, 86s+, 76s, 65s, A7o-AJo, K9o+, Q9o+, J9o+, T9o') } },
        SB: { BB: { r3: P('99+, ATs+, KTs+, AJo+, KQo'), call: P('88-22, A2s-A9s, K2s+, Q5s+, J7s+, T7s+, 96s+, 86s+, 75s+, 65s, 54s, A2o-ATo, K8o+, Q9o+, J9o+, T9o') } },
      },
      vs3bet: {
        IP: { r4: P('QQ+, AKs, AKo'), call: P('JJ-99, AQs, KQs') },
        OOP: { r4: P('QQ+, AKs, AKo'), call: P('JJ-TT, AQs') },
        lateIP: P('88, AJs, KJs, QJs, AQo'),
        lateOOP: P('99, AJs'),
      },
      vs4bet: { r5: P('QQ+, AKs, AKo'), call: {} },
    },
    balanced: {
      rfi6: {
        UTG: P('55+, A2s+, K8s+, Q9s+, J9s+, T9s, 98s, 87s:0.5, 76s:0.5, ATo+, KJo+, QJo:0.5'),
        HJ: P('33+, A2s+, K6s+, Q8s+, J8s+, T8s+, 97s+, 87s, 76s, 65s, A9o+, KTo+, QTo+, JTo'),
        CO: P('22+, A2s+, K3s+, Q5s+, J7s+, T7s+, 96s+, 85s+, 75s+, 64s+, 54s, A7o+, A5o, K9o+, Q9o+, J9o+, T9o'),
        BTN: P('22+, A2s+, K2s+, Q2s+, J4s+, T6s+, 95s+, 85s+, 74s+, 63s+, 53s+, 43s, A2o+, K7o+, Q8o+, J8o+, T8o+, 98o, 87o'),
        SB: P('22+, A2s+, K2s+, Q4s+, J6s+, T6s+, 96s+, 85s+, 75s+, 64s+, 54s, A2o+, K8o+, Q9o+, J9o+, T9o'),
      },
      rfi9: {
        UTG: P('66+, A9s+, A5s:0.5, KTs+, QTs+, JTs, T9s:0.5, AJo+, KQo'),
        UTG1: P('55+, A8s+, A5s, A4s:0.5, K9s+, Q9s+, J9s+, T9s, 98s:0.5, AJo+, KQo'),
        UTG2: P('55+, A4s+, K9s+, Q9s+, J9s+, T9s, 98s, 87s:0.5, ATo+, KJo+'),
      },
      vsOpen: {
        EP: { IP: { r3: P('QQ+, AKs, AKo, A5s, A4s, KQs:0.5'), call: P('JJ-55, AQs-ATs, KJs+, QJs, JTs, T9s, 98s, AQo') },
              SB: { r3: P('JJ+, AQs+, AKo, A5s, A4s, KQs'), call: {} },
              BB: { r3: P('QQ+, AKs, AKo, A5s:0.5, A4s:0.5'), call: P('JJ-22, A2s-AQs, K8s+, Q9s+, J9s+, T8s+, 97s+, 87s, 76s, 65s, 54s, ATo+, KJo+, QJo') } },
        MP: { IP: { r3: P('TT+, AJs+, KQs, AQo+, A5s-A2s, T9s:0.5, 87s:0.5'), call: P('99-22, ATs, KJs-KTs, QJs, QTs, JTs, T9s, 98s, 87s, AJo') },
              SB: { r3: P('99+, ATs+, KJs+, QJs, AJo+, KQo, A5s-A2s, 76s:0.5, 65s:0.5'), call: {} },
              BB: { r3: P('TT+, AJs+, KQs, AQo+, A5s, A4s, 76s:0.5'), call: P('99-22, A2s-ATs, K2s+, Q5s+, J6s+, T6s+, 96s+, 85s+, 75s+, 64s+, 54s, A7o-AJo, K9o+, Q9o+, J9o+, T9o, 98o') } },
        BTN: { SB: { r3: P('77+, A2s+, K9s+, QTs+, JTs, T9s, 98s, 87s, ATo+, KJo+, QJo'), call: {} },
               BB: { r3: P('99+, ATs+, KTs+, QJs, AJo+, KQo, A5s:0.7, A4s:0.6, A3s:0.4, A2s:0.4, 65s:0.4, 54s:0.4'), call: P('88-22, A2s-A9s, K2s+, Q2s+, J4s+, T6s+, 95s+, 85s+, 74s+, 63s+, 53s+, 43s, A2o-ATo, K5o+, Q8o+, J8o+, T8o+, 97o+, 87o') } },
        SB: { BB: { r3: P('88+, A8s+, K9s+, QTs+, A9o+, KJo+, A5s-A2s, 76s, 65s'), call: P('77-22, A2s-A7s, K2s+, Q2s+, J2s+, T5s+, 95s+, 84s+, 74s+, 63s+, 53s+, 43s, A2o-A8o, K2o+, Q6o+, J7o+, T7o+, 97o+, 86o+, 76o') } },
      },
      vs3bet: {
        IP: { r4: P('QQ+, AKs, AKo, A5s:0.5, A4s:0.5'), call: P('JJ-66, AQs-ATs, KQs, KJs, QJs, JTs, T9s, 98s:0.5, AQo') },
        OOP: { r4: P('QQ+, AKs, AKo, A5s:0.4, A4s:0.4'), call: P('JJ-77, AQs-AJs, KQs, QJs:0.5, JTs:0.5, AQo:0.5') },
        lateIP: P('55, A9s, KTs, QTs, J9s, AJo, KQo:0.5'),
        lateOOP: P('66, ATs, KJs, AJo:0.5'),
      },
      vs4bet: { r5: P('QQ+, AKs, AKo:0.85, A5s:0.25'), call: P('JJ:0.5, TT:0.3, AQs:0.4') },
    },
  };
  const LIMP_RANGE = P('22-TT, A2s-AJs, K2s+, Q5s+, J7s+, T7s+, 96s+, 85s+, 75s+, 64s+, 54s, A2o-AJo, K8o+, Q9o+, J9o+, T9o, 98o');
  const FOURBET_POT_RANGE = P('QQ+, AKs, AKo, JJ:0.5, AQs:0.5, A5s:0.2');
  const FOURBET_CALL_RANGE = P('KK:0.3, QQ, JJ, TT:0.5, AKs, AKo:0.6, AQs:0.6, KQs:0.2');

  // ───────────────────────── 포지션 ─────────────────────────
  const POSITIONS = {
    3: ['BTN', 'SB', 'BB'],
    4: ['CO', 'BTN', 'SB', 'BB'],
    5: ['HJ', 'CO', 'BTN', 'SB', 'BB'],
    6: ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
    7: ['UTG', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
    8: ['UTG', 'UTG1', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
    9: ['UTG', 'UTG1', 'UTG2', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
  };
  const normTable = (t) => Math.max(3, Math.min(9, Math.round(Number(t)) || 6));
  // 7·8인의 앞자리는 9인 테이블에서 BTN과 거리가 같은 자리의 차트를 쓴다
  const RFI_ALIAS = { 7: { UTG: 'UTG2' }, 8: { UTG: 'UTG1', UTG1: 'UTG2' } };
  const POS_LABEL = { UTG: 'UTG', UTG1: 'UTG+1', UTG2: 'MP', LJ: 'LJ', HJ: 'HJ', CO: 'CO', BTN: 'BTN', SB: 'SB', BB: 'BB' };
  const preIdx = (table, pos) => POSITIONS[table].indexOf(pos);
  const postIdx = (table, pos) => (pos === 'SB' ? 0 : pos === 'BB' ? 1 : 2 + preIdx(table, pos));
  function openerGroup(pos) {
    if (pos === 'BTN') return 'BTN';
    if (pos === 'SB') return 'SB';
    if (pos === 'HJ' || pos === 'CO') return 'MP';
    return 'EP';
  }
  const heroGroup = (pos) => (pos === 'BB' ? 'BB' : pos === 'SB' ? 'SB' : 'IP');
  const isLatePos = (pos) => pos === 'CO' || pos === 'BTN' || pos === 'SB';

  function rfiRange(style, table, pos) {
    const ch = CHARTS[style];
    const p = (RFI_ALIAS[table] || {})[pos] || pos;
    if (table > 6 && ch.rfi9[p]) return ch.rfi9[p];
    if (table > 6 && p === 'LJ') return ch.rfi6.UTG;
    return ch.rfi6[p] || {};
  }
  function vsOpenChart(style, opener, hero) {
    const g = CHARTS[style].vsOpen[openerGroup(opener)] || CHARTS[style].vsOpen.MP;
    return g[heroGroup(hero)] || g.BB || CHARTS[style].vsOpen.MP.IP;
  }

  // ───────────────────────── 상대 성향 ─────────────────────────
  const OPP_TYPES = {
    unknown: { label: '모름', open: 1.0, call: 1.0 },
    nit: { label: '니트', open: 0.65, call: 0.7 },
    reg: { label: '레귤러', open: 1.0, call: 1.0 },
    lag: { label: 'LAG', open: 1.35, call: 1.2 },
    station: { label: '콜링스테이션', open: 1.1, call: 1.7 },
    maniac: { label: '매니악', open: 1.8, call: 1.5 },
  };

  // 클래스: 0 몬스터 1 강함 2 중간 3 약함 4 강한드로우 5 드로우 6 거트샷 7 에어
  const CLS = { MONSTER: 0, STRONG: 1, MEDIUM: 2, WEAK: 3, DRAW_STRONG: 4, DRAW: 5, GUTSHOT: 6, AIR: 7 };
  const CLS_NAME = ['몬스터', '강한 메이드', '중간 메이드', '약한 페어', '강한 드로우', '드로우', '거트샷', '에어'];

  // 상대 액션별 이 클래스가 그 액션을 택할 가중치 (레귤러 기준)
  const ACTION_W = {
    check:    [0.35, 0.55, 0.90, 1.00, 0.40, 0.65, 0.90, 1.00],
    call:     [0.60, 1.00, 0.90, 0.50, 0.85, 0.90, 0.40, 0.08],
    bet_s:    [0.85, 0.90, 0.70, 0.45, 0.80, 0.60, 0.45, 0.40],
    bet_b:    [1.00, 0.90, 0.45, 0.20, 0.85, 0.60, 0.30, 0.25],
    raise:    [1.00, 0.55, 0.12, 0.04, 0.70, 0.35, 0.12, 0.10],
    allin:    [1.00, 0.50, 0.08, 0.02, 0.55, 0.20, 0.05, 0.06],
  };
  // 팟의 3배 이상 오버벳: 몬스터와 블러프로 폴라라이즈된다. 팟 근처에서 bet_b 와 이어진다
  const OVERBET_W = [1.00, 0.30, 0.04, 0.02, 0.45, 0.20, 0.08, 0.14];
  function actionWeights(key, frac) {
    if (key !== 'bet_b') return ACTION_W[key];
    const t = clamp(((frac || 0) - 1) / 2, 0, 1);
    return ACTION_W.bet_b.map((x, i) => x + (OVERBET_W[i] - x) * t);
  }
  const TYPE_AGG = {
    unknown: [1, 1, 1, 1, 1, 1, 1, 1],
    reg: [1, 1, 1, 1, 1, 1, 1, 1],
    nit: [1, 1, 0.6, 0.4, 0.7, 0.6, 0.4, 0.3],
    lag: [1, 1, 1.1, 1.3, 1.1, 1.2, 1.5, 1.6],
    station: [1, 1, 0.9, 0.7, 0.6, 0.6, 0.5, 0.4],
    maniac: [1, 1, 1.4, 2.0, 1.2, 1.4, 2.0, 2.5],
  };
  const TYPE_CALL = {
    unknown: [1, 1, 1, 1, 1, 1, 1, 1],
    reg: [1, 1, 1, 1, 1, 1, 1, 1],
    nit: [1, 1, 0.8, 0.5, 0.8, 0.8, 0.5, 0.4],
    lag: [1, 1, 1, 1.1, 1, 1, 1.2, 1.3],
    station: [1, 1, 1.3, 1.8, 1, 1.2, 1.6, 2.0],
    maniac: [1, 1, 1.1, 1.3, 1, 1, 1.3, 1.6],
  };

  // 두 전문가의 관점(렌즈)
  const LENS = {
    tight: {
      name: '타이트 전문가',
      tau: 0.05, beta: 1.2,
      // 정보 없는 상대의 턴·리버 공격 액션은 블러프가 적다고 본다 (풀 언더블러프)
      aggUnknown: [1, 1, 0.85, 0.7, 0.9, 0.85, 0.75, 0.62],
      // 정보 없는 상대는 콜을 많이 한다고 본다 (블러프↓ 얇은 밸류↑)
      callUnknown: [1, 1, 1.1, 1.15, 1, 1, 1.1, 1.15],
      implied: 0.12, icm: 1.3, bluffTax: 0.06, pushMult: 0.8, jamWidth: 0.006,
    },
    balanced: {
      name: '균형형 전문가',
      tau: 0.08, beta: 1.6,
      aggUnknown: [1, 1, 1, 1, 1, 1, 1, 1],
      callUnknown: [1, 1, 1, 1, 1, 1, 1, 1],
      implied: 0.22, icm: 1.0, bluffTax: 0, pushMult: 1.0, jamWidth: 0.02,
    },
  };
  const ICM_STAGE = { early: 0.01, middle: 0.03, bubble: 0.12, itm: 0.05, ft: 0.08 };
  const STAGE_LABEL = { early: '초반', middle: '중반', bubble: '버블', itm: '인더머니', ft: '파이널 테이블' };

  // ───────────────────────── 보드 분석 ─────────────────────────
  function analyzeHand(h1, h2, board) {
    const n = board.length;
    const all = [h1, h2].concat(board);
    const v = evaluate(all, n + 2);
    const cat = v >> 20;
    const r1 = h1 >> 2, r2 = h2 >> 2;
    const bCount = new Array(13).fill(0);
    let bmask = 0, mask = (1 << r1) | (1 << r2);
    for (const c of board) { bCount[c >> 2]++; bmask |= 1 << (c >> 2); mask |= 1 << (c >> 2); }
    const distinct = [];
    for (let r = 12; r >= 0; r--) if (bCount[r]) distinct.push(r);
    const top = distinct[0], second = distinct.length > 1 ? distinct[1] : -1;
    let made = -1, madeDesc = '';

    const onePair = (p) => {
      if (r1 === r2) {
        if (p > top) { madeDesc = '오버페어'; return CLS.STRONG; }
        if (p > second) { madeDesc = '미들 포켓페어'; return CLS.MEDIUM; }
        madeDesc = '언더 포켓페어'; return CLS.WEAK;
      }
      const kick = r1 === p ? r2 : r1;
      if (p === top) {
        let best = -1;
        for (let r = 12; r >= 0; r--) if (r !== p && !bCount[r]) { best = r; break; }
        if (kick === best) { madeDesc = '탑페어 탑키커'; return CLS.STRONG; }
        if (kick >= 9) { madeDesc = '탑페어 굿키커'; return CLS.STRONG; }
        madeDesc = '탑페어 약한 키커'; return CLS.MEDIUM;
      }
      if (p === second) { madeDesc = '세컨드 페어'; return CLS.MEDIUM; }
      madeDesc = '바텀 페어'; return CLS.WEAK;
    };

    if (cat >= 4) {
      if (n === 5 && evaluate(board, 5) === v) { made = CLS.WEAK; madeDesc = '보드 플레이'; }
      else if (cat === 5) {
        let fs = 0;
        const cnt = [0, 0, 0, 0];
        for (const c of all) cnt[c & 3]++;
        for (let s = 0; s < 4; s++) if (cnt[s] >= 5) fs = s;
        let nut = 12;
        while (nut >= 0 && board.some((c) => c === nut * 4 + fs)) nut--;
        const holeF = [h1, h2].filter((c) => (c & 3) === fs).map((c) => c >> 2);
        const best = Math.max(...holeF);
        const boardSuit = board.filter((c) => (c & 3) === fs).length;
        if (best === nut) { made = CLS.MONSTER; madeDesc = '넛 플러시'; }
        else if (boardSuit >= 4 && best < 9) { made = CLS.STRONG; madeDesc = '낮은 플러시'; }
        else { made = CLS.MONSTER; madeDesc = '플러시'; }
      } else {
        made = CLS.MONSTER;
        madeDesc = { 4: '스트레이트', 6: '풀하우스', 7: '포카드', 8: '스트레이트 플러시' }[cat];
      }
    } else if (cat === 3) {
      const t = (v >> 16) & 15;
      if (r1 === t && r2 === t) { made = CLS.MONSTER; madeDesc = '셋'; }
      else if (r1 === t || r2 === t) { const k = r1 === t ? r2 : r1; made = k >= 8 ? CLS.MONSTER : CLS.STRONG; madeDesc = '트립스'; }
    } else if (cat === 2) {
      const pA = (v >> 16) & 15, pB = (v >> 12) & 15;
      const heroPairs = [pA, pB].filter((p) => bCount[p] < 2);
      if (heroPairs.length === 2) {
        if (r1 === r2) made = onePair(r1);
        else { made = pA === top ? CLS.MONSTER : CLS.STRONG; madeDesc = pA === top ? '탑 투페어' : '투페어'; }
      } else if (heroPairs.length === 1) made = onePair(heroPairs[0]);
    } else if (cat === 1) {
      const p = (v >> 16) & 15;
      if (bCount[p] < 2) made = onePair(p);
    }

    let fd = false, nutFd = false, oesd = false, gut = false;
    if (n < 5 && cat < 4) {
      const cnt = [0, 0, 0, 0];
      for (const c of all) cnt[c & 3]++;
      for (let s = 0; s < 4; s++) {
        if (cnt[s] === 4 && ((h1 & 3) === s || (h2 & 3) === s)) {
          fd = true;
          let nut = 12;
          while (nut >= 0 && board.some((c) => c === nut * 4 + s)) nut--;
          if ([h1, h2].some((c) => (c & 3) === s && (c >> 2) === nut)) nutFd = true;
        }
      }
      let outs = 0;
      for (let r = 0; r < 13; r++) {
        if (mask & (1 << r)) continue;
        const sh = straightHigh(mask | (1 << r));
        if (sh >= 0 && straightHigh(bmask | (1 << r)) !== sh) outs++;
      }
      if (outs >= 2) oesd = true; else if (outs === 1) gut = true;
    }

    let cls;
    if (made === CLS.MONSTER) cls = CLS.MONSTER;
    else if (made === CLS.STRONG) cls = CLS.STRONG;
    else if ((fd || oesd) && (made >= 0 || (fd && (oesd || gut)) || nutFd)) cls = CLS.DRAW_STRONG;
    else if (made === CLS.MEDIUM) cls = CLS.MEDIUM;
    else if (fd || oesd) cls = CLS.DRAW;
    else if (made === CLS.WEAK) cls = CLS.WEAK;
    else if (gut) cls = CLS.GUTSHOT;
    else cls = CLS.AIR;

    const draws = [];
    if (nutFd) draws.push('넛 플러시 드로우'); else if (fd) draws.push('플러시 드로우');
    if (oesd) draws.push('양방 스트레이트 드로우'); else if (gut) draws.push('거트샷');
    let desc = madeDesc;
    if (!desc) {
      const over = r1 > top && r2 > top;
      desc = over ? '오버카드 2장' : (Math.max(r1, r2) === 12 ? 'A 하이' : '하이카드');
    }
    if (draws.length) desc += ' + ' + draws.join(' + ');
    return { cls, desc, cat };
  }

  function boardTexture(board) {
    if (board.length < 3) return null;
    const ranks = board.map((c) => c >> 2);
    const suitCnt = [0, 0, 0, 0];
    for (const c of board) suitCnt[c & 3]++;
    const maxSuit = Math.max(...suitCnt);
    const rCnt = new Array(13).fill(0);
    for (const r of ranks) rCnt[r]++;
    const paired = rCnt.some((x) => x >= 2);
    let conn = 0;
    for (let lo = -1; lo <= 8; lo++) {
      let k = 0;
      for (let r = lo; r <= lo + 4; r++) { const rr = r === -1 ? 12 : r; if (rCnt[rr]) k++; }
      conn = Math.max(conn, k);
    }
    let wet = 0;
    if (maxSuit >= 3) wet += 0.45; else if (maxSuit === 2) wet += 0.25;
    if (conn >= 3) wet += 0.4; else if (conn === 2) wet += 0.12;
    if (paired) wet -= 0.15;
    if (ranks.filter((r) => r >= 8).length >= 2) wet += 0.1;
    wet = Math.max(0, Math.min(1, wet));
    const tags = [];
    tags.push(maxSuit >= 5 ? '5플러시' : maxSuit === 4 ? '4플러시'
      : maxSuit === 3 ? (board.length === 3 ? '모노톤' : '3플러시')
      : maxSuit === 2 ? (board.length === 5 ? '플러시 없음' : '투톤') : '레인보우');
    if (paired) tags.push('페어 보드');
    if (conn >= 3) tags.push('커넥티드');
    const high = Math.max(...ranks);
    return { wet, paired, conn, maxSuit, high, label: wet < 0.3 ? '드라이' : wet < 0.6 ? '미디엄' : '웻', tags };
  }

  // ───────────────────────── 난수 (결과 고정용) ─────────────────────────
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // 콤보별 히어로 에퀴티 (헤즈업, 보드 런아웃 샘플/전수)
  function comboEquities(hero, board, comboIdx, seed) {
    const dead = new Uint8Array(52);
    for (const c of hero) dead[c] = 1;
    for (const c of board) dead[c] = 1;
    const need = 5 - board.length;
    const out = new Float32Array(comboIdx.length);
    const H = new Int32Array(7), V = new Int32Array(7);
    for (let i = 0; i < board.length; i++) { H[2 + i] = board[i]; V[2 + i] = board[i]; }
    H[0] = hero[0]; H[1] = hero[1];
    const rand = rng(seed);
    const deck = new Int32Array(52);
    const samples = need === 0 ? 1 : need === 1 ? 0 : Math.max(24, Math.min(400, Math.floor(60000 / Math.max(1, comboIdx.length))));
    for (let i = 0; i < comboIdx.length; i++) {
      const [a, b] = COMBOS[comboIdx[i]];
      V[0] = a; V[1] = b;
      let dn = 0;
      for (let c = 0; c < 52; c++) if (!dead[c] && c !== a && c !== b) deck[dn++] = c;
      let win = 0, tot = 0;
      if (need === 0) {
        const hv = evaluate(H, 7), vv = evaluate(V, 7);
        win = hv > vv ? 1 : hv === vv ? 0.5 : 0; tot = 1;
      } else if (need === 1) {
        for (let j = 0; j < dn; j++) {
          H[6] = deck[j]; V[6] = deck[j];
          const hv = evaluate(H, 7), vv = evaluate(V, 7);
          win += hv > vv ? 1 : hv === vv ? 0.5 : 0; tot++;
        }
      } else {
        const base = 7 - need;
        for (let s = 0; s < samples; s++) {
          for (let j = 0; j < need; j++) {
            const k = j + Math.floor(rand() * (dn - j));
            const t = deck[j]; deck[j] = deck[k]; deck[k] = t;
            H[base + j] = deck[j]; V[base + j] = deck[j];
          }
          const hv = evaluate(H, 7), vv = evaluate(V, 7);
          win += hv > vv ? 1 : hv === vv ? 0.5 : 0; tot++;
        }
      }
      out[i] = win / tot;
    }
    return out;
  }

  // 레인지 → (데드카드 제외) 콤보 목록과 가중치
  function rangeCombos(range, dead) {
    const idx = [], w = [];
    for (const k in range) {
      const wt = range[k];
      if (!(wt > 0)) continue;
      for (const ci of KEY_COMBOS[k]) {
        const [a, b] = COMBOS[ci];
        if (dead.has(a) || dead.has(b)) continue;
        idx.push(ci); w.push(wt);
      }
    }
    return { idx, w: Float64Array.from(w) };
  }

  function hashSeed(...parts) {
    let h = 2166136261;
    const s = parts.join('|');
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  // ───────────────────────── 공통 수학 ─────────────────────────
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const r1 = (x) => Math.round(x * 10) / 10;
  const pct = (x) => (x * 100).toFixed(0) + '%';
  const bb = (x) => (Math.round(x * 10) / 10).toString() + 'BB';

  function softmaxFreq(actions, evs, priors, tau, beta, scale) {
    const scores = actions.map((a, i) => evs[i] / scale / tau + beta * Math.log(Math.max(priors[i], 1e-6)));
    const m = Math.max(...scores);
    let w = scores.map((s) => Math.exp(s - m));
    let sum = w.reduce((a, b) => a + b, 0);
    w = w.map((x) => x / sum);
    w = w.map((x) => (x < 0.004 ? 0 : x));
    sum = w.reduce((a, b) => a + b, 0);
    return w.map((x) => x / sum);
  }

  // 핸드 클래스 대 레인지 프리플랍 에퀴티 (몬테카를로). 상대 콤보는 가중치대로 뽑고 보드 5장은 무작위.
  // 13×13 올인 콜 표용이라 대표 콤보 하나로 계산한다 (핸드당 n회, 시드 고정)
  function rangeEquityMC(key, range, n, seed) {
    const [a, b] = COMBOS[KEY_COMBOS[key][0]];
    const vr = rangeCombos(range, new Set([a, b]));
    if (!vr.idx.length) return null;
    const cum = new Float64Array(vr.w.length);
    let t = 0;
    for (let i = 0; i < vr.w.length; i++) { t += vr.w[i]; cum[i] = t; }
    const rand = rng(seed), H = new Int32Array(7), V = new Int32Array(7), used = new Uint8Array(52);
    H[0] = a; H[1] = b;
    let win = 0;
    for (let s = 0; s < n; s++) {
      const x = rand() * t;
      let lo = 0, hi = cum.length - 1;
      while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < x) lo = m + 1; else hi = m; }
      const [c, d] = COMBOS[vr.idx[lo]];
      used.fill(0); used[a] = used[b] = used[c] = used[d] = 1;
      V[0] = c; V[1] = d;
      for (let j = 2; j < 7; j++) {
        let k;
        do { k = (rand() * 52) | 0; } while (used[k]);
        used[k] = 1; H[j] = k; V[j] = k;
      }
      const hv = evaluate(H, 7), vv = evaluate(V, 7);
      win += hv > vv ? 1 : hv === vv ? 0.5 : 0;
    }
    return win / n;
  }

  // 멀티웨이 에퀴티 (몬테카를로). 상대 N명을 같은 레인지 가중치에서 서로 겹치지 않게 뽑고 남은 보드를 깐다.
  // 비기면 팟을 나눈다. 다른 상대의 레인지는 모르므로 주 상대 레인지를 같이 쓴다
  function multiwayEquityMC(hero, board, idx, w, N, n, seed) {
    const cum = new Float64Array(idx.length);
    let t = 0;
    for (let i = 0; i < idx.length; i++) { t += w[i]; cum[i] = t; }
    if (!(t > 0)) return null;
    const rand = rng(seed), used = new Uint8Array(52), need = 5 - board.length;
    const hands = Array.from({ length: N + 1 }, () => new Int32Array(7));
    for (const h of hands) for (let i = 0; i < board.length; i++) h[2 + i] = board[i];
    hands[0][0] = hero[0]; hands[0][1] = hero[1];
    let share = 0, done = 0;
    for (let s = 0; s < n; s++) {
      used.fill(0); used[hero[0]] = used[hero[1]] = 1;
      for (const c of board) used[c] = 1;
      let ok = true;
      for (let v = 1; v <= N && ok; v++) {
        let tries = 0, a, b;
        do {
          const x = rand() * t;
          let lo = 0, hi = cum.length - 1;
          while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < x) lo = m + 1; else hi = m; }
          [a, b] = COMBOS[idx[lo]];
        } while ((used[a] || used[b]) && ++tries < 30);
        if (used[a] || used[b]) { ok = false; break; }
        used[a] = used[b] = 1; hands[v][0] = a; hands[v][1] = b;
      }
      if (!ok) continue;
      for (let j = 0; j < need; j++) {
        let k;
        do { k = (rand() * 52) | 0; } while (used[k]);
        used[k] = 1;
        for (const h of hands) h[2 + board.length + j] = k;
      }
      const hv = evaluate(hands[0], 7);
      let best = hv, ties = 1, lose = false;
      for (let v = 1; v <= N; v++) {
        const vv = evaluate(hands[v], 7);
        if (vv > hv) { lose = true; break; }
        if (vv === hv) ties++;
      }
      share += lose ? 0 : 1 / ties;
      done++;
    }
    return done ? share / done : null;
  }
  const MW_SAMPLES = 4000;

  function weightedEquity(eq, w) {
    let s = 0, t = 0;
    for (let i = 0; i < eq.length; i++) { s += eq[i] * w[i]; t += w[i]; }
    return t > 0 ? s / t : 0.5;
  }

  // 상대 방어 모델: 벳 사이즈 s(=벳/팟)에 대해 MDF = 1/(1+s) 만큼 레인지 상단으로 방어하고,
  // 성향·전문가 관점에 따라 그보다 많이/적게 방어한다.
  const CLS_STRENGTH = [7, 6, 4, 2, 5, 3, 1, 0];
  function defendFactor(style, oppType, s, isRaise) {
    if (oppType === 'unknown') {
      if (isRaise) return style === 'tight' ? 1.05 : 1.0;
      // 풀 경향: 작은 벳엔 오버콜, 1팟 근처 큰 벳엔 오버폴드, 초대형 올인엔 다시 콜이 늘어난다
      const lo = style === 'tight' ? 1.12 : 1.02, mid = style === 'tight' ? 0.98 : 0.9, hi = style === 'tight' ? 1.05 : 1.0;
      if (s <= 1.25) return lo + (mid - lo) * clamp((s - 0.33) / 0.92, 0, 1);
      return mid + (hi - mid) * clamp((s - 1.25) / 1.75, 0, 1);
    }
    return { reg: 0.97, nit: 0.75, lag: 1.0, station: 1.35, maniac: 1.15 }[oppType] || 1;
  }
  // 오버벳에서 강한 메이드·콤보 드로우가 얼마나 빨리 접는지 (작을수록 끝까지 콜)
  const OVERBET_FOLD_POWER = { unknown: 1, reg: 1, nit: 1.4, lag: 0.8, maniac: 0.6, station: 0.45 };
  function defendStats(w, eq, order, D, cls, s, oppType, river) {
    let total = 0, monster = 0, strong = 0, combo = 0;
    for (let i = 0; i < w.length; i++) {
      total += w[i];
      if (cls[i] === CLS.MONSTER) monster += w[i];
      else if (cls[i] === CLS.STRONG) strong += w[i];
      else if (cls[i] === CLS.DRAW_STRONG) combo += w[i];
    }
    if (total <= 0) return { cont: 0, ec: 0.5 };
    // 방어 하한: 몬스터는 어떤 사이즈에도 접지 않고, 강한 메이드는 사이즈와 상관없이 팟 근처까지 버틴다.
    // 팟의 몇 배가 되면 성향별 속도로 접되, MDF 아래로는 내려가지 않아 큰 블러프가 공짜가 되지 않는다
    const k = Math.pow(1.5 / Math.max(s, 1.5), OVERBET_FOLD_POWER[oppType] || 1);
    // 몬스터도 팟의 4배를 넘는 벳에는 일부(투페어 등) 접는다
    const km = Math.pow(4 / Math.max(s, 4), 0.5 * (OVERBET_FOLD_POWER[oppType] || 1));
    const core = Math.min(1, (0.95 * km * monster + 0.9 * k * strong + 0.4 * k * combo) / total);
    D = Math.max(D, core);
    // 방어 경계는 D에 비례해 좁힌다. 고정 폭이면 D가 작은 큰 벳에서 약한 핸드가 콜 레인지에 섞여 내 에퀴티가 부풀려진다
    const edge = Math.max(0.005, Math.min(0.04, D * 0.25));
    let cum = 0, cw = 0, ce = 0;
    for (const i of order) {
      const mid = (cum + w[i] / 2) / total;
      // 리버에서 비기는 콤보는 콜해도 잃지 않으므로 접지 않는다
      const c = river && eq[i] === 0.5 ? 1 : 1 / (1 + Math.exp((mid - D) / edge));
      cw += w[i] * c; ce += w[i] * c * eq[i]; cum += w[i];
    }
    return { cont: cw / total, ec: cw > 0 ? ce / cw : 0.5 };
  }
  const REAL_IP = [1.1, 1.0, 0.92, 0.85, 1.0, 0.92, 0.8, 0.75];
  const REAL_OOP = [1.05, 0.95, 0.82, 0.72, 0.92, 0.82, 0.7, 0.6];

  // ───────────────────────── 프리플랍 ─────────────────────────
  function pushPercent(table, pos, eff, mult) {
    const base6 = { UTG: 0.22, HJ: 0.27, CO: 0.33, BTN: 0.45, SB: 0.58, BB: 0.6 };
    const base9 = { UTG: 0.15, UTG1: 0.17, UTG2: 0.19, LJ: 0.22, HJ: 0.26, CO: 0.31, BTN: 0.42, SB: 0.56, BB: 0.6 };
    const base = (table > 6 ? base9 : base6)[pos] || 0.3;
    const f = clamp(Math.pow(10 / Math.max(eff, 1), 0.75), 0.5, 2.4);
    return clamp(base * f * mult, 0.02, 1);
  }
  function rejamPercent(opener, eff, mult) {
    const base = { EP: 0.08, MP: 0.12, BTN: 0.17, SB: 0.21 }[openerGroup(opener)];
    return clamp(base * Math.pow(20 / Math.max(eff, 5), 0.6) * mult, 0.03, 0.6);
  }
  const handPctile = (key) => RANK_CUM[key];

  // 상대 프리플랍 레인지 추정 (모집단 기준 = 균형형 차트, 성향으로 조정)
  function villainPreflopRange(ctx) {
    const t = OPP_TYPES[ctx.oppType] || OPP_TYPES.unknown;
    const { table, heroPos, oppPos, eff } = ctx;
    switch (ctx.pfAction) {
      case 'limp': return adjustRange(LIMP_RANGE, t.call);
      case 'open': return adjustRange(rfiRange('balanced', table, oppPos), t.open);
      case '3bet': return adjustRange(vsOpenChart('balanced', ctx.openerPos || heroPos, oppPos).r3, t.open);
      case '4bet': return adjustRange(parseRange('QQ+, AKs, AKo, A5s:0.3, JJ:0.3'), t.open);
      case 'allin': {
        const oppFirst = postOrderPre(table, oppPos) < postOrderPre(table, heroPos);
        const p = oppFirst ? pushPercent(table, oppPos, eff, 1) : rejamPercent(heroPos, eff, 1);
        return topPercent(clamp(p * t.open, 0.02, 1));
      }
      default: return null;
    }
  }
  // 프리플랍 액션 순서 (UTG … BTN, SB, BB)
  const postOrderPre = (table, pos) => preIdx(table, pos);

  function preflopContext(ctx) {
    const mtt = ctx.game === 'mtt';
    const ante = mtt ? 1 : 0;
    // 핸드 진행 화면은 실제 팟과 콜 금액을 알고 있다
    if (ctx.potOverride != null) return { pot: ctx.potOverride, call: ctx.callOverride, heroIn: ctx.heroInOverride, ante };
    const heroBlind = ctx.heroPos === 'SB' ? 0.5 : ctx.heroPos === 'BB' ? 1 : 0;
    const openStd = mtt ? 2.2 : 2.5;
    // 팟 시작값(1.5)에 블라인드가 들어 있으므로 레이즈 금액에서 낸 사람의 블라인드를 뺀다. 레이즈는 유효 스택까지만 유효하다
    const oppBlind = ctx.oppPos === 'SB' ? 0.5 : ctx.oppPos === 'BB' ? 1 : 0;
    const cap = (x) => Math.min(x, ctx.eff);
    let pot = 1.5 + ante, call = 0, heroIn = heroBlind;
    const a = ctx.pfAction;
    const size = Number(ctx.raiseSize) || 0;
    if (a === 'none') { call = Math.max(0, 1 - heroBlind); }
    else if (a === 'limp') { const L = Math.max(1, ctx.limpers || 1); pot += L; call = Math.max(0, 1 - heroBlind); }
    else if (a === 'open') { const R = cap(size || openStd); pot += R - oppBlind; call = R - heroBlind; }
    else if (a === '3bet') { const O = cap(ctx.heroOpen || openStd); const T = cap(size || O * (mtt ? 3 : 3.5)); pot += O + T - heroBlind - oppBlind; heroIn = O; call = T - O; }
    else if (a === '4bet') { const T = cap(ctx.heroOpen || (mtt ? 7 : 9)); const F = cap(size || T * 2.3); pot += T + F - heroBlind - oppBlind; heroIn = T; call = F - T; }
    else if (a === 'allin') {
      const oppFirst = postOrderPre(ctx.table, ctx.oppPos) < postOrderPre(ctx.table, ctx.heroPos);
      if (!oppFirst) { heroIn = ctx.heroOpen || openStd; pot += heroIn - heroBlind; }
      const J = ctx.eff;
      pot += J - (ctx.oppPos === 'SB' ? 0.5 : ctx.oppPos === 'BB' ? 1 : 0);
      call = Math.max(0, ctx.eff - heroIn);
    }
    return { pot, call, heroIn, ante };
  }

  function preflopExpert(style, ctx, shared) {
    const L = LENS[style];
    const key = shared.key;
    const mtt = ctx.game === 'mtt';
    const eff = ctx.eff;
    const pos = ctx.heroPos;
    const posL = POS_LABEL[pos];
    const opp = POS_LABEL[ctx.oppPos] || '상대';
    const reasons = [];
    const pc = shared.pc;
    let fr = { fold: 0, call: 0, raise: 0, allin: 0 };
    let sizes = {};
    let evs = null;

    const jamFreq = (target, mine) => 1 / (1 + Math.exp(-(target - mine) / L.jamWidth));

    if (ctx.pfAction === 'none') {
      if (pos === 'BB') return { walk: true };
      const pfThresh = style === 'tight' ? 12 : 13;
      if (mtt && eff <= pfThresh) {
        const p = pushPercent(ctx.table, pos, eff, L.pushMult);
        const mine = handPctile(key);
        const j = jamFreq(p, mine);
        fr.allin = j; fr.fold = 1 - j;
        reasons.push(`유효 ${r1(eff)}BB 푸시/폴드 구간 — ${posL} 푸시 레인지 상위 ${pct(p)}, ${key}는 상위 ${pct(mine)}`);
        reasons.push(style === 'tight' ? '내쉬보다 한 단계 좁게: 버스트 리스크를 줄이고 더 좋은 스팟을 기다린다' : '내쉬 기준: 폴드 에퀴티 + 블라인드·앤티 회수를 최대화');
      } else {
        const rfi = rfiRange(style, ctx.table, pos);
        const w = rfi[key] || 0;
        fr.raise = w;
        if (style === 'balanced' && pos === 'SB' && w < 1) {
          const playable = topPercent(0.72)[key] || 0;
          fr.call = Math.min(1 - w, playable * 0.6);
        }
        fr.fold = 1 - fr.raise - fr.call;
        sizes.raise = pos === 'SB' ? (mtt ? 2.5 : 3) : mtt ? (style === 'balanced' ? 2 : 2.2) : (style === 'balanced' && pos === 'BTN' ? 2.3 : 2.5);
        reasons.push(`${posL} 오픈 레인지 약 ${pct(rangePct(rfi))} — ${key} ${w >= 1 ? '포함' : w > 0 ? `혼합(${pct(w)})` : '제외'}`);
        if (style === 'tight') reasons.push(w > 0 ? '좋은 포지션·좋은 핸드로만 팟에 들어간다' : '마진이 얇은 핸드는 버린다 — 포스트플랍 실수 비용이 더 크다');
        else reasons.push(w > 0 && w < 1 ? '솔버 경계 핸드는 빈도로 섞어 레인지가 읽히지 않게 한다' : fr.call > 0 ? 'SB는 림프를 섞어 BB의 공격을 받아낸다' : '솔버 RFI 기준선을 따른다');
      }
    } else if (ctx.pfAction === 'limp') {
      const rfi = rfiRange(style, ctx.table, pos === 'BB' || pos === 'SB' ? 'BTN' : pos);
      const isoPct = rangePct(rfi) * (style === 'tight' ? 0.55 : 0.75) * (pos === 'BB' ? 0.6 : 1);
      const iso = topPercent(isoPct);
      fr.raise = iso[key] || 0;
      if (pos === 'BB') fr.call = 1 - fr.raise; // 체크
      else if (style === 'balanced' && (rfi[key] || 0) > 0) fr.call = Math.min(1 - fr.raise, 0.55);
      else if (pos === 'SB' && style === 'balanced') fr.call = Math.min(1 - fr.raise, (topPercent(0.5)[key] || 0) * 0.5);
      fr.fold = Math.max(0, 1 - fr.raise - fr.call);
      const L_ = Math.max(1, ctx.limpers || 1);
      sizes.raise = (mtt ? 2.5 : 3.5) + L_;
      reasons.push(`림퍼 ${L_}명 — 아이솔레이션 레인지 상위 ${pct(isoPct)}, ${key}는 상위 ${pct(handPctile(key))}`);
      reasons.push(style === 'tight' ? '림퍼는 약한 레인지 — 강한 핸드로 크게 아이솔레이트해 헤즈업 밸류를 노린다' : '포지션이 있으면 플레이어블 핸드는 오버림프로 싸게 플랍을 본다');
    } else if (ctx.pfAction === 'open') {
      const ch = vsOpenChart(style, ctx.oppPos, pos);
      let r3 = ch.r3[key] || 0;
      let c = Math.min(ch.call[key] || 0, 1 - r3);
      const R = Number(ctx.raiseSize) || (mtt ? 2.2 : 2.5);
      if (R > (mtt ? 2.6 : 3.2)) c *= clamp((mtt ? 2.4 : 3) / R, 0.4, 1);
      const callers = ctx.callers || 0; // 앞에 콜한 사람이 있으면 콜은 좁히고 3벳은 키운다
      if (callers) c *= Math.pow(0.8, callers);
      if (mtt && eff <= 25) {
        const jp = rejamPercent(ctx.oppPos, eff, style === 'tight' ? 0.8 : 1);
        const jam = jamFreq(jp, handPctile(key));
        fr.allin = Math.max(jam, eff <= 18 ? r3 : 0);
        fr.raise = eff > 18 ? r3 * (1 - jam) : 0;
        fr.call = pos === 'BB' ? Math.min(c * (style === 'tight' ? 0.5 : 0.75), 1 - fr.allin - fr.raise) : eff > 20 ? Math.min(c * 0.4, 1 - fr.allin - fr.raise) : 0;
        reasons.push(`유효 ${r1(eff)}BB — 리스틸(3벳 올인) 레인지 상위 ${pct(jp)}, ${key}는 상위 ${pct(handPctile(key))}`);
      } else {
        fr.raise = r3; fr.call = c;
        reasons.push(`${opp} 오픈 vs ${posL}: 3벳 ${pct(rangePct(ch.r3))} · 콜 ${pct(rangePct(ch.call))}`);
      }
      fr.fold = Math.max(0, 1 - fr.raise - fr.call - fr.allin);
      const ip = pos !== 'SB' && pos !== 'BB';
      sizes.raise = R * (ip ? (mtt ? 2.6 : 3) : (mtt ? 3.2 : 3.8)) + R * callers;
      if (callers) reasons.push(`앞에 콜 ${callers}명 — 콜 범위를 좁히고 3벳 사이즈를 키운다`);
      reasons.push(style === 'tight' ? '3벳은 밸류 위주(리니어), 블러프 3벳은 거의 하지 않는다' : '3벳은 폴라라이즈: 밸류 + A5s·A4s 같은 블로커 블러프');
    } else if (ctx.pfAction === '3bet') {
      const v3 = CHARTS[style].vs3bet;
      const ip = postIdx(ctx.table, pos) > postIdx(ctx.table, ctx.oppPos);
      const base = ip ? v3.IP : v3.OOP;
      let call = base.call;
      if (isLatePos(pos)) call = rangeUnion(call, ip ? v3.lateIP : v3.lateOOP);
      const r4 = base.r4[key] || 0;
      // 내가 오픈하지 않았는데 3벳까지 나온 콜드 스팟은 콜 범위를 절반으로 줄인다
      const c = Math.min(call[key] || 0, 1 - r4) * (ctx.cold ? 0.5 : 1);
      if (mtt && eff <= 35) { fr.allin = r4; fr.call = eff <= 25 ? Math.min(c, 1 - r4) * 0.5 : c; }
      else { fr.raise = r4; fr.call = c; }
      fr.fold = Math.max(0, 1 - fr.raise - fr.call - fr.allin);
      const T = Number(ctx.raiseSize) || 9;
      sizes.raise = T * (ip ? 2.2 : 2.5);
      reasons.push(`3벳을 ${ip ? 'IP' : 'OOP'}에서 상대: 4벳 ${pct(rangePct(base.r4))} · 콜 ${pct(rangePct(call))}`);
      reasons.push(style === 'tight' ? '3벳 팟은 SPR이 낮다 — 도미네이트 당하는 핸드(AJo, KQo)는 버린다' : '4벳 블러프는 A 블로커(A5s·A4s)로, 콜은 플레이어빌리티 좋은 수티드로');
    } else if (ctx.pfAction === '4bet') {
      const v4 = CHARTS[style].vs4bet;
      let r5 = v4.r5[key] || 0;
      if (ctx.oppType === 'nit' && style === 'tight') r5 = parseRange('KK+, AKs')[key] || 0;
      fr.allin = r5;
      fr.call = Math.min(v4.call[key] || 0, 1 - r5);
      fr.fold = Math.max(0, 1 - fr.allin - fr.call);
      reasons.push(`4벳을 받음: 5벳 올인 ${pct(rangePct(v4.r5))} · 콜 ${pct(rangePct(v4.call))}`);
      reasons.push(style === 'tight' ? '4벳 레인지는 대부분 QQ+/AK — 그 아래는 미련 없이 폴드' : '상대 4벳 블러프(A5s 등)를 고려해 QQ+, AK는 올인, JJ·AQs는 일부 콜');
    } else if (ctx.pfAction === 'allin') {
      const E = shared.equity;
      const req = pc.call / (pc.pot + pc.call);
      let prem = 0;
      if (mtt) prem = (ICM_STAGE[ctx.stage] || 0) * L.icm * clamp(pc.call / Math.max(eff, 1) / 0.5, 0, 1);
      const evCall = (E - prem) * (pc.pot + pc.call) - pc.call;
      evs = [0, evCall];
      const f = softmaxFreq(['fold', 'call'], evs, [1, 1], L.tau * 0.8, 0, pc.pot);
      fr.fold = f[0]; fr.call = f[1];
      reasons.push(`상대 올인 레인지(약 ${pct(rangePct(shared.villainRange))}) 대비 에퀴티 ${pct(E)} · 필요 ${pct(req + prem)}${prem > 0 ? ` (ICM +${pct(prem)})` : ''}`);
      reasons.push(style === 'tight' ? (mtt ? `${STAGE_LABEL[ctx.stage]}에서는 생존 가치가 크다 — 에퀴티 여유가 있을 때만 콜` : '근소한 +EV 콜보다 확실한 스팟을 기다린다') : '칩EV 기준으로 에퀴티가 필요치를 넘으면 콜');
    }

    return { fr, sizes, reasons, evs };
  }

  function buildPreflopActions(ctx, pc, exp) {
    const raiseSz = exp.balanced.sizes.raise || exp.tight.sizes.raise;
    const callLabel = ctx.pfAction === 'none' ? (ctx.heroPos === 'SB' ? 'Limp (컴플리트)' : 'Limp') :
      ctx.heroPos === 'BB' && ctx.pfAction === 'limp' ? 'Check' : `Call ${bb(pc.call)}`;
    const raiseLabel = { none: 'Raise', limp: 'Iso Raise', open: '3-Bet', '3bet': '4-Bet', '4bet': '5-Bet' }[ctx.pfAction] || 'Raise';
    const acts = [
      { key: 'allin', label: `All-in ${bb(ctx.eff)}`, kind: 'allin' },
      { key: 'raise', label: `${raiseLabel} ${raiseSz ? bb(Math.min(raiseSz, ctx.eff)) : ''}`.trim(), kind: 'raise', amount: raiseSz ? Math.min(raiseSz, ctx.eff) : 0 },
      { key: 'call', label: callLabel, kind: 'call' },
      { key: 'fold', label: 'Fold', kind: 'fold' },
    ];
    return acts;
  }

  // ───────────────────────── 포스트플랍 ─────────────────────────
  // 프리플랍 라인에 따른 상대 레인지 (포스트플랍 시작점)
  function villainLineRange(ctx) {
    const t = OPP_TYPES[ctx.oppType] || OPP_TYPES.unknown;
    const { table, heroPos, oppPos } = ctx;
    switch (ctx.line) {
      case 'hero_open_call': {
        const ch = vsOpenChart('balanced', heroPos, oppPos);
        const r = {};
        for (const k in ch.call) r[k] = Math.max(0, Math.min(ch.call[k], 1 - (ch.r3[k] || 0)));
        if (oppPos === 'SB' || rangePct(r) < 0.04) return adjustRange(vsOpenChart('balanced', heroPos, 'BB').call, t.call);
        return adjustRange(r, t.call);
      }
      // BB는 오픈 차트가 없다 (림프에 레이즈한 경우): BTN 차트로 대신한다
      case 'opp_open_call': return adjustRange(rfiRange('balanced', table, oppPos === 'BB' ? 'BTN' : oppPos), t.open);
      case 'hero_3bet_call': {
        const ip = postIdx(table, oppPos) > postIdx(table, heroPos);
        const v = CHARTS.balanced.vs3bet;
        const c = rangeUnion((ip ? v.IP : v.OOP).call, isLatePos(oppPos) ? (ip ? v.lateIP : v.lateOOP) : {});
        return adjustRange(c, t.call);
      }
      case 'opp_3bet_call': return adjustRange(vsOpenChart('balanced', heroPos, oppPos).r3, t.open);
      case 'limp': return adjustRange(LIMP_RANGE, t.call);
      case 'hero_4bet_call': return FOURBET_CALL_RANGE;
      case 'opp_4bet_call': return FOURBET_POT_RANGE;
      default: return adjustRange(rfiRange('balanced', table, oppPos), t.open);
    }
  }
  const LINE_PFA = { hero_open_call: 'hero', opp_open_call: 'opp', hero_3bet_call: 'hero', opp_3bet_call: 'opp', limp: 'none', hero_4bet_call: 'hero', opp_4bet_call: 'opp' };
  // 라인·프리플랍 액션별로 처음 오픈한 쪽
  const LINE_OPENER = { hero_open_call: 'hero', opp_open_call: 'opp', hero_3bet_call: 'opp', opp_3bet_call: 'hero', hero_4bet_call: 'hero', opp_4bet_call: 'opp' };
  const PF_OPENER = { open: 'opp', '3bet': 'hero', '4bet': 'opp' };

  // 스트리트 액션을 상대 레인지 가중치 키로 변환
  function actionWeightKey(act, betFrac) {
    if (act === 'bet') return betFrac >= 0.6 ? 'bet_b' : 'bet_s';
    if (act === 'raise') return 'raise';
    if (act === 'allin') return 'allin';
    if (act === 'call') return 'call';
    if (act === 'check') return 'check';
    return null;
  }

  function narrowWeights(style, base, classesByStreet, steps, oppType) {
    const L = LENS[style];
    const w = Float64Array.from(base);
    const unknown = oppType === 'unknown';
    for (const st of steps) {
      const key = actionWeightKey(st.act, st.frac);
      if (!key) continue;
      const aw = actionWeights(key, st.frac);
      const aggressive = key.startsWith('bet') || key === 'raise' || key === 'allin';
      const tm = aggressive ? TYPE_AGG[oppType] : key === 'call' ? TYPE_CALL[oppType] : null;
      const lensAgg = aggressive && unknown && st.street !== 'flop' ? L.aggUnknown : null;
      const cls = classesByStreet[st.street];
      for (let i = 0; i < w.length; i++) {
        const c = cls[i];
        let f = aw[c];
        if (tm) f *= tm[c];
        if (lensAgg) f *= lensAgg[c];
        w[i] *= f;
      }
    }
    return w;
  }

  function rangeMix(w, cls) {
    const m = [0, 0, 0, 0];
    let t = 0;
    for (let i = 0; i < w.length; i++) {
      const c = cls[i];
      const g = c <= 1 ? 0 : c <= 3 ? 1 : c <= 6 ? 2 : 3;
      m[g] += w[i]; t += w[i];
    }
    return t > 0 ? m.map((x) => x / t) : m;
  }

  // 사이징 구조 prior — 균형형: 솔버 구조(보드·스트리트·역할), 타이트: 밸류 중심 중간 사이즈
  // 리버 체크 prior 배수. 솔버 시험 풀이(BTN vs BB 리버)와 비교해 맞춘 값이다
  const RIVER_CHECK = { air: 0.6, airEq: 8, medium: 2, weak: 4 };
  // 턴 체크 prior 배수 (클래스 순서). 같은 방식의 턴 시험 풀이와 비교해 맞춘 값이다
  const TURN_CHECK = [1, 5, 8, 1.5, 4.5, 2.5, 2.2, 1.3];
  // 플랍 IP 프리플랍 공격자의 체크 배수와 큰 벳 상대 레이즈 배수. 턴·리버를 크게 단순화한 플랍 시험 풀이로 맞췄다
  const FLOP_CHECK = [1, 5, 12, 3, 5, 4, 3.5, 3.5];
  const FLOP_BIG_RAISE = 0.3;
  // 동크(앞 스트리트 상대 벳에 콜한 OOP가 먼저 벳) 체크 배수. 3벳 팟 턴·리버 시험 풀이에서 솔버는 거의 동크하지 않았다
  const DONK_CHECK = 20;
  // 몬스터는 체크레이즈 가치를 EV가 담지 못해 동크가 남는다. 배럴을 받는 체크를 더 무겁게 본다
  const DONK_MONSTER = 300;
  // 낮은 SPR 턴: SPR이 hi 아래로 내려가면 lo까지 선형으로 TURN_CHECK 효과를 빼고, 공격자 체크와 작은 사이즈를 조정한다. floor 아래(4벳 팟)는 다시 줄인다. 3벳·4벳 팟 턴 시험 풀이로 맞췄다
  const LOW_SPR_TURN = { hi: 5, lo: 2.5, floor: 1.5, aggCheck: 0.4, small: 3 };
  // 올인 prior: 벳할 때 SPR 1.2~2.5 구간, 상대 벳을 받았을 때 SPR 2 이하. 4벳 팟 시험 풀이로 맞췄다
  const SHORT_ALLIN = { bet: 0.3, facing: 1 };
  // 낮은 SPR 플랍: FLOP_CHECK 효과를 SPR hi→lo 사이에서 뺀다. 플랍 동크(프리플랍 레이즈를 콜한 OOP가 먼저 벳) 체크 배수. 3벳 팟 플랍 시험 풀이로 맞췄다
  const LOW_SPR_FLOP = { hi: 10, lo: 5, aggCheck: 2, donk: 10 };
  // 프로브(앞 스트리트가 체크로 끝난 뒤 프리플랍 공격자가 아닌 OOP가 먼저 벳) 체크 배수. SPR hi→lo 사이에서 커진다. 3벳 팟 리버 시험 풀이로 맞췄다
  const LOW_SPR_PROBE = { hi: 5, lo: 2.5, check: 20, monster: 30 };
  function sizingPrior(style, ctx, tex, heroCls, sizes, equity) {
    const street = ctx.street;
    let pr;
    if (style === 'tight') {
      // 드라이 보드의 프리플랍 공격자는 타이트해도 작게 벳한다 (약한 핸드의 콜을 받고 큰 팟은 만들지 않는다)
      pr = street === 'flop' && ctx.aggressor && tex.wet < 0.35
        ? { check: 0.6, 25: 2.2, 50: 1.2, 75: 0.6, 100: 0.2, 150: 0.04 }
        : { check: 0.9, 25: 0.4, 50: 1.2, 75: 1.3, 100: 0.7, 150: 0.08 };
      if (heroCls === CLS.MEDIUM || heroCls === CLS.WEAK) { pr.check *= 1.8; pr[25] *= 1.5; pr[100] *= 0.5; pr[150] *= 0.3; }
      if (heroCls === CLS.AIR || heroCls === CLS.GUTSHOT) pr.check *= 1.6;
      // 원페어로 깊은 스택을 다 넣지 않는다
      if (heroCls === CLS.STRONG && ctx.spr > 4) { pr[100] *= 0.8; pr[150] *= 0.25; }
    } else {
      if (street === 'flop') {
        if (ctx.aggressor) {
          pr = tex.wet < 0.35 ? { check: 0.6, 25: 2.2, 50: 0.7, 75: 0.35, 100: 0.15, 150: 0.05 }
            : tex.wet < 0.6 ? { check: 0.9, 25: 1.1, 50: 1.2, 75: 0.9, 100: 0.4, 150: 0.1 }
            : { check: 1.2, 25: 0.6, 50: 0.9, 75: 1.4, 100: 0.8, 150: 0.2 };
        } else pr = { check: 2.4, 25: 0.8, 50: 0.9, 75: 0.7, 100: 0.3, 150: 0.1 };
      } else if (street === 'turn') pr = { check: 1.0, 25: 0.4, 50: 0.8, 75: 1.3, 100: 1.0, 150: 0.6 };
      else pr = { check: 1.0, 25: 0.35, 50: 0.75, 75: 1.1, 100: 1.0, 150: 0.9 };
      if (street !== 'flop' || !ctx.aggressor) {
        if (heroCls === CLS.MEDIUM || heroCls === CLS.WEAK) { pr.check *= 1.7; pr[25] *= 1.4; pr[50] *= 1.1; pr[100] *= 0.45; pr[150] *= 0.3; }
        if (heroCls === CLS.MONSTER || heroCls === CLS.AIR) { pr[100] *= 1.3; pr[150] *= street === 'river' ? 1 : 1.5; pr[25] *= 0.7; }
        // 턴·리버의 에어는 전부 블러프가 되지 않는다. 블러프 EV가 0 근처라 체크 비중은 prior가 정한다
        if (heroCls === CLS.AIR && street !== 'flop') pr.check *= street === 'river' ? RIVER_CHECK.air * (1 + RIVER_CHECK.airEq * equity) : 3;
      }
      if (tex.paired && street === 'flop') { pr[25] *= 1.3; pr[75] *= 0.8; }
    }
    if (street === 'river') {
      if (heroCls === CLS.MEDIUM) pr.check *= RIVER_CHECK.medium;
      if (heroCls === CLS.WEAK) pr.check *= RIVER_CHECK.weak;
    }
    if (street === 'turn') {
      // 싱글 레이즈 팟(SPR 높음)에서 맞춘 체크 배수는 3벳 팟처럼 SPR이 낮으면 약해진다
      const LS = LOW_SPR_TURN, f = Math.min(1, Math.max(0, (LS.hi - ctx.spr) / (LS.hi - LS.lo))) * (LS.floor > 0 ? Math.min(1, ctx.spr / LS.floor) : 1);
      // 공격자만 해당한다. 콜한 쪽의 체크 빈도는 SPR이 낮아도 솔버와 비슷했다
      pr.check *= ctx.aggressor ? Math.pow(TURN_CHECK[heroCls], 1 - f) * (1 - f * (1 - LS.aggCheck)) : TURN_CHECK[heroCls];
      pr[25] *= 1 + f * (LS.small - 1); pr[50] *= 1 + f * (LS.small - 1);
    }
    // 앞 스트리트에 상대 벳을 콜한 OOP는 먼저 벳하지 않는다
    if (street !== 'flop' && !ctx.ip && !ctx.aggressor && (ctx.history || []).some((h) => h.street === prevStreet(street) && (h.act === 'bet' || h.act === 'raise' || h.act === 'allin'))) pr.check *= DONK_CHECK * (heroCls === CLS.MONSTER ? DONK_MONSTER : 1);
    if (street !== 'flop' && !ctx.ip && !ctx.aggressor && (ctx.pfa || LINE_PFA[ctx.line]) === 'opp'
      && (ctx.history || []).some((h) => h.street === prevStreet(street) && h.act === 'check')
      && !(ctx.history || []).some((h) => h.street === prevStreet(street) && (h.act === 'bet' || h.act === 'raise' || h.act === 'allin'))) {
      const LP = LOW_SPR_PROBE, f = Math.min(1, Math.max(0, (LP.hi - ctx.spr) / (LP.hi - LP.lo)));
      pr.check *= 1 + f * (LP.check * (heroCls === CLS.MONSTER ? LP.monster : 1) - 1);
    }
    if (street === 'flop' && ctx.aggressor && ctx.ip) {
      const LF = LOW_SPR_FLOP, f = Math.min(1, Math.max(0, (LF.hi - ctx.spr) / (LF.hi - LF.lo)));
      pr.check *= Math.pow(FLOP_CHECK[heroCls], 1 - f) * (1 - f * (1 - LF.aggCheck));
    }
    if (street === 'flop' && !ctx.ip && !ctx.aggressor && (ctx.pfa || LINE_PFA[ctx.line]) === 'opp') pr.check *= LOW_SPR_FLOP.donk * (heroCls === CLS.MONSTER ? DONK_MONSTER : 1);
    if (ctx.multiway > 1) { pr.check *= 1.7; pr[150] *= 0.5; }
    pr.allin = ctx.spr <= 1.2 ? 2 : ctx.spr <= 2.5 ? SHORT_ALLIN.bet : ctx.spr <= 6 ? 0.03 : 0.004;
    if (style === 'tight' && heroCls !== CLS.MONSTER && ctx.spr > 4) pr.allin *= 0.1;
    return sizes.map((s) => pr[s.prior] ?? 0.5);
  }
  function facingPrior(style, ctx, a, heroCls) {
    if (a.kind === 'fold') return 1;
    const showdown = heroCls === CLS.MEDIUM || heroCls === CLS.WEAK;
    if (a.kind === 'call') return (style === 'balanced' ? 1.3 : 1) * (style === 'tight' && isDraw(heroCls) ? 1.4 : 1);
    let p = a.kind === 'allin' ? (ctx.spr <= 2 ? SHORT_ALLIN.facing : 0.12) : a.prior === 'r3x' ? (style === 'balanced' ? 0.45 : 0.6) : 0.3;
    if (showdown) p *= 0.3; // 쇼다운 가치가 있는 핸드를 블러프로 바꾸지 않는다
    if (heroCls === CLS.AIR) p *= 0.15; // 드로우 에퀴티가 없는 에어는 레이즈 블러프 후보가 아니다
    if (style === 'tight' && a.kind === 'allin' && heroCls !== CLS.MONSTER && ctx.spr > 3) p *= 0.4;
    // 플랍 큰 벳에 레이즈가 솔버보다 많았다
    if (ctx.street === 'flop' && ctx.call / Math.max(ctx.pot - ctx.call, 0.1) >= 0.5) p *= FLOP_BIG_RAISE;
    return p;
  }
  const argmax = (f) => f.reduce((b, x, i) => (x > f[b] ? i : b), 0);
  const isDraw = (c) => c === CLS.DRAW || c === CLS.DRAW_STRONG || c === CLS.GUTSHOT;

  function postflopExpert(style, ctx, S) {
    const L = LENS[style];
    const w = S.weights[style];
    const { eq, cls, order, actions } = S;
    const ip = ctx.ip;
    const N = Math.max(1, ctx.multiway || 1);
    const Pot = ctx.pot, C = ctx.call, stack = ctx.stack;
    const heroCls = S.hero.cls;
    const wR = ip ? REAL_IP[heroCls] : REAL_OOP[heroCls];
    const R = ctx.street === 'river' ? (ip ? 1 : Math.min(1, wR + 0.1)) : wR;
    // 멀티웨이 에퀴티는 샘플링 값을 쓰고, 벳을 받은 상대들의 에퀴티는 그 값에서 구한 지수(헤즈업 에퀴티의 거듭제곱)로 맞춘다
    const Ehu = weightedEquity(eq, w);
    const Emw = N > 1 && S.mwE ? S.mwE[style] : null;
    const mwPow = N === 1 ? 1 : Emw != null && Ehu > 0.001 && Ehu < 0.999 && Emw > 0.0005
      ? clamp(Math.log(Emw) / Math.log(Ehu), 1, N) : 1 + 0.8 * (N - 1);
    const E = N > 1 && Emw != null ? Emw : Math.pow(Ehu, mwPow);
    const bluffy = heroCls === CLS.AIR || heroCls === CLS.GUTSHOT || heroCls === CLS.WEAK;
    const icmP = ctx.game === 'mtt' ? (ICM_STAGE[ctx.stage] || 0) * L.icm : 0;
    const evs = [], info = {};
    for (const a of actions) {
      let ev = 0;
      if (a.kind === 'check') {
        ev = R * E * Pot;
        if (!ip && heroCls === CLS.MONSTER && (ctx.oppType === 'lag' || ctx.oppType === 'maniac')) ev += 0.1 * Pot;
      } else if (a.kind === 'call') {
        const amt = Math.min(C, stack);
        const allIn = amt >= stack - 1e-9;
        const Rc = allIn || ctx.street === 'river' ? 1 : R;
        let implied = 0;
        if (!allIn && ctx.street !== 'river' && isDraw(heroCls)) {
          implied = L.implied * Math.min(stack - amt, Pot + amt) * (heroCls === CLS.GUTSHOT ? 0.5 : 1);
        }
        ev = Rc * E * (Pot + amt) - amt + implied * E;
        if (allIn && icmP) ev -= icmP * (Pot + amt) * clamp(amt / Math.max(ctx.stackStart, 1) / 0.5, 0, 1);
        info.call = { implied };
      } else if (a.kind !== 'fold') {
        const X = Math.min(a.amount, stack);
        const allIn = X >= stack - 1e-9;
        const s = X / Math.max(Pot, 0.1);
        const D = clamp(defendFactor(style, ctx.oppType, s, C > 0) / (1 + s), 0.02, 1);
        const st = defendStats(w, eq, order, D, cls, s, ctx.oppType, ctx.street === 'river');
        const fold = Math.pow(1 - st.cont, N);
        const ec = Math.pow(st.ec, mwPow);
        const potCalled = Pot + X + Math.max(0, X - C);
        const Rb = allIn || ctx.street === 'river' ? 1 : Math.min(1.05, R + 0.05);
        ev = fold * Pot + (1 - fold) * (Rb * ec * potCalled - X);
        // 몬스터는 스택을 남겨 두면 뒤 스트리트에서 더 받는다. 이게 없으면 깊은 스택 플랍 올인이 과대평가된다
        if (!allIn && heroCls === CLS.MONSTER && ctx.street !== 'river') {
          ev += (1 - fold) * (ctx.street === 'flop' ? 0.35 : 0.2) * Math.max(0, 2 * ec - 1) * Math.min(stack - X, 3 * potCalled);
        }
        // 블러프(또는 쇼다운 가치를 블러프로 바꾸는 레이즈)에는 분산 비용을 매긴다 — 타이트만
        if ((bluffy || (C > 0 && heroCls === CLS.MEDIUM)) && ec < 0.4) ev -= L.bluffTax * Pot * (1 + Math.min(s, 4));
        if (allIn && icmP) ev -= icmP * potCalled * (1 - fold) * clamp(X / Math.max(ctx.stackStart, 1) / 0.5, 0, 1);
        info[a.key] = { fold, ec, D };
      }
      evs.push(ev);
    }
    const priors = C > 0 ? actions.map((a) => facingPrior(style, ctx, a, heroCls)) : sizingPrior(style, ctx, S.tex, heroCls, actions, E);
    const freq = softmaxFreq(actions, evs, priors, L.tau, L.beta, Math.max(Pot, 1));

    const mix = rangeMix(w, cls);
    const top = argmax(freq);
    const ta = actions[top];
    const facts = [`${S.hero.desc} · 보드 ${S.tex.label}(${S.tex.tags.join('·')})`];
    let headline;
    if (C > 0) {
      const amt = Math.min(C, stack);
      const req = amt / (Pot + amt);
      const mdf = Math.max(0, 1 - C / Pot);
      facts.push(`에퀴티 ${pct(E)} vs 필요 ${pct(req)} · MDF ${pct(mdf)}`);
      facts.push(`상대 레인지 강 ${pct(mix[0])} · 중약 ${pct(mix[1])} · 드로우 ${pct(mix[2])} · 에어 ${pct(mix[3])}`);
      if (style === 'tight') {
        headline = ta.kind === 'fold'
          ? (ctx.oppType === 'unknown' && ctx.street !== 'flop' ? '정보 없는 상대의 턴·리버 공격은 블러프가 적다. 블러프를 30~40% 낮춰 보면 콜할 가격이 아니다.' : '애매한 스팟이다. 큰 팟은 강한 핸드로만 만든다.')
          : ta.kind === 'call' ? (E >= req ? `에퀴티가 필요치보다 ${pct(E - req)} 높다. 레이즈로 팟을 키울 이유는 없다.` : '임플라이드 오즈까지 넣으면 콜 가격이 맞는다.')
          : '확실한 밸류가 있다. 지금 팟을 키운다.';
      } else {
        headline = ta.kind === 'fold' ? '이 핸드는 레인지 하단이다. 방어는 더 좋은 핸드로 채운다.'
          : ta.kind === 'call' ? `MDF ${pct(mdf)}를 지키려면 이 핸드는 방어 레인지에 들어간다.`
          : isDraw(heroCls) ? '세미블러프 레이즈: 폴드 에퀴티와 드로우 에퀴티로 두 번 이긴다.'
          : '레이즈 밸류 영역이다. 상대 방어 레인지에 대해서도 앞선다.';
      }
    } else {
      facts.push(`추정 에퀴티 ${pct(E)} · 상대 레인지 강 ${pct(mix[0])} · 중약 ${pct(mix[1])} · 드로우 ${pct(mix[2])} · 에어 ${pct(mix[3])}`);
      if (info[ta.key]) facts.push(`${ta.label}: 상대 폴드 ${pct(info[ta.key].fold)} · 콜 레인지 대비 에퀴티 ${pct(info[ta.key].ec)}`);
      else facts.push(`체크 시 에퀴티 실현 기대치 ${r1(R * E * Pot)}BB`);
      if (style === 'tight') {
        headline = ta.kind === 'check' ? (bluffy ? '정보 없는 상대에게 블러프는 최소화한다. 풀은 콜이 많다.' : '쇼다운 가치가 있다. 팟 컨트롤로 지킨다.')
          : heroCls <= CLS.STRONG && ctx.street === 'flop' && ctx.aggressor && S.tex.wet < 0.35 && (ta.prior === 25 || ta.prior === 50) ? '드라이 보드는 작게 벳해 약한 핸드의 콜을 받는다. 큰 팟은 뒤 스트리트에서 만든다.'
          : heroCls <= CLS.STRONG ? '밸류는 두껍게. 풀이 콜을 많이 하니 사이즈를 키운다.'
          : isDraw(heroCls) ? '세미블러프로 폴드 에퀴티를 챙긴다.' : '얇은 밸류다. 상대가 더 약한 핸드로 콜한다.';
      } else {
        headline = ta.kind === 'check'
          ? (heroCls <= CLS.STRONG ? '강한 핸드도 일부 체크해 체크 레인지를 보호한다.' : '이 핸드는 체크 레인지에 둔다. 실현 에퀴티가 더 크다.')
          : ctx.aggressor && ctx.street === 'flop' && S.tex.wet < 0.35 ? '드라이 보드의 프리플랍 공격자는 작은 사이즈를 많이 쓰되, 약한 핸드는 체크도 섞는다.'
          : S.tex.wet >= 0.6 ? '웻 보드는 폴라라이즈. 큰 사이즈로 드로우에 대가를 치르게 한다.'
          : ctx.street === 'river' ? '리버는 폴라: 넛과 블러프는 크게, 중간 핸드는 체크.'
          : '레인지에서 이 핸드의 역할에 맞는 사이즈를 고른다.';
      }
    }
    return { freq, evs, headline, facts, reasons: [headline].concat(facts), equity: E, mix, info, top };
  }

  function buildPostflopActions(ctx) {
    const { pot, call, stack } = ctx;
    const acts = [];
    if (call > 0) {
      acts.push({ key: 'fold', label: 'Fold', kind: 'fold' });
      acts.push({ key: 'call', label: `Call ${bb(Math.min(call, stack))}`, kind: 'call', amount: Math.min(call, stack) });
      if (stack > call * 1.05) {
        const r3 = call * 3, rp = pot + 2 * call;
        if (r3 < stack * 0.8) acts.push({ key: 'r3x', label: `Raise ${bb(r3)}`, kind: 'raise', amount: r3, prior: 'r3x' });
        if (rp < stack * 0.8 && rp > r3 * 1.15) acts.push({ key: 'rpot', label: `Raise ${bb(rp)}`, kind: 'raise', amount: rp, prior: 'rpot' });
        acts.push({ key: 'allin', label: `All-in ${bb(stack)}`, kind: 'allin', amount: stack });
      }
      return acts;
    }
    acts.push({ key: 'check', label: 'Check', kind: 'check', prior: 'check' });
    for (const s of [25, 50, 75, 100, 150]) {
      const amt = pot * s / 100;
      if (amt < stack * 0.85) acts.push({ key: 'b' + s, label: `Bet ${s}%`, sub: bb(amt), kind: 'bet', amount: amt, prior: s });
    }
    acts.push({ key: 'allin', label: 'All-in', sub: bb(stack), kind: 'allin', amount: stack, prior: 'allin' });
    return acts;
  }

  // ───────────────────────── 합의 ─────────────────────────
  function consensusWeight(ctx, decisionIsAllin) {
    let w = 0.6;
    const why = [];
    switch (ctx.oppType) {
      case 'nit': w = 0.5; why.push('상대가 니트 → 두 관점을 반반'); break;
      case 'station': w = 0.35; why.push('콜링스테이션 → 블러프를 줄이는 타이트 착취 비중↑'); break;
      case 'lag': case 'maniac': w = 0.6; why.push('공격적인 상대 → 블러프캐치를 넓히는 균형형 비중↑'); break;
      default: why.push(ctx.oppType === 'reg' ? '레귤러 상대 → 솔버 기준선(균형형) 우선' : '상대 정보 없음 → 솔버 기준선(균형형) 우선');
    }
    if (ctx.game === 'mtt' && decisionIsAllin && (ctx.stage === 'bubble' || ctx.stage === 'ft')) { w = Math.min(w, 0.4); why.push(`${STAGE_LABEL[ctx.stage]} 올인 결정 → ICM 생존 가치(타이트) 비중↑`); }
    return { w, why };
  }

  // 두 전문가가 갈릴 때 서로에게 하는 반박
  function rebuttal(actions, ti, bi, T, B, ctx, spot) {
    const kind = (i) => actions[i].kind;
    const aggr = (i) => (['raise', 'bet', 'allin'].includes(kind(i)) ? 2 : kind(i) === 'call' ? 1 : 0);
    const who = ctx.oppType === 'unknown' ? '정보 없는 상대' : (OPP_TYPES[ctx.oppType] || OPP_TYPES.unknown).label;
    if (spot === 'facing') {
      if (aggr(ti) < aggr(bi) && kind(bi) === 'call') return {
        tight: `${who}의 이 라인에서 블러프는 ${pct(T.mix[3])} 정도로 봅니다. 에퀴티 ${pct(T.equity)}로는 부족해요.`,
        balanced: `제 추정은 블러프 ${pct(B.mix[3])}, 에퀴티 ${pct(B.equity)}입니다. 여기서 접으면 MDF 아래로 떨어져 상대는 아무 두 장으로나 벳해도 이깁니다.`,
      };
      if (aggr(ti) < aggr(bi)) return {
        tight: isDraw(ctx.heroCls) ? '드로우는 콜로 싸게 보고 완성되면 밸류를 받습니다. 레이즈는 분산만 키워요.' : '콜로 충분합니다. 레이즈하면 더 강한 핸드만 남아요.',
        balanced: isDraw(ctx.heroCls) ? '세미블러프 레이즈는 폴드 에퀴티와 드로우 에퀴티 두 가지로 이깁니다. 레이즈를 섞어야 콜 레인지가 캡되지 않아요.' : '레이즈 빈도를 섞어야 상대가 내 콜 레인지를 공략하지 못합니다.',
      };
      return {
        tight: kind(ti) === 'call' ? `필요 에퀴티는 넘깁니다. ${who}에게 이 정도 핸드를 접는 건 너무 소극적이에요.` : '풀은 콜을 많이 합니다. 지금 레이즈해야 밸류를 받아요.',
        balanced: kind(ti) === 'call' ? '이 핸드는 레인지 하단입니다. 방어는 블로커가 더 좋은 핸드로 채우는 게 맞아요.' : '레이즈하면 블러프는 전부 폴드하고 더 강한 핸드만 남습니다. 콜로 블러프를 계속 끌어들이죠.',
      };
    }
    if (spot === 'betting') {
      if (kind(ti) === 'check' && kind(bi) !== 'check') {
        const f = B.info[actions[bi].key];
        return {
          tight: '이 핸드로 벳하면 콜당할 때 손실이 큽니다. 체크로 에퀴티를 실현하죠.',
          balanced: `이 보드는 레인지 싸움입니다. ${actions[bi].label}이면 상대 폴드 ${f ? pct(f.fold) : '-'}만으로도 이득이고, 체크만 하면 상대가 공짜 카드를 봐요.`,
        };
      }
      if (kind(ti) !== 'check' && kind(bi) === 'check') return {
        tight: '밸류를 놓치면 안 됩니다. 풀은 이 사이즈에 넓게 콜해요.',
        balanced: '체크 레인지에도 강한 핸드가 있어야 상대가 마음 놓고 벳하지 못합니다.',
      };
      const tAmt = actions[ti].amount || 0, bAmt = actions[bi].amount || 0;
      const fb = B.info[actions[ti].key];
      if (tAmt > bAmt) return {
        tight: '이 핸드는 상대 콜 레인지보다 앞서요. 사이즈를 키워 밸류를 최대화합니다.',
        balanced: `${actions[ti].label}엔 상대가 레인지 상위 ${fb ? pct(fb.D) : '-'}만 남깁니다. 작게 가서 넓은 레인지에서 밸류를 받고 다음 스트리트를 노리죠.`,
      };
      return {
        tight: '작게 가서 리스크를 줄이는 편이 낫습니다.',
        balanced: '레인지가 폴라라이즈된 상황이라 큰 사이즈가 맞습니다.',
      };
    }
    // 프리플랍
    const key = ctx.heroKey;
    if (kind(ti) === 'fold') return {
      tight: ctx.pfAction === 'allin' ? `콜 에퀴티는 근소합니다. ${ctx.game === 'mtt' ? 'ICM' : '분산'}을 감안하면 필요 에퀴티가 더 높아요.` : `${key}는 이 자리에서 마진이 얇습니다. 포스트플랍 실수 비용까지 생각하면 폴드.`,
      balanced: ctx.pfAction === 'allin' ? '칩EV로는 에퀴티가 필요치를 넘습니다. 너무 타이트하면 상대 올인 레인지가 계속 넓어져요.' : '솔버는 이 핸드를 플레이합니다. 접으면 레인지가 좁아져 착취당해요.',
    };
    if (kind(bi) === 'fold') return {
      tight: '이 상대에겐 이 핸드로 충분히 이깁니다. 실전 풀은 솔버만큼 정교하지 않아요.',
      balanced: '솔버 기준선에선 이 핸드가 레인지 밖입니다. 기준선을 지키는 게 장기적으로 안전해요.',
    };
    if (kind(ti) === 'call' && aggr(bi) === 2) return {
      tight: '3벳·4벳 밸류가 부족합니다. 콜로 플랍을 보죠.',
      balanced: '블로커와 플레이어빌리티가 좋아 레이즈 후보입니다. 콜만 하면 레인지가 캡돼요.',
    };
    if (aggr(ti) === 2 && kind(bi) === 'call') return {
      tight: '밸류가 충분하니 팟을 키워 주도권을 잡습니다.',
      balanced: '여기선 콜로 상대의 약한 레인지를 계속 끌어들이는 편이 EV가 높아요.',
    };
    return {
      tight: '마진이 얇은 스팟입니다. 분산이 작은 쪽을 고르죠.',
      balanced: '두 선택의 EV가 비슷해서 빈도로 섞는 게 맞습니다.',
    };
  }

  function buildConsensus(actions, tight, bal, ctx, decisionIsAllin, spot) {
    const { w, why } = consensusWeight(ctx, decisionIsAllin);
    const freq = actions.map((_, i) => w * bal.freq[i] + (1 - w) * tight.freq[i]);
    let diff = 0;
    for (let i = 0; i < actions.length; i++) diff += Math.abs(bal.freq[i] - tight.freq[i]);
    const agreement = 1 - diff / 2;
    const ti = argmax(tight.freq), bi = argmax(bal.freq), ci = argmax(freq);
    const fmt = (i, f) => `${actions[i].label} ${(f[i] * 100).toFixed(1)}%`;
    const lines = [
      { who: 'tight', text: `${fmt(ti, tight.freq)}. ${tight.headline}` },
      { who: 'balanced', text: `${fmt(bi, bal.freq)}. ${bal.headline}` },
    ];
    if (ti !== bi || agreement < 0.8) {
      const r = rebuttal(actions, ti, bi, tight, bal, ctx, spot);
      lines.push({ who: 'tight', text: r.tight });
      lines.push({ who: 'balanced', text: r.balanced });
    } else {
      lines.push({ who: 'balanced', text: '같은 결론입니다. 솔버 기준선과 실전 착취가 같은 방향을 가리켜요.' });
    }
    lines.push({ who: 'judge', text: `${why.join(' · ')}. 균형형 ${Math.round(w * 100)} : 타이트 ${Math.round((1 - w) * 100)} 가중 → 최종 ${fmt(ci, freq)}.` });
    return { freq, w, why, agreement, top: ci, dialogue: lines };
  }

  // ───────────────────────── 메인 분석 ─────────────────────────
  /*
   * ctx = {
   *   game: 'cash'|'mtt', stage, table: 6|9, eff, heroPos, hero: [c1,c2], oppPos, oppType,
   *   street: 'preflop'|'flop'|'turn'|'river', board: [cards],
   *   pfAction, raiseSize, limpers, heroOpen,
   *   line, pot, call, multiway, curAct: 'first'|'check'|'bet'|'raise'|'allin', history: [{street, act, frac}]
   * }
   */
  function analyze(input) {
    const ctx = Object.assign({ table: 6, game: 'cash', stage: 'middle', eff: 100, oppType: 'unknown', multiway: 1 }, input);
    ctx.table = normTable(ctx.table);
    ctx.eff = Math.max(1, Number(ctx.eff) || 100);
    const hero = ctx.hero;
    if (!hero || hero.length !== 2) return { error: '내 카드 2장을 선택하세요.' };
    const key = keyOf(hero[0], hero[1]);
    const dead = new Set(hero.concat(ctx.board || []));
    const invalid = ctx.flow ? null : spotError(ctx); // 핸드 진행은 실제 액션 순서라 검증이 필요 없다
    if (invalid) return { error: invalid };

    if (ctx.street === 'preflop') {
      if (ctx.pfAction === 'none' && ctx.heroPos === 'BB') return { walk: true, message: '모두 폴드 — BB가 팟을 가져갑니다.' };
      const pc = preflopContext(ctx);
      const villainRange = villainPreflopRange(ctx);
      let equity = null, vr = null;
      if (villainRange) {
        vr = rangeCombos(villainRange, dead);
        const eqs = comboEquities(hero, [], vr.idx, hashSeed(key, ctx.pfAction, ctx.oppPos, ctx.oppType, ctx.eff));
        equity = weightedEquity(eqs, vr.w);
      }
      const shared = { key, pc, equity, villainRange };
      const exp = { tight: preflopExpert('tight', ctx, shared), balanced: preflopExpert('balanced', ctx, shared) };
      const actions = buildPreflopActions(ctx, pc, exp);
      const toArr = (e) => actions.map((a) => e.fr[a.key] || 0);
      const wrap = (e) => ({ freq: toArr(e), reasons: e.reasons, headline: e.reasons[1] || e.reasons[0], facts: [e.reasons[0]], equity, mix: [0, 0, 0, 0], info: {} });
      const tight = wrap(exp.tight);
      const bal = wrap(exp.balanced);
      // 0 빈도 액션 중 의미 없는 것은 숨김
      const keep = actions.map((a, i) => tight.freq[i] > 0 || bal.freq[i] > 0 || a.kind === 'fold' || (a.kind === 'call' && ctx.pfAction !== 'none') || (a.kind === 'raise' && ctx.pfAction !== 'allin' && !(ctx.game === 'mtt' && ctx.eff <= 13 && ctx.pfAction === 'none')));
      const A = actions.filter((_, i) => keep[i]);
      const pick = (f) => f.filter((_, i) => keep[i]);
      tight.freq = pick(tight.freq); bal.freq = pick(bal.freq);
      const allinDecision = ctx.pfAction === 'allin' || A.some((a, i) => a.kind === 'allin' && (tight.freq[i] > 0.3 || bal.freq[i] > 0.3));
      const consensus = buildConsensus(A, tight, bal, Object.assign({ heroKey: key }, ctx), allinDecision, 'preflop');
      return {
        street: 'preflop', actions: A, tight, balanced: bal, consensus,
        info: {
          heroKey: key, heroPctile: handPctile(key), pot: pc.pot, call: pc.call,
          required: pc.call > 0 ? pc.call / (pc.pot + pc.call) : null,
          equity, villainPct: villainRange ? rangePct(villainRange) : null,
          spr: null, heroDesc: `${key} · 상위 ${pct(handPctile(key))}`,
        },
      };
    }

    // ── 포스트플랍
    const board = ctx.board || [];
    const need = { flop: 3, turn: 4, river: 5 }[ctx.street];
    if (board.length < need) return { error: `${{ flop: '플랍', turn: '턴', river: '리버' }[ctx.street]} 보드 카드 ${need}장을 선택하세요.` };
    const bd = board.slice(0, need);
    const deadSet = new Set(hero.concat(bd));
    const baseRange = villainLineRange(ctx);
    const vr = rangeCombos(baseRange, deadSet);
    if (!vr.idx.length) return { error: '상대 레인지가 비었습니다. 설정을 확인하세요.' };
    const boards = { flop: bd.slice(0, 3), turn: bd.slice(0, 4), river: bd.slice(0, 5) };
    const classes = {};
    for (const st of ['flop', 'turn', 'river']) {
      if (boards[st].length !== { flop: 3, turn: 4, river: 5 }[st] || boards[st].length > need) continue;
      const arr = new Uint8Array(vr.idx.length);
      for (let i = 0; i < vr.idx.length; i++) { const [a, b] = COMBOS[vr.idx[i]]; arr[i] = analyzeHand(a, b, boards[st]).cls; }
      classes[st] = arr;
    }
    const steps = (ctx.history || []).filter((h) => classes[h.street]);
    const curKey = { check: 'check', bet: 'bet', raise: 'raise', allin: 'allin' }[ctx.curAct];
    const stack = Math.max(0.1, Number(ctx.stack) || ctx.eff);
    const rawCall = ctx.curAct === 'bet' || ctx.curAct === 'raise' || ctx.curAct === 'allin' ? Math.max(0, Number(ctx.call) || 0) : 0;
    // 내 스택을 넘는 상대 벳의 초과분은 돌려받는 돈이라 팟에 넣지 않는다
    const refund = Math.max(0, rawCall - stack);
    const call = rawCall - refund;
    const pot = Math.max(0.5, (Number(ctx.pot) || 0) - refund);
    if (curKey) steps.push({ street: ctx.street, act: curKey, frac: call / Math.max(0.5, pot - call) });
    const eq = comboEquities(hero, bd, vr.idx, hashSeed(key, bd.join(','), ctx.line, ctx.oppPos, ctx.oppType));
    const weights = {
      tight: narrowWeights('tight', vr.w, classes, steps, ctx.oppType),
      balanced: narrowWeights('balanced', vr.w, classes, steps, ctx.oppType),
    };
    // 멀티웨이: 관점별 레인지 가중치로 실제 다자 에퀴티를 샘플링한다
    const N = Math.max(1, Math.min(3, ctx.multiway || 1));
    const mwE = N > 1 ? {
      tight: multiwayEquityMC(hero, bd, vr.idx, weights.tight, N, MW_SAMPLES, hashSeed(key, bd.join(','), 'mw', N)),
      balanced: multiwayEquityMC(hero, bd, vr.idx, weights.balanced, N, MW_SAMPLES, hashSeed(key, bd.join(','), 'mw', N)),
    } : null;
    const heroA = analyzeHand(hero[0], hero[1], bd);
    const tex = boardTexture(bd);
    const ip = typeof ctx.ip === 'boolean' ? ctx.ip : postIdx(ctx.table, ctx.heroPos) > postIdx(ctx.table, ctx.oppPos);
    const pfa = ctx.pfa || LINE_PFA[ctx.line] || 'none';
    const aggressor = ctx.street === 'flop' ? pfa === 'hero' : (ctx.history || []).some((h) => h.street === prevStreet(ctx.street) && h.act === 'call');
    const pc = Object.assign({}, ctx, {
      pot, call, stack, ip, aggressor, stackStart: ctx.eff,
      spr: (stack - call) / Math.max(pot + call, 0.5),
    });
    const actions = buildPostflopActions(pc);
    const curCls = classes[ctx.street];
    // 상대 콤보를 강한 순으로 (클래스 → 같은 클래스 안에서는 내 에퀴티가 낮을수록 강함)
    const order = Array.from(curCls.keys()).sort((i, j) => (CLS_STRENGTH[curCls[j]] - CLS_STRENGTH[curCls[i]]) || (eq[i] - eq[j]));
    const S = { weights, eq, cls: curCls, order, hero: heroA, tex, actions, mwE };
    const tight = postflopExpert('tight', pc, S);
    const bal = postflopExpert('balanced', pc, S);
    const allinDecision = ctx.curAct === 'allin' || actions.some((a, i) => a.kind === 'allin' && (tight.freq[i] > 0.3 || bal.freq[i] > 0.3));
    const consensus = buildConsensus(actions, tight, bal, Object.assign({ heroKey: key, heroCls: heroA.cls }, pc), allinDecision, call > 0 ? 'facing' : 'betting');
    return {
      street: ctx.street, actions, tight, balanced: bal, consensus,
      info: {
        heroKey: key, heroDesc: heroA.desc, heroCls: CLS_NAME[heroA.cls], texture: tex,
        pot, call, required: call > 0 ? Math.min(call, stack) / (pot + Math.min(call, stack)) : null,
        mdf: call > 0 ? Math.max(0, 1 - call / pot) : null,
        spr: pc.spr, ip, aggressor, combos: vr.idx.length,
      },
    };
  }
  const prevStreet = (s) => ({ turn: 'flop', river: 'turn' }[s]);

  // 프리플랍에서 먼저 오픈한 쪽이 먼저 액션하는 자리인지 확인한다
  function spotError(ctx) {
    const opener = ctx.street === 'preflop' ? PF_OPENER[ctx.pfAction] : LINE_OPENER[ctx.line];
    if (!opener) return null;
    const [first, second] = opener === 'hero' ? [ctx.heroPos, ctx.oppPos] : [ctx.oppPos, ctx.heroPos];
    if (preIdx(ctx.table, first) < preIdx(ctx.table, second)) return null;
    const who = opener === 'hero' ? `내(${POS_LABEL[first]})가` : `상대(${POS_LABEL[first]})가`;
    return `${who} 먼저 오픈할 수 없는 자리입니다. 먼저 액션하는 쪽은 ${POS_LABEL[second]}입니다. 포지션이나 ${ctx.street === 'preflop' ? '상대 액션' : '프리플랍 라인'}을 확인하세요.`;
  }

  // 프리플랍 라인별 플랍 팟 추정
  function estimateFlopPot(line, game, raiseSize, heroPos, oppPos, eff) {
    const mtt = game === 'mtt';
    const inHand = [heroPos, oppPos];
    // 핸드에 없는 블라인드와 앤티만 데드머니다. 포지션을 모르면 BB가 콜한 흔한 경우로 본다
    const dead = (heroPos && oppPos ? (inHand.includes('SB') ? 0 : 0.5) + (inHand.includes('BB') ? 0 : 1) : 0.5) + (mtt ? 1 : 0);
    const opener = LINE_OPENER[line] === 'hero' ? heroPos : oppPos;
    const O = Number(raiseSize) || (opener === 'SB' ? (mtt ? 2.5 : 3) : (mtt ? 2.2 : 2.5));
    let each = O;
    if (line === 'hero_3bet_call' || line === 'opp_3bet_call') each = O * (mtt ? 3 : 3.5);
    else if (line === 'hero_4bet_call' || line === 'opp_4bet_call') each = 22;
    else if (line === 'limp') each = 1;
    return 2 * Math.min(each, eff > 0 ? eff : Infinity) + dead;
  }

  // 프리플랍 스팟의 13×13 레인지 (두 전문가). 올인 콜 스팟은 핸드별 에퀴티를 샘플링한다
  const GRID_EQ_SAMPLES = 2500;
  function preflopGrid(input) {
    const ctx = Object.assign({ table: 6, game: 'cash', stage: 'middle', eff: 100, oppType: 'unknown' }, input);
    ctx.table = normTable(ctx.table);
    ctx.eff = Math.max(1, Number(ctx.eff) || 100);
    if (ctx.pfAction === 'none' && ctx.heroPos === 'BB') return null;
    const pc = preflopContext(ctx);
    const out = { tight: {}, balanced: {} };
    // 올인 콜 스팟: 핸드마다 상대 올인 레인지 대비 에퀴티를 샘플링으로 구한다
    const villainRange = ctx.pfAction === 'allin' ? villainPreflopRange(ctx) : null;
    if (ctx.pfAction === 'allin' && !villainRange) return null;
    for (const k of ALL_KEYS) {
      const equity = villainRange ? rangeEquityMC(k, villainRange, GRID_EQ_SAMPLES, hashSeed(k, ctx.oppPos, ctx.oppType, ctx.eff)) : null;
      if (villainRange && equity == null) continue;
      for (const style of ['tight', 'balanced']) out[style][k] = preflopExpert(style, ctx, { key: k, pc, equity, villainRange }).fr;
    }
    if (villainRange) out.allin = true;
    return out;
  }

  // ───────────────────────── 핸드 진행 (자리별 액션 순서) ─────────────────────────
  // 모든 자리의 스택은 유효 스택과 같다고 본다. 사이드팟은 다루지 않는다.
  // log 항목: { street, pos, type, to(이번 스트리트 총 베팅), amt(이번에 넣은 칩), raised, frac(팟 대비 벳), hero }
  const STREET_NEXT = { preflop: 'flop', flop: 'turn', turn: 'river' };
  const postOrder = (table) => POSITIONS[table].slice().sort((a, b) => postIdx(table, a) - postIdx(table, b));
  const round1 = (x) => Math.round(x * 10) / 10;

  function startHand(cfg) {
    const table = normTable(cfg.table);
    const eff = Math.max(1, Number(cfg.eff) || 100);
    const order = POSITIONS[table];
    const players = {};
    for (const pos of order) players[pos] = { pos, stack: eff, bet: 0, inHand: true, allin: false, acted: false };
    const post = (pos, x) => { const p = players[pos], a = Math.min(x, p.stack); p.stack -= a; p.bet = a; };
    post('SB', 0.5); post('BB', 1);
    return {
      table, eff, game: cfg.game === 'mtt' ? 'mtt' : 'cash', heroPos: order.includes(cfg.heroPos) ? cfg.heroPos : 'BTN',
      order, players, street: 'preflop', pot: 1.5 + (cfg.game === 'mtt' ? 1 : 0), cur: 1, minRaise: 1,
      log: [], status: 'playing', toAct: order[0],
    };
  }

  const canAct = (p) => p.inHand && !p.allin;
  const inHandPlayers = (s) => s.order.filter((pos) => s.players[pos].inHand);

  function closeStreet(s) {
    const able = s.order.filter((pos) => canAct(s.players[pos]));
    if (s.street === 'river') { s.status = 'showdown'; s.toAct = null; return; }
    if (able.length <= 1 || s.players[s.heroPos].allin) { s.status = 'runout'; s.toAct = null; return; }
    s.street = STREET_NEXT[s.street];
    s.order = postOrder(s.table);
    s.cur = 0; s.minRaise = 1;
    for (const pos of s.order) { s.players[pos].bet = 0; s.players[pos].acted = false; }
    s.toAct = s.order.find((pos) => canAct(s.players[pos]));
  }

  function nextTurn(s, from) {
    const i0 = s.order.indexOf(from), n = s.order.length;
    for (let i = 1; i <= n; i++) {
      const pos = s.order[(i0 + i) % n], p = s.players[pos];
      if (canAct(p) && (!p.acted || p.bet < s.cur)) { s.toAct = pos; return; }
    }
    closeStreet(s);
  }

  // a = { type: 'fold'|'check'|'call'|'bet'|'raise'|'allin', to }. 규칙에 어긋난 액션과 금액은 가장 가까운 합법 액션으로 고친다
  function applyAction(s, a) {
    if (s.status !== 'playing') return s;
    const pos = s.toAct, p = s.players[pos], hero = pos === s.heroPos;
    const toCall = Math.max(0, s.cur - p.bet);
    const entry = { street: s.street, pos, hero, type: a.type, to: p.bet, amt: 0, raised: false, frac: 0 };
    const put = (x) => { const amt = Math.min(x, p.stack); p.stack = round1(p.stack - amt); p.bet = round1(p.bet + amt); s.pot = round1(s.pot + amt); entry.amt = amt; entry.to = p.bet; if (p.stack <= 0) p.allin = true; };
    let type = a.type;
    if (type === 'fold' && toCall === 0) type = 'check';
    if (type === 'check' && toCall > 0) type = 'call';
    if (type === 'allin') {
      const total = p.bet + p.stack;
      type = total > s.cur ? (s.cur === 0 ? 'bet' : 'raise') : 'call';
      a = { to: total };
    }
    if (type === 'bet' || type === 'raise') {
      const potBefore = s.pot;
      const to = Math.min(p.bet + p.stack, Math.max(Number(a.to) || 0, s.cur + s.minRaise));
      if (to <= s.cur) type = 'call';
      else {
        const by = to - s.cur;
        put(to - p.bet);
        if (by >= s.minRaise) s.minRaise = by;
        s.cur = p.bet;
        entry.raised = true;
        entry.frac = potBefore > 0 ? entry.amt / potBefore : 0;
        for (const q of s.order) if (q !== pos) s.players[q].acted = false;
      }
    }
    if (type === 'call') put(toCall);
    if (type === 'fold') p.inHand = false;
    p.acted = true;
    entry.type = p.allin && type !== 'fold' ? 'allin' : (type === 'raise' && s.cur === p.bet && s.street !== 'preflop' && entry.frac && s.log.every((e) => e.street !== s.street || !e.raised) ? 'bet' : type);
    s.log.push(entry);
    const left = inHandPlayers(s);
    if (hero && type === 'fold') { s.status = 'hero_folded'; s.toAct = null; return s; }
    if (left.length === 1) { s.status = 'won'; s.toAct = null; return s; }
    nextTurn(s, pos);
    return s;
  }

  function replayHand(cfg, actions) {
    const s = startHand(cfg);
    for (const a of actions || []) applyAction(s, a);
    return s;
  }

  // 현재 차례에게 보여 줄 선택지. 레이즈 사이즈는 총 베팅 금액(to) 기준
  function flowOptions(s) {
    if (s.status !== 'playing') return null;
    const p = s.players[s.toAct];
    const toCall = Math.max(0, s.cur - p.bet);
    const max = round1(p.bet + p.stack);
    const min = round1(s.cur + s.minRaise);
    const othersCanRespond = s.order.some((pos) => pos !== s.toAct && canAct(s.players[pos]));
    const canRaise = max > s.cur && othersCanRespond;
    const raises = s.log.filter((e) => e.street === s.street && e.raised).length;
    let sizes = [];
    if (canRaise) {
      if (s.street === 'preflop' && raises === 0) {
        const limps = s.log.filter((e) => e.type === 'call').length;
        sizes = [2, 2.5, 3].map((x) => ({ to: x + limps, label: bb(x + limps) }));
      } else if (s.street === 'preflop') sizes = [2.5, 3, 4].map((x) => ({ to: round1(s.cur * x), label: `${x}배 ${bb(s.cur * x)}` }));
      else if (s.cur === 0) sizes = [33, 50, 75, 100, 150].map((x) => ({ to: round1(s.pot * x / 100), label: `${x}%` }));
      else sizes = [2.5, 3].map((x) => ({ to: round1(s.cur * x), label: `${x}배 ${bb(s.cur * x)}` })).concat([{ to: round1(s.cur + s.pot + toCall), label: `팟 ${bb(s.cur + s.pot + toCall)}` }]);
      sizes = sizes.filter((x) => x.to >= min && x.to < max);
    }
    return { pos: s.toAct, hero: s.toAct === s.heroPos, toCall: Math.min(toCall, p.stack), canCheck: toCall === 0, canRaise, raiseType: s.cur === 0 ? 'bet' : 'raise', min: Math.min(min, max), max, sizes };
  }

  // 지금이 내 차례일 때 진행 상태를 analyze 입력으로 바꾼다 (oppType·hero·board·stage 는 호출하는 쪽이 넣는다)
  function flowContext(s) {
    const hero = s.players[s.heroPos];
    const toCall = Math.max(0, s.cur - hero.bet);
    const base = { flow: true, game: s.game, table: s.table, eff: s.eff, heroPos: s.heroPos, street: s.street };
    const pre = s.log.filter((e) => e.street === 'preflop');
    const raises = pre.filter((e) => e.raised);
    const lastR = raises[raises.length - 1];
    if (s.street === 'preflop') {
      const firstRaiseAt = raises.length ? pre.indexOf(raises[0]) : pre.length;
      const limps = pre.slice(0, firstRaiseAt).filter((e) => e.type === 'call');
      const n = raises.length;
      let pfAction, oppPos;
      if (!lastR) { pfAction = limps.length ? 'limp' : 'none'; oppPos = limps.length ? limps[0].pos : (s.heroPos === 'BB' ? 'SB' : 'BB'); }
      else { oppPos = lastR.pos; pfAction = lastR.type === 'allin' ? 'allin' : n === 1 ? 'open' : n === 2 ? '3bet' : '4bet'; }
      const heroRaises = raises.filter((e) => e.hero);
      const heroLast = heroRaises[heroRaises.length - 1];
      return Object.assign(base, {
        pfAction, oppPos, raiseSize: lastR ? lastR.to : 0, heroOpen: heroLast ? heroLast.to : 0, limpers: limps.length,
        cold: n >= 2 && !(heroLast && raises[n - 2] === heroLast),
        callers: lastR ? pre.slice(pre.indexOf(lastR)).filter((e) => e.type === 'call' && !e.hero).length : 0,
        openerPos: raises.length ? raises[0].pos : null,
        potOverride: s.pot, callOverride: toCall, heroInOverride: hero.bet,
      });
    }
    const others = inHandPlayers(s).filter((pos) => pos !== s.heroPos);
    const cur = s.log.filter((e) => e.street === s.street);
    const curAgg = cur.filter((e) => e.raised && !e.hero).pop();
    const lastCaller = pre.filter((e) => !e.hero && others.includes(e.pos)).pop();
    const oppPos = curAgg ? curAgg.pos : lastR && others.includes(lastR.pos) ? lastR.pos : lastCaller ? lastCaller.pos : others[others.length - 1];
    const tier = raises.length <= 1 ? 'open' : raises.length === 2 ? '3bet' : '4bet';
    const line = !raises.length ? 'limp' : `${lastR.pos === oppPos ? 'opp' : 'hero'}_${tier}_call`;
    const facingAgg = cur.filter((e) => e.raised).pop();
    const curAct = toCall > 0 ? (facingAgg && facingAgg.type === 'allin' ? 'allin' : hero.bet > 0 ? 'raise' : 'bet') : cur.length ? 'check' : 'first';
    return Object.assign(base, {
      oppPos, line, curAct, pot: s.pot, call: toCall, stack: hero.stack,
      pfa: !raises.length ? 'none' : lastR.hero ? 'hero' : 'opp',
      ip: others.every((pos) => postIdx(s.table, s.heroPos) > postIdx(s.table, pos)),
      multiway: Math.min(3, others.length),
      history: s.log.filter((e) => e.street !== 'preflop' && e.street !== s.street && e.pos === oppPos).map((e) => ({ street: e.street, act: e.type, frac: e.frac })),
    });
  }

  // 프리플랍 분석 결과 → 플레이해도 되는 핸드인지 (합의 빈도 기준: 70% 이상 플레이, 30% 미만 폴드, 그 사이는 경계)
  function playVerdict(res) {
    if (!res || !res.actions) return null;
    const i = res.actions.findIndex((a) => a.kind === 'fold');
    const play = 1 - (i >= 0 ? res.consensus.freq[i] : 0);
    const level = play >= 0.7 ? 'play' : play >= 0.3 ? 'mixed' : 'fold';
    return { play, level, label: { play: '플레이', mixed: '경계 — 빈도로 섞음', fold: '폴드' }[level] };
  }

  // ───────────────────────── 연습 모드 ─────────────────────────
  // 무작위 카드와 상대 액션으로 핸드를 진행하다가, 정해진 스트리트의 내 차례에서 멈춘다.
  // 상대는 카드를 보지 않는 확률 정책으로 움직이고, 그 전 내 결정은 합의 추천을 따른다.
  const cardStr = (c) => RANKS[c >> 2] + SUITS[c & 3];
  function pickW(rand, items) { // [[값, 가중치]...]
    let t = 0; for (const [, w] of items) t += w;
    let x = rand() * t;
    for (const [v, w] of items) { x -= w; if (x <= 0) return v; }
    return items[items.length - 1][0];
  }
  function practiceOppAction(s, rand) {
    const o = flowOptions(s);
    const raises = s.log.filter((e) => e.street === s.street && e.raised).length;
    const size = (i) => (o.sizes[i] || o.sizes[o.sizes.length - 1] || {}).to;
    // 이미 다른 상대가 팟에 들어와 있으면 대부분 폴드해서 헤즈업 위주로 만든다
    const inPot = s.order.filter((p) => p !== s.toAct && p !== s.heroPos && s.players[p].inHand && (s.players[p].bet > (p === 'BB' ? 1 : p === 'SB' ? 0.5 : 0) || s.street !== 'preflop')).length;
    if (s.street === 'preflop') {
      if (raises === 0) {
        const pick = pickW(rand, [['fold', inPot ? 9 : 76], ['raise', 20], ['call', s.toAct === 'SB' ? 6 : 1]]);
        if (pick === 'raise' && o.canRaise) return { type: 'raise', to: size(1) };
        return { type: pick === 'call' ? 'call' : 'fold' };
      }
      const facingHero = s.log.filter((e) => e.raised).pop().hero;
      const w = raises === 1 ? [['fold', facingHero ? 55 : 80], ['call', 30], ['raise', 12]]
        : raises === 2 ? [['fold', 45], ['call', 38], ['raise', 14], ['allin', 3]]
          : [['fold', 50], ['call', 28], ['allin', 22]];
      const pick = pickW(rand, inPot && !facingHero ? [['fold', 1]] : w);
      if (pick === 'raise' && o.canRaise) return { type: 'raise', to: size(raises === 1 ? 1 : 0) };
      if (pick === 'allin') return { type: 'allin' };
      return { type: pick === 'raise' ? 'call' : pick };
    }
    if (o.canCheck) {
      const pick = pickW(rand, [['check', 52], ['b33', 18], ['b50', 16], ['b75', 10], ['b100', 4]]);
      if (pick === 'check' || !o.canRaise) return { type: 'check' };
      const pctMap = { b33: 0.33, b50: 0.5, b75: 0.75, b100: 1 };
      const to = round1(s.pot * pctMap[pick]);
      return to >= o.max * 0.85 ? { type: 'allin' } : { type: 'bet', to: Math.max(o.min, to) };
    }
    const pick = pickW(rand, [['fold', 32], ['call', 55], ['raise', o.canRaise ? 13 : 0]]);
    if (pick === 'raise') return { type: 'raise', to: size(0) || o.max };
    return { type: pick };
  }
  // 합의 액션 → 진행 액션 (앱의 빈도 버튼과 같은 규칙)
  function flowActionFor(s, a) {
    const o = flowOptions(s);
    if (a.kind === 'fold') return { type: 'fold' };
    if (a.kind === 'check' || a.kind === 'call') return { type: o.canCheck ? 'check' : 'call' };
    if (a.kind === 'allin') return { type: 'allin' };
    return { type: o.raiseType, to: (s.street === 'preflop' ? 0 : s.players[s.heroPos].bet) + (a.amount || o.min) };
  }
  function practiceHand(cfg, seed) {
    const rand = rng(seed >>> 0);
    const table = normTable(cfg.table), streets = cfg.streets && cfg.streets.length ? cfg.streets : ['preflop', 'flop', 'turn', 'river'];
    const extra = { stage: cfg.stage || 'middle', oppType: cfg.oppType || 'unknown' };
    for (let tries = 0; tries < 60; tries++) {
      const target = streets[(rand() * streets.length) | 0];
      const heroPos = cfg.heroPos || POSITIONS[table][(rand() * POSITIONS[table].length) | 0];
      // 내 카드: 포스트플랍 문제는 플레이할 만한 상위 핸드에서 뽑아 프리플랍 폴드로 끝나는 일을 줄인다
      const deck = Array.from({ length: 52 }, (_, i) => i);
      for (let i = 51; i > 0; i--) { const j = (rand() * (i + 1)) | 0; [deck[i], deck[j]] = [deck[j], deck[i]]; }
      let hero = deck.slice(0, 2);
      if (target !== 'preflop' || rand() < 0.5) {
        const top = topPercent(target === 'preflop' ? 0.4 : 0.3);
        const vr = rangeCombos(top, new Set());
        let t = 0; for (const w of vr.w) t += w;
        let x = rand() * t, k = 0;
        for (; k < vr.w.length - 1; k++) { x -= vr.w[k]; if (x <= 0) break; }
        hero = COMBOS[vr.idx[k]].slice();
      }
      const rest = deck.filter((c) => c !== hero[0] && c !== hero[1]);
      const board = rest.slice(0, 5);
      const hand = { table, eff: cfg.eff || 100, game: cfg.game === 'mtt' ? 'mtt' : 'cash', heroPos };
      const s = startHand(hand), acts = [];
      let ok = false;
      for (let step = 0; step < 80 && s.status === 'playing'; step++) {
        if (s.toAct === s.heroPos) {
          if (s.street === target) { ok = true; break; }
          const ctx = Object.assign(flowContext(s), extra, { hero, board: board.slice(0, { preflop: 0, flop: 3, turn: 4, river: 5 }[s.street]) });
          const r = analyze(ctx);
          if (!r || r.error || !r.actions) break;
          const a = flowActionFor(s, r.actions[r.consensus.top]);
          applyAction(s, a); acts.push(a);
        } else {
          const a = practiceOppAction(s, rand);
          applyAction(s, a); acts.push(a);
        }
      }
      if (!ok) continue;
      const ctx = Object.assign(flowContext(s), extra, { hero, board: board.slice(0, { preflop: 0, flop: 3, turn: 4, river: 5 }[s.street]) });
      const res = analyze(ctx);
      if (!res || res.error || res.walk || !res.actions) continue;
      return { cfg: hand, acts, hero: hero.map(cardStr), board: board.map(cardStr), street: s.street, state: s, ctx, res };
    }
    return null;
  }
  // 고른 액션 채점: 합의 빈도와 균형형 EV 차이로 정답·혼합·실수를 나눈다
  function gradeChoice(res, i) {
    const f = res.consensus.freq, top = res.consensus.top;
    const mine = f[i] || 0, best = f[top] || 0;
    const evs = res.balanced.evs;
    const loss = Array.isArray(evs) && evs.length === f.length && Number.isFinite(evs[i]) && Number.isFinite(evs[top]) ? Math.max(0, evs[top] - evs[i]) : null; // 합의 추천 액션 대비
    const level = i === top || mine >= 0.35 || mine >= best * 0.6 ? 'good' : mine >= 0.1 ? 'mixed' : 'bad';
    return { level, mine, best, top, loss };
  }

  const api = {
    RANKS, SUITS, SUIT_SYM, parseCard, parseCards, cardText, evaluate, keyOf, GRID, ALL_KEYS,
    playVerdict, startHand, applyAction, replayHand, flowOptions, flowContext,
    parseRange, rangePct, topPercent, analyzeHand, boardTexture, comboEquities, rangeCombos,
    CHARTS, POSITIONS, POS_LABEL, OPP_TYPES, STAGE_LABEL, LENS, analyze, estimateFlopPot,
    rfiRange, vsOpenChart, handPctile, RANK_LIST, preflopGrid, FOURBET_POT_RANGE, FOURBET_CALL_RANGE, multiwayEquityMC, rangeEquityMC, practiceHand, gradeChoice, flowActionFor,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.HoldemEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
