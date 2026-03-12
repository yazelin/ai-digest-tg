/* AI Digest TG — Settings Web UI */

const API_BASE = "https://ai-digest-tg.YOUR_SUBDOMAIN.workers.dev";

const TOPICS = [
  { value: "llm",             label: "LLM" },
  { value: "ai-safety",       label: "AI Safety" },
  { value: "ai-agents",       label: "AI Agents" },
  { value: "open-source",     label: "Open Source" },
  { value: "computer-vision", label: "Computer Vision" },
  { value: "robotics",        label: "Robotics" },
  { value: "ai-coding",       label: "AI Coding" },
  { value: "ai-policy",       label: "AI Policy" },
  { value: "industry",        label: "Industry" },
  { value: "research",        label: "Research" },
];

const TIME_SLOTS = [
  { value: 0,  label: "00:00 UTC" },
  { value: 3,  label: "03:00 UTC" },
  { value: 6,  label: "06:00 UTC" },
  { value: 9,  label: "09:00 UTC" },
  { value: 12, label: "12:00 UTC" },
  { value: 15, label: "15:00 UTC" },
  { value: 18, label: "18:00 UTC" },
  { value: 21, label: "21:00 UTC" },
];

let currentUser = null;

/* ── DOM helpers ──────────────────────────────────────────── */

function $(id) { return document.getElementById(id); }

function setStatus(msg, type = "") {
  const el = $("status-msg");
  el.textContent = msg;
  el.className = type;
}

/* ── Topics grid ──────────────────────────────────────────── */

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
      <span>${t.label}</span>
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

/* ── Radio chips (time slot / lang / style) ───────────────── */

function buildOptionChips(containerId, options, selectedValue) {
  const container = $(containerId);
  container.innerHTML = "";
  for (const opt of options) {
    const label = document.createElement("label");
    label.className = "option-chip" + (opt.value === selectedValue ? " selected" : "");
    label.dataset.value = opt.value;
    label.innerHTML = `<input type="radio" name="${containerId}" value="${opt.value}">${opt.label}`;
    label.addEventListener("change", (e) => {
      container.querySelectorAll(".option-chip").forEach(c => c.classList.remove("selected"));
      e.currentTarget.classList.add("selected");
    });
    container.appendChild(label);
  }
}

function getSelectedOption(containerId) {
  const el = document.querySelector(`#${containerId} .option-chip.selected`);
  return el ? el.dataset.value : null;
}

/* ── Populate form from UserSettings ─────────────────────── */

function populateForm(user) {
  buildTopicsGrid(user.topics || []);
  buildOptionChips("time-chips",  TIME_SLOTS,                   user.time_slot);
  buildOptionChips("lang-chips",  [
    { value: "zh-TW", label: "繁中 (zh-TW)" },
    { value: "en",    label: "English" },
  ], user.lang || "en");
  buildOptionChips("style-chips", [
    { value: "mixed", label: "Mixed" },
    { value: "brief", label: "Brief" },
    { value: "deep",  label: "Deep" },
  ], user.style || "mixed");
}

/* ── Auth ──────────────────────────────────────────────────── */

window.onTelegramAuth = async function(loginData) {
  setStatus("Verifying…");
  try {
    const res = await fetch(`${API_BASE}/api/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(loginData),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Auth failed" }));
      setStatus(err.error || "Auth failed", "error");
      return;
    }
    const { user } = await res.json();
    if (!user) {
      setStatus("Account not found. Please start the bot first via /start.", "error");
      return;
    }
    currentUser = user;
    showSettings(loginData);
  } catch (err) {
    setStatus("Network error: " + err.message, "error");
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

/* ── Save ──────────────────────────────────────────────────── */

async function saveSettings() {
  if (!currentUser) return;

  const topics = getSelectedTopics();
  if (topics.length === 0) {
    setStatus("Please select at least one topic.", "error");
    return;
  }

  const timeSlotRaw = getSelectedOption("time-chips");
  const lang  = getSelectedOption("lang-chips");
  const style = getSelectedOption("style-chips");

  if (timeSlotRaw === null || lang === null || style === null) {
    setStatus("Please complete all selections.", "error");
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
  setStatus("Saving…");

  try {
    const res = await fetch(`${API_BASE}/api/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text();
      setStatus("Save failed: " + text, "error");
      return;
    }
    currentUser = await res.json();
    setStatus("Settings saved!", "success");
    setTimeout(() => setStatus(""), 3000);
  } catch (err) {
    setStatus("Network error: " + err.message, "error");
  } finally {
    btn.disabled = false;
  }
}

/* ── Init ──────────────────────────────────────────────────── */

document.addEventListener("DOMContentLoaded", () => {
  $("save-btn").addEventListener("click", saveSettings);
  $("logout-btn").addEventListener("click", logout);
});
