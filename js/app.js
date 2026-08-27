// ══════════════════════════════════════════════════════════════
//  First Day Outbreak — ice-breaker + contact-tracing mystery
//  Single-file app logic. Two backends: Firestore (real, multi-phone)
//  or an in-memory Demo store (single device, seeded classmates).
// ══════════════════════════════════════════════════════════════
import { firebaseConfig, isConfigured } from "./firebase-config.js";

// ── Content ─────────────────────────────────────────────────
const ADJS = ["Wandering","Curious","Brave","Sleepy","Clever","Jolly","Swift","Mellow","Bold","Cosmic","Fuzzy","Nimble","Sunny","Witty","Gentle","Daring","Lucky","Quiet","Zesty","Plucky","Radiant","Breezy"];
const ANIMALS = ["Otter","Falcon","Panda","Lynx","Heron","Fox","Koala","Wren","Bison","Gecko","Moose","Puffin","Tapir","Raven","Ibex","Newt","Quokka","Marten","Egret","Yak","Civet","Dingo"];
const EMOJIS = ["🦊","🐨","🦉","🦥","🐧","🦦","🐢","🦫","🦔","🐝","🦩","🐙","🦭","🐳","🦚","🦜","🐿️","🦎","🐡","🦌","🐼","🦇"];
const MISSIONS = [
  "Find someone who grew up in a different town than you.",
  "Find someone who wants to work in the same field as you.",
  "Find someone with the same first-letter in their name.",
  "Find someone who's had a job before — ask what it was.",
  "Find someone who took a science class they loved.",
  "Find someone born in the same season as you.",
  "Find someone who speaks more than one language.",
  "Find someone who's nervous about the same thing you are today.",
  "Find someone with a pet — ask its name.",
  "Find someone who ate breakfast this morning.",
  "Find someone who has a hidden talent — ask them to describe it.",
  "Find someone who chose this program for a reason like yours.",
];
// Trait ladder — students record a NEW trait each meeting, starting generic and
// getting more personal. Clues/dossier reveal them in this tier order (generic first).
const TRAIT_PROMPTS = [
  { tier: 0, label: "A general trait (easy to spot across the room)", ph: "e.g. in the afternoon cohort" },
  { tier: 1, label: "Something they like (a subject, food, team…)", ph: "e.g. loves anatomy class" },
  { tier: 2, label: "Something they've done (a past job or hobby)", ph: "e.g. used to be a barista" },
  { tier: 3, label: "A unique personal detail", ph: "e.g. has a husky named Kona" },
];
const TIER_NAMES = ["general", "interest", "background", "personal"];
const DEMO_TRAITS = [
  { t: 0, x: "in the afternoon cohort" }, { t: 0, x: "sits near the front" }, { t: 0, x: "always has an iced coffee" }, { t: 0, x: "wears a blue lanyard" },
  { t: 1, x: "loves anatomy class" }, { t: 1, x: "is a big soccer fan" }, { t: 1, x: "wants to go into pediatrics" }, { t: 1, x: "is obsessed with true-crime podcasts" },
  { t: 2, x: "used to be a lifeguard" }, { t: 2, x: "worked as a barista" }, { t: 2, x: "volunteers at an animal shelter" }, { t: 2, x: "was a competitive swimmer" },
  { t: 3, x: "has a husky named Kona" }, { t: 3, x: "has an identical twin" }, { t: 3, x: "plays the cello" }, { t: 3, x: "grew up on a dairy farm" },
];
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no I,L,O,0,1
const DEFAULT_STATIONS = ["Front-Desk Tablet", "Hand-Sanitizer Pump", "Candy Bowl", "Coffee Station"];

// ── Tiny utils ──────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const app = $("app");
const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
function code4(exclude = new Set()) {
  let c; do { c = Array.from({ length: 4 }, () => rand([...CODE_CHARS])).join(""); } while (exclude.has(c));
  return c;
}
function roomCode() { return Array.from({ length: 4 }, () => rand([..."ABCDEFGHJKMNPQRSTUVWXYZ"])).join(""); }
function tms(v) { // normalize a timestamp to millis for sorting
  if (v == null) return Infinity;
  if (typeof v === "number") return v;
  if (typeof v.toMillis === "function") return v.toMillis();
  return Infinity;
}
let toastT;
function toast(msg, isErr = false) {
  const t = $("toast"); t.textContent = msg;
  t.className = "toast show" + (isErr ? " err" : "");
  clearTimeout(toastT); toastT = setTimeout(() => (t.className = "toast"), 2600);
}

// ── Local session (survive refresh) ─────────────────────────
const SS = "outbreak.session";
function saveSession() { localStorage.setItem(SS, JSON.stringify(S.session)); }
function loadSession() { try { return JSON.parse(localStorage.getItem(SS)) || {}; } catch { return {}; } }

// ── Host-only private notes (stay on THIS device, never sent to Firestore) ──
const NOTES = "outbreak.notes";
function allNotes() { try { return JSON.parse(localStorage.getItem(NOTES)) || {}; } catch { return {}; } }
function getNote(pid) { return allNotes()[S.session.roomCode + "/" + pid] || ""; }
function setNote(pid, text) { const n = allNotes(); n[S.session.roomCode + "/" + pid] = text; localStorage.setItem(NOTES, JSON.stringify(n)); }

// ── Global runtime state ────────────────────────────────────
const S = {
  session: loadSession(),          // { role, roomCode, pid }
  room: null, players: [], objects: [], contacts: [], facts: [], guesses: [],
  unsub: [], hostPickMode: null, dossierPick: "",
};
let currentTraitTier = 0; // which rung of the trait ladder the mingle screen is showing

// ════════════════════════════════════════════════════════════
//  STORE — Firestore or Demo, same interface
// ════════════════════════════════════════════════════════════
let store;

async function makeFirestoreStore() {
  const { initializeApp } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js");
  const fs = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
  const dbApp = initializeApp(firebaseConfig);
  const db = fs.getFirestore(dbApp);
  const roomRef = (rc) => fs.doc(db, "rooms", rc);
  const sub = (rc, name) => fs.collection(db, "rooms", rc, name);
  return {
    kind: "firestore",
    async createRoom(rc, data) { await fs.setDoc(roomRef(rc), data); },
    async updateRoom(rc, patch) { await fs.updateDoc(roomRef(rc), patch); },
    async roomExists(rc) { return (await fs.getDoc(roomRef(rc))).exists(); },
    async addPlayer(rc, pid, p) { await fs.setDoc(fs.doc(sub(rc, "players"), pid), p); },
    async updatePlayer(rc, pid, patch) { await fs.updateDoc(fs.doc(sub(rc, "players"), pid), patch); },
    async setObject(rc, oid, o) { await fs.setDoc(fs.doc(sub(rc, "objects"), oid), o); },
    async addContact(rc, cid, c) { await fs.setDoc(fs.doc(sub(rc, "contacts"), cid), c); },
    async addFact(rc, fid, f) { await fs.setDoc(fs.doc(sub(rc, "facts"), fid), f); },
    async addGuess(rc, pid, g) { await fs.setDoc(fs.doc(sub(rc, "guesses"), pid), g); },
    serverTime: () => fs.serverTimestamp(),
    listen(rc, onChange) {
      const unsubs = [
        fs.onSnapshot(roomRef(rc), (d) => { S.room = d.exists() ? { id: d.id, ...d.data() } : null; onChange(); }),
        fs.onSnapshot(sub(rc, "players"), (q) => { S.players = q.docs.map((d) => ({ id: d.id, ...d.data() })); onChange(); }),
        fs.onSnapshot(sub(rc, "objects"), (q) => { S.objects = q.docs.map((d) => ({ id: d.id, ...d.data() })); onChange(); }),
        fs.onSnapshot(sub(rc, "contacts"), (q) => { S.contacts = q.docs.map((d) => ({ id: d.id, ...d.data() })); onChange(); }),
        fs.onSnapshot(sub(rc, "facts"), (q) => { S.facts = q.docs.map((d) => ({ id: d.id, ...d.data() })); onChange(); }),
        fs.onSnapshot(sub(rc, "guesses"), (q) => { S.guesses = q.docs.map((d) => ({ id: d.id, ...d.data() })); onChange(); }),
      ];
      return () => unsubs.forEach((u) => u());
    },
  };
}

function makeDemoStore() {
  // Single-device, in-memory. Everything lives in S.* already.
  let cb = null;
  const fire = () => cb && cb();
  return {
    kind: "demo",
    async createRoom(rc, data) { S.room = { id: rc, ...data }; fire(); },
    async updateRoom(rc, patch) { Object.assign(S.room, patch); fire(); },
    async roomExists() { return !!S.room; },
    async addPlayer(rc, pid, p) { S.players.push({ id: pid, ...p }); fire(); },
    async updatePlayer(rc, pid, patch) { const x = S.players.find((p) => p.id === pid); if (x) Object.assign(x, patch); fire(); },
    async setObject(rc, oid, o) { const i = S.objects.findIndex((x) => x.id === oid); if (i >= 0) S.objects[i] = { id: oid, ...o }; else S.objects.push({ id: oid, ...o }); fire(); },
    async addContact(rc, cid, c) { if (!S.contacts.some((x) => x.id === cid)) S.contacts.push({ id: cid, ...c }); fire(); },
    async addFact(rc, fid, f) { const i = S.facts.findIndex((x) => x.id === fid); if (i >= 0) S.facts[i] = { id: fid, ...f }; else S.facts.push({ id: fid, ...f }); fire(); },
    async addGuess(rc, pid, g) { const i = S.guesses.findIndex((x) => x.id === pid); if (i >= 0) S.guesses[i] = { id: pid, ...g }; else S.guesses.push({ id: pid, ...g }); fire(); },
    serverTime: () => Date.now(),
    listen(rc, onChange) { cb = onChange; onChange(); return () => (cb = null); },
  };
}

// ════════════════════════════════════════════════════════════
//  GAME HELPERS
// ════════════════════════════════════════════════════════════
const me = () => S.players.find((p) => p.id === S.session.pid) || null;
const takenCodes = () => new Set([...S.players.map((p) => p.code), ...S.objects.map((o) => o.code)]);
const persons = () => S.players.filter((p) => !p.isHost);
const stations = () => S.objects;

function lookupByCode(raw) {
  const c = raw.trim().toUpperCase();
  const p = S.players.find((x) => x.code === c && !x.isHost);
  if (p) return { kind: "person", target: p };
  const o = S.objects.find((x) => x.code === c);
  if (o) return { kind: "object", target: o };
  return null;
}

// distinct people a given pid has met
function metPeople(pid) {
  const set = new Set();
  for (const c of S.contacts) {
    if (c.type !== "person") continue;
    if (c.a === pid) set.add(c.b);
    else if (c.b === pid) set.add(c.a);
  }
  return set;
}
function stationsVisited(pid) {
  const set = new Set();
  for (const c of S.contacts) if (c.type === "object" && c.a === pid) set.add(c.b);
  return set;
}
// facts other classmates recorded ABOUT a given person, generic → specific
function factsAbout(pid) {
  return S.facts
    .filter((f) => f.about === pid && f.text && f.text.trim())
    .sort((a, b) => ((a.tier ?? 9) - (b.tier ?? 9)) || (tms(a.createdAt) - tms(b.createdAt)));
}
// overall pair coverage among students
function pairCoverage() {
  const n = persons().length;
  const total = n < 2 ? 0 : (n * (n - 1)) / 2;
  const seen = new Set();
  for (const c of S.contacts) {
    if (c.type !== "person") continue;
    seen.add([c.a, c.b].sort().join("~"));
  }
  return { met: seen.size, total };
}

// ── The epidemiology engine ────────────────────────────────
// Deterministic, time-ordered spread from the two seeds.
function computeSpread() {
  const pz = S.room?.patientZeroPid;
  const srcObj = S.objects.find((o) => o.isSource);
  const state = {};
  persons().forEach((p) => (state[p.id] = { infected: false, onset: null, via: null }));
  if (pz && state[pz]) state[pz] = { infected: true, onset: 0, via: "seed" };

  const sorted = [...S.contacts].sort((a, b) => (tms(a.createdAt) - tms(b.createdAt)) || (a.seq - b.seq));
  let step = 1;
  for (const c of sorted) {
    if (c.type === "object") {
      const p = state[c.a];
      if (p && !p.infected && srcObj && c.b === srcObj.id) { state[c.a] = { infected: true, onset: step++, via: "object" }; }
    } else {
      const A = state[c.a], B = state[c.b];
      if (!A || !B) continue;
      if (A.infected && !B.infected) state[c.b] = { infected: true, onset: step++, via: c.a };
      else if (B.infected && !A.infected) state[c.a] = { infected: true, onset: step++, via: c.b };
    }
  }
  return state;
}

// ════════════════════════════════════════════════════════════
//  ACTIONS
// ════════════════════════════════════════════════════════════
async function connectRoom(rc) {
  S.unsub.forEach((u) => u()); S.unsub = [];
  S.unsub.push(store.listen(rc, () => render()));
}

async function hostCreate() {
  const rc = roomCode();
  await store.createRoom(rc, {
    phase: "lobby", patientZeroPid: null, answerRevealed: false, cluesRevealed: 0, createdAt: store.serverTime(),
  });
  // seed station objects
  const taken = new Set();
  for (let i = 0; i < DEFAULT_STATIONS.length; i++) {
    const c = code4(taken); taken.add(c);
    await store.setObject(rc, "obj" + i, { name: DEFAULT_STATIONS[i], code: c, isSource: i === 1 });
  }
  S.session = { role: "host", roomCode: rc, pid: null }; saveSession();
  await connectRoom(rc);
  if (store.kind === "demo") seedDemoPlayers(rc);
}

async function joinRoom(rc) {
  rc = rc.trim().toUpperCase();
  if (rc.length !== 4) return toast("Room code is 4 letters.", true);
  if (store.kind === "firestore") {
    await connectRoom(rc);
    await new Promise((r) => setTimeout(r, 500)); // let snapshot arrive
    if (!S.room) return toast("No room with that code.", true);
  }
  const codename = newCodename();
  const pid = "p_" + code4(new Set()).toLowerCase() + Date.now().toString(36);
  const player = { codename, emoji: rand(EMOJIS), code: code4(takenCodes()), isHost: false, senior: false, infected: false, onset: null, joinedAt: store.serverTime() };
  await store.addPlayer(rc, pid, player);
  S.session = { role: "player", roomCode: rc, pid }; saveSession();
  if (store.kind === "demo") return render();
}
function newCodename(excludeId) {
  const used = new Set(S.players.filter((p) => p.id !== excludeId).map((p) => p.codename));
  let cn; do { cn = `${rand(ADJS)} ${rand(ANIMALS)}`; } while (used.has(cn) && used.size < ADJS.length * ANIMALS.length);
  return cn;
}
async function rerollCodename() {
  const my = me(); if (!my) return;
  const cn = newCodename(my.id);
  await store.updatePlayer(S.session.roomCode, my.id, { codename: cn });
  toast(`You're now ${cn}!`);
}
async function hostToggleSenior(pid) {
  const p = S.players.find((x) => x.id === pid); if (!p) return;
  await store.updatePlayer(S.session.roomCode, pid, { senior: !p.senior });
}
async function hostRandomPZ() {
  const ppl = persons(); if (!ppl.length) return;
  const pool = ppl.filter((p) => p.senior);
  const pick = rand(pool.length ? pool : ppl);
  await hostSetPZ(pick.id);
  toast(`🎲 ${pick.codename} is your index case — go powder them!`);
}

async function logCode(raw, fact = "") {
  const my = me(); if (!my) return;
  const found = lookupByCode(raw);
  if (!found) return toast("No match for that code. Ask again!", true);
  if (found.kind === "person") {
    const other = found.target;
    if (other.id === my.id) return toast("That's your own code 🙂", true);
    if (!fact || fact.trim().length < 3) return toast("Type a new fact you learned about them 🙂", true);
    const cid = "PP_" + [my.id, other.id].sort().join("_");
    const already = S.contacts.some((c) => c.id === cid);
    if (!already) await store.addContact(S.session.roomCode, cid, { type: "person", a: my.id, b: other.id, createdAt: store.serverTime(), seq: Date.now() });
    // record the fact I learned about them (one per direction; updates if re-logged)
    await store.addFact(S.session.roomCode, "F_" + my.id + "_" + other.id, { by: my.id, about: other.id, text: fact.trim().slice(0, 120), tier: currentTraitTier, createdAt: store.serverTime() });
    toast(already ? `New fact logged about ${other.codename}! 🧠` : `Met ${other.codename}! 🤝`);
    return true;
  } else {
    const obj = found.target;
    const cid = "PO_" + my.id + "_" + obj.id;
    if (S.contacts.some((c) => c.id === cid)) return toast(`Already checked in at ${obj.name} ✓`);
    await store.addContact(S.session.roomCode, cid, { type: "object", a: my.id, b: obj.id, createdAt: store.serverTime(), seq: Date.now() });
    toast(`Checked in: ${obj.name} 📍`);
    return true;
  }
}

async function hostDripClue() {
  const pz = S.room?.patientZeroPid;
  const clues = pz ? factsAbout(pz) : [];
  if (!clues.length) return toast("No facts were recorded about Patient Zero — use the line list + dossier instead.", true);
  const next = Math.min((S.room.cluesRevealed || 0) + 1, clues.length);
  await store.updateRoom(S.session.roomCode, { cluesRevealed: next });
  if (next >= clues.length) toast("That's every recorded clue about Patient Zero.");
}

async function hostSetPhase(phase) {
  if (phase === "reveal") {
    if (!S.room.patientZeroPid) return toast("Pick Patient Zero first (tap a student).", true);
    if (!S.objects.some((o) => o.isSource)) return toast("Mark one object as the source first.", true);
    const spread = computeSpread();
    for (const p of persons()) {
      const st = spread[p.id];
      await store.updatePlayer(S.session.roomCode, p.id, { infected: st.infected, onset: st.onset });
    }
  }
  await store.updateRoom(S.session.roomCode, { phase });
}

async function hostSetPZ(pid) { await store.updateRoom(S.session.roomCode, { patientZeroPid: pid }); S.hostPickMode = null; toast("Patient Zero set 🔴"); }
async function hostSetSource(oid) { for (const o of S.objects) await store.setObject(S.session.roomCode, o.id, { ...o, isSource: o.id === oid }); toast("Contaminated object set ☣️"); }
async function hostRevealAnswer() { await store.updateRoom(S.session.roomCode, { answerRevealed: true }); }

async function submitGuess(pzPid, objId) {
  if (!pzPid || !objId) return toast("Pick both a person and an object.", true);
  await store.addGuess(S.session.roomCode, S.session.pid, { pzPid, objId, codename: me()?.codename || "?" });
  toast("Investigation filed! 🔎");
}

function leave() { S.unsub.forEach((u) => u()); S.unsub = []; localStorage.removeItem(SS); S.session = {}; S.room = null; S.players = []; S.objects = []; S.contacts = []; S.facts = []; S.guesses = []; render(); }

// ── Demo seeding ────────────────────────────────────────────
function seedDemoPlayers(rc) {
  const n = 12, taken = new Set(S.objects.map((o) => o.code));
  for (let i = 0; i < n; i++) {
    const cn = `${ADJS[i % ADJS.length]} ${ANIMALS[(i * 3) % ANIMALS.length]}`;
    const cd = code4(taken); taken.add(cd);
    S.players.push({ id: "demo" + i, codename: cn, emoji: EMOJIS[i % EMOJIS.length], code: cd, isHost: false, senior: i % 5 === 0, infected: false, onset: null, joinedAt: Date.now() + i });
  }
  render();
}
function demoSimulate() {
  const ppl = persons(); if (ppl.length < 2) return;
  let t = Date.now();
  // ensure patient zero + source exist for a meaningful sim
  const pz = S.room.patientZeroPid || ppl[0].id;
  if (!S.room.patientZeroPid) S.room.patientZeroPid = pz;
  if (!S.objects.some((o) => o.isSource)) S.objects[1].isSource = true;
  // random dense-ish mingling (+ a fact recorded about whoever was met)
  for (let round = 0; round < 4; round++) {
    for (const p of ppl) {
      const other = rand(ppl.filter((x) => x.id !== p.id));
      const cid = "PP_" + [p.id, other.id].sort().join("_");
      if (!S.contacts.some((c) => c.id === cid)) S.contacts.push({ id: cid, type: "person", a: p.id, b: other.id, createdAt: t, seq: t }); t += 1000;
      const fid = "F_" + p.id + "_" + other.id;
      if (!S.facts.some((f) => f.id === fid)) { const tr = rand(DEMO_TRAITS); S.facts.push({ id: fid, by: p.id, about: other.id, text: tr.x, tier: tr.t, createdAt: t }); }
    }
  }
  // some station check-ins
  for (const p of ppl) if (Math.random() < 0.6) { const o = rand(S.objects); const cid = "PO_" + p.id + "_" + o.id; if (!S.contacts.some((c) => c.id === cid)) S.contacts.push({ id: cid, type: "object", a: p.id, b: o.id, createdAt: t, seq: t }); t += 500; }
  toast("Simulated a few minutes of mingling.");
  render();
}

// ════════════════════════════════════════════════════════════
//  RENDER
// ════════════════════════════════════════════════════════════
function header(role) {
  return `<div class="brand"><span class="logo">🦠</span><h1>First Day Outbreak</h1><span class="role">${role}</span></div>`;
}

function render() {
  const { role, roomCode: rc } = S.session;
  if (!role) return renderHome();
  if (role === "join") return renderJoin();
  if (role === "player") { return me() ? renderPlayer() : renderJoin(); }
  if (role === "host") return renderHost();
  renderHome();
}

// ── Home ──
function renderHome() {
  app.className = "";
  app.innerHTML = `<div class="wrap">
    ${header("welcome")}
    <div class="card center">
      <div style="font-size:56px">🧬</div>
      <h2>First Day Outbreak</h2>
      <p class="sub">A get-to-know-you mingle game… with a secret. Meet your classmates, then discover how far a "germ" can travel in one morning.</p>
      <button data-a="go-join">I'm a Student — Join</button>
      <button class="ghost mt" data-a="go-host">I'm the Instructor — Host</button>
    </div>
    ${store.kind === "demo" ? `<div class="card"><h2>⚙️ Demo mode</h2><p class="sub">Firebase isn't configured yet, so this runs on one device with pretend classmates — perfect for a dry run. Add your keys in <code>js/firebase-config.js</code> for real multi-phone play. See <b>README.md</b>.</p></div>` : ""}
    <small class="foot">No accounts, no personal data — just codenames.</small>
  </div>`;
}

// ── Join ──
function renderJoin() {
  app.className = "";
  app.innerHTML = `<div class="wrap">
    ${header("student")}
    <div class="card">
      <h2>Join the room</h2>
      <p class="sub">Ask the instructor for the 4-letter room code on the screen. You'll get an <b>anonymous codename</b> — no name or personal info required.</p>
      <label class="fld">Room code</label>
      <input id="rc" class="code-in" maxlength="4" autocapitalize="characters" autocomplete="off" placeholder="ABCD" value="${esc((S.session.roomCode) || "")}" />
      <button class="mt" data-a="do-join">Get my codename →</button>
      <button class="ghost mt" data-a="home">Back</button>
    </div>
  </div>`;
  $("rc").addEventListener("input", (e) => (e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, "")));
}

// ── Player ──
function renderPlayer() {
  app.className = "";
  const my = me(); const phase = S.room?.phase || "lobby";
  if (phase === "lobby") return playerLobby(my);
  if (phase === "mingle") return playerMingle(my);
  if (phase === "reveal") return playerReveal(my);
  if (phase === "investigate" || phase === "solved") return playerInvestigate(my);
  playerLobby(my);
}

function idCard(my) {
  return `<div class="idcard">
    <div class="avatar">${my.emoji}</div>
    <div class="codename">${esc(my.codename)}</div>
    <div class="label">Your germ ID — share it when you meet someone</div>
    <div class="mycode">${my.code}</div>
    <div class="hint">🎭 Your secret identity — no name needed</div>
  </div>`;
}

function playerLobby(my) {
  app.innerHTML = `<div class="wrap">${header("student")}
    ${idCard(my)}
    <button class="ghost mt small" data-a="reroll">↻ Give me a different codename</button>
    <div class="card center mt"><h2>You're in! 🎉</h2><p class="sub">Sit tight — the instructor will start the mingle in a moment. Get ready to meet everyone.</p></div>
    <button class="ghost" data-a="leave">Leave</button>
  </div>`;
}

function playerMingle(my) {
  const total = persons().length - 1;
  const met = metPeople(my.id); const metCount = met.size;
  const pct = total > 0 ? Math.round((metCount / total) * 100) : 0;
  const missionIdx = metCount % MISSIONS.length;
  const trait = TRAIT_PROMPTS[metCount % TRAIT_PROMPTS.length];
  currentTraitTier = trait.tier;
  const metNames = [...met].map((id) => S.players.find((p) => p.id === id)?.codename).filter(Boolean);
  const st = stationsVisited(my.id);
  const done = metCount >= total && total > 0;
  app.innerHTML = `<div class="wrap">${header("student")}
    <div class="idcard" style="padding:14px">
      <div style="display:flex;align-items:center;gap:12px;text-align:left">
        <div style="font-size:40px">${my.emoji}</div>
        <div><div class="codename" style="font-size:18px">${esc(my.codename)}</div>
        <div class="muted" style="font-size:13px">Your code: <b style="color:var(--teal);letter-spacing:3px">${my.code}</b></div></div>
      </div>
    </div>

    ${done ? `<div class="card center" style="border-color:var(--lime)"><div style="font-size:40px">🌟</div><h2>You met everyone!</h2><p class="sub">Legend. Help anyone still looking for people — and check in at any stations you missed.</p></div>`
      : `<div class="mission"><div class="tag">Your mission</div><div class="txt">${MISSIONS[missionIdx]}</div></div>`}

    <div class="card">
      <h2>Log who you met</h2>
      <p class="sub">Chat first, then swap codes. <b>Already know them? Trade a fact neither of you knew.</b></p>
      <label class="fld">Their 4-letter code (or a station card's code)</label>
      <input id="logc" class="code-in" maxlength="4" autocapitalize="characters" autocomplete="off" placeholder="CODE" />
      <label class="fld">${esc(trait.label)}</label>
      <input id="logf" type="text" autocomplete="off" placeholder="${esc(trait.ph)}" />
      <button class="mt" data-a="do-log">Add contact ✓</button>
      <div class="progress mt">
        <div class="bar"><span style="width:${pct}%"></span></div>
        <div class="cap"><span>Met ${metCount} of ${total} classmates</span><span>${pct}%</span></div>
      </div>
      ${st.size ? `<p class="muted mt" style="font-size:13px">📍 Checked in at ${st.size} station${st.size>1?"s":""}.</p>` : ""}
      ${metNames.length ? `<div class="chips">${metNames.map((n) => `<span class="chip">${esc(n)}</span>`).join("")}</div>` : ""}
    </div>
    <button class="ghost" data-a="leave">Leave</button>
  </div>`;
  const inp = $("logc");
  inp.addEventListener("input", (e) => (e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "")));
  $("logf").addEventListener("keydown", (e) => { if (e.key === "Enter") doLog(); });
}

function playerReveal(my) {
  app.innerHTML = `<div class="wrap">${header("student")}
    <div class="reveal-hero card ${my.infected ? "status-infected" : "status-clear"}">
      <div class="big pulse">${my.infected ? "🦠" : "🧼"}</div>
      <h2>Outbreak detected</h2>
      <p class="sub">Turn on the blacklight and check your hands. The glow doesn't lie.</p>
    </div>
    <div class="card center">
      ${my.infected
        ? `<h2 style="color:var(--red)">You were exposed.</h2><p class="sub">You picked up the "germ" somewhere this morning. But <b>you're not the origin</b> — someone (and something) started this. Time to trace it back.</p>`
        : `<h2 style="color:var(--lime)">You stayed clean!</h2><p class="sub">Nice hand hygiene… or lucky timing. Help your team find where this began.</p>`}
    </div>
    <div class="card center"><p class="sub">Waiting for the instructor to open the investigation…</p></div>
  </div>`;
}

function playerInvestigate(my) {
  const revealed = S.room?.answerRevealed;
  const spread = computeSpread();
  const line = persons().filter((p) => spread[p.id].infected)
    .sort((a, b) => spread[a.id].onset - spread[b.id].onset);
  const myGuess = S.guesses.find((g) => g.id === S.session.pid);
  const pzName = (id) => S.players.find((p) => p.id === id)?.codename || "?";
  const answerPZ = S.room?.patientZeroPid;
  const answerObj = S.objects.find((o) => o.isSource);

  app.innerHTML = `<div class="wrap">${header("investigator")}
    <div class="card">
      <h2>🔬 The investigation</h2>
      <p class="sub">Epidemiologists find "Patient Zero" by <b>symptom-onset order</b>: whoever showed symptoms <i>first</i> is the likely source. Read the line list, cross-check the contact log, and name the origin — the student <b>and</b> the object.</p>
    </div>

    <div class="card">
      <h2>Line list — order of onset</h2>
      <p class="sub">Earliest onset at the top.</p>
      <div class="tbl-wrap"><table><thead><tr><th>#</th><th>Case</th><th>Onset</th></tr></thead><tbody>
        ${line.map((p, i) => `<tr class="${i === 0 ? "rank1" : ""}"><td>${i + 1}</td><td>${p.emoji} ${esc(p.codename)}</td><td>${spread[p.id].onset === 0 ? "① first signs" : "step " + spread[p.id].onset}</td></tr>`).join("")}
      </tbody></table></div>
    </div>

    ${(S.room?.cluesRevealed > 0) ? `<div class="card" style="border-color:var(--violet)">
        <h2>🔍 Clues about Patient Zero</h2>
        <p class="sub">Facts classmates recorded about the index case during the mingle. Match them to a real person in the room.</p>
        <div class="list">
          ${factsAbout(answerPZ).slice(0, S.room.cluesRevealed).map((f, i) => `<div class="person" style="border-color:var(--violet)"><span class="em">🧩</span><div><div class="meta">Clue ${i + 1} · ${TIER_NAMES[f.tier ?? 0]}</div><div class="nm">"${esc(f.text)}"</div></div></div>`).join("") || `<p class="muted">No facts were recorded about the index case.</p>`}
        </div>
      </div>` : ""}

    <div class="card">
      <h2>🗂 Suspect dossier</h2>
      <p class="sub">Pick a case to see what classmates learned about them — use it to unmask who the codename really is.</p>
      <select id="dossier">${["<option value=''>— choose a case —</option>", ...line.map((p) => `<option value="${p.id}" ${S.dossierPick === p.id ? "selected" : ""}>${esc(p.codename)}</option>`)].join("")}</select>
      ${S.dossierPick ? (() => { const fx = factsAbout(S.dossierPick); return `<div class="list mt">${fx.length ? fx.map((f) => `<div class="person"><span class="em">🧠</span><div><div class="nm">"${esc(f.text)}"</div><div class="meta">${TIER_NAMES[f.tier ?? 0]} trait</div></div></div>`).join("") : `<p class="muted">No facts were recorded about this person — they may not have been logged as "the person you met."</p>`}</div>`; })() : ""}
    </div>

    ${revealed ? `<div class="card" style="border-color:var(--amber)">
        <h2>☣️ Confirmed source</h2>
        <div class="list">
          <div class="person pz"><span class="em">🔴</span><div><div class="nm">${esc(pzName(answerPZ))}</div><div class="meta">Patient Zero — the index case</div></div></div>
          <div class="person"><span class="em">☣️</span><div><div class="nm">${esc(answerObj?.name || "?")}</div><div class="meta">Contaminated object (fomite)</div></div></div>
        </div>
        ${myGuess ? `<p class="mt" style="font-weight:800;color:${myGuess.pzPid === answerPZ && myGuess.objId === answerObj?.id ? "var(--lime)" : "var(--amber)"}">${myGuess.pzPid === answerPZ && myGuess.objId === answerObj?.id ? "✅ Your team nailed it!" : "So close — compare with your guess."}</p>` : ""}
      </div>`
    : `<div class="card">
        <h2>File your conclusion</h2>
        <label class="fld">Who was Patient Zero?</label>
        <select id="gPZ">${["<option value=''>— choose —</option>", ...line.map((p) => `<option value="${p.id}" ${myGuess?.pzPid === p.id ? "selected" : ""}>${esc(p.codename)}</option>`)].join("")}</select>
        <label class="fld">Which object was contaminated?</label>
        <select id="gOBJ">${["<option value=''>— choose —</option>", ...S.objects.map((o) => `<option value="${o.id}" ${myGuess?.objId === o.id ? "selected" : ""}>${esc(o.name)}</option>`)].join("")}</select>
        <button class="mt" data-a="do-guess">${myGuess ? "Update our answer" : "Submit our answer"}</button>
        ${myGuess ? `<p class="muted mt center">Filed: ${esc(pzName(myGuess.pzPid))} + ${esc(S.objects.find((o)=>o.id===myGuess.objId)?.name||"?")}. Waiting for the reveal…</p>` : ""}
      </div>`}

    <details class="card"><summary style="cursor:pointer;font-weight:700">📇 Full contact log (evidence)</summary>
      <div class="tbl-wrap mt"><table><thead><tr><th>#</th><th>Type</th><th>A</th><th>B</th></tr></thead><tbody>
        ${[...S.contacts].sort((a,b)=>(tms(a.createdAt)-tms(b.createdAt))||(a.seq-b.seq)).map((c,i)=>{
          const A = S.players.find((p)=>p.id===c.a)?.codename||"?";
          const B = c.type==="object" ? (S.objects.find((o)=>o.id===c.b)?.name||"?") : (S.players.find((p)=>p.id===c.b)?.codename||"?");
          return `<tr><td>${i+1}</td><td>${c.type==="object"?"📍 station":"🤝 met"}</td><td>${esc(A)}</td><td>${esc(B)}</td></tr>`;
        }).join("")}
      </tbody></table></div>
    </details>
    <button class="ghost" data-a="leave">Leave</button>
  </div>`;
  const dsel = $("dossier");
  if (dsel) dsel.addEventListener("change", (e) => { S.dossierPick = e.target.value; render(); });
}

// ── Host ──
function renderHost() {
  app.className = "host";
  const phase = S.room?.phase || "lobby";
  if (phase === "lobby") return hostLobby();
  if (phase === "mingle") return hostMingle();
  if (phase === "reveal") return hostReveal();
  if (phase === "investigate" || phase === "solved") return hostInvestigate();
  hostLobby();
}

function joinInfo() {
  const url = location.href.split("#")[0];
  return `<div class="card center">
    <p class="sub" style="margin-bottom:6px">Students go to</p>
    <div style="font-size:15px;word-break:break-all">${esc(url)}</div>
    <p class="sub" style="margin:14px 0 4px">Room code</p>
    <div class="mycode" style="color:var(--teal);font-size:52px">${S.session.roomCode}</div>
  </div>`;
}

function hostLobby() {
  const ppl = persons();
  const pz = S.room?.patientZeroPid;
  app.innerHTML = `<div class="wrap host">${header("instructor")}
    ${joinInfo()}
    <div class="card">
      <h2>1 · Contaminated object <span class="badge src">powder this one</span></h2>
      <p class="sub">Pick the object you'll dust with UV powder and tape a code card to. Everyone should touch it naturally.</p>
      <div class="list">
        ${S.objects.map((o) => `<div class="person ${o.isSource ? "" : ""}">
          <span class="em">${o.isSource ? "☣️" : "📦"}</span>
          <div><div class="nm">${esc(o.name)}</div><div class="meta">card code: <b style="letter-spacing:2px">${o.code}</b></div></div>
          <div class="tail">${o.isSource ? `<span class="badge src">SOURCE</span>` : `<button class="small ghost" data-a="src" data-arg="${o.id}">make source</button>`}</div>
        </div>`).join("")}
      </div>
      <div class="row mt"><button class="ghost small" data-a="print-cards">🖨 Print station cards</button><button class="ghost small" data-a="cheatsheet">📄 Run-of-show</button></div>
    </div>

    <div class="card">
      <h2>2 · Patient Zero <span class="badge pz">powder their hands</span></h2>
      <p class="sub">Decide once you see who showed up — you can set or change this any time before you press Reveal. Ask your returning senior for their codename (it's on their phone) and tap them, or ⭐ the seniors and let 🎲 pick. Students never see this.</p>
      <div class="list">
        ${ppl.length === 0 ? `<p class="muted">Waiting for students to join…</p>` :
          ppl.map((p) => `<div class="person ${p.id === pz ? "pz" : ""}">
            <span class="em">${p.emoji}</span>
            <div><div class="nm">${esc(p.codename)}</div><div class="meta">code ${p.code}${p.senior ? " · ⭐ senior" : ""}</div></div>
            <div class="tail">
              <button class="small ghost" data-a="star" data-arg="${p.id}" title="mark returning senior">${p.senior ? "⭐" : "☆"}</button>
              ${p.id === pz ? `<span class="badge pz">PATIENT ZERO</span>` : `<button class="small ghost" data-a="pz" data-arg="${p.id}">set</button>`}
            </div>
          </div>`).join("")}
      </div>
      ${ppl.length ? `<div class="row mt"><button class="ghost small" data-a="rand-pz">🎲 Random ${ppl.some((p) => p.senior) ? "senior" : "student"}</button></div>` : ""}
      ${pz ? `<div style="margin-top:14px;border-top:1px solid var(--line);padding-top:12px">
        <label class="fld" style="margin-top:0">📌 Private note — who is <b style="color:var(--red)">${esc(S.players.find((p) => p.id === pz)?.codename || "")}</b>? (stays on this device only)</label>
        <input id="pznote" type="text" autocomplete="off" placeholder="e.g. Marcus, back row" value="${esc(getNote(pz))}" />
      </div>` : ""}
    </div>

    <div class="stats">
      <div class="stat"><div class="n">${ppl.length}</div><div class="l">joined</div></div>
      <div class="stat"><div class="n">${pz ? "✔" : "—"}</div><div class="l">patient zero</div></div>
      <div class="stat"><div class="n">${S.objects.some((o)=>o.isSource) ? "✔" : "—"}</div><div class="l">object</div></div>
    </div>

    <button class="mt" data-a="start" ${ppl.length < 2 || !pz || !S.objects.some((o)=>o.isSource) ? "disabled" : ""}>Start the mingle →</button>
    ${store.kind === "demo" ? `<button class="ghost mt" data-a="demo-sim">🎲 (demo) simulate students joining/mingling</button>` : ""}
    <button class="ghost mt" data-a="leave">End & reset</button>
  </div>`;
  const nt = $("pznote");
  if (nt) nt.addEventListener("input", (e) => setNote(pz, e.target.value));
}

function hostMingle() {
  const ppl = persons();
  const { met, total } = pairCoverage();
  const pct = total ? Math.round((met / total) * 100) : 0;
  // stragglers: fewest connections
  const conn = ppl.map((p) => ({ p, n: metPeople(p.id).size })).sort((a, b) => a.n - b.n);
  const need = conn.filter((x) => x.n < ppl.length - 1).slice(0, 8);
  app.innerHTML = `<div class="wrap host">${header("instructor")}
    <div class="card">
      <h2>Mingling in progress 🤝</h2>
      <p class="sub">Everyone meets everyone. Keep it going until coverage is where you want it, then reveal.</p>
      <div class="progress">
        <div class="bar"><span style="width:${pct}%"></span></div>
        <div class="cap"><span>${met} of ${total} possible pairs have met</span><span>${pct}%</span></div>
      </div>
    </div>
    <div class="stats">
      <div class="stat"><div class="n">${ppl.length}</div><div class="l">students</div></div>
      <div class="stat"><div class="n">${S.contacts.filter((c)=>c.type==="person").length}</div><div class="l">handshakes</div></div>
      <div class="stat"><div class="n">${S.contacts.filter((c)=>c.type==="object").length}</div><div class="l">check-ins</div></div>
      <div class="stat"><div class="n">${pct}%</div><div class="l">coverage</div></div>
    </div>
    <div class="card">
      <h2>Still need to mingle</h2>
      <p class="sub">Nudge these folks toward each other.</p>
      <div class="list">
        ${need.length ? need.map((x) => `<div class="person"><span class="em">${x.p.emoji}</span><div><div class="nm">${esc(x.p.codename)}</div><div class="meta">met ${x.n} of ${ppl.length-1}</div></div></div>`).join("") : `<p class="muted">Everyone's well connected 🎉</p>`}
      </div>
    </div>
    <button data-a="reveal">🦠 Reveal the outbreak (blacklight time)</button>
    ${store.kind === "demo" ? `<button class="ghost mt" data-a="demo-sim">🎲 (demo) simulate more mingling</button>` : ""}
    <button class="ghost mt" data-a="back-lobby">← back to setup</button>
  </div>`;
}

function hostReveal() {
  const spread = computeSpread();
  const inf = persons().filter((p) => spread[p.id].infected);
  const pct = persons().length ? Math.round((inf.length / persons().length) * 100) : 0;
  app.innerHTML = `<div class="wrap host">${header("instructor")}
    <div class="reveal-hero card status-infected">
      <div class="big pulse">🦠</div>
      <h2>${inf.length} of ${persons().length} contaminated</h2>
      <p class="sub">Blacklight on. Let the gasps happen. Then open the investigation.</p>
    </div>
    <div class="stats">
      <div class="stat"><div class="n">${pct}%</div><div class="l">of the room</div></div>
      <div class="stat"><div class="n">1</div><div class="l">patient zero</div></div>
      <div class="stat"><div class="n">1</div><div class="l">object</div></div>
    </div>
    <div class="card"><h2>Talking points while they gawk</h2><p class="sub">"One person and one object this morning → <b>${pct}%</b> of us. This is why hand hygiene isn't paranoia. Now — can you prove where it started, like a real disease detective?"</p>
    ${S.room?.patientZeroPid ? `<p class="muted mt" style="font-size:13px">📌 <b>Your index case:</b> ${esc(S.players.find((p) => p.id === S.room.patientZeroPid)?.codename || "")}${getNote(S.room.patientZeroPid) ? ` — ${esc(getNote(S.room.patientZeroPid))}` : ""}</p>` : ""}</div>
    <button data-a="investigate">🔬 Open the investigation</button>
    <button class="ghost mt" data-a="back-mingle">← back</button>
  </div>`;
}

function hostInvestigate() {
  const revealed = S.room?.answerRevealed;
  const answerPZ = S.room?.patientZeroPid;
  const answerObj = S.objects.find((o) => o.isSource);
  const pzName = (id) => S.players.find((p) => p.id === id)?.codename || "?";
  const correct = S.guesses.filter((g) => g.pzPid === answerPZ && g.objId === answerObj?.id).length;
  const pzClues = answerPZ ? factsAbout(answerPZ) : [];
  const shownClues = pzClues.slice(0, S.room?.cluesRevealed || 0);
  // epi curve buckets
  const spread = computeSpread();
  const onsets = persons().filter((p)=>spread[p.id].infected).map((p)=>spread[p.id].onset);
  const maxO = Math.max(1, ...onsets);
  const buckets = Array.from({length: 10}, (_, i) => onsets.filter((o) => Math.floor((o/(maxO+0.001))*10) === i).length);
  const bmax = Math.max(1, ...buckets);
  app.innerHTML = `<div class="wrap host">${header("instructor")}
    <div class="card">
      <h2>Investigation open 🔬</h2>
      <p class="sub">Students are tracing the line list on their phones. Here's the epi curve and their submissions.</p>
      <div class="epi">${buckets.map((b) => `<div class="b" style="height:${Math.round((b/bmax)*100)}%"></div>`).join("")}</div>
      <div class="cap muted" style="display:flex;justify-content:space-between;font-size:12px;margin-top:6px"><span>first onset</span><span>time →</span><span>last</span></div>
    </div>
    <div class="stats">
      <div class="stat"><div class="n">${S.guesses.length}</div><div class="l">answers filed</div></div>
      <div class="stat"><div class="n">${revealed ? correct : "—"}</div><div class="l">correct</div></div>
      <div class="stat"><div class="n">${(S.room?.cluesRevealed||0)}/${pzClues.length}</div><div class="l">clues dripped</div></div>
    </div>
    <div class="card" style="border-color:var(--violet)">
      <h2>🔍 Drip clues about Patient Zero</h2>
      <p class="sub">Reveal the facts classmates recorded about your index case, one at a time, on every phone — let the room shout out who it is before you confirm.</p>
      ${shownClues.length ? `<div class="list">${shownClues.map((f, i) => `<div class="person" style="border-color:var(--violet)"><span class="em">🧩</span><div><div class="meta">Clue ${i + 1} · ${TIER_NAMES[f.tier ?? 0]}</div><div class="nm">"${esc(f.text)}"</div></div></div>`).join("")}</div>` : `<p class="muted">${pzClues.length ? "No clues dripped yet." : "No facts were recorded about Patient Zero — students may not have logged them. Use the line list instead."}</p>`}
      <button class="mt" data-a="drip-clue" ${(S.room?.cluesRevealed||0) >= pzClues.length ? "disabled" : ""}>🔍 Drip the next clue</button>
    </div>
    <div class="card">
      <h2>Submissions</h2>
      <div class="list">
        ${S.guesses.length ? S.guesses.map((g) => `<div class="person"><span class="em">📝</span><div><div class="nm">${esc(g.codename)}</div><div class="meta">${esc(pzName(g.pzPid))} + ${esc(S.objects.find((o)=>o.id===g.objId)?.name||"?")}</div></div>${revealed ? `<div class="tail"><span class="badge ${g.pzPid===answerPZ&&g.objId===answerObj?.id?"ok":"src"}">${g.pzPid===answerPZ&&g.objId===answerObj?.id?"correct":"off"}</span></div>`:""}</div>`).join("") : `<p class="muted">No submissions yet…</p>`}
      </div>
    </div>
    ${revealed
      ? `<div class="card" style="border-color:var(--amber)"><h2>Answer revealed ✔</h2><p class="sub">On every student's screen now: <b>${esc(pzName(answerPZ))}</b> (Patient Zero) + <b>${esc(answerObj?.name||"?")}</b>.${getNote(answerPZ) ? ` <span class="muted">📌 ${esc(getNote(answerPZ))}</span>` : ""}</p></div>`
      : `<button data-a="reveal-answer">🎯 Reveal the answer to everyone</button>`}
    <button class="ghost mt" data-a="leave">End & reset</button>
  </div>`;
}

// ── Print station cards ──
function printCards() {
  const w = window.open("", "_blank");
  if (!w) return toast("Allow pop-ups to print.", true);
  const cards = S.objects.map((o) => `
    <div class="pc">
      <div class="pc-h">STATION CHECK-IN</div>
      <div class="pc-n">${esc(o.name)}</div>
      <div class="pc-c">${o.code}</div>
      <div class="pc-f">Type this code in the app when you use this item.</div>
    </div>`).join("");
  w.document.write(`<html><head><title>Station cards — ${S.session.roomCode}</title><style>
    body{font-family:Segoe UI,system-ui,sans-serif;margin:0;padding:20px;display:flex;flex-wrap:wrap;gap:16px}
    .pc{border:3px dashed #111;border-radius:16px;width:320px;padding:22px;text-align:center;page-break-inside:avoid}
    .pc-h{letter-spacing:3px;font-size:12px;color:#666}
    .pc-n{font-size:24px;font-weight:800;margin:8px 0}
    .pc-c{font-size:60px;font-weight:900;letter-spacing:10px;font-family:monospace}
    .pc-f{font-size:12px;color:#666;margin-top:10px}
  </style></head><body>${cards}<script>window.onload=()=>window.print()<\/script></body></html>`);
  w.document.close();
}

// ════════════════════════════════════════════════════════════
//  EVENT DELEGATION
// ════════════════════════════════════════════════════════════
function doLog() {
  const v = $("logc")?.value || "", f = $("logf")?.value || "";
  if (v.length < 3) return toast("Codes are 4 characters.", true);
  logCode(v, f).then((ok) => { if (ok) { const i = $("logc"), j = $("logf"); if (i) i.value = ""; if (j) j.value = ""; } });
}

app.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-a]"); if (!btn) return;
  const a = btn.dataset.a, arg = btn.dataset.arg;
  switch (a) {
    case "go-join": S.session = { role: "join" }; saveSession(); return render();
    case "home": S.session = {}; saveSession(); return render();
    case "go-host": return hostCreate();
    case "do-join": return joinRoom($("rc").value);
    case "do-log": return doLog();
    case "reroll": return rerollCodename();
    case "leave": return leave();
    case "pz": return hostSetPZ(arg);
    case "star": return hostToggleSenior(arg);
    case "rand-pz": return hostRandomPZ();
    case "src": return hostSetSource(arg);
    case "start": return hostSetPhase("mingle");
    case "reveal": return hostSetPhase("reveal");
    case "investigate": return hostSetPhase("investigate");
    case "back-lobby": return hostSetPhase("lobby");
    case "back-mingle": return hostSetPhase("mingle");
    case "reveal-answer": return hostRevealAnswer();
    case "drip-clue": return hostDripClue();
    case "do-guess": return submitGuess($("gPZ").value, $("gOBJ").value);
    case "print-cards": return printCards();
    case "cheatsheet": return window.open("./cheatsheet.html", "_blank");
    case "demo-sim": return demoSimulate();
  }
});

// ════════════════════════════════════════════════════════════
//  BOOT
// ════════════════════════════════════════════════════════════
(async function boot() {
  store = isConfigured ? await makeFirestoreStore() : makeDemoStore();

  // Demo quick-starts (only in demo mode) for dry runs:
  //   #host   → host room pre-seeded with pretend classmates
  //   #demo   → fully-simulated investigation, instructor view
  //   #student→ preview a student's mingle screen
  //   #solve  → preview a student's investigation screen (with clues)
  const hash = location.hash.replace("#", "");
  const DEMOS = ["host", "demo", "student", "solve"];
  if (store.kind === "demo" && DEMOS.includes(hash)) {
    S.session = {}; localStorage.removeItem(SS);
    await hostCreate();
    await hostSetPZ(persons()[0].id);
    if (hash === "host") return;
    if (hash === "student") { await hostSetPhase("mingle"); S.session = { role: "player", roomCode: S.room.id, pid: persons()[1].id }; return render(); }
    demoSimulate();
    await hostSetPhase("reveal");
    await hostSetPhase("investigate");
    if (hash === "solve") { await store.updateRoom(S.room.id, { cluesRevealed: 2 }); S.session = { role: "player", roomCode: S.room.id, pid: persons()[1].id }; return render(); }
    return;
  }

  if (store.kind === "demo") { S.session = {}; } // demo data is in-memory; start fresh
  if (S.session?.roomCode && (S.session.role === "host" || S.session.role === "player") && store.kind === "firestore") {
    await connectRoom(S.session.roomCode);
  } else {
    render();
  }
})();
