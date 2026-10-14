/* ===== 税务师刷题助手 核心逻辑（税法一 + 税法二） ===== */
'use strict';

/* ===== 版本号：每次更新题库/功能后递增，手机端刷新即自动更新 ===== */
const APP_VERSION = '2026-10-11.3';
console.log('税务师刷题助手 v' + APP_VERSION);

/* ---------- 数据与存储（按科目隔离） ---------- */
const BANK = window.QUESTION_BANK || { questions: [] };
const ALL_QUESTIONS = BANK.questions || [];
const ALL_CARDS = window.KNOWLEDGE_CARDS || [];   // 知识点卡（自动生成）
const CHAPTER_SCORES = window.CHAPTER_SCORES || {}; // 章节分值权重
const TYPE_NAMES = { single: '单选题', multiple: '多选题', calc: '计算题', comprehensive: '综合分析题' };

let currentSubject = '税法一';   // '税法一' | '税法二'
let QUESTIONS = [];             // 当前科目的题目
let CARDS = [];                 // 当前科目的知识点卡
let SYLLABUS = [];              // 当前科目章节
let LS_WRONG, LS_STATS, LS_EXAM, LS_SETTINGS, LS_FAV, LS_PROGRESS, LS_CARDS, LS_ROUND;
let wrongStore, statsStore, favStore, settings, cardsStore, roundStore;
let LS_SETS, setsStore;   // 卷子库与卷子练习进度

function subjectSuffix() { return currentSubject === '税法一' ? 's1' : 's2'; }

function loadLS(key, def) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : def; }
  catch (e) { return def; }
}
function saveLS(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
}

function loadStores() {
  LS_WRONG = 'tax_wrong_' + subjectSuffix() + '_v1';
  LS_STATS = 'tax_stats_' + subjectSuffix() + '_v1';
  LS_EXAM = 'tax_exam_' + subjectSuffix() + '_v1';
  LS_SETTINGS = 'tax_settings_' + subjectSuffix() + '_v1';
  LS_FAV = 'tax_fav_' + subjectSuffix() + '_v1';
  LS_PROGRESS = 'tax_progress_' + subjectSuffix() + '_v1';
  LS_CARDS = 'tax_cards_' + subjectSuffix() + '_v1';
  wrongStore = loadLS(LS_WRONG, {});
  statsStore = loadLS(LS_STATS, {});
  favStore = loadLS(LS_FAV, {});
  settings = loadLS(LS_SETTINGS, {});
  LS_CARDS = 'tax_cards_' + subjectSuffix() + '_v1';
  LS_ROUND = 'tax_round_' + subjectSuffix() + '_v1';
  wrongStore = loadLS(LS_WRONG, {});
  statsStore = loadLS(LS_STATS, {});
  favStore = loadLS(LS_FAV, {});
  settings = loadLS(LS_SETTINGS, {});
  cardsStore = loadLS(LS_CARDS, {});
  roundStore = loadLS(LS_ROUND, {});   // {章节号: {round:N, done:[qid...]}}
  LS_SETS = 'tax_sets_' + subjectSuffix() + '_v1';
  setsStore = loadLS(LS_SETS, { sets: [], progress: {} });
  autoDetectSets();   // 自动识别题库来源中的卷子
}

/* ---------- 章节轮次刷题 ---------- */
function getRoundState(ch) {
  if (!roundStore[ch]) roundStore[ch] = { round: 1, done: [] };
  return roundStore[ch];
}
function saveRound() {
  saveLS(LS_ROUND, roundStore);
}
function markChapterDone(ch, qid) {
  const st = getRoundState(ch);
  if (!st.done.includes(qid)) st.done.push(qid);
  saveRound();
}
function chapterUnseen(qs, ch) {
  // 该章未刷过的题（本回合剔除 done）
  const st = getRoundState(ch);
  return qs.filter(q => !st.done.includes(q.id));
}

/* ---------- 间隔重复引擎（SM-2 简化版，按章节分值加权） ---------- */
// SM-2 递增间隔（天）
const SRS_STEPS = [0, 1, 3, 7, 14, 30, 60, 120];
// 自评等级 → 答对次数增减
// 'again'(忘了) 重置答对次数；'hard'(模糊) 不增加；'good'(记住) +1；'easy'(很熟) +2

function chFactor(ch) {
  // 章节复习系数：分值高的章 → 系数小 → 间隔短
  const info = (CHAPTER_SCORES[currentSubject] || {})[String(ch)];
  return info ? (info.factor || 1.0) : 1.0;
}

function chScore(ch) {
  const info = (CHAPTER_SCORES[currentSubject] || {})[String(ch)];
  return info ? (info.score || 0) : 0;
}

function cardKey(card) {
  // 知识点卡的稳定 key：科目+章+知识点标题
  return currentSubject + ':' + card.chapter + ':' + card.kp;
}

function srsInterval(reps, ch) {
  // 第 reps 次答对后的间隔天数，乘以章节系数（高权重章复习更频繁）
  const base = SRS_STEPS[Math.min(reps, SRS_STEPS.length - 1)] || 30;
  return Math.max(1, Math.round(base * chFactor(ch)));
}

/* 错题调度：错误次数升级间隔 */
function wrongInterval(count) {
  // count=1 → 2 天，2 → 5 天，3+ → 10 天（错得越多复习越频繁）
  if (count <= 1) return 2;
  if (count === 2) return 5;
  return 10;
}

/* ---------- 卷子库（按套试卷刷题） ---------- */
const SET_KEYWORDS = ['必刷550','八套卷','模拟试卷','年真题','押题卷','万人模考','临门模考试卷','终极密卷','轻1模考','方银行','月考','密训卷'];
function isSetSource(s) {
  if (!s) return false;
  return SET_KEYWORDS.some(k => s.includes(k));
}

/* 自动识别题库来源里的整套试卷/套卷（如「八套卷-模拟试卷-1」「押题卷一」） */
function autoDetectSets() {
  if (!setsStore.sets) setsStore.sets = [];
  if (!setsStore.progress) setsStore.progress = {};
  const sets = setsStore.sets;
  let changed = false;
  const known = new Set(sets.filter(x => x.type === 'book').map(x => x.source));
  const candidates = new Map();
  for (const q of ALL_QUESTIONS) {
    if (q.subject !== currentSubject) continue;
    if (!isSetSource(q.source)) continue;
    if (known.has(q.source)) continue;
    if (!candidates.has(q.source)) candidates.set(q.source, new Set());
    candidates.get(q.source).add(q.id);
  }
  candidates.forEach((ids, source) => {
    const san = String(source).replace(/[^\w\u4e00-\u9fa5]/g, '_');
    sets.push({ id: 'book-' + san, name: source, type: 'book', source: source, count: ids.size, subject: currentSubject, auto: true });
    changed = true;
  });
  // 题量同步：题库更新后刷新每套卷子的题数；题库里已消失的自动卷子移除
  for (let i = sets.length - 1; i >= 0; i--) {
    const s = sets[i];
    if (s.subject !== currentSubject) continue;
    if (s.type !== 'book') continue;
    const n = setPool(s).length;
    if (s.auto && n === 0) { sets.splice(i, 1); changed = true; continue; }
    if (s.count !== n) { s.count = n; changed = true; }
  }
  if (changed) saveLS(LS_SETS, setsStore);
}

function getSetById(setId) {
  return (setsStore.sets || []).find(s => s.id === setId) || null;
}

function qtypeLabel(t) {
  return (!t || t === 'all') ? '全部题型' : (TYPE_NAMES[t] || t);
}

/* 一套卷子的题目池：按题库中的原卷顺序（单选→多选→计算→综合）。
   qtype：题型过滤；chapters：税种/章节多选（空/不传＝全部章节）。
   注意：不做 shuffle，保持试卷原始题序，便于按题号顺序刷完整套。 */
function setPool(set, qtype, chapters) {
  if (!set) return [];
  let pool = QUESTIONS.filter(q => {
    if (set.type === 'book') return q.source === set.source;
    if (set.chapter && set.chapter !== 'all') return (q.chapter || 0) === Number(set.chapter);
    return true;
  });
  const baseType = set.type === 'custom' ? set.qtype : 'all';
  if (baseType && baseType !== 'all') pool = pool.filter(q => q.type === baseType);
  if (qtype && qtype !== 'all') pool = pool.filter(q => q.type === qtype);
  if (chapters && chapters.length) {
    const want = new Set(chapters.map(Number));
    pool = pool.filter(q => want.has(Number(q.chapter || 0)));
  }
  return pool;
}

/* 一套卷子里出现的税种/章节（用于多选 chips），按章节号升序 */
function setChapters(set, qtype) {
  const pool = setPool(set, qtype);
  const map = new Map();
  for (const q of pool) {
    const ch = Number(q.chapter || 0);
    if (!map.has(ch)) map.set(ch, { ch: ch, name: ch ? chapterName(ch) : '未分章/综合', count: 0 });
    map.get(ch).count++;
  }
  return [...map.values()].sort((a, b) => (a.ch || 99) - (b.ch || 99));
}

/* 税种选择的可读标签（用于练习标题） */
function chapterSelLabel(chapters) {
  if (!chapters || !chapters.length) return '';
  const names = chapters.map(ch => Number(ch) ? chapterName(Number(ch)) : '未分章');
  if (names.length <= 2) return names.join(' + ');
  return names.length + ' 个税种';
}

/* 卷子练习进度：doneIds = 已做过的题目 id（去重，用于「继续未做」「完成度」） */
function setProg(setId) {
  if (!setsStore.progress) setsStore.progress = {};
  const p = setsStore.progress[setId];
  if (!p) return { done: 0, right: 0, wrong: 0, lastAt: 0, doneIds: [] };
  if (!Array.isArray(p.doneIds)) p.doneIds = [];
  return p;
}

/* 一套卷子的进度视图（按当前「税种 + 题型」筛选题池计算） */
function setProgressView(set, qtype, chapters) {
  const pool = setPool(set, qtype, chapters);
  const p = setProg(set.id);
  const doneIds = new Set(p.doneIds);
  const doneN = pool.filter(q => doneIds.has(q.id)).length;
  const attempts = (p.right || 0) + (p.wrong || 0);
  return {
    pool: pool,
    total: pool.length,
    done: doneN,
    left: pool.length - doneN,
    attempts: attempts,
    rate: attempts ? Math.round(p.right / attempts * 100) : 0,
    wrong: pool.filter(q => wrongStore[q.id]).length,
    pct: pool.length ? Math.round(doneN / pool.length * 100) : 0,
  };
}

/* 记录一次卷子作答：qid 传入则登记为「已做」 */
function recordSetStat(setId, qid, correct) {
  if (!setsStore.progress) setsStore.progress = {};
  const p = setProg(setId);
  p.done = (p.done || 0) + 1;
  if (correct) p.right = (p.right || 0) + 1; else p.wrong = (p.wrong || 0) + 1;
  p.lastAt = Date.now();
  if (qid && !p.doneIds.includes(qid)) p.doneIds.push(qid);
  setsStore.progress[setId] = p;
  saveLS(LS_SETS, setsStore);
}

function resetSetProgress(setId) {
  if (!confirm('确定清空这套卷子的练习进度吗？（错题库、收藏不受影响）')) return;
  if (setsStore.progress) delete setsStore.progress[setId];
  saveLS(LS_SETS, setsStore);
  const prog = getSavedProgress();
  if (prog && prog.setId === setId) clearProgress();
  renderSetDetail();
}

/* 记录一次作答结果（错题 SRS）
 * 规则：做错 → 入错题库并排期；重练答对一次 → 立即移出错题库 */
function recordWrongSrs(qid, correct) {
  const q = qById(qid);
  const ch = q ? q.chapter : 0;
  if (correct) {
    // 答对一次即移出错题库
    if (wrongStore[qid]) delete wrongStore[qid];
  } else {
    if (!wrongStore[qid]) wrongStore[qid] = { count: 0, due: 0 };
    wrongStore[qid].count = (wrongStore[qid].count || 0) + 1;
    wrongStore[qid].rightStreak = 0;
    wrongStore[qid].due = Date.now() + wrongInterval(wrongStore[qid].count) * 86400000 * chFactor(ch);
    wrongStore[qid].lastWrong = Date.now();
  }
  saveLS(LS_WRONG, wrongStore);
  updateWrongBadge();
}

/* 今日到期统计 */
function dueStats() {
  const now = Date.now();
  const wrongDue = Object.keys(wrongStore).filter(id => {
    const w = wrongStore[id];
    return !w.due || w.due <= now;
  }).length;
  const cardDue = Object.keys(cardsStore).filter(k => {
    const s = cardsStore[k];
    return s && s.due && s.due <= now;
  }).length;
  const cardNew = CARDS.filter(c => !cardsStore[cardKey(c)]).length;
  return { wrongDue, cardDue, cardNew };
}

/* 知识卡自评 */
function gradeCard(card, grade) {
  const key = cardKey(card);
  const st = cardsStore[key] || { reps: 0, due: 0 };
  if (grade === 'again') {
    st.reps = 0;
    st.due = Date.now() + 10 * 60 * 1000;   // 10 分钟后重来
  } else if (grade === 'hard') {
    st.due = Date.now() + srsInterval(st.reps + 1, card.chapter) * 86400000;
    st.reps = st.reps + 1;
  } else if (grade === 'good') {
    st.reps = st.reps + 1;
    st.due = Date.now() + srsInterval(st.reps, card.chapter) * 86400000;
  } else if (grade === 'easy') {
    st.reps = st.reps + 2;
    st.due = Date.now() + srsInterval(st.reps, card.chapter) * 86400000;
  }
  st.last = Date.now();
  cardsStore[key] = st;
  saveLS(LS_CARDS, cardsStore);
}

const SYLLABUS_S1 = [
  { ch: 1, name: '税法基本原理' }, { ch: 2, name: '增值税' }, { ch: 3, name: '消费税' },
  { ch: 4, name: '城市维护建设税' }, { ch: 5, name: '土地增值税' }, { ch: 6, name: '资源税' },
  { ch: 7, name: '车辆购置税' }, { ch: 8, name: '环境保护税' }, { ch: 9, name: '烟叶税' },
  { ch: 10, name: '关税' }, { ch: 11, name: '社会保险费' }, { ch: 12, name: '非税收入' },
];
const SYLLABUS_S2 = [
  { ch: 1, name: '企业所得税' }, { ch: 2, name: '个人所得税' }, { ch: 3, name: '国际税收' },
  { ch: 4, name: '印花税' }, { ch: 5, name: '房产税' }, { ch: 6, name: '车船税' },
  { ch: 7, name: '契税' }, { ch: 8, name: '城镇土地使用税' }, { ch: 9, name: '耕地占用税' },
  { ch: 10, name: '船舶吨税' },
];

/* 切换科目：更新题目/章节/存储 */
function setSubject(subj) {
  if (subj === currentSubject) { showHome(); return; }
  currentSubject = subj;
  QUESTIONS = ALL_QUESTIONS.filter(q => q.subject === currentSubject);
  CARDS = ALL_CARDS.filter(c => c.subject === currentSubject);
  SYLLABUS = currentSubject === '税法一' ? SYLLABUS_S1 : SYLLABUS_S2;
  loadStores();
  // 更新顶部科目切换高亮与标题
  document.querySelectorAll('.subject-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.subject === currentSubject);
  });
  const subjName = currentSubject === '税法一' ? '税法(一)' : '税法(二)';
  document.getElementById('logoText').textContent = subjName + '刷题助手';
  showHome();
}

function qById(id) {
  for (const q of QUESTIONS) if (q.id === id) return q;
  return null;
}

function chapterName(ch) {
  const s = SYLLABUS.find(x => x.ch === ch);
  return s ? s.name : (ch ? '综合' : '综合');
}

/* ---------- 页面切换 ---------- */
function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.style.display = 'none');
  document.getElementById(id).style.display = 'block';
  document.querySelectorAll('.nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.page === id.replace('page-', ''));
  });
  window.scrollTo(0, 0);
}

/* ---------- 首页 ---------- */
function showHome() {
  cardScrollRestore = null;   // 主动离开知识卡页时清掉待恢复位置
  showPage('page-home');
  const total = QUESTIONS.length;
  document.getElementById('heroTotal').textContent = total;
  const subjName = currentSubject === '税法一' ? '税法（一）' : '税法（二）';
  const heroH = document.getElementById('heroTitle');
  if (heroH) heroH.textContent = '2026 税务师《' + subjName + '》';
  // 统计卡片
  const answered = Object.keys(statsStore).length;
  let right = 0, wrong = 0;
  for (const k in statsStore) { right += statsStore[k].right; wrong += statsStore[k].wrong; }
  const done = right + wrong;
  const rate = done ? Math.round(right / done * 100) : 0;
  const wrongCount = Object.keys(wrongStore).length;
  document.getElementById('homeStats').innerHTML = `
    <div class="stat-card"><div class="num">${total}</div><div class="label">${subjName}题库</div></div>
    <div class="stat-card"><div class="num">${done}</div><div class="label">已答题数</div></div>
    <div class="stat-card green"><div class="num">${rate}%</div><div class="label">总正确率</div></div>
    <div class="stat-card red"><div class="num">${wrongCount}</div><div class="label">错题数</div></div>`;
  // 今日复习卡片（间隔重复）
  const due = dueStats();
  const dueTotal = due.wrongDue + due.cardDue;
  const reviewBox = document.getElementById('todayReview');
  if (reviewBox) {
    const hasNew = due.cardNew > 0;
    reviewBox.innerHTML = `
      <div class="review-banner ${dueTotal > 0 ? '' : 'done'}">
        <div class="review-info">
          <div class="review-title">📅 今日复习 <span class="sub">间隔重复 · 按章节分值加权</span></div>
          <div class="review-counts">
            ${dueTotal > 0
              ? `<b class="due-num">${dueTotal}</b> 题到期（错题 ${due.wrongDue} · 知识卡 ${due.cardDue}）`
              : '今日无到期复习 ✅'}
            ${hasNew ? `<span class="tag tag-new">${due.cardNew} 张新知识卡可学</span>` : ''}
          </div>
        </div>
        <div class="review-actions">
          ${dueTotal > 0 ? `<button class="btn btn-primary btn-sm" onclick="startDueReview()">开始复习</button>` : ''}
          ${hasNew ? `<button class="btn btn-accent btn-sm" onclick="showCardList()">学新卡</button>` : ''}
          <button class="btn btn-outline btn-sm" onclick="showCardList()">知识卡</button>
        </div>
      </div>`;
  }
  // 章节分布
  renderChapterBars();
  updateWrongBadge();
  updateFavBadge();
}

/* 到期复习：错题(到期) + 知识卡(到期) 混合队列 */
function startDueReview() {
  const now = Date.now();
  const wrongDue = Object.keys(wrongStore).filter(id => {
    const w = wrongStore[id];
    return (!w.due || w.due <= now) && qById(id);
  }).map(id => qById(id));
  const cardDue = CARDS.filter(c => {
    const st = cardsStore[cardKey(c)];
    return st && st.due && st.due <= now;
  });
  if (!wrongDue.length && !cardDue.length) { alert('今日没有到期复习内容'); return; }
  // 到期错题 → 进入错题复习模式
  if (wrongDue.length) {
    startQuiz({ mode: 'wrong', questions: groupSort(wrongDue), title: `今日到期错题（${wrongDue.length} 题）` });
  } else {
    // 只有知识卡到期 → 知识卡复习
    startCardReview(cardDue.map(c => cardKey(c)), 'home');
  }
}

/* ---------- 知识点卡 ---------- */
let cardReviewQueue = [];  // 当前知识卡复习队列（card key 数组）
let cardReviewIndex = 0;
let cardRevealed = false;

/* 知识卡：两级导航（税种列表 → 章内卡片） */
let cardChapter = null;   // 当前浏览的章
let cardScrollRestore = null;   // 进复习前的滚动位置 {ch, y}，返回时恢复

function showCardList() {
  showPage('page-card');
  cardChapter = null;
  // 返回知识卡页时恢复到进入复习前的位置
  if (cardScrollRestore && cardScrollRestore.ch === null) {
    window.scrollTo(0, cardScrollRestore.y);
  }
  cardScrollRestore = null;
  // 按章分组统计
  const byCh = {};
  for (const c of CARDS) {
    const ch = c.chapter;
    if (!byCh[ch]) byCh[ch] = { name: c.chapter_name, score: c.score, cards: [] };
    byCh[ch].cards.push(c);
  }
  const rows = SYLLABUS.map(s => {
    const g = byCh[s.ch];
    if (!g) return '';
    const dueCnt = g.cards.filter(c => {
      const st = cardsStore[cardKey(c)];
      return st && st.due && st.due <= Date.now();
    }).length;
    const newCnt = g.cards.filter(c => !cardsStore[cardKey(c)]).length;
    return `<div class="card-chapter" onclick="showChapterCards(${s.ch})">
      <div class="cc-name">第${s.ch}章 ${g.name}</div>
      <div class="cc-meta">
        <span>${g.cards.length} 卡</span>
        ${g.score ? `<span class="tag tag-score">${g.score}分</span>` : ''}
        ${dueCnt ? `<span class="tag tag-due">${dueCnt} 待复习</span>` : ''}
        ${newCnt ? `<span class="tag tag-new">${newCnt} 新</span>` : ''}
      </div>
    </div>`;
  }).filter(Boolean).join('');
  document.getElementById('cardList').innerHTML = rows ||
    '<div class="empty"><div class="big">📇</div>当前科目暂无知识卡</div>';
}

function showChapterCards(ch) {
  showPage('page-card');
  cardChapter = ch;
  // 返回本章时恢复到进入复习前的位置（如最下面那行）
  if (cardScrollRestore && cardScrollRestore.ch === ch) {
    window.scrollTo(0, cardScrollRestore.y);
  }
  cardScrollRestore = null;
  const chCards = CARDS.filter(c => c.chapter === ch);
  const rows = chCards.map(c => {
    const st = cardsStore[cardKey(c)];
    const due = st && st.due;
    const overdue = due && due <= Date.now();
    const reps = st ? st.reps : 0;
    return `<div class="card-item" onclick="startSingleCard('${esc(cardKey(c))}')">
      <div class="ci-meta">
        <span class="tag tag-chapter">第${c.chapter}章 ${c.chapter_name}</span>
        <span class="ci-state">${due ? (overdue ? '待复习' : reps + ' 次') : '未学习'}</span>
      </div>
      <div class="ci-title">${esc(c.kp)}</div>
      ${cardTypeTags(c)}
      <div class="ci-preview">${esc(c.content.slice(0, 40))}…</div>
    </div>`;
  }).join('');
  document.getElementById('cardList').innerHTML = `
    <div class="card-back" onclick="showCardList()">← 返回税种列表</div>
    <div class="card-ch-head">
      <h3>第${ch}章 ${chCards[0] ? chCards[0].chapter_name : ''}（${chCards.length} 卡）</h3>
    </div>` + rows;
}

function startSingleCard(key) {
  cardFrom = 'chapter';
  startCardReview([key], 'chapter');
}

let cardFrom = 'list';   // 卡复习来源：'chapter'(章内卡列表) | 'list'(知识卡页) | 'home'(首页)

function startCardReview(keys, from) {
  cardFrom = from || 'list';
  // 记录进入复习前的滚动位置（仅从知识卡页进入时）
  if (document.getElementById('page-card').style.display !== 'none') {
    cardScrollRestore = { ch: cardChapter, y: window.scrollY };
  }
  cardReviewQueue = keys;
  cardReviewIndex = 0;
  cardRevealed = false;
  showPage('page-card-quiz');
  renderCardQuestion();
}

// 返回上一级（而不是固定回到最开始一级）
function cardQuizBack() {
  if (cardFrom === 'chapter' && cardChapter != null) { showChapterCards(cardChapter); return; }
  if (cardFrom === 'home') { showHome(); return; }
  showCardList();
}

function currentCard() {
  const key = cardReviewQueue[cardReviewIndex];
  return CARDS.find(c => cardKey(c) === key) || null;
}

function renderCardQuestion() {
  const c = currentCard();
  if (!c) { finishCardReview(); return; }
  cardRevealed = false;
  document.getElementById('cardProgress').textContent = `${cardReviewIndex + 1} / ${cardReviewQueue.length}`;
  document.getElementById('cardType').textContent = `第${c.chapter}章 ${c.chapter_name} · ${c.score}分`;
  document.getElementById('cardTitle').textContent = c.kp;
  document.getElementById('cardBody').textContent = c.content;
  document.getElementById('cardBody').style.display = 'none';
  document.getElementById('cardExamples').innerHTML = '';   // 翻面后才渲染例题
  document.getElementById('cardRevealBtn').style.display = 'inline-block';
  document.getElementById('cardGradeBtns').style.display = 'none';
  document.getElementById('cardHint').textContent = '点击「显示内容」回忆后自评';
}

function revealCard() {
  cardRevealed = true;
  renderCardExamples(currentCard());
  document.getElementById('cardBody').style.display = 'block';
  document.getElementById('cardRevealBtn').style.display = 'none';
  document.getElementById('cardGradeBtns').style.display = 'flex';
}

// 例题附卡：知识点怎么考（真题示例，可折叠）
function renderCardExamples(c) {
  const el = document.getElementById('cardExamples');
  const exs = (c && c.examples) || [];
  if (!exs.length) { el.innerHTML = ''; return; }
  const items = exs.map(e => `
    <div class="ex-item">
      <span class="ex-type">${esc(e.type)}</span>
      <div class="ex-q">${esc(e.q)}</div>
      ${e.answer ? `<div class="ex-ans">答案：${esc(e.answer)}</div>` : ''}
      ${e.explain ? `<div class="ex-exp">解析：${esc(e.explain)}</div>` : ''}
    </div>`).join('');
  el.innerHTML = `<div class="card-examples">
    <button class="examples-toggle" onclick="toggleExamples()">📝 怎么考 · ${exs.length} 道真题示例</button>
    <div class="examples-list" id="examplesList" style="display:none">${items}</div>
  </div>`;
}

function toggleExamples() {
  const l = document.getElementById('examplesList');
  if (l) l.style.display = l.style.display === 'none' ? 'block' : 'none';
}

// 卡片题型标签（从例题统计）
function cardTypeTags(c) {
  const exs = (c && c.examples) || [];
  if (!exs.length) return '';
  const tags = [...new Set(exs.map(e => e.type))].join(' · ');
  return `<div class="ci-tags">题型：${esc(tags)}</div>`;
}

function gradeCardClick(grade) {
  const c = currentCard();
  if (!c) return;
  gradeCard(c, grade);
  cardReviewIndex++;
  if (cardReviewIndex >= cardReviewQueue.length) {
    finishCardReview();
  } else {
    renderCardQuestion();
  }
}

function finishCardReview() {
  // 复习完成 → 返回上一级（章内卡列表/知识卡页/首页），并恢复进入前的位置
  cardQuizBack();
}

function renderChapterBars() {
  const counts = {};
  for (const q of QUESTIONS) {
    const c = q.chapter || 0;
    counts[c] = (counts[c] || 0) + 1;
  }
  const max = Math.max(1, ...Object.values(counts));
  const html = SYLLABUS.map(s => {
    const n = counts[s.ch] || 0;
    const pct = Math.round(n / max * 100);
    return `<div class="chapter-bar-row">
      <div class="chapter-bar-name">第${s.ch}章 ${s.name}</div>
      <div class="chapter-bar-track"><div class="chapter-bar-fill" style="width:${pct}%"></div></div>
      <div class="chapter-bar-num">${n}</div>
    </div>`;
  }).join('');
  document.getElementById('chapterBars').innerHTML = html;
}

/* ---------- 章节练习 ---------- */
let currentQuiz = null; // {mode, questions:[...], index, answers:{}, type, chapter, wrongLog:[], examStart}

function showChapterList() {
  showPage('page-chapter');
  const counts = {}, rates = {};
  for (const q of QUESTIONS) {
    const c = q.chapter || 0;
    counts[c] = (counts[c] || 0) + 1;
  }
  for (const c in counts) {
    let r = 0, w = 0;
    for (const q of QUESTIONS) {
      if ((q.chapter || 0) != c) continue;
      const st = statsStore[q.id];
      if (st) { r += st.right; w += st.wrong; }
    }
    rates[c] = (r + w) ? Math.round(r / (r + w) * 100) : null;
  }
  const html = SYLLABUS.map(s => {
    const n = counts[s.ch] || 0;
    const r = rates[s.ch];
    const rateHtml = r === null ? '' : (r >= 60
      ? `<div class="ch-rate">正确率 ${r}%</div>`
      : `<div class="ch-rate warn">正确率 ${r}%（需加强）</div>`);
    // 轮次进度
    const rs = roundStore[s.ch];
    const doneCnt = rs ? rs.done.length : 0;
    const roundN = rs ? rs.round : 1;
    const roundHtml = `<div class="ch-round">第${roundN}轮 · 本轮已刷 ${Math.min(doneCnt, n)}/${n}</div>`;
    return `<div class="chapter-item" onclick="startChapter(${s.ch})">
      <div class="ch-num">第${s.ch}章</div>
      <div class="ch-name">${s.name}</div>
      <div class="ch-count">题库 ${n} 题</div>
      ${roundHtml}
      ${rateHtml}
    </div>`;
  }).join('');
  document.getElementById('chapterGrid').innerHTML = html;
}

function startChapter(ch) {
  // 恢复上次本章进度（校验章节一致）
  if (tryResumeProgress('chapter', p => p.chapter === ch)) return;
  const all = QUESTIONS.filter(q => (q.chapter || 0) === ch);
  if (!all.length) { alert('该章节暂无题目'); return; }
  let unseen = chapterUnseen(all, ch);
  if (!unseen.length) {
    // 本轮刷完 → 提示进入下一轮
    const st = getRoundState(ch);
    if (!confirm(`本章第 ${st.round} 轮已全部刷完（${st.done.length} 题）。\n开始第 ${st.round + 1} 轮复习？`)) {
      showChapterList();
      return;
    }
    st.round += 1;
    st.done = [];
    saveRound();
    unseen = all;
  }
  const list = groupSort(unseen);
  startQuiz({ mode: 'chapter', questions: list, title: `第${ch}章 ${chapterName(ch)} 练习（第${getRoundState(ch).round}轮）`, chapter: ch });
}

/* ---------- 随机刷题 ---------- */
function showRandomSetup() {
  showPage('page-random-setup');
  const sel = document.getElementById('randomChapter');
  sel.innerHTML = '<option value="all">全部章节</option>' + SYLLABUS.map(s =>
    `<option value="${s.ch}">第${s.ch}章 ${s.name}</option>`).join('');
}

function startRandom() {
  const ch = document.getElementById('randomChapter').value;
  const type = document.getElementById('randomType').value;
  const count = parseInt(document.getElementById('randomCount').value, 10);
  let pool = QUESTIONS.slice();
  if (ch !== 'all') pool = pool.filter(q => (q.chapter || 0) == ch);
  if (type !== 'all') pool = pool.filter(q => q.type === type);
  if (!pool.length) { alert('没有符合条件的题目'); return; }
  const list = groupSort(pool).slice(0, Math.min(count, pool.length));
  startQuiz({ mode: 'random', questions: list, title: '随机刷题' });
}

/* ---------- 模拟考试 ---------- */
function showExamSetup() {
  showPage('page-exam-setup');
}

function startExam(kind) {
  if (kind === 'standard') {
    const singles = shuffle(QUESTIONS.filter(q => q.type === 'single')).slice(0, 40);
    const multis = shuffle(QUESTIONS.filter(q => q.type === 'multiple')).slice(0, 20);
    const calcGroups = collectGroups('calc').slice(0, 2);
    const compGroups = collectGroups('comprehensive').slice(0, 2);
    const calcQs = calcGroups.flatMap(g => g.slice());
    const compQs = compGroups.flatMap(g => g.slice());
    const all = [...singles, ...multis, ...calcQs, ...compQs];
    startQuiz({
      mode: 'exam', kind: 'standard', questions: all, title: '模拟考试 · 标准卷',
      exam: true, durationMin: 150,
      scoring: { single: 1.5, multiple: 2, calc: 2, comprehensive: 2 },
      fullScore: 140,
    });
  } else {
    const singles = shuffle(QUESTIONS.filter(q => q.type === 'single')).slice(0, 40);
    const multis = shuffle(QUESTIONS.filter(q => q.type === 'multiple')).slice(0, 20);
    const all = [...singles, ...multis];
    startQuiz({
      mode: 'exam', kind: 'simple', questions: all, title: '模拟考试 · 简版客观卷',
      exam: true, durationMin: 90,
      scoring: { single: 1.5, multiple: 2 },
      fullScore: 100,
    });
  }
}

/* 收集大题组（含材料+子问题，保持组内顺序） */
function collectGroups(type) {
  const groups = {};
  const order = [];
  for (const q of QUESTIONS) {
    if (q.type !== type) continue;
    const gid = q.group_id || q.id;
    if (!groups[gid]) { groups[gid] = []; order.push(gid); }
    groups[gid].push(q);
  }
  const result = shuffle(order).map(gid => groups[gid]);
  return result;
}

/* ---------- 答题核心 ---------- */
/* ---------- 进度保存/恢复/退出 ---------- */
function saveProgress() {
  if (!currentQuiz || currentQuiz.exam) return;  // 考试不保存进度
  try {
    const prog = {
      mode: currentQuiz.mode,
      kind: currentQuiz.kind,
      title: currentQuiz.title,
      chapter: currentQuiz.chapter,
      setId: currentQuiz.setId || null,
      setExam: !!currentQuiz.setExam,
      index: currentQuiz.index,
      qids: currentQuiz.questions.map(q => q.id),
      answers: currentQuiz.answers,
      revealed: currentQuiz.revealed,
      savedAt: Date.now(),
    };
    localStorage.setItem(LS_PROGRESS, JSON.stringify(prog));
  } catch (e) {}
}

function clearProgress() {
  try { localStorage.removeItem(LS_PROGRESS); } catch (e) {}
}

function hasProgress() {
  try { return !!localStorage.getItem(LS_PROGRESS); } catch (e) { return false; }
}

function getSavedProgress() {
  try { return JSON.parse(localStorage.getItem(LS_PROGRESS)); } catch (e) { return null; }
}

/* 退出当前练习：保存进度并返回来源页 */
function exitQuiz() {
  if (!currentQuiz) return;
  if (currentQuiz.exam) {
    // 考试模式：确认退出（放弃本场）
    if (!confirm('确定退出考试吗？本场进度不会保留，需重新作答。')) return;
    clearInterval(currentQuiz.timerId);
    currentQuiz = null;
    showExamSetup();
    return;
  }
  // 练习模式：保存进度
  const answered = Object.keys(currentQuiz.answers).length;
  const total = currentQuiz.questions.length;
  if (currentQuiz.index > 0 || answered > 0) {
    saveProgress();
    alert(`已保存进度（做到第 ${currentQuiz.index + 1}/${total} 题）。\n下次从「${currentQuiz.title}」入口可继续上次练习。`);
  }
  const m = currentQuiz.mode;
  const sid = currentQuiz.setId;
  currentQuiz = null;
  if (m === 'wrong') showWrongList();
  else if (m === 'favorite') showFavoriteList();
  else if (m === 'search') showSearch();
  else if (m === 'chapter') showChapterList();
  else if (m === 'set' && sid) showSetDetail(sid);
  else showHome();
}

/* 询问是否继续上次进度，返回 true 表示已恢复并开始 */
function tryResumeProgress(cfgKey, extraCheck) {
  const prog = getSavedProgress();
  if (!prog || prog.mode !== cfgKey) return false;
  if (extraCheck && !extraCheck(prog)) return false;
  // 恢复题组
  const qs = prog.qids.map(id => qById(id)).filter(Boolean);
  if (!qs.length) { clearProgress(); return false; }
  if (!confirm(`检测到上次「${prog.title}」进行到第 ${prog.index + 1}/${qs.length} 题（已答 ${Object.keys(prog.answers || {}).length} 题）。\n\n「确定」继续上次进度，「取消」重新开始。`)) {
    clearProgress();
    return false;
  }
  startQuiz({
    mode: prog.mode, kind: prog.kind, questions: qs,
    index: prog.index, title: prog.title, chapter: prog.chapter,
    setId: prog.setId || null, setExam: !!prog.setExam,
    answers: prog.answers || {}, revealed: prog.revealed || {},
  });
  return true;
}

function startQuiz(cfg) {
  currentQuiz = {
    mode: cfg.mode,
    kind: cfg.kind || null,
    setId: cfg.setId || null,
    setExam: cfg.setExam || false,
    questions: cfg.questions,
    index: cfg.index || 0,
    answers: {},       // qid -> [selected keys]
    wrongLog: [],
    title: cfg.title,
    chapter: cfg.chapter || null,
    exam: !!cfg.exam,
    durationMin: cfg.durationMin || 0,
    scoring: cfg.scoring || null,
    fullScore: cfg.fullScore || null,
    startTime: Date.now(),
    timerId: null,
    revealed: {},
    groupOrder: [],
  };
  // 恢复已存进度（answers/revealed）
  if (cfg.answers) currentQuiz.answers = cfg.answers;
  if (cfg.revealed) currentQuiz.revealed = cfg.revealed;
  // 大题目排序：材料在前子问题在后已在 collectGroups 保证；但全混合时保持原始顺序
  showPage('page-quiz');
  document.getElementById('quizTitle').textContent = cfg.title;
  const timerEl = document.getElementById('quizTimer');
  if (cfg.exam) {
    timerEl.style.display = 'inline-block';
    startTimer();
    document.getElementById('answerSheet').style.display = 'block';
    renderSheet();
  } else {
    timerEl.style.display = 'none';
    document.getElementById('answerSheet').style.display = 'none';
  }
  renderQuestion();
}

function startTimer() {
  const el = document.getElementById('quizTimer');
  const tick = () => {
    if (!currentQuiz || !currentQuiz.exam) return;
    const elapsed = Math.floor((Date.now() - currentQuiz.startTime) / 1000);
    const remain = currentQuiz.durationMin * 60 - elapsed;
    if (remain <= 0) { el.textContent = '⏱ 时间到'; el.classList.add('warn'); submitExam(); return; }
    const mm = String(Math.floor(remain / 60)).padStart(2, '0');
    const ss = String(remain % 60).padStart(2, '0');
    el.textContent = `⏱ ${mm}:${ss}`;
    if (remain <= 300) el.classList.add('warn'); else el.classList.remove('warn');
  };
  clearInterval(currentQuiz.timerId);
  currentQuiz.timerId = setInterval(tick, 1000);
  tick();
}

function currentQ() {
  return currentQuiz.questions[currentQuiz.index];
}

function renderQuestion() {
  const q = currentQ();
  const idx = currentQuiz.index;
  const total = currentQuiz.questions.length;
  document.getElementById('quizProgressText').textContent = `${idx + 1} / ${total}`;
  document.getElementById('quizProgressFill').style.width = `${((idx + 1) / total) * 100}%`;

  // 材料（计算/综合）
  const matBox = document.getElementById('materialBox');
  if ((q.type === 'calc' || q.type === 'comprehensive') && q.material) {
    matBox.style.display = 'block';
    document.getElementById('materialText').textContent = q.material;
  } else {
    matBox.style.display = 'none';
  }

  document.getElementById('qTypeTag').textContent = TYPE_NAMES[q.type] || q.type;
  document.getElementById('qChapterTag').textContent = `第${q.chapter || '?'}章 ${chapterName(q.chapter)}`;
  document.getElementById('qSourceTag').textContent = q.source || '';

  // 题干（大题内子问题显示组内序号）
  let stem = (q.stem || '').replace(/\s*\n\s*/g, '');   // OCR 断行防御：显示时合并
  if (q.material && (q.type === 'calc' || q.type === 'comprehensive')) {
    // 子问题：前缀序号由题目本身带（1）（2）…
  }
  document.getElementById('qStem').textContent = stem;

  // 选项（跳过空选项，防御 OCR 丢字）
  const optBox = document.getElementById('qOptions');
  optBox.innerHTML = '';
  const saved = currentQuiz.answers[q.id] || [];
  for (const opt of q.options) {
    if (!(opt.text || '').trim()) continue;
    const div = document.createElement('div');
    div.className = 'q-option' + (saved.includes(opt.key) ? ' selected' : '');
    div.dataset.key = opt.key;
    div.innerHTML = `<span class="opt-key">${opt.key}</span><span class="opt-text">${esc(opt.text)}</span>`;
    div.onclick = () => toggleOption(div, q);
    optBox.appendChild(div);
  }

  // 按钮
  const confirmBtn = document.getElementById('confirmBtn');
  const nextBtn = document.getElementById('nextBtn');
  const fb = document.getElementById('qFeedback');
  fb.style.display = 'none';
  renderFavBtn();
  if (currentQuiz.revealed[q.id]) {
    // 已作答（练习模式翻页回来）：显示解析
    confirmBtn.style.display = 'none';
    nextBtn.style.display = 'inline-block';
    showFeedback(q, true);
  } else {
    confirmBtn.style.display = 'inline-block';
    nextBtn.style.display = 'none';
  }
  // 考试模式：确认即锁定
  if (currentQuiz.exam && currentQuiz.answers[q.id] && currentQuiz.answers[q.id].length) {
    // 已选过
  }
  renderSheet();
}

function toggleOption(div, q) {
  const multi = q.type === 'multiple';
  let saved = currentQuiz.answers[q.id] || [];
  const key = div.dataset.key;
  if (multi) {
    saved = saved.includes(key) ? saved.filter(k => k !== key) : [...saved, key];
  } else {
    saved = [key];
  }
  currentQuiz.answers[q.id] = saved;
  document.querySelectorAll('#qOptions .q-option').forEach(el => {
    const sel = saved.includes(el.dataset.key);
    el.classList.toggle('selected', sel);
  });
  renderSheet();
}

function confirmAnswer() {
  const q = currentQ();
  const saved = currentQuiz.answers[q.id] || [];
  if (!saved.length) { alert('请先选择答案'); return; }
  currentQuiz.revealed[q.id] = true;
  const correct = checkAnswer(q, saved);
  if (!currentQuiz.exam) {
    recordStat(q.id, correct);
    recordWrongSrs(q.id, correct);   // 错题 SRS 调度（按章节分值加权）
    currentQuiz.wrongLog.push({ qid: q.id, correct });
    // 章节练习：记录本轮已刷（做过即算）
    if (currentQuiz.mode === 'chapter' && q.chapter) {
      markChapterDone(q.chapter, q.id);
    }
    // 卷子练习：记录单题进度（按题目 id 记「已做过」）
    if (currentQuiz.setId) recordSetStat(currentQuiz.setId, q.id, correct);
  }
  // 显示反馈
  showFeedback(q, true);
  document.getElementById('confirmBtn').style.display = 'none';
  document.getElementById('nextBtn').style.display = 'inline-block';
}

function checkAnswer(q, selected) {
  const ans = (q.answer || []).slice().sort().join('');
  const sel = selected.slice().sort().join('');
  return ans === sel;
}

function showFeedback(q, show) {
  const fb = document.getElementById('qFeedback');
  const saved = currentQuiz.answers[q.id] || [];
  const correct = checkAnswer(q, saved);
  fb.className = 'q-feedback ' + (correct ? 'correct' : 'wrong');
  fb.innerHTML = `
    <div class="fb-title">${correct ? '✅ 回答正确' : '❌ 回答错误'}　正确答案：<b>${(q.answer || []).join('')}</b>${saved.length ? `　你的答案：${saved.join('')}` : ''}</div>
    ${q.explanation ? `<div class="fb-expl"><b>解析：</b>${esc(q.explanation)}</div>` : ''}`;
  fb.style.display = 'block';
  // 选项标记
  const ansKeys = q.answer || [];
  document.querySelectorAll('#qOptions .q-option').forEach(el => {
    const k = el.dataset.key;
    el.classList.remove('selected', 'correct', 'wrong', 'missed');
    if (ansKeys.includes(k)) el.classList.add('correct');
    else if (saved.includes(k)) el.classList.add('wrong');
    else if (correct === false && !saved.length) el.classList.add('missed');
  });
}

function nextQuestion() {
  if (currentQuiz.index < currentQuiz.questions.length - 1) {
    currentQuiz.index++;
    renderQuestion();
  } else {
    if (currentQuiz.exam) {
      submitExam();
    } else {
      // 练习完成：清除进度
      clearProgress();
      const total = currentQuiz.questions.length;
      const right = currentQuiz.wrongLog.filter(w => w.correct).length;
      // 章节练习：本轮刷完自动进入下一轮（已实时标记 done，这里只需推进轮次）
      if (currentQuiz.mode === 'chapter' && currentQuiz.chapter) {
        const st = getRoundState(currentQuiz.chapter);
        st.round += 1;
        st.done = [];
        saveRound();
        showResult(`第${st.round - 1}轮完成`, right, total, `第${st.round - 1}轮完成 · 已进入第${st.round}轮`);
        return;
      }
      if (currentQuiz.mode === 'set' && currentQuiz.setId) {
        const set = getSetById(currentQuiz.setId);
        const v = setProgressView(set, 'all');
        const extra = v.left > 0
          ? `本卷还剩 ${v.left} 题未做，回本卷详情点「继续练习」接着刷`
          : '本卷题目已全部做过 🎉';
        showResult('', right, total, (set ? set.name + ' · ' : '') + '本套练习完成', extra);
        return;
      }
      showResult('', right, total);
    }
  }
}

/* ---------- 我的卷子（按套试卷刷题） ---------- */
let currentSetId = null;
let setChapterSel = [];    // 当前卷子选中的税种/章节（空数组 = 全部）

function showSetsList() {
  showPage('page-sets');
  currentSetId = null;
  const box = document.getElementById('setSearchInput');
  if (box) box.value = '';
  renderSetsList();
}

function renderSetsList() {
  const grid = document.getElementById('setsGrid');
  const kwEl = document.getElementById('setSearchInput');
  const kw = kwEl ? kwEl.value.trim().toLowerCase() : '';
  let sets = (setsStore.sets || []).filter(s => s.subject === currentSubject);
  if (kw) sets = sets.filter(s => (s.name + ' ' + (s.source || '')).toLowerCase().includes(kw));
  const cntEl = document.getElementById('setCountText');
  if (cntEl) cntEl.textContent = `（共 ${sets.length} 套）`;
  if (!sets.length) {
    grid.innerHTML = '<div class="empty"><div class="big">📚</div>' + (kw
      ? '没有匹配「' + esc(kw) + '」的卷子'
      : '还没有卷子<br>系统会自动识别题库来源中的整卷（八套卷 / 押题卷 / 历年真题等）<br>也可以点上方「➕ 创建新卷子」自己组卷');
    return;
  }
  grid.innerHTML = sets.map(set => {
    const v = setProgressView(set, 'all');
    const srcLabel = set.type === 'book'
      ? '来源：' + esc(set.source || set.name)
      : '自定义 · ' + (set.chapter === 'all' ? '全部章节' : '第' + set.chapter + '章') + ' · ' + qtypeLabel(set.qtype);
    return `<div class="set-card" onclick="openSet('${esc(set.id)}')">
      <div class="set-header">
        <div class="set-title">${esc(set.name)}</div>
        <div class="set-source">${srcLabel}</div>
      </div>
      <div class="set-meta">
        <span class="set-count">${v.total} 题</span>
        <span class="set-progress">已做 ${v.done}/${v.total}</span>
        ${v.attempts ? `<span class="set-rate">正确率 ${v.rate}%</span>` : ''}
      </div>
      <div class="set-progress-bar"><div class="set-progress-fill" style="width:${v.pct}%"></div></div>
      <div class="set-actions" onclick="event.stopPropagation()">
        <button class="btn btn-primary btn-sm" onclick="startSetPractice('${esc(set.id)}', {mode:'continue'})">${v.left ? '▶ 继续练习' : '🔄 再刷一遍'}</button>
        <button class="btn btn-outline btn-sm" onclick="openSet('${esc(set.id)}')">套卷详情</button>
      </div>
    </div>`;
  }).join('');
}

/* 打开某一套卷子的详情页（税种/题型/题量筛选、题目清单、各种练习入口） */
function openSet(setId, opts) {
  opts = opts || {};
  const set = getSetById(setId);
  if (!set) { showSetsList(); return; }
  const rebuild = currentSetId !== setId || opts.reset;
  currentSetId = setId;
  if (rebuild) setChapterSel = [];   // 换卷子 → 税种选择重置为「全部」
  showPage('page-set-detail');
  if (rebuild) {
    const pool = setPool(set);
    const counts = { single: 0, multiple: 0, calc: 0, comprehensive: 0 };
    pool.forEach(q => { counts[q.type] = (counts[q.type] || 0) + 1; });
    document.getElementById('setTypeFilter').innerHTML = `<option value="all">全部题型（${pool.length}）</option>`
      + ['single', 'multiple', 'calc', 'comprehensive'].filter(t => counts[t]).map(t =>
        `<option value="${t}">${TYPE_NAMES[t]}（${counts[t]}）</option>`).join('');
    document.getElementById('setCountLimit').value = pool.length > 200 ? '50' : '0';
  }
  renderSetDetail();
}
function showSetDetail(setId) {
  if (!setId) { showSetsList(); return; }
  openSet(setId);
}

function renderSetDetail() {
  const set = getSetById(currentSetId);
  if (!set) { showSetsList(); return; }
  const qtype = document.getElementById('setTypeFilter').value || 'all';
  // 题型变化后，清掉已不存在的税种选择
  const avail = setChapters(set, qtype).map(c => c.ch);
  setChapterSel = setChapterSel.filter(ch => avail.includes(Number(ch)));
  const v = setProgressView(set, qtype, setChapterSel);
  const selLabel = setChapterSel.length ? chapterSelLabel(setChapterSel) : '全部税种';
  document.getElementById('setDetailName').textContent = set.name;
  document.getElementById('setDetailSub').textContent = (set.type === 'book' ? '来源：' + (set.source || '') : '自定义卷子')
    + ` · 当前筛选：${selLabel} · ${qtypeLabel(qtype)}（${v.total} 题）`;
  renderSetChapterChips(set, qtype);
  document.getElementById('setDetailStats').innerHTML = `
    <div class="stat-card"><div class="num">${v.total}</div><div class="label">当前范围题量</div></div>
    <div class="stat-card green"><div class="num">${v.done}</div><div class="label">已做过</div></div>
    <div class="stat-card orange"><div class="num">${v.attempts ? v.rate + '%' : '—'}</div><div class="label">正确率</div></div>
    <div class="stat-card red"><div class="num">${v.left}</div><div class="label">未做</div></div>`;
  document.getElementById('setProgressLine').innerHTML =
    `<div class="set-progress-bar"><div class="set-progress-fill" style="width:${v.pct}%"></div></div>
     <div class="set-progress-text">当前范围完成度 ${v.pct}%（已做 ${v.done} / ${v.total} 题，练习作答 ${v.attempts} 次）</div>`;
  document.getElementById('setResumeBtn').textContent = v.left ? `▶ 继续练习（未做 ${v.left} 题）` : '🔄 当前范围已做完 · 重刷一遍';
  document.getElementById('setWrongBtn').textContent = `❌ 本卷错题重练（${v.wrong}）`;
  document.getElementById('setDeleteBtn').style.display = set.type === 'custom' ? '' : 'none';
  renderSetQuestionGrid(v, set);
}

/* 税种 / 章节多选 chips（自由组合，如「必刷550题」只刷增值税） */
function renderSetChapterChips(set, qtype) {
  const box = document.getElementById('setChapterChips');
  if (!box) return;
  const list = setChapters(set, qtype);
  if (list.length <= 1) { box.innerHTML = '<span class="set-chips-empty">本卷题目未分章节</span>'; return; }
  const allChip = `<span class="set-chip all ${setChapterSel.length ? '' : 'active'}" onclick="toggleSetChapter(0, true)">全部税种（${list.reduce((s, c) => s + c.count, 0)}）</span>`;
  box.innerHTML = allChip + list.map(c => {
    const on = setChapterSel.includes(c.ch);
    const nm = c.ch ? '第' + c.ch + '章 ' + c.name : '未分章';
    return `<span class="set-chip ${on ? 'active' : ''}" onclick="toggleSetChapter(${c.ch})">${esc(nm)}（${c.count}）</span>`;
  }).join('');
}

/* ch=0 且 isAll 时清空选择（＝全部税种）；否则切换该章节 */
function toggleSetChapter(ch, isAll) {
  if (isAll) { setChapterSel = []; renderSetDetail(); return; }
  ch = Number(ch);
  setChapterSel = setChapterSel.includes(ch) ? setChapterSel.filter(x => x !== ch) : [...setChapterSel, ch];
  renderSetDetail();
}

function setChapterSelAll() {
  const set = getSetById(currentSetId);
  if (!set) return;
  setChapterSel = setChapters(set, document.getElementById('setTypeFilter').value || 'all').map(c => c.ch);
  renderSetDetail();
}

function renderSetQuestionGrid(v, set) {
  const box = document.getElementById('setQuestionGrid');
  const MAX = 800;
  const doneIds = new Set(setProg(set.id).doneIds);
  const cells = v.pool.slice(0, MAX).map((q, i) => {
    const isWrong = !!wrongStore[q.id];
    const cls = 'set-q-cell' + (doneIds.has(q.id) ? ' done' : '') + (isWrong ? ' wrong' : '');
    const tip = (TYPE_NAMES[q.type] || '') + ' · 第' + (q.chapter || '?') + '章' + (isWrong ? ' · 曾做错' : '');
    return `<span class="${cls}" title="${esc(tip)}" onclick="jumpToSetQuestion(${i})">${i + 1}</span>`;
  }).join('');
  box.innerHTML = cells + (v.pool.length > MAX
    ? `<div class="set-q-more">…当前范围共 ${v.pool.length} 题，清单只显示前 ${MAX} 题（可用上方税种/题型缩小范围）</div>` : '');
}

function jumpToSetQuestion(index) {
  startSetPractice(currentSetId, { mode: 'jump', index: index });
}

/* 开始按套刷题
 * mode: continue=继续未做 | all=重做全部 | wrong=本卷错题 | exam=限时整卷 | jump=从第 N 题开始 */
function startSetPractice(setId, opts) {
  opts = opts || {};
  const mode = opts.mode || 'continue';
  const set = getSetById(setId);
  if (!set) { alert('卷子不存在'); showSetsList(); return; }
  const onDetail = document.getElementById('page-set-detail').style.display !== 'none';
  const qtype = onDetail ? (document.getElementById('setTypeFilter').value || 'all') : 'all';
  const chapters = onDetail ? setChapterSel.slice() : [];
  const v = setProgressView(set, qtype, chapters);
  const pool = v.pool;
  if (!pool.length) { alert('该卷子在当前筛选下没有题目'); return; }
  const exam = mode === 'exam';
  // 同一套卷子上次做到一半 → 询问是否续做
  const prog = getSavedProgress();
  if (mode === 'continue' && prog && prog.setId === setId && (prog.qids || []).length) {
    if (tryResumeProgress('set')) return;
  }
  if (prog && prog.setId === setId) clearProgress();   // 换练习方式 → 放弃旧进度
  const doneIds = new Set(setProg(setId).doneIds);
  let list = pool.slice();
  let label = '';
  if (mode === 'continue') {
    list = list.filter(q => !doneIds.has(q.id));
    if (!list.length) {
      if (!confirm('本卷当前筛选的题目已全部做过。\n「确定」重刷一遍全部题目，「取消」返回卷子详情。')) return;
      list = pool.slice();
      label = ' · 重刷';
    } else label = ' · 继续未做';
  } else if (mode === 'all') {
    label = ' · 全部题目';
  } else if (mode === 'wrong') {
    list = list.filter(q => wrongStore[q.id]);
    if (!list.length) { alert('本卷暂无错题记录（做错过的题会自动进错题库）'); return; }
    label = ' · 错题重练';
  }
  // 题量限制（详情页选择；「全部」为 0）
  const limit = onDetail ? (parseInt(document.getElementById('setCountLimit').value, 10) || 0) : 0;
  if (mode !== 'jump' && limit > 0) list = list.slice(0, limit);
  if (!list.length) { alert('没有可练习的题目'); return; }
  const startIndex = mode === 'jump' ? Math.max(0, Math.min(opts.index || 0, pool.length - 1)) : 0;
  const baseTitle = set.name
    + (chapters.length ? ' · ' + chapterSelLabel(chapters) : '')
    + (qtype === 'all' ? '' : ' · ' + qtypeLabel(qtype))
    + (exam ? '' : label);
  startQuiz({
    mode: 'set', setId: setId, questions: list, index: startIndex,
    title: exam ? '限时考试 · ' + baseTitle : baseTitle,
    exam: exam, setExam: exam,
    durationMin: exam ? Math.min(180, Math.max(20, Math.round(list.length * 1.2))) : 0,
    fullScore: 100,
  });
}

function showCreateSet() {
  showPage('page-set-create');
  renderCreateSetFilters();
  updateSetPreview();
}
function renderCreateSetFilters() {
  const sel = document.getElementById('newSetChapter');
  sel.innerHTML = '<option value="all">全部章节</option>' + SYLLABUS.map(s =>
    '<option value="' + s.ch + '">第' + s.ch + '章 ' + s.name + '</option>').join('');
}
function updateSetPreview() {
  const name = document.getElementById('newSetName').value.trim();
  if (!name) { document.getElementById('newSetPreview').textContent = '0 题'; return; }
  let pool = QUESTIONS.slice();
  const ch = document.getElementById('newSetChapter').value;
  const tp = document.getElementById('newSetType').value;
  if (ch !== 'all') pool = pool.filter(q => (q.chapter || 0) === Number(ch));
  if (tp !== 'all') pool = pool.filter(q => q.type === tp);
  document.getElementById('newSetPreview').textContent = pool.length + ' 题';
}
function confirmCreateSet() {
  const name = document.getElementById('newSetName').value.trim();
  const ch = document.getElementById('newSetChapter').value;
  const tp = document.getElementById('newSetType').value;
  if (!name) { alert('请输入卷子名称'); return; }
  let pool = QUESTIONS.slice();
  if (ch !== 'all') pool = pool.filter(q => (q.chapter || 0) === Number(ch));
  if (tp !== 'all') pool = pool.filter(q => q.type === tp);
  if (!pool.length) { alert('根据所选条件找不到题目'); return; }
  const setId = 'custom-' + ch + '-' + tp + '-' + Date.now();
  setsStore.sets.push({ id: setId, name: name, type: 'custom', chapter: ch, qtype: tp, count: pool.length, subject: currentSubject, createdAt: Date.now() });
  saveLS(LS_SETS, setsStore);
  openSet(setId);
  startSetPractice(setId, { mode: 'continue' });
}
function deleteSet(setId) {
  const set = getSetById(setId);
  if (!confirm('确定删除「' + (set ? set.name : '该卷子') + '」吗？练习进度会一并清空。')) return;
  if (setsStore.progress) delete setsStore.progress[setId];
  setsStore.sets = setsStore.sets.filter(s => s.id !== setId);
  saveLS(LS_SETS, setsStore);
  const prog = getSavedProgress();
  if (prog && prog.setId === setId) clearProgress();
  showSetsList();
}

/* ---------- 答题卡 ---------- */
function renderSheet() {
  const grid = document.getElementById('sheetGrid');
  if (!currentQuiz || !currentQuiz.exam) return;
  grid.innerHTML = currentQuiz.questions.map((q, i) => {
    const answered = (currentQuiz.answers[q.id] || []).length > 0;
    return `<div class="sheet-cell ${answered ? 'answered' : ''}" onclick="goToIndex(${i})">${i + 1}</div>`;
  }).join('');
}

function goToIndex(i) {
  if (i < 0 || i >= currentQuiz.questions.length) return;
  currentQuiz.index = i;
  renderQuestion();
}

/* ---------- 考试交卷 ---------- */
function submitExam() {
  if (!currentQuiz || !currentQuiz.exam) return;
  const unanswered = currentQuiz.questions.filter(q => !(currentQuiz.answers[q.id] || []).length);
  if (unanswered.length && !confirm(`还有 ${unanswered.length} 题未作答，确定交卷吗？`)) return;
  clearInterval(currentQuiz.timerId);
  // 评分（套卷考试不带 scoring 配置 → 用默认每题分值，最终按百分比计分）
  const scoring = currentQuiz.scoring || {};
  const details = currentQuiz.questions.map((q, i) => {
    const saved = currentQuiz.answers[q.id] || [];
    const correct = checkAnswer(q, saved);
    const pts = scoring[q.type] || 1.5;
    return { q, index: i + 1, saved, correct, pts };
  });
  const totalPts = details.reduce((s, d) => s + d.pts, 0);
  const gotPts = details.filter(d => d.correct).reduce((s, d) => s + d.pts, 0);
  const fullScore = currentQuiz.fullScore || 100;
  let score, pass;
  if (currentQuiz.setExam) {
    // 卷子考试采用百分比计分
    score = Math.round(details.filter(d => d.correct).length / details.length * 100);
    pass = score >= 60;
  } else {
    score = Math.round(gotPts / totalPts * fullScore);
    pass = score >= (fullScore * 0.6);
  }
  // 记录统计与错题（考试也记录）
  for (const d of details) {
    recordStat(d.q.id, d.correct);
    recordWrongSrs(d.q.id, d.correct);
    if (currentQuiz.setId) recordSetStat(currentQuiz.setId, d.q.id, d.correct);   // 整卷考试也计入套卷进度
  }
  currentQuiz.examResult = { details, score, gotPts, totalPts, pass, title: currentQuiz.title, fullScore };
  saveLS(LS_EXAM, { title: currentQuiz.title, score, time: new Date().toISOString() });
  showExamResult();
}

function showExamResult() {
  const r = currentQuiz.examResult;
  showPage('page-result');
  document.getElementById('resultTitle').textContent = r.title;
  const info = currentQuiz.setExam
    ? `答对 ${r.details.filter(d => d.correct).length} / ${r.details.length} 题 · 正确率 ${r.score}% · ${r.pass ? '✅ 通过（≥60%）' : '❌ 未通过（60% 及格）'}`
    : `满分 ${r.fullScore} 分 · 答对 ${r.details.filter(d => d.correct).length} / ${r.details.length} 题 · ${r.gotPts} / ${r.totalPts} 题面分 · ${r.pass ? '✅ 通过（≥' + Math.round(r.fullScore * 0.6) + '分）' : '❌ 未通过（' + Math.round(r.fullScore * 0.6) + '分及格）'}`;
  document.getElementById('resultSummary').innerHTML = `
    <div class="score ${r.pass ? 'pass' : 'fail'}">${r.score} ${currentQuiz.setExam ? '%' : '分'}</div>
    <div class="info">${info}</div>
    <div class="info">做错的题目已自动加入错题库</div>`;
  document.getElementById('resultDetail').innerHTML = '';
  // 套卷考试：返回本卷详情；普通模拟考：返回考试选择
  document.getElementById('resultActions').innerHTML = currentQuiz.setId
    ? `<button class="btn btn-primary" onclick="reviewExam()">查看全部解析</button>
       <button class="btn btn-outline" onclick="backFromResult()">返回本卷详情</button>`
    : `<button class="btn btn-primary" onclick="reviewExam()">查看全部解析</button>
       <button class="btn btn-outline" onclick="showExamSetup()">返回考试选择</button>`;
  updateWrongBadge();
}

function reviewExam() {
  const r = currentQuiz.examResult;
  const html = r.details.map(d => {
    const q = d.q;
    const optsHtml = q.options.map(o => {
      let cls = '';
      if ((q.answer || []).includes(o.key)) cls = 'rv-correct';
      else if (d.saved.includes(o.key)) cls = 'rv-wrong';
      return `<div class="${cls}">${o.key}. ${esc(o.text)}${cls === 'rv-correct' ? ' ✓' : ''}${cls === 'rv-wrong' ? ' ✗' : ''}</div>`;
    }).join('');
    return `<div class="review-item">
      <div class="rv-meta">
        <span class="tag tag-type">${TYPE_NAMES[q.type]}</span>
        <span class="tag tag-chapter">第${q.chapter || '?'}章</span>
        <span class="tag ${d.correct ? 'tag-type' : ''}" style="${d.correct ? '' : 'background:#fef2f2;color:#dc2626'}">${d.correct ? '✓ 答对' : '✗ 答错'}</span>
      </div>
      ${q.material ? `<div class="material-box" style="margin-bottom:10px"><div class="material-title">【资料】</div><div class="material-text">${esc(q.material)}</div></div>` : ''}
      <div class="rv-stem">${d.index}. ${esc(q.stem)}</div>
      <div class="rv-opts">${optsHtml}</div>
      <div class="rv-answer">正确答案：<b>${(q.answer || []).join('')}</b>${d.saved.length ? `　你的答案：<span class="your">${d.saved.join('')}</span>` : '　未作答'}</div>
      ${q.explanation ? `<div class="rv-expl">${esc(q.explanation)}</div>` : ''}
    </div>`;
  }).join('');
  document.getElementById('resultDetail').innerHTML = html;
  document.getElementById('resultDetail').scrollIntoView({ behavior: 'smooth' });
}

/* ---------- 错题库（可按卷子区分） ---------- */
let wrongFilter = 'all';   // 'all' | 'set:<setId>' | 'src:<来源文本>'

function updateWrongBadge() {
  const n = Object.keys(wrongStore).length;
  const badge = document.getElementById('wrongBadge');
  badge.textContent = n;
  badge.classList.toggle('show', n > 0);
}

/* 一道错题的「主归属卷子」：来源命中自动识别的整卷 → 该整卷；否则按来源文本分组 */
function wrongSetOf(q) {
  if (!q) return { key: 'src:__none__', name: '未标注来源' };
  const bookSet = (setsStore.sets || []).find(s => s.type === 'book' && s.source === q.source);
  if (bookSet) return { key: 'set:' + bookSet.id, name: bookSet.name, setId: bookSet.id };
  const src = (q.source || '').trim();
  return { key: 'src:' + (src || '__none__'), name: src || '未标注来源' };
}

/* 自定义卷子中含多少道错题（用于筛选下拉的可选项） */
function customSetWrongCounts(ids) {
  const out = new Map();
  const customs = (setsStore.sets || []).filter(s => s.type === 'custom');
  if (!customs.length) return out;
  const idSet = new Set(ids);
  for (const s of customs) {
    let n = 0;
    for (const q of setPool(s)) if (idSet.has(q.id)) n++;
    if (n) out.set(s.id, n);
  }
  return out;
}

function wrongFilteredIds() {
  const ids = Object.keys(wrongStore).filter(id => qById(id));
  if (wrongFilter === 'all') return ids;
  if (wrongFilter.indexOf('set:') === 0) {
    const setId = wrongFilter.slice(4);
    const set = getSetById(setId);
    if (!set) return ids;
    if (set.type === 'custom') {
      const pool = new Set(setPool(set).map(q => q.id));
      return ids.filter(id => pool.has(id));
    }
    return ids.filter(id => (qById(id) || {}).source === set.source);
  }
  if (wrongFilter.indexOf('src:') === 0) {
    const src = wrongFilter.slice(4);
    return ids.filter(id => ((qById(id) || {}).source || '').trim() === src || (src === '__none__' && !((qById(id) || {}).source || '').trim()));
  }
  return ids;
}

function wrongFilterName() {
  if (wrongFilter === 'all') return '全部错题';
  if (wrongFilter.indexOf('set:') === 0) {
    const set = getSetById(wrongFilter.slice(4));
    return set ? set.name : '全部错题';
  }
  const src = wrongFilter.slice(4);
  return src === '__none__' ? '未标注来源' : src;
}

function wrongFilterChange(v) {
  wrongFilter = v || 'all';
  renderWrongList();
}

function addWrong(qid) {
  if (!wrongStore[qid]) wrongStore[qid] = { count: 1, lastWrong: Date.now() };
  else wrongStore[qid].count++;
  saveLS(LS_WRONG, wrongStore);
  updateWrongBadge();
}

function removeWrong(qid) {
  delete wrongStore[qid];
  saveLS(LS_WRONG, wrongStore);
  updateWrongBadge();
  renderWrongList();
}

function clearWrong() {
  if (!Object.keys(wrongStore).length) { alert('错题库为空'); return; }
  if (!confirm('确定清空全部错题记录吗？')) return;
  for (const k in wrongStore) delete wrongStore[k];
  saveLS(LS_WRONG, wrongStore);
  updateWrongBadge();
  renderWrongList();
}

function showWrongList() {
  showPage('page-wrong');
  renderWrongList();
}

function renderWrongList() {
  const list = document.getElementById('wrongList');
  const now = Date.now();
  // 题库更新后可能残留已不存在的题目 → 顺手清理
  let stale = false;
  for (const id of Object.keys(wrongStore)) {
    if (!qById(id)) { delete wrongStore[id]; stale = true; }
  }
  if (stale) saveLS(LS_WRONG, wrongStore);
  const allIds = Object.keys(wrongStore);
  const dueCount = allIds.filter(id => !wrongStore[id].due || wrongStore[id].due <= now).length;

  // ---- 卷子分组（用于筛选下拉） ----
  const groups = new Map();   // key -> {key,name,count}
  for (const id of allIds) {
    const g = wrongSetOf(qById(id));
    if (!groups.has(g.key)) groups.set(g.key, { key: g.key, name: g.name, count: 0 });
    groups.get(g.key).count++;
  }
  const groupList = [...groups.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh'));
  const customCounts = customSetWrongCounts(allIds);

  const sel = document.getElementById('wrongSetFilter');
  if (sel) {
    sel.innerHTML = `<option value="all">全部错题（${allIds.length}）</option>`
      + `<optgroup label="按卷子 / 来源">`
      + groupList.map(g => `<option value="${esc(g.key)}">${esc(g.name)}（${g.count}）</option>`).join('')
      + `</optgroup>`
      + (customCounts.size
        ? `<optgroup label="自定义卷子">` + [...customCounts.entries()].map(([sid, n]) => {
            const s = getSetById(sid);
            return `<option value="set:${esc(sid)}">${esc(s ? s.name : sid)}（${n}）</option>`;
          }).join('') + `</optgroup>`
        : '');
    // 当前筛选失效（该卷错题已清零）→ 回落到全部
    if (wrongFilter !== 'all' && !sel.querySelector(`option[value="${wrongFilter.replace(/"/g, '\\"')}"]`)) {
      wrongFilter = 'all';
    }
    sel.value = wrongFilter;
  }

  const ids = wrongFilteredIds();
  const txt = document.getElementById('wrongCountText');
  if (txt) {
    txt.textContent = wrongFilter === 'all'
      ? `（${allIds.length} 题 · ${dueCount} 到期）`
      : `（当前筛选 ${ids.length} / 共 ${allIds.length} 题 · 到期 ${ids.filter(id => !wrongStore[id].due || wrongStore[id].due <= now).length}）`;
  }
  const rvBtn = document.getElementById('wrongReviewBtn');
  if (rvBtn) {
    rvBtn.textContent = wrongFilter === 'all' ? `重练到期错题` : `重练「${wrongFilterName()}」（${ids.length}）`;
  }
  if (!allIds.length) {
    list.innerHTML = `<div class="empty"><div class="big">🎉</div>错题库为空，继续保持！<br>做错的题会自动收录到这里，重练答对一次即移出</div>`;
    return;
  }
  if (!ids.length) {
    list.innerHTML = `<div class="empty"><div class="big">✅</div>「${esc(wrongFilterName())}」的错题已全部清空<br>可在上方切换回「全部错题」</div>`;
    return;
  }
  // 到期优先，其次最近错误时间
  ids.sort((a, b) => {
    const da = (!wrongStore[a].due || wrongStore[a].due <= now) ? 0 : 1;
    const db = (!wrongStore[b].due || wrongStore[b].due <= now) ? 0 : 1;
    if (da !== db) return da - db;
    return (wrongStore[b].lastWrong || 0) - (wrongStore[a].lastWrong || 0);
  });
  list.innerHTML = ids.map(id => {
    const q = qById(id);
    const info = wrongStore[id];
    const date = new Date(info.lastWrong).toLocaleDateString();
    const isDue = !info.due || info.due <= now;
    const dueTag = isDue ? '<span class="tag tag-due">待复习</span>' : '';
    const g = wrongSetOf(q);
    return `<div class="wrong-item">
      <div class="wi-info">
        <div class="wi-stem" onclick="startWrongReview(['${id}'])">${esc(q.stem)}</div>
        <div class="wi-meta">
          <span class="tag tag-source">📄 ${esc(g.name)}</span>
          <span>${TYPE_NAMES[q.type]}</span>
          <span>第${q.chapter || '?'}章 ${chapterName(q.chapter)}</span>
          <span>答错 ${info.count} 次</span>
          <span>最近 ${date}</span>
          ${dueTag}
        </div>
      </div>
      <div class="wi-actions">
        <button class="btn btn-primary btn-sm" onclick="startWrongReview(['${id}'])">重练</button>
        <button class="btn btn-outline btn-sm" onclick="removeWrong('${id}')">移出</button>
      </div>
    </div>`;
  }).join('');
}

/* 重练「当前筛选」的错题（按卷子筛选时即本卷错题） */
function startWrongReviewFiltered() {
  const ids = wrongFilteredIds();
  if (!ids.length) { alert('当前筛选下没有错题'); return; }
  startWrongReview(ids, wrongFilter === 'all' ? null : wrongFilterName());
}

function startWrongReview(ids, titleName) {
  let list;
  if (ids && ids.length) {
    list = ids.map(id => qById(id)).filter(Boolean);
  } else {
    // 默认只练到期错题（未到期的不重复打扰）
    if (tryResumeProgress('wrong')) return;
    const now = Date.now();
    const dueIds = Object.keys(wrongStore).filter(id => {
      const w = wrongStore[id];
      return (!w.due || w.due <= now) && qById(id);
    });
    list = dueIds.map(id => qById(id)).filter(Boolean);
    if (!list.length) {
      const all = Object.keys(wrongStore).map(id => qById(id)).filter(Boolean);
      if (all.length) {
        if (!confirm(`暂无到期错题（还有 ${all.length} 题未到复习时间）。\n「确定」立即重练全部 ${all.length} 题，「取消」返回。`)) return;
        list = all;
      }
    }
  }
  if (!list.length) { alert('错题库为空'); return; }
  const prefix = titleName ? `「${titleName}」错题重练` : '错题重练';
  startQuiz({ mode: 'wrong', questions: groupSort(list), title: `${prefix}（${list.length} 题）` });
}

/* ---------- 收藏 ---------- */
function updateFavBadge() {
  const n = Object.keys(favStore).length;
  const badge = document.getElementById('favBadge');
  badge.textContent = n;
  badge.classList.toggle('show', n > 0);
}

function isFav(qid) {
  return !!favStore[qid];
}

function toggleFavorite() {
  const q = currentQ();
  if (!q) return;
  const btn = document.getElementById('favBtn');
  if (favStore[q.id]) {
    delete favStore[q.id];
    btn.textContent = '☆ 收藏';
    btn.classList.remove('active');
  } else {
    favStore[q.id] = Date.now();
    btn.textContent = '★ 已收藏';
    btn.classList.add('active');
  }
  saveLS(LS_FAV, favStore);
  updateFavBadge();
}

function renderFavBtn() {
  const q = currentQ();
  const btn = document.getElementById('favBtn');
  if (!q) return;
  if (favStore[q.id]) {
    btn.textContent = '★ 已收藏';
    btn.classList.add('active');
  } else {
    btn.textContent = '☆ 收藏';
    btn.classList.remove('active');
  }
}

function showFavoriteList() {
  showPage('page-favorite');
  renderFavList();
}

function renderFavList() {
  const list = document.getElementById('favList');
  const ids = Object.keys(favStore);
  document.getElementById('favCountText').textContent = `（${ids.length} 题）`;
  if (!ids.length) {
    list.innerHTML = `<div class="empty"><div class="big">☆</div>还没有收藏题目<br>做题时点击「☆ 收藏」按钮即可收藏</div>`;
    return;
  }
  ids.sort((a, b) => favStore[b] - favStore[a]);
  list.innerHTML = ids.map(id => {
    const q = qById(id);
    if (!q) return '';
    return `<div class="wrong-item">
      <div class="wi-info">
        <div class="wi-stem" onclick="startFavReview(['${id}'])">${esc(q.stem)}</div>
        <div class="wi-meta">
          <span>${TYPE_NAMES[q.type]}</span>
          <span>第${q.chapter || '?'}章 ${chapterName(q.chapter)}</span>
          <span>${q.source || ''}</span>
        </div>
      </div>
      <div class="wi-actions">
        <button class="btn btn-primary btn-sm" onclick="startFavReview(['${id}'])">刷此题</button>
        <button class="btn btn-outline btn-sm" onclick="removeFav('${id}')">取消收藏</button>
      </div>
    </div>`;
  }).join('');
}

function removeFav(qid) {
  delete favStore[qid];
  saveLS(LS_FAV, favStore);
  updateFavBadge();
  renderFavList();
}

function startFavoriteReview(ids) {
  let list;
  if (ids && ids.length) {
    list = ids.map(id => qById(id)).filter(Boolean);
  } else {
    if (tryResumeProgress('favorite')) return;
    list = Object.keys(favStore).map(id => qById(id)).filter(Boolean);
  }
  if (!list.length) { alert('收藏夹为空'); return; }
  startQuiz({ mode: 'favorite', questions: list, title: `收藏题练习（${list.length} 题）` });
}

/* ---------- 题目搜索 ---------- */
function showSearch() {
  showPage('page-search');
  const sel = document.getElementById('searchScope');
  sel.innerHTML = '<option value="all">全部章节</option>' + SYLLABUS.map(s =>
    `<option value="${s.ch}">第${s.ch}章 ${s.name}</option>`).join('');
  document.getElementById('searchInput').focus();
  document.getElementById('searchResult').innerHTML = '';
}

function doSearch() {
  const kw = document.getElementById('searchInput').value.trim();
  const scope = document.getElementById('searchScope').value;
  const resBox = document.getElementById('searchResult');
  if (!kw) { resBox.innerHTML = '<div class="empty"><div class="big">🔍</div>请输入搜索关键词</div>'; return; }
  // 多关键词（空格分隔，全部命中）
  const kws = kw.split(/\s+/).filter(Boolean).map(k => k.toLowerCase());
  let pool = QUESTIONS.slice();
  if (scope !== 'all') pool = pool.filter(q => (q.chapter || 0) == scope);
  const hits = pool.filter(q => {
    const text = (q.stem + ' ' + (q.material || '') + ' '
      + q.options.map(o => o.text).join(' ') + ' ' + (q.explanation || '')).toLowerCase();
    return kws.every(k => text.includes(k));
  });
  if (!hits.length) {
    resBox.innerHTML = `<div class="empty"><div class="big">😕</div>没有找到匹配「${esc(kw)}」的题目</div>`;
    return;
  }
  resBox.innerHTML = `<div class="search-count">共找到 ${hits.length} 题</div>` +
    hits.map(q => {
      // 高亮匹配词
      let stem = esc(q.stem);
      for (const k of kws) {
        stem = stem.replace(new RegExp('(' + escRe(k) + ')', 'gi'), '<mark>$1</mark>');
      }
      return `<div class="search-item" onclick="startSearchQuiz(${hits.indexOf(q)})">
        <div class="si-stem">${stem.length > 90 ? stem.slice(0, 90) + '…' : stem}</div>
        <div class="si-meta">
          <span>${TYPE_NAMES[q.type]}</span>
          <span>第${q.chapter || '?'}章 ${chapterName(q.chapter)}</span>
          <span>${q.source || ''}</span>
          <span class="match">${hits.length} 题命中</span>
        </div>
      </div>`;
    }).join('');
  // 保存搜索结果以便点击进入
  window.__searchHits = hits;
}

function escRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function startSearchQuiz(idx) {
  const hits = window.__searchHits || [];
  if (!hits.length) return;
  startQuiz({ mode: 'search', questions: hits, index: idx, title: `搜索结果练习（${hits.length} 题）` });
}

/* ---------- 统计 ---------- */
function recordStat(qid, correct) {
  if (!statsStore[qid]) statsStore[qid] = { right: 0, wrong: 0 };
  if (correct) statsStore[qid].right++; else statsStore[qid].wrong++;
  saveLS(LS_STATS, statsStore);
}

function showStats() {
  showPage('page-stats');
  let right = 0, wrong = 0, answered = 0;
  for (const k in statsStore) { right += statsStore[k].right; wrong += statsStore[k].wrong; }
  answered = Object.keys(statsStore).length;
  const rate = (right + wrong) ? Math.round(right / (right + wrong) * 100) : 0;
  const wrongCount = Object.keys(wrongStore).length;
  document.getElementById('statsCards').innerHTML = `
    <div class="stat-card"><div class="num">${answered}</div><div class="label">已练题目（去重）</div></div>
    <div class="stat-card green"><div class="num">${rate}%</div><div class="label">总正确率</div></div>
    <div class="stat-card red"><div class="num">${wrongCount}</div><div class="label">错题数</div></div>
    <div class="stat-card orange"><div class="num">${Math.round(answered / Math.max(1, QUESTIONS.length) * 100)}%</div><div class="label">题库完成度</div></div>`;
  // 章节正确率
  const rows = SYLLABUS.map(s => {
    let r = 0, w = 0;
    for (const q of QUESTIONS) {
      if ((q.chapter || 0) !== s.ch) continue;
      const st = statsStore[q.id];
      if (st) { r += st.right; w += st.wrong; }
    }
    const total = r + w;
    const ratePct = total ? Math.round(r / total * 100) : null;
    const color = ratePct === null ? '#cbd5e1' : ratePct >= 70 ? '#16a34a' : ratePct >= 50 ? '#d97706' : '#dc2626';
    return `<div class="chapter-rate-row">
      <div class="chapter-rate-name">第${s.ch}章 ${s.name}</div>
      <div class="chapter-rate-track"><div class="chapter-rate-fill" style="width:${ratePct === null ? 0 : ratePct}%;background:${color}"></div></div>
      <div class="chapter-rate-num">${ratePct === null ? '未练习' : ratePct + '%'}（${total}题）</div>
    </div>`;
  }).join('');
  document.getElementById('statsChapters').innerHTML = rows;
}

/* ---------- 工具 ---------- */
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* 排序：同一大题组（calc/comprehensive 子问题）保持连续，组内按原顺序；普通题随机 */
function groupSort(qs) {
  const groups = {};      // gid -> [questions in original order]
  const singles = [];
  const order = [];
  for (const q of qs) {
    const gid = q.group_id;
    if (gid) {
      if (!groups[gid]) { groups[gid] = []; order.push(gid); }
      groups[gid].push(q);
    } else {
      singles.push(q);
    }
  }
  // 组随机 + 普通题随机
  const shufGroups = shuffle(order);
  const shufSingles = shuffle(singles);
  const result = [];
  for (const gid of shufGroups) result.push(...groups[gid]);
  result.push(...shufSingles);
  // 打散位置：把普通题插入组之间，避免全部组排前面
  const mixed = [];
  const singleIter = shufSingles[Symbol.iterator]();
  let si = 0;
  const totalGroups = shufGroups.length;
  for (let g = 0; g < totalGroups; g++) {
    mixed.push(...groups[shufGroups[g]]);
    // 每组后插入 1-2 个普通题
    for (let k = 0; k < 2 && si < shufSingles.length; k++) {
      mixed.push(shufSingles[si++]);
    }
  }
  while (si < shufSingles.length) mixed.push(shufSingles[si++]);
  return mixed;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ---------- 练习完成/结果展示（练习模式） ---------- */
function showResult(msg, right, total, title, extraInfo) {
  showPage('page-result');
  document.getElementById('resultTitle').textContent = title || '练习完成';
  document.getElementById('resultSummary').innerHTML = `
    <div class="score ${right / total >= 0.8 ? 'pass' : 'fail'}">${Math.round(right / total * 100)}%</div>
    <div class="info">答对 ${right} / ${total} 题${right === total ? ' 🎉 全对！' : ''}</div>
    ${extraInfo ? `<div class="info">${esc(extraInfo)}</div>` : ''}`;
  document.getElementById('resultActions').innerHTML = `
    <button class="btn btn-primary" onclick="reviewPractice()">查看解析</button>
    <button class="btn btn-outline" onclick="backFromResult()">${currentQuiz && currentQuiz.setId ? '返回本卷详情' : '返回'}</button>`;
  document.getElementById('resultDetail').innerHTML = '';
  updateWrongBadge();
}

function reviewPractice() {
  const html = currentQuiz.questions.map((q, i) => {
    const saved = currentQuiz.answers[q.id] || [];
    const correct = checkAnswer(q, saved);
    const optsHtml = q.options.map(o => {
      let cls = '';
      if ((q.answer || []).includes(o.key)) cls = 'rv-correct';
      else if (saved.includes(o.key)) cls = 'rv-wrong';
      return `<div class="${cls}">${o.key}. ${esc(o.text)}${cls === 'rv-correct' ? ' ✓' : ''}${cls === 'rv-wrong' ? ' ✗' : ''}</div>`;
    }).join('');
    return `<div class="review-item">
      <div class="rv-meta">
        <span class="tag tag-type">${TYPE_NAMES[q.type]}</span>
        <span class="tag tag-chapter">第${q.chapter || '?'}章</span>
        <span class="tag" style="${correct ? 'background:#f0fdf4;color:#16a34a' : 'background:#fef2f2;color:#dc2626'}">${correct ? '✓ 答对' : '✗ 答错'}</span>
      </div>
      ${q.material ? `<div class="material-box" style="margin-bottom:10px"><div class="material-title">【资料】</div><div class="material-text">${esc(q.material)}</div></div>` : ''}
      <div class="rv-stem">${i + 1}. ${esc(q.stem)}</div>
      <div class="rv-opts">${optsHtml}</div>
      <div class="rv-answer">正确答案：<b>${(q.answer || []).join('')}</b>${saved.length ? `　你的答案：<span class="your">${saved.join('')}</span>` : ''}</div>
      ${q.explanation ? `<div class="rv-expl">${esc(q.explanation)}</div>` : ''}
    </div>`;
  }).join('');
  document.getElementById('resultDetail').innerHTML = html;
  document.getElementById('resultDetail').scrollIntoView({ behavior: 'smooth' });
}

function backFromResult() {
  const m = currentQuiz ? currentQuiz.mode : null;
  const sid = currentQuiz ? currentQuiz.setId : null;
  if (m === 'wrong') showWrongList();
  else if (m === 'favorite') showFavoriteList();
  else if (m === 'search') showSearch();
  else if (m === 'chapter') showChapterList();
  else if (m === 'set' && sid) showSetDetail(sid);
  else showHome();
}

function backFromReview() {
  showHome();
}

/* ---------- 初始化 ---------- */
document.addEventListener('DOMContentLoaded', () => {
  // 初始化当前科目（默认税法一）
  currentSubject = '税法一';
  QUESTIONS = ALL_QUESTIONS.filter(q => q.subject === currentSubject);
  CARDS = ALL_CARDS.filter(c => c.subject === currentSubject);
  SYLLABUS = SYLLABUS_S1;
  loadStores();
  // 科目切换按钮高亮
  document.querySelectorAll('.subject-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.subject === currentSubject);
  });
  updateWrongBadge();
  updateFavBadge();
  showHome();
});
