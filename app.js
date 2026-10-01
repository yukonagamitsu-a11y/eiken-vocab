'use strict';
/* 英検準1級 単語アプリ */
const KEY = 'eiken-vocab-v1';
const API = 'https://api.dictionaryapi.dev/api/v2/entries/en/';
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const dstr = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const today = () => dstr(new Date());
const yesterday = () => { const d = new Date(); d.setDate(d.getDate() - 1); return dstr(d); };
const STATUS = { new: '新規', learning: '学習中', master: 'マスター' };

/* ---------- データ ---------- */
function defaults() { return { words: [], points: 0, studyDays: { last: null, count: 0 }, best: { timeattack: 0 }, settings: { sound: true } }; }
function normStats(s) {
  s = s || {};
  const st = ['new', 'learning', 'master'].includes(s.status) ? s.status : 'new';
  return { right: +s.right || 0, wrong: +s.wrong || 0, streak: +s.streak || 0, status: st, last: +s.last || 0 };
}
function normalize(d) {
  const o = defaults();
  if (!d || !Array.isArray(d.words)) return o;
  o.words = d.words.filter(w => w && typeof w.word === 'string' && Array.isArray(w.meanings)).map(w => ({
    id: w.id || uid(), word: w.word, addedAt: +w.addedAt || Date.now(),
    meanings: w.meanings.filter(m => m && m.ja).map(m => ({
      id: m.id || uid(), pos: m.pos || '', def: m.def || '', example: m.example || '', ja: String(m.ja), stats: normStats(m.stats)
    }))
  })).filter(w => w.meanings.length);
  o.points = +d.points || 0;
  if (d.studyDays) o.studyDays = { last: d.studyDays.last || null, count: +d.studyDays.count || 0 };
  if (d.best) o.best = { timeattack: +d.best.timeattack || 0 };
  if (d.settings) o.settings.sound = d.settings.sound !== false;
  return o;
}
function load() { try { return normalize(JSON.parse(localStorage.getItem(KEY))); } catch (e) { return defaults(); } }
let S = load();
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { toast('保存できませんでした'); } }

const wordStatus = w => {
  const ms = w.meanings;
  if (ms.every(m => m.stats.status === 'master')) return 'master';
  if (ms.every(m => m.stats.status === 'new')) return 'new';
  return 'learning';
};
const wrongCount = w => w.meanings.reduce((a, m) => a + m.stats.wrong, 0);
const units = () => { const u = []; S.words.forEach(w => w.meanings.forEach(m => u.push({ w, m }))); return u; };
const level = p => Math.floor(p / 100) + 1;
const streakDays = () => (S.studyDays.last === today() || S.studyDays.last === yesterday()) ? S.studyDays.count : 0;
function touchStudy() {
  const t = today();
  if (S.studyDays.last === t) return;
  S.studyDays.count = S.studyDays.last === yesterday() ? S.studyDays.count + 1 : 1;
  S.studyDays.last = t;
}

/* ---------- UI部品 ---------- */
let toastT;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2200);
}
let ac;
function beep(type) {
  if (!S.settings.sound) return;
  try {
    ac = ac || new (window.AudioContext || window.webkitAudioContext)();
    const seqs = { ok: [[660, 0], [880, .1]], ng: [[220, 0], [160, .12]], lv: [[523, 0], [659, .1], [784, .2], [1046, .3]] };
    (seqs[type] || []).forEach(([f, t]) => {
      const o = ac.createOscillator(), g = ac.createGain(), n = ac.currentTime + t;
      o.type = type === 'ng' ? 'sawtooth' : 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(.15, n); g.gain.exponentialRampToValueAtTime(.001, n + .15);
      o.connect(g); g.connect(ac.destination); o.start(n); o.stop(n + .16);
    });
  } catch (e) { }
}
function speak(w) {
  try {
    if (!window.speechSynthesis) return toast('この端末は読み上げに対応していません');
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(w); u.lang = 'en-US'; u.rate = .9; speechSynthesis.speak(u);
  } catch (e) { }
}
function confirmBox(msg, ok = 'OK', danger = false, cancel = 'キャンセル') {
  return new Promise(res => {
    const m = document.createElement('div'); m.className = 'modal';
    m.innerHTML = `<div class="box"><p style="margin:0 0 18px;font-weight:700">${esc(msg)}</p><div class="row"><button class="btn ghost" data-r="0">${esc(cancel)}</button><button class="btn ${danger ? 'danger' : ''}" data-r="1">${esc(ok)}</button></div></div>`;
    m.addEventListener('click', e => { const b = e.target.closest('[data-r]'); if (!b) return; m.remove(); res(b.dataset.r === '1'); });
    document.body.appendChild(m);
  });
}

/* ---------- 画面状態 ---------- */
let tab = 'home', G = null, scope = 'all';
let R = newR(), BK = { q: '', sort: 'added' };
function newR() { return { word: '', searched: false, loading: false, msg: '', msgType: '', items: [], dup: false }; }

function go(t) {
  if (G) endGame();
  tab = t; render(); window.scrollTo(0, 0);
}
function render() {
  document.body.classList.toggle('playing', !!G && tab === 'game');
  document.body.classList.toggle('nofx', !S.settings.sound);
  document.querySelectorAll('#tabbar button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  const v = $('#view');
  ({ home: renderHome, register: renderRegister, book: renderBook, game: renderGame, settings: renderSettings }[tab])(v);
}

/* ---------- ホーム ---------- */
function renderHome(v) {
  const lv = level(S.points), prog = S.points % 100;
  const mastered = S.words.filter(w => wordStatus(w) === 'master').length;
  v.innerHTML = `
  <h2>📚 英検準1級 単語</h2>
  <div class="hero"><div class="lv">レベル</div><div class="big">Lv.${lv}</div>
    <div class="bar"><i style="width:${prog}%"></i></div>
    <div class="lv" style="margin-top:6px">次のレベルまで ${100 - prog} pt</div></div>
  <div class="stats">
    <div class="stat"><b>${S.words.length}</b><small>登録単語</small></div>
    <div class="stat"><b>${mastered}</b><small>マスター</small></div>
    <div class="stat"><b>${streakDays()}</b><small>🔥連続日数</small></div>
  </div>
  <button class="btn pink" data-act="go" data-tab="game">🎮 ゲームを始める</button>
  <div class="gap"></div>
  <button class="btn ghost" data-act="go" data-tab="register">✏️ 単語を登録する</button>
  ${S.best.timeattack ? `<p class="center muted">⏱ タイムアタック ハイスコア：${S.best.timeattack}問</p>` : ''}
  ${S.words.length ? '' : '<div class="msg info" style="margin-top:14px">まず「登録」で単語を調べて、日本語の意味を入れてみよう！</div>'}`;
}

/* ---------- 単語登録 ---------- */
function renderRegister(v) {
  const w = R.word.trim();
  const dictCards = R.items.map((it, i) => it.manual ? '' : `
    <div class="dcard ${it.checked ? 'on' : ''}" data-card="${i}">
      <label><input type="checkbox" data-act="toggle" data-i="${i}" ${it.checked ? 'checked' : ''}>
        <div><span class="pos">${esc(it.pos)}</span><div class="def">${esc(it.def)}</div>${it.example ? `<div class="ex">"${esc(it.example)}"</div>` : ''}</div></label>
      <div class="ja"><input data-f="ja" data-i="${i}" placeholder="日本語の意味（必須）" value="${esc(it.ja)}"></div>
    </div>`).join('');
  const manualCards = R.items.map((it, i) => !it.manual ? '' : `
    <div class="dcard on">
      <div class="pos">✍️ 自分で入力</div>
      <input data-f="ja" data-i="${i}" placeholder="日本語の意味（必須）" value="${esc(it.ja)}" style="margin-top:6px">
      <input data-f="example" data-i="${i}" placeholder="例文（任意・英語）" value="${esc(it.example)}" style="margin-top:8px">
      <button class="btn ghost sm" data-act="rmManual" data-i="${i}" style="margin-top:8px">この入力を消す</button>
    </div>`).join('');
  v.innerHTML = `
  <h2>✏️ 単語を登録</h2>
  <form id="regForm" class="row" style="gap:8px;align-items:stretch">
    <input id="wordIn" placeholder="英単語を入力" autocapitalize="none" autocorrect="off" spellcheck="false" value="${esc(R.word)}" style="flex:1">
    <button class="btn" style="width:auto;flex:none;min-height:48px" ${R.loading ? 'disabled' : ''}>${R.loading ? '…' : '調べる'}</button>
  </form>
  ${R.loading ? '<p class="center muted">辞書を検索中…</p>' : ''}
  ${R.msg ? `<div class="msg ${R.msgType}">${esc(R.msg)}</div>` : ''}
  ${R.searched ? `
    <div class="links">
      <a class="btn ghost sm" target="_blank" rel="noopener" href="https://ejje.weblio.jp/content/${encodeURIComponent(w)}">Weblioで見る</a>
      <a class="btn ghost sm" target="_blank" rel="noopener" href="https://eow.alc.co.jp/search?q=${encodeURIComponent(w)}">英辞郎で見る</a>
    </div>
    <p class="muted" style="margin:0 0 10px">覚えたい意味にチェックして、日本語の意味を入れよう（複数OK）</p>
    ${dictCards}${manualCards}
    <button class="btn ghost" data-act="addManual">＋ 自分で意味を追加</button>
    <div class="gap"></div>
    <button class="btn mint" data-act="saveWord">💾 保存</button>` : ''}`;
}
async function doSearch() {
  const word = R.word.trim();
  if (!/^[A-Za-z][A-Za-z' -]*$/.test(word)) return toast('英単語を入力してください');
  const exist = S.words.find(x => x.word.toLowerCase() === word.toLowerCase());
  R.dup = !!exist;
  if (exist && !await confirmBox('登録済みです。意味を追加しますか？', '追加する')) return;
  R.loading = true; R.msg = ''; R.searched = false; R.items = []; renderRegister($('#view'));
  const res = await lookup(word);
  R.loading = false; R.searched = true;
  const have = exist ? exist.meanings.map(m => m.def).filter(Boolean) : [];
  if (res.items) {
    R.items = res.items.filter(i => !have.includes(i.def));
    R.msg = res.items.length && !R.items.length ? 'この単語の辞書の意味はすべて登録済みです。自分で意味を追加できます。' : '';
    R.msgType = 'info';
    if (!R.items.length) R.items = [blankManual()];
  } else {
    R.items = [blankManual()]; R.msgType = '';
    R.msg = res.notFound ? '見つかりませんでした。日本語の意味と例文を自分で入力してね（手動入力モード）' : '辞書につながりませんでした（オフラインかも）。自分で入力して登録できます（手動入力モード）';
  }
  if (tab === 'register') renderRegister($('#view'));
}
const blankManual = () => ({ manual: true, checked: true, pos: '', def: '', example: '', ja: '' });
async function lookup(word) {
  if (!navigator.onLine) return { error: true };
  const c = new AbortController(), t = setTimeout(() => c.abort(), 8000);
  try {
    const r = await fetch(API + encodeURIComponent(word.toLowerCase()), { signal: c.signal });
    if (r.status === 404) return { notFound: true };
    if (!r.ok) return { error: true };
    const data = await r.json(), items = [], seen = new Set();
    (Array.isArray(data) ? data : []).forEach(e => (e.meanings || []).forEach(m => {
      let n = 0;
      (m.definitions || []).forEach(d => {
        if (n >= 3 || items.length >= 12 || !d.definition || seen.has(d.definition)) return;
        seen.add(d.definition); n++;
        items.push({ manual: false, checked: false, pos: m.partOfSpeech || '', def: d.definition, example: d.example || '', ja: '' });
      });
    }));
    return items.length ? { items } : { notFound: true };
  } catch (e) { return { error: true }; } finally { clearTimeout(t); }
}
function saveWord() {
  const chosen = R.items.filter(i => i.checked);
  if (!chosen.length) return toast('覚えたい意味にチェックしてね');
  let bad = false;
  R.items.forEach((it, i) => {
    const el = document.querySelector(`input[data-f=ja][data-i="${i}"]`);
    const miss = it.checked && !it.ja.trim();
    if (el) el.classList.toggle('err', miss);
    if (miss) bad = true;
  });
  if (bad) return toast('日本語の意味を入力してね');
  const word = R.word.trim();
  let w = S.words.find(x => x.word.toLowerCase() === word.toLowerCase());
  if (!w) { w = { id: uid(), word, addedAt: Date.now(), meanings: [] }; S.words.push(w); }
  chosen.forEach(it => w.meanings.push({
    id: uid(), pos: it.pos, def: it.def, example: it.example.trim(), ja: it.ja.trim(), stats: normStats()
  }));
  save(); R = newR(); toast('保存しました 🎉'); renderRegister($('#view')); window.scrollTo(0, 0);
}

/* ---------- 単語帳 ---------- */
function renderBook(v) {
  v.innerHTML = `
  <h2>📖 単語帳</h2>
  <input id="bkSearch" placeholder="🔍 検索（英語・日本語）" value="${esc(BK.q)}">
  <div class="gap"></div>
  <select id="bkSort"><option value="added">並び替え：登録日（新しい順）</option><option value="status">並び替え：ステータス</option><option value="weak">並び替え：苦手順</option></select>
  <div class="gap"></div><div id="bkList"></div>`;
  $('#bkSort').value = BK.sort;
  renderList();
}
function renderList() {
  const q = BK.q.trim().toLowerCase();
  let ws = S.words.filter(w => !q || w.word.toLowerCase().includes(q) || w.meanings.some(m => m.ja.toLowerCase().includes(q)));
  const ord = { new: 0, learning: 1, master: 2 };
  if (BK.sort === 'added') ws.sort((a, b) => b.addedAt - a.addedAt);
  else if (BK.sort === 'status') ws.sort((a, b) => ord[wordStatus(a)] - ord[wordStatus(b)] || a.word.localeCompare(b.word));
  else ws.sort((a, b) => wrongCount(b) - wrongCount(a) || b.addedAt - a.addedAt);
  $('#bkList').innerHTML = ws.length ? ws.map(w => {
    const st = wordStatus(w);
    return `<button class="wi" data-act="open" data-id="${w.id}"><div class="t"><div class="w">${esc(w.word)}</div><div class="m">${esc(w.meanings.map(m => m.ja).join(' / '))}</div></div><span class="badge ${st}">${STATUS[st]}</span></button>`;
  }).join('') : `<p class="center muted">${S.words.length ? '見つかりませんでした' : 'まだ単語がありません。「登録」から追加しよう'}</p>`;
}
function openDetail(id) {
  const w = S.words.find(x => x.id === id); if (!w) return closeSheet();
  let sh = $('#sheet');
  if (!sh) { sh = document.createElement('div'); sh.id = 'sheet'; sh.className = 'sheet'; document.body.appendChild(sh); }
  sh.dataset.id = id;
  sh.innerHTML = `<div>
    <div class="row" style="align-items:center;margin-bottom:10px"><button class="btn ghost sm" data-act="closeSheet" style="flex:none">← 戻る</button><span></span></div>
    <div class="row" style="align-items:center;gap:12px;margin-bottom:8px"><h2 style="margin:0;flex:1;word-break:break-word">${esc(w.word)}</h2><button class="spk" data-act="speak" data-w="${esc(w.word)}" style="margin:0;flex:none">🔊</button></div>
    ${w.meanings.map(m => `<div class="card mk">
      <span class="badge ${m.stats.status}">${STATUS[m.stats.status]}</span> <span class="muted">⭕${m.stats.right} ❌${m.stats.wrong}</span>
      ${m.def ? `<div style="margin:6px 0"><span class="pos">${esc(m.pos)}</span> <span class="def">${esc(m.def)}</span></div>` : ''}
      <div class="muted" style="margin-top:6px">日本語の意味</div>
      <input data-edit="ja" data-mid="${m.id}" value="${esc(m.ja)}">
      <div class="muted" style="margin-top:6px">例文</div>
      <input data-edit="example" data-mid="${m.id}" value="${esc(m.example)}" placeholder="（なし）">
      <button class="btn ghost sm" data-act="delMeaning" data-mid="${m.id}" style="margin-top:10px">この意味を削除</button>
    </div>`).join('')}
    <button class="btn danger" data-act="delWord">🗑 この単語を削除</button></div>`;
}
function closeSheet() { const s = $('#sheet'); if (s) s.remove(); if (tab === 'book') renderList(); }

/* ---------- ゲーム ---------- */
function weight(m) {
  const s = m.stats;
  if (s.status === 'master') return .3;
  if (s.status === 'new') return 3;
  const t = s.right + s.wrong;
  return 2 + (t ? s.wrong / t : 0) * 4 + (s.wrong > 0 ? 1 : 0);
}
function pick(pool, n) {
  const p = pool.slice(), out = [];
  while (out.length < n && p.length) {
    let r = Math.random() * p.reduce((a, u) => a + weight(u.m), 0), i = 0;
    for (; i < p.length; i++) { r -= weight(p[i].m); if (r <= 0) break; }
    out.push(p.splice(Math.min(i, p.length - 1), 1)[0]);
  }
  return out;
}
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
function scopePool() {
  const u = units();
  return scope === 'weak' ? u.filter(x => x.m.stats.status === 'learning') : scope === 'new' ? u.filter(x => x.m.stats.status === 'new') : u;
}
function makeQ(u) {
  const seen = new Set([u.m.ja]), opts = [];
  shuffle(units().filter(x => x.w.id !== u.w.id)).forEach(x => { if (opts.length < 3 && !seen.has(x.m.ja)) { seen.add(x.m.ja); opts.push({ t: x.m.ja, ok: false }); } });
  if (opts.length < 3) return null;
  opts.push({ t: u.m.ja, ok: true });
  return { u, opts: shuffle(opts), done: false, sel: -1 };
}
function startGame(mode) {
  const pool = scopePool();
  if (!pool.length) return toast(scope === 'weak' ? '苦手な単語はまだありません' : scope === 'new' ? '新規の単語はありません' : '単語を登録してね');
  if (mode !== 'flash' && new Set(S.words.map(w => w.id)).size < 4) return toast('4択は4単語以上登録すると遊べます');
  G = { mode, id: uid(), phase: 'play', i: 0, correct: 0, combo: 0, maxCombo: 0, pts: 0, total: 0, wrong: [], lv0: level(S.points), flipped: false, q: null };
  if (mode === 'time') {
    G.pool = pool; G.end = Date.now() + 60000; G.q = nextTimeQ();
    if (!G.q) { G = null; return toast('出題できる単語が足りません'); }
    G.timer = setInterval(tick, 100);
  } else {
    G.queue = pick(pool, 10);
    if (mode === 'quiz') { G.queue = G.queue.filter(u => makeQ(u)); if (!G.queue.length) { G = null; return toast('出題できる単語が足りません'); } G.q = makeQ(G.queue[0]); }
  }
  render();
}
function nextTimeQ(prev) {
  for (let k = 0; k < 8; k++) {
    const u = pick(G.pool, 1)[0], q = u && makeQ(u);
    if (q && !(prev && G.pool.length > 1 && u.m.id === prev.u.m.id)) return q;
  }
  return null;
}
function endGame() { if (G && G.timer) clearInterval(G.timer); G = null; }
function record(u, ok) {
  const s = u.m.stats; touchStudy();
  if (ok) {
    s.right++; s.streak++; s.status = s.streak >= 3 ? 'master' : 'learning';
    G.combo++; G.maxCombo = Math.max(G.maxCombo, G.combo); G.correct++;
    G.pts += 10 + Math.min(G.combo - 1, 5) * 2;
    beep('ok');
  } else {
    s.wrong++; s.streak = 0; s.status = 'learning'; G.combo = 0; G.wrong.push(u); beep('ng');
  }
  G.total++; s.last = Date.now(); save();
}
function finish() {
  if (G.timer) clearInterval(G.timer);
  S.points += G.pts;
  G.lv1 = level(S.points);
  if (G.mode === 'time' && G.correct > S.best.timeattack) { S.best.timeattack = G.correct; G.newBest = true; }
  if (G.lv1 > G.lv0) beep('lv');
  save(); G.phase = 'result'; render();
}
function tick() {
  if (!G || G.mode !== 'time' || G.phase !== 'play') return;
  const left = G.end - Date.now();
  if (left <= 0) return finish();
  const b = $('#tbar'), n = $('#tnum');
  if (b) b.style.width = (left / 600) + '%';
  if (n) n.textContent = Math.ceil(left / 1000);
}
const gname = { flash: 'フラッシュカード', quiz: '4択クイズ', time: 'タイムアタック' };

function renderGame(v) {
  if (!G) return renderGameMenu(v);
  if (G.phase === 'result') return renderResult(v);
  const head = G.mode === 'time'
    ? `<div class="prog time"><i id="tbar" style="width:${Math.max(0, (G.end - Date.now()) / 600)}%"></i></div><div class="gnum" id="tnum">${Math.max(0, Math.ceil((G.end - Date.now()) / 1000))}</div>`
    : `<div class="prog"><i style="width:${G.i / G.queue.length * 100}%"></i></div><div class="gnum">${Math.min(G.i + 1, G.queue.length)}/${G.queue.length}</div>`;
  const top = `<div class="ghead"><button class="q" data-act="quit">✕</button>${head}</div>
    <div class="row" style="align-items:center"><div class="combo">${G.combo >= 2 ? `<b>🔥 ${G.combo} COMBO!</b>` : ''}</div><div class="pts" style="text-align:right;flex:none">${G.pts} pt${G.mode === 'time' ? ` ・ ⭕${G.correct}` : ''}</div></div>`;
  if (G.mode === 'flash') {
    const u = G.queue[G.i];
    v.innerHTML = top + (G.flipped ? `
      <div class="fcard" id="fcard"><div class="muted">${esc(u.w.word)}</div><div class="ja">${esc(u.m.ja)}</div>${u.m.example ? `<div class="ex">"${esc(u.m.example)}"</div>` : ''}<div class="hint">← まだ ／ 覚えた →（スワイプもできるよ）</div></div>
      <div class="row"><button class="btn danger" data-act="notyet">まだ</button><button class="btn mint" data-act="know">覚えた！</button></div>` : `
      <div class="fcard" id="fcard"><div class="word" data-act="speak" data-w="${esc(u.w.word)}">${esc(u.w.word)}</div><button class="spk" data-act="speak" data-w="${esc(u.w.word)}">🔊</button><div class="hint">単語をタップすると発音が聞けるよ</div></div>
      <button class="btn" data-act="flip">意味を見る</button>`);
    swipeSetup();
  } else {
    const q = G.q;
    v.innerHTML = top + `<div class="qword">${q.u.m.pos ? `<span class="pos">${esc(q.u.m.pos)}</span>` : ''}<div class="word">${esc(q.u.w.word)}</div><button class="spk" data-act="speak" data-w="${esc(q.u.w.word)}">🔊</button></div>` +
      q.opts.map((o, i) => `<button class="choice ${q.done ? (o.ok ? 'ok' : (i === q.sel ? 'ng' : '')) : ''}" data-act="choose" data-i="${i}" ${q.done ? 'disabled' : ''}>${esc(o.t)}</button>`).join('') +
      (q.done && G.mode === 'quiz' && !q.right ? '<button class="btn" data-act="next">次へ</button>' : '');
  }
}
function renderGameMenu(v) {
  const sc = (k, t) => `<button class="chip ${scope === k ? 'on' : ''}" data-act="scope" data-k="${k}">${t}</button>`;
  v.innerHTML = `<h2>🎮 ゲーム</h2>
  <p class="muted" style="margin:0 0 6px">出題範囲</p>
  <div class="chips">${sc('all', 'ぜんぶ')}${sc('weak', '苦手のみ')}${sc('new', '新規のみ')}</div>
  <button class="mode" data-act="start" data-m="flash"><span class="ic">🃏</span><span><b>フラッシュカード</b><small>めくって「覚えた／まだ」</small></span></button>
  <button class="mode" data-act="start" data-m="quiz"><span class="ic">🎯</span><span><b>4択クイズ</b><small>正しい意味を選ぼう（10問）</small></span></button>
  <button class="mode" data-act="start" data-m="time"><span class="ic">⏱</span><span><b>タイムアタック</b><small>60秒で何問正解できる？${S.best.timeattack ? ` ハイスコア ${S.best.timeattack}` : ''}</small></span></button>
  <p class="muted center">4択は4単語以上登録すると遊べます<br>3回連続で正解すると「マスター」！</p>`;
}
function renderResult(v) {
  let stars, big;
  if (G.mode === 'time') { stars = G.correct >= 12 ? 3 : G.correct >= 7 ? 2 : 1; big = `${G.correct}<small style="font-size:24px">問正解</small>`; }
  else { const a = G.total ? G.correct / G.total : 0; stars = a >= .9 ? 3 : a >= .6 ? 2 : 1; big = `${G.correct}<small style="font-size:24px"> / ${G.total}</small>`; }
  v.innerHTML = `<div class="card center"><h2>${gname[G.mode]} 結果</h2>
    <div class="stars">${[1, 2, 3].map(i => `<span class="${i > stars ? 'off' : ''}">⭐</span>`).join('')}</div>
    <div class="rbig">${big}</div>
    <p style="margin:8px 0">+${G.pts} pt ・ 最大コンボ ${G.maxCombo}</p>
    ${G.newBest ? '<div class="lvup">🏆 ハイスコア更新！</div>' : ''}
    ${G.lv1 > G.lv0 ? `<div class="lvup">🎉 レベルアップ！ Lv.${G.lv1}</div>` : ''}</div>
    ${G.wrong.length ? `<div class="card wrong"><b>まちがえた単語</b><ul>${G.wrong.map(u => `<li><b>${esc(u.w.word)}</b>　${esc(u.m.ja)}</li>`).join('')}</ul></div>` : ''}
    <button class="btn pink" data-act="again">もう一回</button><div class="gap"></div>
    <button class="btn ghost" data-act="menu">ゲームメニューへ</button>`;
}
function swipeSetup() {
  const el = $('#fcard'); if (!el || !G.flipped) return;
  let x0 = null;
  el.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, { passive: true });
  el.addEventListener('touchend', e => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0; x0 = null;
    if (dx > 70) flashAnswer(true); else if (dx < -70) flashAnswer(false);
  });
}
function flashAnswer(ok) {
  if (!G || G.busy) return; G.busy = true;
  const u = G.queue[G.i], id = G.id;
  record(u, ok);
  const el = $('#fcard'); if (el) el.classList.add(ok ? 'fly-r' : 'fly-l');
  setTimeout(() => {
    if (!G || G.id !== id) return;
    G.busy = false; G.flipped = false; G.i++;
    G.i >= G.queue.length ? finish() : render();
  }, S.settings.sound ? 220 : 0);
}
function choose(i) {
  const q = G.q; if (q.done || G.phase !== 'play') return;
  const ok = q.opts[i].ok; q.done = true; q.sel = i; q.right = ok;
  record(q.u, ok); render();
  const id = G.id;
  if (G.mode === 'time') setTimeout(() => { if (G && G.id === id && G.phase === 'play') { G.q = nextTimeQ(q); render(); } }, ok ? 350 : 900);
  else if (ok) setTimeout(() => { if (G && G.id === id && G.phase === 'play') nextQuiz(); }, 700);
}
function nextQuiz() {
  G.i++;
  if (G.i >= G.queue.length) return finish();
  G.q = makeQ(G.queue[G.i]); render();
}

/* ---------- 設定 ---------- */
function renderSettings(v) {
  v.innerHTML = `<h2>⚙️ 設定</h2>
  <div class="card"><div class="sw"><span>🔊 効果音・アニメーション</span><button class="${S.settings.sound ? 'on' : ''}" data-act="sound" aria-label="効果音"></button></div></div>
  <div class="card"><h3 style="margin-top:0">バックアップ</h3>
    <p class="muted" style="margin-top:0">データはこのスマホの中にだけ保存されています。機種変更前に書き出してください。</p>
    <button class="btn mint" data-act="export">📤 データを書き出す</button><div class="gap"></div>
    <button class="btn ghost" data-act="import">📥 データを読み込む</button>
    <input type="file" id="impFile" accept=".json,application/json" hidden></div>
  <div class="card"><button class="btn danger" data-act="reset">🗑 全データを削除</button></div>
  <p class="center muted">英検準1級 単語アプリ</p>`;
}
async function doExport() {
  const json = JSON.stringify(S, null, 2), name = `eiken-vocab-${today()}.json`;
  const file = new File([json], name, { type: 'application/json' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; }
  } catch (e) { if (e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('書き出しました');
}
function doImport(file) {
  const r = new FileReader();
  r.onload = async () => {
    try {
      const d = JSON.parse(r.result);
      if (!d || !Array.isArray(d.words)) throw 0;
      const n = normalize(d);
      if (!await confirmBox(`${n.words.length}語のデータを読み込みます。今のデータは上書きされます。`, '読み込む')) return;
      S = n; save(); render(); toast('読み込みました');
    } catch (e) { toast('読み込めないファイルです'); }
  };
  r.readAsText(file);
}

/* ---------- イベント ---------- */
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const d = b.dataset;
  switch (d.act) {
    case 'go': go(d.tab); break;
    case 'toggle': R.items[+d.i].checked = b.checked; b.closest('.dcard').classList.toggle('on', b.checked); break;
    case 'addManual': R.items.push(blankManual()); renderRegister($('#view')); break;
    case 'rmManual': R.items.splice(+d.i, 1); renderRegister($('#view')); break;
    case 'saveWord': saveWord(); break;
    case 'speak': speak(d.w); break;
    case 'open': openDetail(d.id); break;
    case 'closeSheet': closeSheet(); break;
    case 'delMeaning': {
      const w = S.words.find(x => x.id === $('#sheet').dataset.id);
      if (w.meanings.length === 1) { if (await confirmBox('最後の意味です。単語ごと削除しますか？', '削除', true)) { S.words = S.words.filter(x => x !== w); save(); closeSheet(); } break; }
      if (await confirmBox('この意味を削除しますか？', '削除', true)) { w.meanings = w.meanings.filter(m => m.id !== d.mid); save(); openDetail(w.id); }
      break;
    }
    case 'delWord': {
      const w = S.words.find(x => x.id === $('#sheet').dataset.id);
      if (await confirmBox(`「${w.word}」を削除しますか？`, '削除', true)) { S.words = S.words.filter(x => x !== w); save(); closeSheet(); }
      break;
    }
    case 'scope': scope = d.k; renderGame($('#view')); break;
    case 'start': startGame(d.m); break;
    case 'quit': if (await confirmBox('ゲームをやめますか？', 'やめる', true, 'つづける')) { endGame(); render(); } break;
    case 'flip': G.flipped = true; render(); break;
    case 'know': flashAnswer(true); break;
    case 'notyet': flashAnswer(false); break;
    case 'choose': choose(+d.i); break;
    case 'next': nextQuiz(); break;
    case 'again': { const m = G.mode; endGame(); startGame(m); break; }
    case 'menu': endGame(); render(); break;
    case 'sound': S.settings.sound = !S.settings.sound; save(); render(); break;
    case 'export': doExport(); break;
    case 'import': $('#impFile').click(); break;
    case 'reset':
      if (await confirmBox('すべての単語と記録を削除します。元に戻せません。本当によいですか？', '削除する', true)) {
        if (await confirmBox('最終確認：本当に全部削除しますか？', '全部削除', true)) { S = defaults(); save(); R = newR(); render(); toast('削除しました'); }
      }
      break;
  }
});
document.addEventListener('submit', e => {
  if (e.target.id !== 'regForm') return;
  e.preventDefault(); R.word = $('#wordIn').value; document.activeElement.blur(); doSearch();
});
document.addEventListener('input', e => {
  const t = e.target;
  if (t.id === 'wordIn') R.word = t.value;
  else if (t.id === 'bkSearch') { BK.q = t.value; renderList(); }
  else if (t.dataset.f && t.dataset.i !== undefined) { R.items[+t.dataset.i][t.dataset.f] = t.value; t.classList.remove('err'); }
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'bkSort') { BK.sort = t.value; renderList(); }
  else if (t.id === 'impFile') { if (t.files[0]) doImport(t.files[0]); t.value = ''; }
  else if (t.dataset.edit) {
    const w = S.words.find(x => x.id === $('#sheet').dataset.id), m = w && w.meanings.find(x => x.id === t.dataset.mid);
    if (!m) return;
    if (t.dataset.edit === 'ja' && !t.value.trim()) { t.value = m.ja; return toast('日本語の意味は空にできません'); }
    m[t.dataset.edit] = t.value.trim(); save(); toast('保存しました');
  }
});

render();
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('service-worker.js').catch(() => { });
