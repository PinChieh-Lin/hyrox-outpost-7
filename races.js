// 第七屆 HYROX 前哨打卡站：大家報名的賽事倒數
// 要新增或修改賽事，只改下面這份清單即可（日期格式 YYYY-MM-DD，以台北時間當天 00:00 計算）
(() => {
  const RACES = [
    { name: "Garmin Run", date: "2026-11-29" },
    { name: "麗晨馬拉松", date: "2026-12-06" },
    { name: "台北馬", date: "2026-12-20" },
    { name: "渣打全馬", date: "2027-01-10" },
    { name: "台中城市半馬", date: "2027-01-17" },
    { name: "Harco", date: "2027-02-14" },
    { name: "HYROX", date: "2027-03-12", main: true },
    { name: "金瓜石馬", date: "2027-03-21" },
    { name: "大雅旺來馬", date: "2027-03-21" },
    { name: "💍 草森世紀婚宴", date: "2027-03-28" },
  ];

  const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
  const HORIZON_DAYS = 120; // 進度條的時間尺度：距離比賽越近，條越滿
  const pad = (v) => String(v).padStart(2, "0");
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const raceStart = (r) => Date.parse(`${r.date}T00:00:00+08:00`);
  const taipeiToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());
  const dayDiff = (fromKey, toKey) => Math.round((Date.parse(`${toKey}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) / 86400000);
  const md = (key) => {
    const [, m, d] = key.split("-").map(Number);
    return `${m}/${d}（${WEEKDAYS[new Date(`${key}T00:00:00Z`).getUTCDay()]}）`;
  };

  // 狀態：days > 0 還沒到、0 今天比賽、< 0 已完賽
  function withStatus(today) {
    return RACES.map((r) => ({ ...r, days: dayDiff(today, r.date) })).sort((a, b) => a.date.localeCompare(b.date));
  }

  function label(r) {
    if (r.days > 0) return `剩 ${r.days} 天`;
    if (r.days === 0) return "今天比賽！加油";
    return "已完賽 ✓";
  }

  // ---------- 頂部跑馬燈 ----------
  function renderTicker(list) {
    const el = document.getElementById("race-ticker");
    if (!el) return;
    const upcoming = list.filter((r) => r.days >= 0);
    const items = upcoming.length
      ? upcoming
          .map((r) => `<span class="rt-item ${r.main ? "is-main" : ""}">${r.main ? "🏁" : "🏃"} ${esc(r.name)}<b>${label(r)}</b></span>`)
          .join('<span class="rt-sep" aria-hidden="true">・</span>')
      : '<span class="rt-item is-main">🏁 所有賽事都完賽了，大家辛苦了！</span>';
    const sig = items;
    if (el.dataset.sig === sig) return; // 內容沒變就不重畫，避免動畫跳回開頭
    el.dataset.sig = sig;
    // 內容放兩份，捲到一半時接回開頭，看起來是無限循環
    el.innerHTML = `<div class="rt-track"><div class="rt-group">${items}<span class="rt-sep" aria-hidden="true">・</span></div><div class="rt-group" aria-hidden="true">${items}<span class="rt-sep">・</span></div></div>`;
    el.setAttribute("aria-label", upcoming.length ? upcoming.map((r) => `${r.name} ${label(r)}`).join("，") : "所有賽事都完賽了");
  }

  // ---------- 太陽就是倒數：主要賽事 ----------
  function renderMain(list) {
    const main = list.find((r) => r.main);
    if (!main || !document.getElementById("sun-count")) return;
    const set = (id, v) => {
      const n = document.getElementById(id);
      if (n && n.textContent !== v) n.textContent = v;
    };
    const [, m, d] = main.date.split("-").map(Number);
    const ms = raceStart(main) - Date.now();
    document.getElementById("sun-count").classList.toggle("is-final", main.days <= 0);
    if (main.days > 0) {
      // 大數字用日曆天數（和跑馬燈、卡片一致），下面一行是精確倒數
      const s = Math.max(0, Math.floor(ms / 1000));
      set("sun-tag", `${main.name} 倒數`);
      set("sun-days", String(main.days));
      set("sun-hms", `${m}/${d}・${Math.floor(s / 86400)}天 ${pad(Math.floor((s % 86400) / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`);
    } else if (main.days === 0) {
      set("sun-tag", `${main.name} 就是今天`);
      set("sun-days", "GO");
      set("sun-hms", "全力衝刺！");
    } else {
      set("sun-tag", `${main.name} 完賽`);
      set("sun-days", "✓");
      set("sun-hms", "大家辛苦了");
    }
  }

  // ---------- 卡片牆 ----------
  // 還沒比的賽事照常顯示；比完的自動收進下方「已完賽」摺疊區
  function renderList(list) {
    const el = document.getElementById("race-list");
    if (!el) return;
    const others = list.filter((r) => !r.main);
    const upcoming = others.filter((r) => r.days >= 0);
    const done = others.filter((r) => r.days < 0).reverse(); // 最近比完的排前面
    const nextName = upcoming[0] ? upcoming[0].name : null;
    const html = upcoming.length
      ? upcoming
          .map((r) => {
            const pct = Math.max(4, Math.min(100, (1 - r.days / HORIZON_DAYS) * 100));
            const tag = r.days === 0 ? '<i class="rc-tag is-today">今天</i>' : r.name === nextName ? '<i class="rc-tag">下一場</i>' : "";
            return `<li class="race-card ${r.name === nextName ? "is-next" : ""}">
          <div class="rc-main"><b>${esc(r.name)}</b>${tag}<small>${md(r.date)}</small></div>
          <div class="rc-days">${r.days > 0 ? `<b>${r.days}</b><small>天</small>` : "<b>🔥</b>"}</div>
          <span class="rc-bar"><i style="width:${pct}%"></i></span>
        </li>`;
          })
          .join("")
      : '<li class="race-empty">目前沒有即將到來的賽事，大家都完賽了！🎉</li>';
    if (el.dataset.sig !== html) {
      el.dataset.sig = html;
      el.innerHTML = html;
    }

    const box = document.getElementById("race-done");
    if (!box) return;
    box.hidden = done.length === 0;
    const sum = `✓ 已完賽 ${done.length} 場`;
    const items = done.map((r) => `<li><b>${esc(r.name)}</b><small>${md(r.date)}</small><span>完賽 ✓</span></li>`).join("");
    if (box.dataset.sig !== items) {
      box.dataset.sig = items;
      box.querySelector("summary").textContent = sum;
      box.querySelector("ul").innerHTML = items;
    }
  }

  function tick() {
    const list = withStatus(taipeiToday());
    renderTicker(list);
    renderMain(list);
    renderList(list);
  }

  window.addEventListener("DOMContentLoaded", () => {
    tick();
    setInterval(tick, 1000);
  });
  window.HYROX_RACES = RACES;
})();
