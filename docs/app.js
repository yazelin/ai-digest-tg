/* AI Digest TG — Settings Web UI */

const API_BASE = "https://ai-digest-tg.yazelinj303.workers.dev";

const TOPICS = [
  { value: "llm",             zh: "大型語言模型", en: "LLM" },
  { value: "ai-safety",       zh: "AI 安全",     en: "AI Safety" },
  { value: "ai-agents",       zh: "AI 代理",     en: "AI Agents" },
  { value: "open-source",     zh: "開源模型",     en: "Open Source" },
  { value: "computer-vision", zh: "電腦視覺",     en: "Computer Vision" },
  { value: "robotics",        zh: "機器人",       en: "Robotics" },
  { value: "ai-coding",       zh: "AI 程式開發",  en: "AI Coding" },
  { value: "ai-policy",       zh: "AI 政策法規",  en: "AI Policy" },
  { value: "industry",        zh: "產業動態",     en: "Industry" },
  { value: "research",        zh: "學術研究",     en: "Research" },
];

const TIME_SLOTS = [
  { value: 0,  utc: "00:00", tw: "08:00" },
  { value: 3,  utc: "03:00", tw: "11:00" },
  { value: 6,  utc: "06:00", tw: "14:00" },
  { value: 9,  utc: "09:00", tw: "17:00" },
  { value: 12, utc: "12:00", tw: "20:00" },
  { value: 15, utc: "15:00", tw: "23:00" },
  { value: 18, utc: "18:00", tw: "02:00" },
  { value: 21, utc: "21:00", tw: "05:00" },
];

const STYLES = [
  { value: "mixed", name: "綜合", desc: "3 篇重點摘要 + 3~5 條快訊，兼顧深度與廣度" },
  { value: "brief", name: "快覽", desc: "5~10 條一行快訊，適合快速瀏覽" },
  { value: "deep",  name: "深讀", desc: "3~5 篇深度分析，適合想深入了解的讀者" },
];

let currentUser = null;

/* ── DOM helpers ──────────────────────────────────────── */

function $(id) { return document.getElementById(id); }

function setStatus(msg, type = "") {
  const el = $("status-msg");
  el.textContent = msg;
  el.className = type;
}

/* ── Topics grid ──────────────────────────────────────── */

function buildTopicsGrid(selected = []) {
  const grid = $("topics-grid");
  grid.innerHTML = "";
  for (const t of TOPICS) {
    const isChecked = selected.includes(t.value);
    const chip = document.createElement("label");
    chip.className = "topic-chip" + (isChecked ? " checked" : "");
    chip.dataset.value = t.value;
    chip.innerHTML = `
      <input type="checkbox" value="${t.value}" ${isChecked ? "checked" : ""}>
      <span class="checkmark"></span>
      <span class="topic-label">
        <span class="zh">${t.zh}</span>
        <span class="en">${t.en}</span>
      </span>
    `;
    chip.addEventListener("change", onTopicChange);
    grid.appendChild(chip);
  }
  enforceTopicLimit();
}

function onTopicChange(e) {
  const chip = e.currentTarget;
  const checked = chip.querySelector("input").checked;
  chip.classList.toggle("checked", checked);
  enforceTopicLimit();
}

function enforceTopicLimit() {
  const chips = document.querySelectorAll(".topic-chip");
  const checkedCount = document.querySelectorAll(".topic-chip.checked").length;
  for (const chip of chips) {
    if (!chip.classList.contains("checked")) {
      chip.classList.toggle("disabled", checkedCount >= 5);
      chip.querySelector("input").disabled = checkedCount >= 5;
    }
  }
  $("topic-count").textContent = checkedCount;
}

function getSelectedTopics() {
  return Array.from(document.querySelectorAll(".topic-chip.checked"))
    .map(c => c.dataset.value);
}

/* ── Time chips ───────────────────────────────────────── */

function buildTimeChips(selectedValue) {
  const container = $("time-chips");
  container.innerHTML = "";
  for (const slot of TIME_SLOTS) {
    const label = document.createElement("label");
    label.className = "time-chip" + (slot.value === selectedValue ? " selected" : "");
    label.dataset.value = slot.value;
    label.innerHTML = `
      <input type="radio" name="time-chips" value="${slot.value}">
      <span class="time-tw">${slot.tw}</span>
      <span class="time-utc">UTC ${slot.utc}</span>
    `;
    label.addEventListener("change", () => {
      container.querySelectorAll(".time-chip").forEach(c => c.classList.remove("selected"));
      label.classList.add("selected");
    });
    container.appendChild(label);
  }
}

/* ── Style cards ──────────────────────────────────────── */

function buildStyleCards(selectedValue) {
  const container = $("style-chips");
  container.innerHTML = "";
  for (const s of STYLES) {
    const card = document.createElement("label");
    card.className = "style-card" + (s.value === selectedValue ? " selected" : "");
    card.dataset.value = s.value;
    card.innerHTML = `
      <input type="radio" name="style-chips" value="${s.value}">
      <div class="style-name">${s.name}</div>
      <div class="style-desc">${s.desc}</div>
    `;
    card.addEventListener("change", () => {
      container.querySelectorAll(".style-card").forEach(c => c.classList.remove("selected"));
      card.classList.add("selected");
    });
    container.appendChild(card);
  }
}

/* ── Radio chips (lang) ───────────────────────────────── */

function buildOptionChips(containerId, options, selectedValue) {
  const container = $(containerId);
  container.innerHTML = "";
  for (const opt of options) {
    const label = document.createElement("label");
    label.className = "option-chip" + (opt.value === selectedValue ? " selected" : "");
    label.dataset.value = opt.value;
    label.innerHTML = `<input type="radio" name="${containerId}" value="${opt.value}">${opt.label}`;
    label.addEventListener("change", () => {
      container.querySelectorAll(".option-chip").forEach(c => c.classList.remove("selected"));
      label.classList.add("selected");
    });
    container.appendChild(label);
  }
}

function getSelectedOption(containerId) {
  const el = document.querySelector(`#${containerId} .option-chip.selected, #${containerId} .time-chip.selected, #${containerId} .style-card.selected`);
  return el ? el.dataset.value : null;
}

/* ── Populate form from UserSettings ──────────────────── */

function populateForm(user) {
  buildTopicsGrid(user.topics || []);
  buildTimeChips(user.time_slot);
  buildOptionChips("lang-chips", [
    { value: "zh-TW", label: "繁體中文" },
    { value: "en",    label: "English" },
  ], user.lang || "en");
  buildStyleCards(user.style || "mixed");
}

/* ── Auth ──────────────────────────────────────────────── */

window.onTelegramAuth = async function(loginData) {
  setStatus("驗證中…");
  try {
    const res = await fetch(`${API_BASE}/api/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(loginData),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "驗證失敗" }));
      setStatus(err.error || "驗證失敗", "error");
      return;
    }
    const { user } = await res.json();
    if (!user) {
      setStatus("找不到帳號。請先在 Telegram 上向 Bot 發送 /start 邀請碼 完成註冊。", "error");
      return;
    }
    currentUser = user;
    showSettings(loginData);
  } catch (err) {
    setStatus("網路錯誤：" + err.message, "error");
  }
};

function showSettings(loginData) {
  $("auth-section").classList.add("hidden");
  $("settings-section").classList.remove("hidden");

  const name = [loginData.first_name, loginData.last_name].filter(Boolean).join(" ");
  $("user-name").textContent = name || `User ${loginData.id}`;

  populateForm(currentUser);
  setStatus("");
}

function logout() {
  currentUser = null;
  $("auth-section").classList.remove("hidden");
  $("settings-section").classList.add("hidden");
  setStatus("");
}

/* ── Save ──────────────────────────────────────────────── */

async function saveSettings() {
  if (!currentUser) return;

  const topics = getSelectedTopics();
  if (topics.length === 0) {
    setStatus("請至少選擇一個主題。", "error");
    return;
  }

  const timeSlotRaw = getSelectedOption("time-chips");
  const lang  = getSelectedOption("lang-chips");
  const style = getSelectedOption("style-chips");

  if (timeSlotRaw === null || lang === null || style === null) {
    setStatus("請完成所有選項。", "error");
    return;
  }

  const payload = {
    telegram_id: currentUser.telegram_id,
    topics,
    time_slot: parseInt(timeSlotRaw, 10),
    lang,
    style,
  };

  const btn = $("save-btn");
  btn.disabled = true;
  setStatus("儲存中…");

  try {
    const res = await fetch(`${API_BASE}/api/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text();
      setStatus("儲存失敗：" + text, "error");
      return;
    }
    currentUser = await res.json();
    setStatus("設定已儲存！", "success");
    setTimeout(() => setStatus(""), 3000);
  } catch (err) {
    setStatus("網路錯誤：" + err.message, "error");
  } finally {
    btn.disabled = false;
  }
}

/* ── Init ──────────────────────────────────────────────── */

document.addEventListener("DOMContentLoaded", () => {
  $("save-btn").addEventListener("click", saveSettings);
  $("logout-btn").addEventListener("click", logout);
});
