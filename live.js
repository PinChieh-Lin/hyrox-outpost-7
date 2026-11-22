// 第七屆 HYROX 前哨打卡站：正式版資料層（連 Supabase）
// 資料表與函式見 race/supabase/01_hyrox_schema.sql
(() => {
  const SUPABASE_URL = "https://llsdqlfesqxmovcqhtnp.supabase.co";
  const SUPABASE_KEY = "sb_publishable_Ce93FdjBXdjIB_6o1Tt_xA_BTWRBWCv";
  const CHALLENGE_NAME = "第七屆 HYROX 前哨打卡站";
  const ME_KEY = "hyrox7.me";

  const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  // key 與資料表欄位同名
  const TASKS = [
    { key: "strength", no: "01", label: "重訓", sub: "上肢 / 下肢" },
    { key: "long_run", no: "02", label: "長距離", sub: "每週 1 次・+3 分", points: 3, weeklyLimit: 1 },
    { key: "easy_run", no: "03", label: "輕鬆跑", sub: "或運動 1 小時・+1 分" },
    { key: "water", no: "04", label: "喝水", sub: "2500 ml" },
    { key: "healthy_diet", no: "05", label: "健康飲食", sub: "無糖・少油炸" },
    { key: "hyrox_challenge", no: "06", label: "HYROX 挑戰", sub: "午夜抽卡" },
  ];
  const DAILY_CAP = 5;
  const WEEKLY_CAP = 15;
  const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

  // ---------- 日期（一律以台北時間為準） ----------
  const pad = (v) => String(v).padStart(2, "0");
  const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseKey = (k) => new Date(`${k}T00:00:00`);
  const addDays = (d, n) => {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  };
  const md = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
  const taipeiToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());

  // ---------- 狀態 ----------
  let TODAY_KEY = taipeiToday();
  let challenge = null; // { id, start_date, end_date }
  let PLAYERS = []; // { id, name, i }
  let logs = {}; // logs[participantId][dateKey] = { strength: bool, ... }
  let weeks = []; // [[Date x7], ...] 週一開始
  let CUR_WEEK = 0;
  let currentDay = 0;
  let currentPerson = null;
  let personDate = null;
  let draft = null;
  let todayDraw = null;
  let loadError = null;
  let saving = false;
  let dirty = false; // 個人頁有勾選但還沒儲存
  let goals = {}; // goals[participantId] = { has_goal, achieved }
  let goalResults = {}; // 結賽後公開：goalResults[participantId] = { achieved, revealed_goal }
  const promptedGoal = new Set(); // 這次開網頁已經提示過設定目標的人

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const avatar = (p, extra = "") => `<span class="avatar ${extra}" data-i="${p.i}">${esc(p.name[0] || "?")}</span>`;
  const byId = (id) => PLAYERS.find((p) => p.id === id);
  const readMe = () => {
    try { return localStorage.getItem(ME_KEY); } catch { return null; }
  };
  const writeMe = (id) => {
    try { localStorage.setItem(ME_KEY, id); } catch { /* 無痕模式等情況存不了，略過 */ }
  };

  const START_KEY = () => challenge.start_date;
  const END_KEY = () => challenge.end_date;
  const inRange = (k) => challenge && k >= START_KEY() && k <= END_KEY();
  const isOpen = (k) => inRange(k) && k <= TODAY_KEY;
  const started = () => challenge && TODAY_KEY >= START_KEY();
  const ended = () => challenge && TODAY_KEY >= END_KEY();
  const lastOpenKey = () => (TODAY_KEY < END_KEY() ? TODAY_KEY : END_KEY());

  const emptyLog = () => Object.fromEntries(TASKS.map((t) => [t.key, false]));
  const getLog = (id, k) => (logs[id] && logs[id][k]) || emptyLog();
  const pts = (t) => t.points || 1;
  const dayRaw = (o) => TASKS.reduce((s, t) => s + (o[t.key] ? pts(t) : 0), 0);
  const dayScore = (o) => Math.min(DAILY_CAP, dayRaw(o));
  const weekOf = (k) => weeks.findIndex((wk) => wk.some((d) => keyOf(d) === k));
  const weekRaw = (id, w = CUR_WEEK) => (weeks[w] || []).reduce((s, d) => s + (inRange(keyOf(d)) ? dayScore(getLog(id, keyOf(d))) : 0), 0);
  const weekScore = (id, w = CUR_WEEK) => Math.min(WEEKLY_CAP, weekRaw(id, w));
  const totalScore = (id) => weeks.reduce((s, _, w) => s + weekScore(id, w), 0);
  const GOAL_BONUS = 3;
  const goalBonus = (id) => (goals[id] && goals[id].achieved === true ? GOAL_BONUS : 0);
  const finalScore = (id) => totalScore(id) + goalBonus(id);
  const lockedBy = (id, k, t) => {
    if (!t.weeklyLimit) return null;
    const w = weekOf(k);
    if (w < 0) return null;
    const used = weeks[w].map(keyOf).filter((x) => x !== k && getLog(id, x)[t.key]);
    return used.length >= t.weeklyLimit ? used[0] : null;
  };
  const taskLabel = (t) => (pts(t) > 1 ? `${t.label}<small class="th-pt">+${pts(t)}</small>` : t.label);

  // ---------- 提示訊息 ----------
  function notify(msg, type = "ok") {
    let el = $("live-banner");
    if (!el) {
      el = document.createElement("div");
      el.id = "live-banner";
      el.className = "live-banner";
      el.setAttribute("role", "status");
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.dataset.type = type;
    el.classList.add("is-show");
    clearTimeout(notify.t);
    notify.t = setTimeout(() => el.classList.remove("is-show"), type === "error" ? 5000 : 2200);
  }

  function friendlyError(error) {
    if (!error) return "發生未知錯誤，請稍後再試。";
    if (error.code === "23505" && String(error.message).includes("one_long_run_per_week")) return "這週已經打過長距離了，每週只能算 1 次。";
    if (error.code === "P0001") return error.message;
    if (error.message && /fetch|network/i.test(error.message)) return "連不上資料庫，請檢查網路後再試。";
    return `儲存失敗：${error.message || error.code}`;
  }

  // ---------- 讀取 ----------
  function buildWeeks() {
    const start = parseKey(START_KEY());
    const end = parseKey(END_KEY());
    const firstMonday = addDays(start, -((start.getDay() + 6) % 7));
    weeks = [];
    for (let m = firstMonday; m <= end; m = addDays(m, 7)) {
      weeks.push(Array.from({ length: 7 }, (_, d) => addDays(m, d)));
    }
    const anchor = TODAY_KEY < START_KEY() ? START_KEY() : TODAY_KEY > END_KEY() ? END_KEY() : TODAY_KEY;
    CUR_WEEK = Math.max(0, weekOf(anchor));
    currentDay = Math.max(0, weeks[CUR_WEEK].findIndex((d) => keyOf(d) === anchor));
  }

  async function loadAll({ silent = false } = {}) {
    TODAY_KEY = taipeiToday();
    try {
      const { data: ch, error: chErr } = await db
        .from("challenge")
        .select("id, start_date, end_date")
        .eq("name", CHALLENGE_NAME)
        .maybeSingle();
      if (chErr) throw chErr;
      if (!ch) throw new Error(`找不到「${CHALLENGE_NAME}」活動`);
      challenge = ch;

      const { data: ps, error: pErr } = await db
        .from("participants")
        .select("id, name, created_at")
        .eq("challenge_id", ch.id)
        .order("created_at", { ascending: true });
      if (pErr) throw pErr;
      PLAYERS = ps.map((p, i) => ({ id: p.id, name: p.name, i }));

      const ids = PLAYERS.map((p) => p.id);
      const [logRes, drawRes, goalRes, resultRes] = await Promise.all([
        ids.length
          ? db.from("hyrox_daily_logs").select(`participant_id, log_date, ${TASKS.map((t) => t.key).join(", ")}`).in("participant_id", ids)
          : Promise.resolve({ data: [], error: null }),
        db
          .from("hyrox_daily_draws")
          .select("draw_date, drawn_by, drawn_at, hyrox_draw_cards(station, name, home_move, detail, level)")
          .eq("challenge_id", ch.id)
          .eq("draw_date", TODAY_KEY)
          .maybeSingle(),
        db.rpc("hyrox_goal_overview"),
        db.rpc("hyrox_goal_results"),
      ]);
      if (logRes.error) throw logRes.error;
      if (drawRes.error) throw drawRes.error;
      if (goalRes.error) throw goalRes.error;
      goals = {};
      (goalRes.data || []).forEach((g) => (goals[g.participant_id] = { has_goal: g.has_goal, achieved: g.achieved }));
      if (resultRes.error) throw resultRes.error;
      goalResults = {};
      (resultRes.data || []).forEach((g) => (goalResults[g.participant_id] = { achieved: g.achieved, revealed_goal: g.revealed_goal }));

      logs = {};
      PLAYERS.forEach((p) => (logs[p.id] = {}));
      logRes.data.forEach((row) => {
        const o = emptyLog();
        TASKS.forEach((t) => (o[t.key] = !!row[t.key]));
        if (logs[row.participant_id]) logs[row.participant_id][String(row.log_date).slice(0, 10)] = o;
      });

      const d = drawRes.data;
      todayDraw = d && d.hyrox_draw_cards
        ? { ...d.hyrox_draw_cards, draw_date: d.draw_date, drawn_by: d.drawn_by, drawn_by_name: byId(d.drawn_by)?.name || "" }
        : null;

      buildWeeks();
      const me = readMe();
      if (!currentPerson || !byId(currentPerson)) currentPerson = byId(me) ? me : PLAYERS[0]?.id || null;
      if (!personDate || !isOpen(personDate)) personDate = started() ? lastOpenKey() : START_KEY();
      loadError = null;
    } catch (err) {
      console.error(err);
      loadError = err;
      if (!silent) notify(`讀取資料失敗：${err.message || err}`, "error");
    }
    renderRoster();
    renderAll();
    renderDrawState();
  }

  // ---------- 主畫面 ----------
  function renderRoster() {
    const el = $("roster");
    if (!el) return;
    el.innerHTML = PLAYERS.map((p) => `<span class="player" data-i="${p.i}">${avatar(p)}${esc(p.name)}</span>`).join("");
  }

  function renderDayChips() {
    const el = $("day-chips");
    if (!el || !weeks.length) return;
    el.innerHTML = weeks[CUR_WEEK]
      .map((d, i) => {
        const k = keyOf(d);
        const open = isOpen(k);
        const cls = ["day-chip", i === currentDay ? "is-active" : "", open ? "" : "is-future", k === TODAY_KEY ? "is-today" : ""].join(" ");
        return `<button class="${cls}" data-day="${i}" ${open ? "" : "disabled"}><span>週${WEEKDAYS[i]}</span><small>${md(d)}</small></button>`;
      })
      .join("");
  }

  function renderToday() {
    const el = $("today-table");
    if (!el) return;
    if (!weeks.length) {
      el.innerHTML = `<tbody><tr><td class="empty-cell">${loadError ? "資料讀取失敗，請重新整理。" : "載入中…"}</td></tr></tbody>`;
      return;
    }
    const k = keyOf(weeks[CUR_WEEK][currentDay]);
    const head = `<thead><tr><th class="col-name">選手</th>${TASKS.map(
      (t) => `<th><span class="th-no">${t.no}</span><span class="th-label">${taskLabel(t)}</span></th>`
    ).join("")}<th><span class="th-no">DAY</span><span class="th-label">今日</span></th><th><span class="th-no">WEEK</span><span class="th-label">本週</span></th></tr></thead>`;
    const rows = PLAYERS.map((p) => {
      const o = getLog(p.id, k);
      const raw = dayRaw(o);
      const cells = TASKS.map((t) => `<td data-label="${t.label}${pts(t) > 1 ? " +" + pts(t) : ""}"><span class="cell ${o[t.key] ? "is-on" : ""}" aria-label="${esc(p.name)} ${t.label}${o[t.key] ? " 已完成" : ""}">${o[t.key] ? "✓" : ""}</span></td>`).join("");
      return `<tr><td class="col-name"><button class="name-link" data-person="${p.id}">${avatar(p)}${esc(p.name)}</button></td>${cells}<td class="score-cell" data-label="今日"><b>${dayScore(o)}</b><small>/${DAILY_CAP}</small>${raw > DAILY_CAP ? '<i class="cap">MAX</i>' : ""}</td><td class="score-cell week" data-label="本週"><b>${weekScore(p.id)}</b><small>/${WEEKLY_CAP}</small></td></tr>`;
    }).join("");
    el.innerHTML = head + `<tbody>${rows}</tbody>`;
  }

  function renderRanking() {
    const el = $("ranking");
    if (!el || !weeks.length) return;
    const sorted = PLAYERS.map((p) => ({ p, s: weekScore(p.id), raw: weekRaw(p.id) })).sort((a, b) => b.s - a.s || b.raw - a.raw);
    el.innerHTML = sorted
      .map(
        (r, idx) => `<li class="rank-item ${idx < 3 && r.s > 0 ? "is-top" : ""}">
          <span class="rank-no">${pad(idx + 1)}</span>
          ${avatar(r.p)}
          <span class="rank-name">${esc(r.p.name)}</span>
          <span class="bar"><i style="width:${(r.s / WEEKLY_CAP) * 100}%"></i></span>
          <span class="rank-score"><b>${r.s}</b><small>/${WEEKLY_CAP}</small></span>
        </li>`
      )
      .join("");
  }

  // ---------- 總分排行 ----------
  function renderTotal() {
    const el = $("total-board");
    if (!el || !weeks.length) return;
    const rows = PLAYERS.map((p) => ({ p, weeks: weeks.map((_, w) => weekScore(p.id, w)), total: finalScore(p.id) })).sort(
      (a, b) => b.total - a.total || b.weeks[CUR_WEEK] - a.weeks[CUR_WEEK]
    );
    const max = WEEKLY_CAP * weeks.length;
    const podium = [1, 0, 2]
      .filter((i) => rows[i])
      .map((i) => {
        const r = rows[i];
        return `<div class="podium-item rank-${i + 1}">${avatar(r.p, "big")}<b class="podium-name">${esc(r.p.name)}</b><span class="podium-score">${r.total}<small> 分</small></span><div class="podium-block"><span>${i + 1}</span></div></div>`;
      })
      .join("");
    const label = (wk) => {
      const a = inRange(keyOf(wk[0])) ? wk[0] : parseKey(START_KEY());
      const b = inRange(keyOf(wk[6])) ? wk[6] : parseKey(END_KEY());
      return `${md(a)}–${md(b)}`;
    };
    const head = `<thead><tr><th>名次</th><th class="col-name">選手</th><th><span class="th-label">總分</span><span class="th-no">上限 ${max + GOAL_BONUS}</span></th><th><span class="th-label">目標</span><span class="th-no">+${GOAL_BONUS}</span></th>${weeks
      .map((wk, w) => `<th class="${w === CUR_WEEK ? "is-cur" : ""}"><span class="th-label">第 ${w + 1} 週</span><span class="th-no">${label(wk)}</span></th>`)
      .join("")}</tr></thead>`;
    const body = rows
      .map(
        (r, idx) => `<tr class="${idx < 3 && r.total > 0 ? "is-top" : ""}"><td class="total-rank">${pad(idx + 1)}</td><td class="col-name">${avatar(r.p)}${esc(r.p.name)}</td><td class="total-cell"><b>${r.total}</b><span class="bar"><i style="width:${Math.min(100, (r.total / max) * 100)}%"></i></span></td><td class="goal-cell">${goalCell(r.p.id)}</td>${r.weeks
          .map((s, w) => {
            const future = keyOf(weeks[w][0]) > TODAY_KEY;
            return `<td class="${w === CUR_WEEK ? "is-cur" : ""}">${future ? '<small>—</small>' : `<b>${s}</b><small>/${WEEKLY_CAP}</small>`}${w === CUR_WEEK && started() ? '<i class="cap">進行中</i>' : ""}</td>`;
          })
          .join("")}</tr>`
      )
      .join("");
    const anyResult = Object.keys(goalResults).length > 0;
    const reveal = anyResult || ended()
      ? `<div class="goal-reveal"><h3>🎯 結賽目標公開</h3><ul>${PLAYERS.map((p) => {
          const res = goalResults[p.id];
          const g = goals[p.id] || {};
          const badge = res ? (res.achieved ? `<span class="goal-badge is-done">✅ 達成 +${GOAL_BONUS}</span>` : '<span class="goal-badge">未達成</span>') : `<span class="goal-badge">${g.has_goal ? "等待本人確認" : "沒有設定目標"}</span>`;
          return `<li>${avatar(p)}<div><b>${esc(p.name)}</b><span>${res ? esc(res.revealed_goal) : "🔒"}</span></div>${badge}</li>`;
        }).join("")}</ul></div>`
      : "";
    el.innerHTML = `<div class="podium">${podium}</div><div class="table-wrap"><table class="total-table">${head}<tbody>${body}</tbody></table></div>${reveal}`;
  }

  function goalCell(id) {
    const g = goals[id];
    if (!g || !g.has_goal) return '<small title="尚未設定目標">—</small>';
    if (g.achieved === true) return '<span class="goal-badge is-done">✅ +3</span>';
    if (g.achieved === false) return '<span class="goal-badge">未達成</span>';
    return '<span class="goal-badge" title="已設定，內容加密">🔒</span>';
  }

  // ---------- 個人打卡 ----------
  // keepDraft：儲存中或儲存失敗時，保留使用者還沒存進去的勾選
  function renderPersonal(keepDraft) {
    const el = $("person-area");
    if (!el) return;
    const p = byId(currentPerson);
    if (!p) {
      el.innerHTML = `<p class="lead">${loadError ? "資料讀取失敗，請重新整理。" : "載入中…"}</p>`;
      return;
    }
    draft = keepDraft ? { ...keepDraft } : { ...getLog(p.id, personDate) };
    const w = Math.max(0, weekOf(personDate));
    const openKeys = weeks.flat().map(keyOf).filter(isOpen);
    const history = openKeys
      .slice()
      .reverse()
      .map((k) => {
        const o = getLog(p.id, k);
        const raw = dayRaw(o);
        const d = parseKey(k);
        return `<tr class="${k === personDate ? "is-sel" : ""}" data-date="${k}"><td class="col-name">${md(d)}<small>週${WEEKDAYS[(d.getDay() + 6) % 7]}</small></td>${TASKS.map(
          (t) => `<td>${o[t.key] ? `<span class="dot is-on">${pts(t) > 1 ? "+" + pts(t) : "✓"}</span>` : '<span class="dot"></span>'}</td>`
        ).join("")}<td class="score-cell"><b>${dayScore(o)}</b><small>/${DAILY_CAP}</small>${raw > DAILY_CAP ? '<i class="cap">MAX</i>' : ""}</td></tr>`;
      })
      .join("");

    const pre = !started();
    const maxKey = pre ? START_KEY() : lastOpenKey();
    const tasksHtml = `${pre ? `<p class="me-notice">第七屆 ${md(parseKey(START_KEY()))} 開始，當天起才能送出打卡。現在可以先看看有哪些項目。</p>` : ""}
          <div class="me-date">
            <button data-act="prev" aria-label="前一天">←</button>
            <input type="date" value="${personDate}" min="${START_KEY()}" max="${maxKey}" aria-label="打卡日期" />
            <button data-act="next" aria-label="後一天">→</button>
            <button data-act="today">今天</button>
          </div>
          <div class="me-tasks">${TASKS.map((t) => {
            const lock = !draft[t.key] && lockedBy(p.id, personDate, t);
            const sub = lock
              ? `本週已在 ${md(parseKey(lock))} 打卡`
              : t.key === "hyrox_challenge" && todayDraw && personDate === TODAY_KEY
                ? `今日：${esc(todayDraw.home_move)}`
                : t.sub;
            return `<label class="me-task ${draft[t.key] ? "is-on" : ""} ${lock ? "is-locked" : ""}"><input type="checkbox" data-k="${t.key}" ${draft[t.key] ? "checked" : ""} ${lock ? "disabled" : ""} />
              <span class="me-task-no">${t.no}</span><b>${t.label}${pts(t) > 1 ? ` <em class="me-pt">+${pts(t)}</em>` : ""}</b><small>${sub}</small><i class="me-check">${lock ? "–" : "✓"}</i></label>`;
          }).join("")}</div>
          <div class="me-foot">
            <span class="me-day-score">${md(parseKey(personDate))} <b id="me-day-score">${dayScore(draft)}</b>/${DAILY_CAP} 分<em id="me-max">${dayRaw(draft) > DAILY_CAP ? "已達上限" : ""}</em></span>
            <button class="me-save" data-act="save" ${saving ? "disabled" : ""}>${saving ? "儲存中…" : "💾 儲存打卡"}</button>
          </div>`;

    el.innerHTML = `
      <div class="me-grid">
        <div class="me-side">
          <div class="me-label">選擇選手</div>
          <div class="me-players">${PLAYERS.map(
            (x) => `<button class="me-chip ${x.id === p.id ? "is-active" : ""}" data-pid="${x.id}">${avatar(x)}${esc(x.name)}</button>`
          ).join("")}</div>
          <div class="me-card">
            <div class="me-head">
              ${avatar(p, "big")}
              <div class="me-who"><b class="me-name">${esc(p.name)}</b><small>第七屆選手</small></div>
              <button class="me-edit" data-act="edit-name">✏️ 編輯名字</button>
            </div>
            <form class="me-name-form" data-form="name" hidden>
              <input type="text" maxlength="20" value="${esc(p.name)}" aria-label="選手名字" />
              <div class="me-name-actions"><button type="button" data-act="cancel-name">取消</button><button type="submit" class="is-primary">儲存名字</button></div>
              <p class="me-error" hidden></p>
            </form>
            <div class="me-stats">
              <div><span>本週積分</span><b>${weekScore(p.id, w)}</b><small>/${WEEKLY_CAP}</small></div>
              <div><span>累積總分</span><b>${finalScore(p.id)}</b><small>分</small></div>
            </div>
            ${goalBlock(p.id)}
          </div>
        </div>
        <div class="me-main">${tasksHtml}</div>
      </div>
      ${history ? `<div class="me-history"><h3>個人歷史紀錄</h3><div class="table-wrap"><table class="history-table"><thead><tr><th class="col-name">日期</th>${TASKS.map(
        (t) => `<th><span class="th-no">${t.no}</span><span class="th-label">${taskLabel(t)}</span></th>`
      ).join("")}<th><span class="th-label">當日</span></th></tr></thead><tbody>${history}</tbody></table></div></div>` : ""}`;
  }

  function goalBlock(id) {
    const g = goals[id] || {};
    const needConfirm = g.has_goal && g.achieved == null && ended();
    const sub = !g.has_goal
      ? `尚未設定・結賽達成 +${GOAL_BONUS} 分`
      : g.achieved === true
        ? `已達成・最終 +${GOAL_BONUS} 分`
        : g.achieved === false
          ? "這次沒有達成"
          : needConfirm
            ? "結賽了！輸入密碼確認是否達成"
            : "已設定・內容已加密";
    return `<div class="me-goal ${needConfirm ? "is-pending" : ""}">
      <span class="me-goal-icon" aria-hidden="true">🎯</span>
      <div class="me-goal-text"><b>個人目標</b><small>${sub}</small></div>
      <button data-act="${g.has_goal ? "reveal-goal" : "set-goal"}">${!g.has_goal ? "設定目標" : needConfirm ? "🏁 確認" : "🔒 查看"}</button>
    </div>`;
  }

  // ---------- 目標對話框 ----------
  function goalDialog() {
    let d = $("goal-dialog");
    if (!d) {
      d = document.createElement("dialog");
      d.id = "goal-dialog";
      d.className = "goal-dialog";
      document.body.appendChild(d);
      d.addEventListener("click", (e) => {
        if (e.target === d || e.target.closest('[data-gd="cancel"]')) d.close();
      });
      d.addEventListener("close", () => (d.innerHTML = ""));
    }
    return d;
  }

  function openSetGoal(id, reason) {
    const p = byId(id);
    if (!p) return;
    const d = goalDialog();
    d.innerHTML = `<form class="gd" novalidate>
      <h3>🎯 ${reason === "first" ? "第一次打卡！" : ""}設定 ${esc(p.name)} 的目標</h3>
      <p class="gd-desc">寫下你想在 ${md(parseKey(END_KEY()))} 前達成的目標，例如「半馬跑進 2:20」。結賽時達成，最終統計 <b>+${GOAL_BONUS} 分</b>。</p>
      <ul class="gd-rules">
        <li>送出後<b>不能修改</b>。</li>
        <li>目標會用你的密碼加密，其他人看不到，查看時要輸入密碼。</li>
        <li>密碼忘記就看不到目標了，請記好。</li>
      </ul>
      <label>我的目標<textarea name="goal" maxlength="200" rows="3" placeholder="半馬跑進 2:20"></textarea></label>
      <label>設定密碼（至少 4 個字元）<input name="pw" type="password" maxlength="64" autocomplete="new-password" /></label>
      <label>再輸入一次密碼<input name="pw2" type="password" maxlength="64" autocomplete="new-password" /></label>
      <label class="gd-check"><input type="checkbox" name="ok" /> 我確認送出後不能修改</label>
      <p class="gd-error" hidden></p>
      <div class="gd-actions"><button type="button" data-gd="cancel">${reason === "first" ? "之後再說" : "取消"}</button><button type="submit" class="is-primary">確認送出</button></div>
    </form>`;
    const form = d.querySelector("form");
    const err = form.querySelector(".gd-error");
    const fail = (msg) => {
      err.textContent = msg;
      err.hidden = false;
    };
    form.addEventListener("input", () => (err.hidden = true));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const goal = form.goal.value.trim();
      const pw = form.pw.value;
      if (goal.length < 2) return fail("目標至少寫 2 個字。");
      if (pw.length < 4) return fail("密碼至少 4 個字元。");
      if (pw !== form.pw2.value) return fail("兩次輸入的密碼不一樣。");
      if (!form.ok.checked) return fail("請勾選「我確認送出後不能修改」。");
      const btn = form.querySelector('[type="submit"]');
      btn.disabled = true;
      btn.textContent = "加密儲存中…";
      const { error } = await db.rpc("hyrox_set_goal", { p_participant_id: id, p_goal: goal, p_password: pw });
      btn.disabled = false;
      btn.textContent = "確認送出";
      if (error) {
        console.error(error);
        return fail(error.code === "P0001" ? error.message : `設定失敗：${error.message}`);
      }
      goals[id] = { has_goal: true, achieved: null };
      d.close();
      renderPersonal(dirty ? draft : undefined);
      renderTotal();
      notify("目標已加密保存，記得你的密碼！");
    });
    d.showModal();
    form.goal.focus();
  }

  function openRevealGoal(id) {
    const p = byId(id);
    if (!p) return;
    const d = goalDialog();
    d.innerHTML = `<form class="gd" novalidate>
      <h3>🔒 查看 ${esc(p.name)} 的目標</h3>
      <p class="gd-desc">輸入 ${esc(p.name)} 設定的密碼。連續錯 5 次會鎖 10 分鐘。</p>
      <label>密碼<input name="pw" type="password" maxlength="64" autocomplete="current-password" /></label>
      <p class="gd-error" hidden></p>
      <div class="gd-actions"><button type="button" data-gd="cancel">取消</button><button type="submit" class="is-primary">查看</button></div>
    </form>`;
    const form = d.querySelector("form");
    const err = form.querySelector(".gd-error");
    form.addEventListener("input", () => (err.hidden = true));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!form.pw.value) {
        err.textContent = "請輸入密碼。";
        err.hidden = false;
        return;
      }
      const btn = form.querySelector('[type="submit"]');
      btn.disabled = true;
      const { data, error } = await db.rpc("hyrox_reveal_goal", { p_participant_id: id, p_password: form.pw.value });
      btn.disabled = false;
      if (error || !data || !data.ok) {
        err.textContent = error ? `查看失敗：${error.message}` : (data && data.error) || "查看失敗";
        err.hidden = false;
        form.pw.select();
        return;
      }
      const pw = form.pw.value;
      const canMark = data.achieved == null && ended();
      const status = data.achieved === true
        ? `✅ 已達成，最終統計 +${GOAL_BONUS} 分`
        : data.achieved === false
          ? "這次沒有達成，下次再挑戰！"
          : canMark
            ? ""
            : `${md(parseKey(END_KEY()))} 結賽當天，可以在這裡確認是否達成。`;
      d.innerHTML = `<div class="gd">
        <h3>🎯 ${esc(p.name)} 的目標</h3>
        <p class="gd-goal">${esc(data.goal)}</p>
        ${status ? `<p class="gd-desc">${status}</p>` : ""}
        ${canMark ? `<div class="gd-finish">
            <b>🏁 結賽確認：你達成目標了嗎？</b>
            <small>送出後不能修改，目標會公開在總分排行，達成者總分 +${GOAL_BONUS}。</small>
            <div class="gd-actions"><button type="button" data-mark="false">沒有達成</button><button type="button" data-mark="true" class="is-primary">✅ 達成了</button></div>
            <p class="gd-error" hidden></p>
          </div>` : ""}
        <div class="gd-actions"><button type="button" data-gd="cancel" ${canMark ? "" : 'class="is-primary"'}>${canMark ? "之後再確認" : "看完了，隱藏"}</button></div>
      </div>`;
      if (!canMark) return;
      d.querySelectorAll("[data-mark]").forEach((b) =>
        b.addEventListener("click", async () => {
          const achieved = b.dataset.mark === "true";
          const err = d.querySelector(".gd-finish .gd-error");
          d.querySelectorAll("[data-mark]").forEach((x) => (x.disabled = true));
          const res = await db.rpc("hyrox_mark_goal", { p_participant_id: id, p_password: pw, p_achieved: achieved });
          d.querySelectorAll("[data-mark]").forEach((x) => (x.disabled = false));
          if (res.error || !res.data || !res.data.ok) {
            err.textContent = res.error ? `確認失敗：${res.error.message}` : (res.data && res.data.error) || "確認失敗";
            err.hidden = false;
            return;
          }
          goals[id] = { has_goal: true, achieved };
          goalResults[id] = { achieved, revealed_goal: res.data.goal };
          renderAll();
          d.querySelector(".gd-finish").innerHTML = `<b>${achieved ? `✅ 恭喜達成！總分 +${GOAL_BONUS}` : "已記錄：這次沒有達成"}</b><small>目標已公開在總分排行。</small>`;
          d.querySelector('[data-gd="cancel"]').textContent = "關閉";
          d.querySelector('[data-gd="cancel"]').classList.add("is-primary");
          notify(achieved ? `${p.name} 達成目標，總分 +${GOAL_BONUS}！` : `已記錄 ${p.name} 的結果`);
        })
      );
    });
    d.showModal();
    form.pw.focus();
  }

  async function saveDay() {
    if (saving) return;
    const id = currentPerson;
    const k = personDate;
    if (!started()) return notify(`第七屆 ${md(parseKey(START_KEY()))} 才開始，當天起才能送出打卡哦！`, "error");
    if (!isOpen(k)) return notify("這一天不能打卡。", "error");
    const keep = { ...draft };
    saving = true;
    renderPersonal(keep);
    const row = { participant_id: id, log_date: k };
    TASKS.forEach((t) => (row[t.key] = !!keep[t.key]));
    const { error } = await db.from("hyrox_daily_logs").upsert(row, { onConflict: "participant_id,log_date" });
    saving = false;
    if (error) {
      console.error(error);
      renderPersonal(keep);
      notify(friendlyError(error), "error");
      return;
    }
    logs[id] = logs[id] || {};
    logs[id][k] = keep;
    dirty = false;
    writeMe(id);
    renderAll();
    notify(`已儲存 ${byId(id)?.name || ""} ${md(parseKey(k))} 的打卡`);
    if (!goals[id]?.has_goal && !promptedGoal.has(id)) {
      promptedGoal.add(id);
      setTimeout(() => openSetGoal(id, "first"), 600);
    }
  }

  async function saveName(form) {
    const input = form.querySelector("input");
    const err = form.querySelector(".me-error");
    const name = input.value.trim();
    const fail = (msg) => {
      err.textContent = msg;
      err.hidden = false;
    };
    if (!name) return fail("名字不能空白。");
    if (name === byId(currentPerson)?.name) {
      form.hidden = true;
      return;
    }
    if (PLAYERS.some((x) => x.id !== currentPerson && x.name === name)) return fail("已經有人叫這個名字了，換一個吧。");
    const btn = form.querySelector('[type="submit"]');
    btn.disabled = true;
    const { error } = await db.from("participants").update({ name }).eq("id", currentPerson).eq("challenge_id", challenge.id);
    btn.disabled = false;
    if (error) {
      console.error(error);
      return fail(`改名失敗：${error.message}`);
    }
    byId(currentPerson).name = name;
    if (todayDraw && todayDraw.drawn_by === currentPerson) todayDraw.drawn_by_name = name;
    renderRoster();
    renderAll();
    renderDrawState();
    notify(`名字已改成「${name}」`);
  }

  function personalEvents() {
    const el = $("person-area");
    if (!el) return;
    const setDate = (k) => {
      if (!isOpen(k)) return;
      personDate = k;
      dirty = false;
      renderPersonal();
    };
    el.addEventListener("click", (e) => {
      const chip = e.target.closest(".me-chip");
      if (chip) {
        currentPerson = chip.dataset.pid;
        writeMe(currentPerson);
        dirty = false;
        renderPersonal();
        return;
      }
      const row = e.target.closest(".history-table tr[data-date]");
      if (row) return setDate(row.dataset.date);
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (!act) return;
      const form = el.querySelector('[data-form="name"]');
      if (act === "edit-name") {
        form.hidden = false;
        form.querySelector("input").focus();
        form.querySelector("input").select();
      } else if (act === "cancel-name") {
        form.hidden = true;
      } else if (act === "prev") {
        setDate(keyOf(addDays(parseKey(personDate), -1)));
      } else if (act === "next") {
        setDate(keyOf(addDays(parseKey(personDate), 1)));
      } else if (act === "today") {
        setDate(lastOpenKey());
      } else if (act === "save") {
        saveDay();
      } else if (act === "set-goal") {
        openSetGoal(currentPerson, "manual");
      } else if (act === "reveal-goal") {
        openRevealGoal(currentPerson);
      }
    });
    el.addEventListener("change", (e) => {
      if (e.target.matches('input[type="date"]')) return setDate(e.target.value);
      const k = e.target.dataset.k;
      if (!k) return;
      draft[k] = e.target.checked;
      dirty = true;
      e.target.closest(".me-task").classList.toggle("is-on", e.target.checked);
      $("me-day-score").textContent = dayScore(draft);
      $("me-max").textContent = dayRaw(draft) > DAILY_CAP ? "已達上限" : "";
    });
    el.addEventListener("input", (e) => {
      if (e.target.closest('[data-form="name"]')) {
        const err = el.querySelector(".me-error");
        if (err) err.hidden = true;
      }
    });
    el.addEventListener("submit", (e) => {
      e.preventDefault();
      saveName(e.target);
    });
  }

  function renderAll() {
    renderDayChips();
    renderToday();
    renderRanking();
    renderTotal();
    renderPersonal(dirty ? draft : undefined);
  }

  // ---------- 午夜抽卡 ----------
  const stars = (n) => "●".repeat(n) + "○".repeat(3 - n);
  const frontHtml = (c) => `
    <span class="front-station">${c.station === "RUN" ? "RUN" : "STATION " + esc(c.station)}</span>
    <span class="front-name">${esc(c.name)}</span>
    <span class="front-home-label">居家平替</span>
    <span class="front-home">${esc(c.home_move)}</span>
    <span class="front-detail">${esc(c.detail)}</span>
    <span class="front-level">難度 ${stars(c.level || 1)}</span>`;

  function renderDraw() {
    const el = $("draw-area");
    if (!el) return;
    const cards = [0, 1, 2, 3, 4]
      .map(
        (i) => `<div class="card" style="--i:${i - 2}" data-idx="${i}"><div class="card-inner">
          <div class="face back"><span class="back-mark"></span><span class="back-text">HYROX</span><span class="back-q">?</span></div>
          <div class="face front"></div></div></div>`
      )
      .join("");
    el.innerHTML = `
      <div class="draw">
        <div class="draw-meta"><span>下次公布倒數</span><strong id="countdown">--:--:--</strong></div>
        <div class="deck" id="deck">${cards}</div>
        <div class="draw-who"><label for="draw-me">我是</label><select id="draw-me"></select></div>
        <p class="draw-error" id="draw-error" hidden></p>
        <div class="draw-actions"><button id="draw-btn" class="btn-draw">搶第一！抽今日挑戰</button></div>
        <p class="draw-note" id="draw-note">每晚 00:00 開放，第一位進站的選手可以抽卡，抽出的題目就是全員當天的 HYROX 挑戰。</p>
      </div>`;

    $("draw-me").addEventListener("change", (e) => {
      writeMe(e.target.value);
      $("draw-error").hidden = true;
    });
    $("draw-btn").addEventListener("click", drawCard);

    const tick = () => {
      const now = Date.now();
      const nextMidnight = Date.parse(`${keyOf(addDays(parseKey(TODAY_KEY), 1))}T00:00:00+08:00`);
      const s = Math.max(0, Math.floor((nextMidnight - now) / 1000));
      const cd = $("countdown");
      if (cd) cd.textContent = `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
      if (taipeiToday() !== TODAY_KEY) {
        resetDeck();
        loadAll({ silent: true });
      }
    };
    tick();
    setInterval(tick, 1000);
  }

  function resetDeck() {
    const deck = $("deck");
    if (!deck) return;
    deck.classList.remove("is-shuffling", "is-picked");
    deck.querySelectorAll(".card").forEach((c) => c.classList.remove("is-chosen", "is-flipped"));
  }

  function showDraw(card, animate) {
    const deck = $("deck");
    const chosen = deck.querySelector('[data-idx="2"]');
    chosen.querySelector(".front").innerHTML = frontHtml(card);
    const reveal = () => {
      deck.classList.remove("is-shuffling");
      deck.classList.add("is-picked");
      chosen.classList.add("is-chosen");
      setTimeout(() => chosen.classList.add("is-flipped"), animate ? 450 : 0);
    };
    if (animate) {
      deck.classList.add("is-shuffling");
      setTimeout(reveal, 1100);
    } else {
      reveal();
    }
  }

  function renderDrawState() {
    const sel = $("draw-me");
    const btn = $("draw-btn");
    const note = $("draw-note");
    if (!sel || !btn) return;
    const me = readMe();
    sel.innerHTML = `<option value="">選擇你的名字</option>${PLAYERS.map((p) => `<option value="${p.id}" ${p.id === me ? "selected" : ""}>${esc(p.name)}</option>`).join("")}`;
    if (!challenge) {
      btn.disabled = true;
      return;
    }
    if (todayDraw) {
      btn.disabled = true;
      btn.textContent = "今日挑戰已揭曉";
      note.innerHTML = `<b>${esc(todayDraw.drawn_by_name)}</b> 搶到今天的第一抽！挑戰：<b>${esc(todayDraw.home_move)}</b>（對應 ${esc(todayDraw.name)}）`;
      const deck = $("deck");
      if (!deck.classList.contains("is-picked")) showDraw(todayDraw, false);
    } else if (!inRange(TODAY_KEY)) {
      btn.disabled = true;
      btn.textContent = TODAY_KEY < START_KEY() ? `${md(parseKey(START_KEY()))} 00:00 開放第一抽` : "第七屆已結束";
      note.textContent = TODAY_KEY < START_KEY() ? "開賽當天午夜起，每晚第一位進站的選手可以抽卡。" : "感謝大家這兩個月的努力！";
    } else {
      btn.disabled = false;
      btn.textContent = "搶第一！抽今日挑戰";
    }
  }

  async function drawCard() {
    const sel = $("draw-me");
    const err = $("draw-error");
    const btn = $("draw-btn");
    if (!sel.value) {
      err.textContent = "先選你是誰，才能抽卡。";
      err.hidden = false;
      sel.focus();
      return;
    }
    err.hidden = true;
    btn.disabled = true;
    btn.textContent = "抽卡中…";
    const { data, error } = await db.rpc("hyrox_draw_today", { p_participant_id: sel.value });
    if (error) {
      console.error(error);
      err.textContent = error.code === "P0001" ? error.message : `抽卡失敗：${error.message}`;
      err.hidden = false;
      btn.disabled = false;
      btn.textContent = "搶第一！抽今日挑戰";
      return;
    }
    writeMe(sel.value);
    todayDraw = { ...data, drawn_by_name: byId(data.drawn_by)?.name || data.drawn_by_name };
    showDraw(todayDraw, true);
    setTimeout(() => {
      renderDrawState();
      renderPersonal(dirty ? draft : undefined);
      notify(data.won ? "你搶到今天的第一抽！" : `慢了一步，${todayDraw.drawn_by_name} 已經抽出今天的挑戰。`);
    }, 1600);
  }

  // ---------- 捲動驅動背景（與原型相同） ----------
  const root = document.documentElement;
  const toRgb = (h) => {
    const n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const mix = (a, b, t) => {
    const A = toRgb(a);
    const B = toRgb(b);
    return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(",")})`;
  };
  let ticking = false;
  function applyScroll() {
    ticking = false;
    const max = root.scrollHeight - window.innerHeight;
    const p = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
    const stops = window.SCENE_STOPS || [];
    if (stops.length > 1) {
      const seg = p * (stops.length - 1);
      const i = Math.min(stops.length - 2, Math.floor(seg));
      const t = seg - i;
      const a = stops[i];
      const b = stops[i + 1];
      Object.keys(a).forEach((k) => root.style.setProperty(k, mix(a[k], b[k] || a[k], t)));
      document.body.dataset.stage = String(Math.round(seg));
    }
    root.style.setProperty("--p", p.toFixed(4));
    root.style.setProperty("--sy", `${window.scrollY}px`);
    if (typeof window.onSceneProgress === "function") window.onSceneProgress(p);
  }
  window.addEventListener("scroll", () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(applyScroll);
    }
  }, { passive: true });
  window.addEventListener("resize", applyScroll);

  // ---------- 事件 ----------
  document.addEventListener("click", (e) => {
    const chip = e.target.closest(".day-chip");
    if (chip && !chip.disabled) {
      currentDay = Number(chip.dataset.day);
      renderDayChips();
      renderToday();
      return;
    }
    const link = e.target.closest(".name-link");
    if (link) {
      currentPerson = link.dataset.person;
      dirty = false;
      renderPersonal();
      if (typeof window.setTab === "function") window.setTab("me");
    }
  });

  // 切回這個分頁時重新抓資料，讓 6 個人看到彼此最新的打卡
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && !saving) loadAll({ silent: true });
  });

  window.addEventListener("DOMContentLoaded", () => {
    renderDraw();
    personalEvents();
    applyScroll();
    loadAll();
  });

  window.HY = { TASKS, DAILY_CAP, WEEKLY_CAP, renderAll, applyScroll, reload: loadAll };
})();
