/* ==========================================================
   DueCue — script.js  (Team DEBUG DIVAS)
   Sections: 1 Data  2 Helpers  3 Smart logic  4 Rendering
             5 Forms & clicks  6 Start-up
   ========================================================== */

/* ---------- 1. DATA & LOCAL STORAGE ---------- */
const KEY = "duecue-data-v1";     // name under which we save in the browser
let editingId = null;             // id of the assignment being edited (null = adding new)

// Returns a date string like "2026-10-05", `offset` days from today
function isoDate(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

// Sample data shown on first launch (dates are relative to today, so demo never goes stale)
function demoData() {
  return {
    assignments: [
      { id: "a1", title: "Physics Assignment", subject: "Physics", deadline: isoDate(1), workload: "high", strict: "high", done: false },
      { id: "a2", title: "Chemistry Assignment", subject: "Chemistry", deadline: isoDate(3), workload: "medium", strict: "medium", done: false },
      { id: "a3", title: "Maths Assignment", subject: "Maths", deadline: isoDate(7), workload: "low", strict: "low", done: false }
    ],
    tests: [{ id: "t1", name: "Physics Unit Test", subject: "Physics", date: isoDate(4) }],
    timetable: [
      { id: "c1", subject: "Physics", day: "Monday", start: "09:00", end: "10:00" },
      { id: "c2", subject: "Maths", day: "Tuesday", start: "10:00", end: "11:00" },
      { id: "c3", subject: "Chemistry", day: "Wednesday", start: "11:00", end: "12:00" }
    ],
    attendance: { attended: 39, total: 50 },   // 78%
    settings: { name: "", required: 75 }
  };
}

function load() {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) return JSON.parse(saved);
  } catch (e) { /* storage blocked or corrupted: fall back to demo */ }
  return demoData();
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
}
let state = load();
save();

/* ---------- 2. SMALL HELPERS ---------- */
const $ = (id) => document.getElementById(id);
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// Stops user text from being treated as HTML
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Whole days from today until a "YYYY-MM-DD" date (negative = already passed)
function daysLeft(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((new Date(y, m - 1, d) - today) / 86400000);
}
function dayText(d) {
  if (d < 0) return Math.abs(d) + (d === -1 ? " day overdue" : " days overdue");
  if (d === 0) return "today";
  if (d === 1) return "tomorrow";
  return "in " + d + " days";
}
function joinList(a) { return a.length > 1 ? a.slice(0, -1).join(", ") + " and " + a[a.length - 1] : a[0]; }
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/* ---------- 3. SMART LOGIC ---------- */

// 3a. PRIORITY: score = deadline points + workload points + professor points
function priorityOf(a) {
  const d = daysLeft(a.deadline);

  let dead = 5;                                   // deadline points (closer = more)
  if (d <= 0) dead = 50; else if (d === 1) dead = 45; else if (d <= 2) dead = 35;
  else if (d <= 4) dead = 25; else if (d <= 7) dead = 15;

  const work = { low: 5, medium: 12, high: 20 }[a.workload];    // workload points
  const prof = { low: 0, medium: 5, high: 10 }[a.strict];       // professor points
  const score = dead + work + prof;

  const level = score >= 50 ? "high" : score >= 28 ? "medium" : "low";

  // Build a human-readable explanation from the same facts
  const facts = [d < 0 ? "overdue" : d === 0 ? "due today" : "due " + dayText(d), "has " + a.workload + " workload"];
  if (a.strict === "high") facts.push("has a strict professor");
  return { score, level, d, facts: "this is " + joinList(facts), reason: cap(level) + " priority because this is " + joinList(facts) + "." };
}

// 3b. ATTENDANCE: all the maths in one place
function attStats() {
  const { attended, total } = state.attendance;
  const req = state.settings.required;
  if (!total || total <= 0) return { valid: false };
  const pct = (attended / total) * 100;

  // Missing x classes keeps us >= req if attended/(total+x) >= req/100
  // => x <= attended*100/req - total
  const canMiss = Math.max(0, Math.floor((attended * 100) / req - total + 1e-9));

  // If below: attending n classes in a row gives (attended+n)/(total+n) >= req/100
  // => n >= (req*total - 100*attended) / (100 - req)
  const needed = pct >= req ? 0 : Math.ceil((req * total - 100 * attended) / (100 - req) - 1e-9);

  const afterMiss = [1, 2, 3].map((k) => (attended / (total + k)) * 100);
  const status = pct < req ? "critical" : pct < req + 5 ? "warning" : "safe";
  return { valid: true, pct, canMiss, needed, afterMiss, status, req, attended, total };
}

// 3c. REMINDERS from deadlines (assignments + tests)
function getReminders() {
  const list = [];
  state.assignments.filter((a) => !a.done).forEach((a) => {
    const p = priorityOf(a), d = p.d, name = a.subject + " assignment";
    let text = null;
    if (d < 0) text = "🚨 " + name + " is " + dayText(d) + ". Submit ASAP!";
    else if (d === 0) text = "🚨 " + name + " is due today. Final push!";
    else if (d === 1) text = "⚠️ " + name + " is due tomorrow.";
    else if (d <= 3) text = "⏳ " + name + " is due in " + d + " days.";
    else if (d <= 7) text = "📌 " + name + " is due in " + d + " days. Plan it in.";
    if (text && p.level === "high" && d >= 1 && d <= 2) text = "🚨 You're running out of time for " + a.subject + ". " + text.slice(3);
    if (text) list.push({ d, text });
  });
  state.tests.forEach((t) => {
    const d = daysLeft(t.date);
    if (d >= 0 && d <= 7) list.push({ d, text: "📝 " + t.subject + " test is " + dayText(d) + ". Time to revise!" });
  });
  return list.sort((x, y) => x.d - y.d).slice(0, 6);
}

// 3d. "WHAT SHOULD I DO NEXT?" — compares everything and picks ONE action
function recommend() {
  const att = attStats();

  // Rule 1: critical attendance beats everything
  if (att.valid && att.status === "critical") {
    return {
      alert: true, title: "🚨 Your attendance needs attention before your next class.",
      why: "It is " + att.pct.toFixed(1) + "%, below the " + att.req + "% requirement. Attend the next " + att.needed + " classes in a row to get back on track."
    };
  }

  // Rule 2: score every pending assignment and every near test, pick the highest
  const options = [];
  state.assignments.filter((a) => !a.done).forEach((a) => {
    const p = priorityOf(a);
    options.push({ score: p.score, title: "Finish " + a.title + ".", why: cap(p.facts) + "." });
  });
  state.tests.forEach((t) => {
    const d = daysLeft(t.date);
    const s = d < 0 ? 0 : d === 0 ? 70 : d === 1 ? 65 : d === 2 ? 55 : d === 3 ? 45 : d <= 7 ? 25 : 0;
    if (s) options.push({ score: s, title: "Revise for " + t.name + ".", why: "Your " + t.subject + " test is " + dayText(d) + "." });
  });
  options.sort((x, y) => y.score - x.score);

  const top = options[0] || { title: "You're all caught up 🎉", why: "No pending assignments or close tests. Use the time to revise ahead." };
  if (att.valid && att.status === "warning") top.note = "Heads up: attendance is " + att.pct.toFixed(1) + "%. You can miss only " + att.canMiss + " more class" + (att.canMiss === 1 ? "" : "es") + ".";
  return top;
}

/* ---------- 4. RENDERING (draw data on screen) ---------- */
const badge = (lvl, txt) => '<span class="badge ' + lvl + '">' + (txt || lvl.toUpperCase()) + "</span>";
const emptyMsg = (t) => '<p class="empty">' + t + "</p>";

function renderDashboard() {
  const h = new Date().getHours();
  const hello = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  const name = state.settings.name.trim();
  $("greeting").textContent = hello + (name ? ", " + name : "") + " 👋";
  $("todayDate").textContent = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });

  const pending = state.assignments.filter((a) => !a.done);
  const urgentTests = state.tests.filter((t) => { const d = daysLeft(t.date); return d >= 0 && d <= 2; });
  const attention = pending.filter((a) => priorityOf(a).level === "high").length + urgentTests.length;
  $("subGreeting").textContent = attention
    ? "You have " + attention + " thing" + (attention === 1 ? "" : "s") + " that need attention today."
    : "Nothing urgent today. Nice work ✨";

  // Next move card
  const r = recommend();
  $("nextCard").className = "card next" + (r.alert ? " alert" : "");
  $("nextCard").innerHTML = '<div class="label">🎯 Your next move</div><div class="big">' + esc(r.title) + "</div>" +
    "<div><strong>Why?</strong> " + esc(r.why) + "</div>" + (r.note ? '<p class="muted" style="margin-top:8px">' + esc(r.note) + "</p>" : "");

  // Overview stats
  const att = attStats();
  const upcoming = state.tests.filter((t) => daysLeft(t.date) >= 0).length;
  const doneCount = state.assignments.length - pending.length;
  $("stats").innerHTML =
    '<div class="stat"><b>' + pending.length + "</b><span>Pending assignments</span></div>" +
    '<div class="stat"><b>' + doneCount + "/" + state.assignments.length + "</b><span>Assignments done</span></div>" +
    '<div class="stat"><b>' + upcoming + "</b><span>Upcoming tests</span></div>" +
    '<div class="stat"><b>' + (att.valid ? att.pct.toFixed(0) + "%" : "–") + "</b><span>Attendance " + (att.valid ? badge(att.status === "safe" ? "low" : att.status === "warning" ? "medium" : "high", att.status.toUpperCase()) : "") + "</span></div>";

  // Priority tasks (top 3)
  const top = pending.map((a) => ({ a, p: priorityOf(a) })).sort((x, y) => y.p.score - x.p.score).slice(0, 3);
  $("priorityList").innerHTML = top.length
    ? top.map((o) => '<div class="mini"><strong>' + esc(o.a.title) + "</strong> " + badge(o.p.level) + '<div class="muted">' + esc(o.p.reason) + "</div></div>").join("")
    : emptyMsg("No pending assignments 🎉");

  const rem = getReminders();
  $("reminderList").innerHTML = rem.length ? rem.map((x) => '<div class="mini">' + esc(x.text) + "</div>").join("") : emptyMsg("No reminders. Chill 😌");

  const tests = state.tests.filter((t) => daysLeft(t.date) >= 0).sort((x, y) => x.date.localeCompare(y.date)).slice(0, 3);
  $("dashTests").innerHTML = tests.length ? tests.map((t) => '<div class="mini"><strong>' + esc(t.name) + "</strong> " + testBadge(daysLeft(t.date)) + '<div class="muted">' + esc(t.subject) + " · " + dayText(daysLeft(t.date)) + "</div></div>").join("") : emptyMsg("No upcoming tests.");

  const todayName = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][new Date().getDay()];
  const todays = state.timetable.filter((c) => c.day === todayName).sort((x, y) => x.start.localeCompare(y.start));
  $("dashClasses").innerHTML = todays.length ? todays.map((c) => '<div class="mini"><strong>' + esc(c.subject) + '</strong> <span class="muted">' + c.start + "–" + c.end + "</span></div>").join("") : emptyMsg("No classes today.");
}

function renderAssignments() {
  const sorted = state.assignments.map((a) => ({ a, p: priorityOf(a) }))
    .sort((x, y) => (x.a.done - y.a.done) || (y.p.score - x.p.score));   // pending first, then by score
  $("assignList").innerHTML = sorted.length ? sorted.map(({ a, p }) =>
    '<div class="item ' + (a.done ? "done" : "") + '"><div class="item-main">' +
    '<div class="title">' + esc(a.title) + " " + (a.done ? badge("low", "DONE") : badge(p.level)) + "</div>" +
    '<div class="meta">' + esc(a.subject) + " · due " + a.deadline + " (" + dayText(p.d) + ") · " + a.workload + " workload</div>" +
    (a.done ? "" : '<div class="why">' + esc(p.reason) + "</div>") + "</div>" +
    '<div class="actions"><button class="btn sm" data-action="toggle" data-id="' + a.id + '">' + (a.done ? "Undo" : "✓ Complete") + "</button>" +
    '<button class="btn sm ghost" data-action="edit" data-id="' + a.id + '">Edit</button>' +
    '<button class="btn sm danger" data-action="delA" data-id="' + a.id + '">Delete</button></div></div>').join("")
    : emptyMsg("No assignments yet. Add your first one above.");
}

function testBadge(d) {
  if (d < 0) return badge("low", "PAST");
  if (d <= 2) return badge("high", "URGENT");
  if (d <= 7) return badge("medium", "SOON");
  return badge("low", "PLANNED");
}
function renderTests() {
  const sorted = [...state.tests].sort((x, y) => x.date.localeCompare(y.date));
  $("testList").innerHTML = sorted.length ? sorted.map((t) => {
    const d = daysLeft(t.date);
    return '<div class="item ' + (d < 0 ? "done" : "") + '"><div class="item-main"><div class="title">' + esc(t.name) + " " + testBadge(d) + "</div>" +
      '<div class="meta">' + esc(t.subject) + " · " + t.date + " (" + dayText(d) + ")</div></div>" +
      '<div class="actions"><button class="btn sm danger" data-action="delT" data-id="' + t.id + '">Delete</button></div></div>';
  }).join("") : emptyMsg("No tests added.");
}

function renderTimetable() {
  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  $("ttGrid").innerHTML = days.map((day) => {
    const classes = state.timetable.filter((c) => c.day === day).sort((x, y) => x.start.localeCompare(y.start));
    return '<div class="tt-day"><h3>' + day + "</h3>" + (classes.map((c) =>
      '<div class="tt-class"><strong>' + esc(c.subject) + "</strong><small>" + c.start + " – " + c.end + '</small><button data-action="delC" data-id="' + c.id + '" aria-label="Delete class">×</button></div>').join("") || '<p class="empty">Free</p>') + "</div>";
  }).join("");
}

function renderAttendance() {
  const s = attStats();
  $("attAttended").value = state.attendance.attended;
  $("attTotal").value = state.attendance.total || "";
  if (!s.valid) { $("attResult").innerHTML = emptyMsg("Enter your attended and total classes to see your status."); return; }
  const lvl = s.status === "safe" ? "low" : s.status === "warning" ? "medium" : "high";
  const msg = s.status === "critical"
    ? "Your attendance is " + s.pct.toFixed(1) + "%. You are below the " + s.req + "% requirement. Attend the next " + s.needed + " classes in a row to recover."
    : "You can miss up to " + s.canMiss + " more class" + (s.canMiss === 1 ? "" : "es") + " and still stay at " + s.req + "% or above.";
  $("attResult").innerHTML =
    '<div class="att-top"><span class="att-pct">' + s.pct.toFixed(1) + "%</span>" + badge(lvl, s.status.toUpperCase()) + "</div>" +
    '<div class="bar"><i style="width:' + Math.min(100, s.pct) + '%"></i><em style="left:' + s.req + '%"></em></div>' +
    "<p>" + msg + '</p><h2 style="margin-top:16px">If you miss…</h2><div class="sim">' +
    s.afterMiss.map((v, i) => "<div><span class='muted'>" + (i + 1) + " class" + (i ? "es" : "") + "</span><b class='" + (v < s.req ? "bad" : "") + "'>" + v.toFixed(1) + "%</b></div>").join("") + "</div>";
}

function renderSettings() {
  $("sName").value = state.settings.name;
  $("sRequired").value = state.settings.required;
}

function renderAll() { renderDashboard(); renderAssignments(); renderTests(); renderTimetable(); renderAttendance(); renderSettings(); }

/* ---------- 5. NAVIGATION, FORMS & CLICKS ---------- */
function showView(name, focusId) {
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + name));
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  closeMenu();
  window.scrollTo(0, 0);
  if (focusId) $(focusId).focus();
}
function closeMenu() { $("sidebar").classList.remove("open"); $("overlay").classList.remove("show"); }
$("menuBtn").onclick = () => { $("sidebar").classList.add("open"); $("overlay").classList.add("show"); };
$("overlay").onclick = closeMenu;

// Add or update an assignment
function resetAssignForm() {
  editingId = null;
  $("assignForm").reset();
  $("assignFormTitle").textContent = "Add assignment";
  $("assignSubmit").textContent = "Add assignment";
  $("assignCancel").hidden = true;
}
$("assignForm").onsubmit = (e) => {
  e.preventDefault();
  const data = { title: $("aTitle").value.trim(), subject: $("aSubject").value.trim(), deadline: $("aDeadline").value, workload: $("aWorkload").value, strict: $("aStrict").value };
  if (editingId) {
    Object.assign(state.assignments.find((a) => a.id === editingId), data);   // EDIT
  } else {
    state.assignments.push({ id: newId(), done: false, ...data });            // ADD
  }
  resetAssignForm(); save(); renderAll();
};
$("assignCancel").onclick = resetAssignForm;

$("testForm").onsubmit = (e) => {
  e.preventDefault();
  state.tests.push({ id: newId(), name: $("tName").value.trim(), subject: $("tSubject").value.trim(), date: $("tDate").value });
  e.target.reset(); save(); renderAll();
};
$("classForm").onsubmit = (e) => {
  e.preventDefault();
  if ($("cEnd").value <= $("cStart").value) { alert("End time must be after start time."); return; }
  state.timetable.push({ id: newId(), subject: $("cSubject").value.trim(), day: $("cDay").value, start: $("cStart").value, end: $("cEnd").value });
  e.target.reset(); $("cStart").value = "09:00"; $("cEnd").value = "10:00"; save(); renderAll();
};
$("attForm").onsubmit = (e) => {
  e.preventDefault();
  const attended = parseInt($("attAttended").value, 10), total = parseInt($("attTotal").value, 10);
  if (attended > total) { alert("Attended classes cannot be more than total classes."); return; }
  state.attendance = { attended, total }; save(); renderAll();
};
$("settingsForm").onsubmit = (e) => {
  e.preventDefault();
  const newName = $("sName").value.trim();
  if (!newName) { $("settingsMsg").textContent = "Please enter a name."; return; }   // keep the old name if empty
  state.settings.name = newName;
  state.settings.required = Math.min(99, Math.max(1, parseInt($("sRequired").value, 10) || 75));
  save(); renderAll();
  $("settingsMsg").textContent = "Saved ✓";
};
$("resetDemo").onclick = () => {
  if (confirm("Replace everything with demo data?")) {
    const keepName = state.settings.name;          // demo data never changes your name
    state = demoData(); state.settings.name = keepName;
    save(); renderAll();
  }
};
$("clearAll").onclick = () => {
  if (confirm("Delete ALL your data?")) {
    state = { assignments: [], tests: [], timetable: [], attendance: { attended: 0, total: 0 }, settings: { name: "", required: 75 } };
    save(); renderAll();
    showWelcome();                                  // no name saved anymore, so ask again
  }
};

// One click listener handles every Complete / Edit / Delete button (event delegation)
document.addEventListener("click", (e) => {
  const nav = e.target.closest("[data-view]");
  if (nav) return showView(nav.dataset.view);
  const go = e.target.closest("[data-goto]");
  if (go) return showView(go.dataset.goto, go.dataset.focus);

  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const id = btn.dataset.id, act = btn.dataset.action;
  if (act === "toggle") { const a = state.assignments.find((x) => x.id === id); a.done = !a.done; }
  else if (act === "delA") { if (!confirm("Delete this assignment?")) return; state.assignments = state.assignments.filter((x) => x.id !== id); if (editingId === id) resetAssignForm(); }
  else if (act === "delT") state.tests = state.tests.filter((x) => x.id !== id);
  else if (act === "delC") state.timetable = state.timetable.filter((x) => x.id !== id);
  else if (act === "edit") {                       // fill the form with the assignment's data
    const a = state.assignments.find((x) => x.id === id);
    editingId = id;
    $("aTitle").value = a.title; $("aSubject").value = a.subject; $("aDeadline").value = a.deadline;
    $("aWorkload").value = a.workload; $("aStrict").value = a.strict;
    $("assignFormTitle").textContent = "Edit assignment"; $("assignSubmit").textContent = "Save changes";
    $("assignCancel").hidden = false; window.scrollTo(0, 0); $("aTitle").focus();
    return;
  }
  save(); renderAll();
});

/* ---------- WELCOME SCREEN (asks for a name when none is saved) ---------- */
const hasName = () => (state.settings.name || "").trim() !== "";
function showWelcome() { $("wName").value = ""; $("wMsg").textContent = ""; $("welcome").hidden = false; $("wName").focus(); }
$("welcomeForm").onsubmit = (e) => {
  e.preventDefault();
  const name = $("wName").value.trim();
  if (!name) { $("wMsg").textContent = "Please enter your name."; return; }
  state.settings.name = name;                       // saved inside "duecue-data-v1"
  save(); renderAll();
  $("welcome").hidden = true;
  showView("dashboard");
};

/* ---------- 6. START-UP ---------- */
renderAll();
if (!hasName()) showWelcome();
setInterval(renderDashboard, 60000);   // refresh greeting/dates if the tab stays open
