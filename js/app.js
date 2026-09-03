// ══════════════════════════════════════════════════════════════
//  First Day BreakOut — ice-breaker + contact-tracing mystery
//  Single-file app logic. Two backends: Firestore (real, multi-phone)
//  or an in-memory Demo store (single device, seeded classmates).
// ══════════════════════════════════════════════════════════════
import { firebaseConfig, isConfigured } from "./firebase-config.js";

// ── Content ─────────────────────────────────────────────────
const ADJS = ["Wandering","Curious","Brave","Sleepy","Clever","Jolly","Swift","Mellow","Bold","Cosmic","Fuzzy","Nimble","Sunny","Witty","Gentle","Daring","Lucky","Quiet","Zesty","Plucky","Radiant","Breezy"];
const ANIMALS = ["Otter","Falcon","Panda","Lynx","Heron","Fox","Koala","Wren","Bison","Gecko","Moose","Puffin","Tapir","Raven","Ibex","Newt","Quokka","Marten","Egret","Yak","Civet","Dingo"];
const EMOJIS = ["🦊","🐨","🦉","🦥","🐧","🦦","🐢","🦫","🦔","🐝","🦩","🐙","🦭","🐳","🦚","🦜","🐿️","🦎","🐡","🦌","🐼","🦇"];
// Health-tech conversation prompts. Each meeting shows one question to ASK the person
// you're talking to (no "go find someone" scavenger chaos). Ordered general → personal;
// the `tier` also grades the recorded answer for the clue ladder.
const QUESTIONS = [
  { tier: 0, q: "What's your dream healthcare job?", ph: "e.g. ER nurse" },
  { tier: 0, q: "What made you choose this program?", ph: "e.g. wants to help people" },
  { tier: 1, q: "Do you have any family in healthcare?", ph: "e.g. mom's a paramedic" },
  { tier: 1, q: "Which part of the body fascinates you most?", ph: "e.g. the heart" },
  { tier: 1, q: "Favorite medical show — or one you can't stand?", ph: "e.g. loves Grey's Anatomy" },
  { tier: 2, q: "What healthcare skill do you most want to master?", ph: "e.g. drawing blood" },
  { tier: 2, q: "Any job you've had before this program?", ph: "e.g. was a barista" },
  { tier: 2, q: "Ever been a patient for something memorable?", ph: "e.g. broke an arm at 8" },
  { tier: 3, q: "Who's your healthcare hero or role model?", ph: "e.g. their aunt, an RN" },
  { tier: 3, q: "Where do you hope to be working in 5 years?", ph: "e.g. a children's hospital" },
];
const TIER_NAMES = ["general", "interest", "background", "personal"];
const DEMO_TRAITS = [
  { t: 0, x: "wants to be an ER nurse" }, { t: 0, x: "chose this to help people" }, { t: 0, x: "dreams of being a surgeon" }, { t: 0, x: "wants to work in peds" },
  { t: 1, x: "mom is a paramedic" }, { t: 1, x: "fascinated by the heart" }, { t: 1, x: "loves Grey's Anatomy" }, { t: 1, x: "whole family are nurses" },
  { t: 2, x: "wants to master drawing blood" }, { t: 2, x: "was a barista before" }, { t: 2, x: "volunteered at a hospital" }, { t: 2, x: "used to be a lifeguard" },
  { t: 3, x: "their hero is their aunt, an RN" }, { t: 3, x: "hopes to work in a children's hospital" }, { t: 3, x: "broke their arm at 8" }, { t: 3, x: "grew up around a family clinic" },
];
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no I,L,O,0,1
const DEFAULT_OBJECTS = ["Front-Desk Tablet", "Hand-Sanitizer Pump", "Candy Bowl", "Coffee Station"];

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
// mingle countdown: endsAt is a plain ms number stored on the room
function fmtRemain(endsAt) {
  const s = Math.max(0, Math.round((endsAt - Date.now()) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
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
const takenCodes = () => new Set(S.players.map((p) => p.code));
const persons = () => S.players.filter((p) => !p.isHost);

// find a student by the 4-letter code they read off their phone
function lookupPerson(raw) {
  const c = raw.trim().toUpperCase();
  return S.players.find((x) => x.code === c && !x.isHost) || null;
}

// distinct people a given pid has met
function metPeople(pid) {
  const set = new Set();
  for (const c of S.contacts) {
    if (c.a === pid) set.add(c.b);
    else if (c.b === pid) set.add(c.a);
  }
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
// Deterministic, time-ordered person-to-person spread from Patient Zero.
// (The contaminated object spreads physically via UV powder only — it is
//  intentionally NOT modeled here; students identify it by observation.)
function computeSpread() {
  const pz = S.room?.patientZeroPid;
  const state = {};
  persons().forEach((p) => (state[p.id] = { infected: false, onset: null, via: null }));
  if (pz && state[pz]) state[pz] = { infected: true, onset: 0, via: "seed" };

  const sorted = [...S.contacts].sort((a, b) => (tms(a.createdAt) - tms(b.createdAt)) || (a.seq - b.seq));
  let step = 1;
  for (const c of sorted) {
    const A = state[c.a], B = state[c.b];
    if (!A || !B) continue;
    if (A.infected && !B.infected) state[c.b] = { infected: true, onset: step++, via: c.a };
    else if (B.infected && !A.infected) state[c.a] = { infected: true, onset: step++, via: c.b };
  }
  return state;
}

// ── "How it spread" transmission tree — built from computeSpread's via/onset ──
let playSpread = false; // one-shot flag set by the ▶ Replay button

function spreadLayout() {
  const spread = computeSpread();
  const pmap = {}; persons().forEach((p) => (pmap[p.id] = p));
  const infected = persons().filter((p) => spread[p.id].infected);
  const uninfected = persons().filter((p) => !spread[p.id].infected);
  const rootId = Object.keys(spread).find((id) => spread[id].via === "seed" && spread[id].infected);
  if (!rootId) return { hasTree: false, uninfected, width: 320, height: 80 };

  // children map, ordered by onset
  const children = {};
  infected.forEach((p) => { const v = spread[p.id].via; if (v && v !== "seed") (children[v] = children[v] || []).push(p.id); });
  Object.values(children).forEach((arr) => arr.sort((a, b) => spread[a].onset - spread[b].onset));

  // depth from root + traversal order
  const depth = { [rootId]: 0 }, order = [];
  (function walk(id) { order.push(id); (children[id] || []).forEach((k) => { depth[k] = depth[id] + 1; walk(k); }); })(rootId);
  const maxDepth = Math.max(0, ...Object.values(depth));

  // tidy y-rows (leaves get sequential rows; parents centre over their children)
  const row = {}; let rc = 0;
  (function assignRow(id) {
    const kids = children[id] || [];
    if (!kids.length) { row[id] = rc++; return row[id]; }
    const kr = kids.map(assignRow);
    row[id] = (kr[0] + kr[kr.length - 1]) / 2; return row[id];
  })(rootId);
  const maxRow = Math.max(0, ...Object.values(row));

  const LEFT = 96, TOP = 64, RIGHT = 150, ROWGAP = 84, BOTTOM = 44;
  const COLW = Math.max(96, Math.min(180, Math.round(820 / (maxDepth || 1))));
  const width = LEFT + maxDepth * COLW + RIGHT;
  const treeH = TOP + maxRow * ROWGAP + BOTTOM;

  const nodes = order.map((id) => {
    const p = pmap[id];
    return { id, codename: p.codename, emoji: p.emoji, onset: spread[id].onset, isPZ: id === rootId,
      x: LEFT + depth[id] * COLW, y: TOP + row[id] * ROWGAP, r: id === rootId ? 26 : 20 };
  });
  const npos = {}; nodes.forEach((n) => (npos[n.id] = n));
  const links = [];
  infected.forEach((p) => {
    const v = spread[p.id].via;
    if (v && v !== "seed" && npos[v]) { const a = npos[v], b = npos[p.id];
      links.push({ x1: a.x + a.r, y1: a.y, x2: b.x - b.r, y2: b.y, onset: spread[p.id].onset }); }
  });

  // uninfected footer strip
  let height = treeH, unPos = [];
  if (uninfected.length) {
    const uy = treeH + 20;
    uninfected.forEach((p, i) => unPos.push({ emoji: p.emoji, x: LEFT + (i % 14) * 46, y: uy + Math.floor(i / 14) * 44 }));
    height = uy + 44 + Math.floor((uninfected.length - 1) / 14) * 44;
  }
  return { hasTree: true, nodes, links, width, height, uninfected: unPos, count: infected.length };
}

function spreadSVG({ animate = false } = {}) {
  const L = spreadLayout();
  if (!L.hasTree) return `<p class="muted">The spread map appears once the outbreak is revealed.</p>`;
  const del = (o) => (animate ? `animation-delay:${(o * 0.12).toFixed(2)}s` : "");
  const trunc = (s) => (s.length > 14 ? s.slice(0, 13) + "…" : s);
  const link = (l) => { const dx = Math.max(24, (l.x2 - l.x1) / 2);
    return `<path class="lnk" style="${del(l.onset)}" d="M${l.x1} ${l.y1} C${l.x1 + dx} ${l.y1} ${l.x2 - dx} ${l.y2} ${l.x2} ${l.y2}" marker-end="url(#sp-arrow)"/>`; };
  const node = (n) => `<g class="node${n.isPZ ? " pz" : ""}" style="${del(n.onset)}">
      ${n.isPZ ? `<circle class="halo" cx="${n.x}" cy="${n.y}" r="${n.r + 9}"/>` : ""}
      <circle class="dot" cx="${n.x}" cy="${n.y}" r="${n.r}"/>
      <text class="em" x="${n.x}" y="${n.y}" dy="0.34em" text-anchor="middle">${n.emoji}</text>
      <text class="nm" x="${n.x}" y="${n.y + n.r + 16}" text-anchor="middle">${esc(trunc(n.codename))}</text>
      ${n.isPZ ? `<text class="pzlbl" x="${n.x}" y="${n.y - n.r - 12}" text-anchor="middle">PATIENT ZERO</text>` : ""}
    </g>`;
  const un = L.uninfected.length ? `<g class="un">
      <text class="unlbl" x="30" y="${L.uninfected[0].y - 20}">Never caught it (${L.uninfected.length})</text>
      ${L.uninfected.map((u) => `<circle class="dot out" cx="${u.x}" cy="${u.y}" r="13"/><text class="em sm" x="${u.x}" y="${u.y}" dy="0.34em" text-anchor="middle">${u.emoji}</text>`).join("")}
    </g>` : "";
  return `<svg class="spread${animate ? " animate" : ""}" viewBox="0 0 ${L.width} ${L.height}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Transmission tree: how the germ spread from Patient Zero">
    <defs><marker id="sp-arrow" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z"/></marker></defs>
    <g class="links">${L.links.map(link).join("")}</g>
    <g class="nodes">${L.nodes.map(node).join("")}</g>
    ${un}
  </svg>`;
}

function spreadStats() {
  const spread = computeSpread();
  const inf = persons().filter((p) => spread[p.id].infected);
  const uninf = persons().filter((p) => !spread[p.id].infected);
  const total = persons().length;
  const pct = total ? Math.round((inf.length / total) * 100) : 0;
  const nm = (id) => S.players.find((x) => x.id === id)?.codename || "?";
  const em = (id) => S.players.find((x) => x.id === id)?.emoji || "";
  // direct-infection counts → super-spreader
  const kids = {};
  inf.forEach((p) => { const v = spread[p.id].via; if (v && v !== "seed") kids[v] = (kids[v] || 0) + 1; });
  let superId = null, superN = 0;
  Object.entries(kids).forEach(([id, n]) => { if (n > superN || (n === superN && superId && spread[id].onset < spread[superId].onset)) { superN = n; superId = id; } });
  // longest chain (hops from Patient Zero)
  const dm = {};
  const depthOf = (id) => { if (dm[id] != null) return dm[id]; const v = spread[id].via; return dm[id] = (!v || v === "seed") ? 0 : depthOf(v) + 1; };
  let longest = 0; inf.forEach((p) => (longest = Math.max(longest, depthOf(p.id))));
  // most social (most people met)
  let socialId = null, socialN = -1;
  persons().forEach((p) => { const n = metPeople(p.id).size; if (n > socialN) { socialN = n; socialId = p.id; } });
  const infectors = Object.keys(kids).length;
  const avgOnward = infectors ? ((inf.length - 1) / infectors).toFixed(1) : "0";
  return { hasData: inf.length > 0, infN: inf.length, pct, longest, avgOnward, uninfN: uninf.length,
    superName: superId ? nm(superId) : null, superEmoji: superId ? em(superId) : "", superN,
    socialName: socialId ? nm(socialId) : null, socialEmoji: socialId ? em(socialId) : "", socialN };
}

function spreadCard() {
  const s = spreadStats();
  return `<div class="card">
    <h2>🌳 How it spread</h2>
    <p class="sub">Every arrow is one classmate passing the germ to another, in the order it happened — follow the chains back to the single glowing red node: <b>Patient Zero</b>.</p>
    ${s.hasData ? `<div class="stats">
      <div class="stat"><div class="n">${s.infN}</div><div class="l">caught it</div></div>
      <div class="stat"><div class="n">${s.pct}%</div><div class="l">of the room</div></div>
      <div class="stat"><div class="n">${s.longest}</div><div class="l">longest chain</div></div>
      <div class="stat"><div class="n">${s.avgOnward}</div><div class="l">avg spread / spreader</div></div>
    </div>
    <div class="awards">
      ${s.superName ? `<div class="award super"><span class="ic">🦠</span><div><div class="t">Super-spreader</div><div class="v">${s.superEmoji} ${esc(s.superName)} — infected ${s.superN} classmate${s.superN > 1 ? "s" : ""} directly</div></div></div>` : ""}
      ${s.socialName ? `<div class="award"><span class="ic">🤝</span><div><div class="t">Most social</div><div class="v">${s.socialEmoji} ${esc(s.socialName)} — met ${s.socialN} ${s.socialN === 1 ? "person" : "people"}</div></div></div>` : ""}
      ${s.uninfN ? `<div class="award"><span class="ic">🧼</span><div><div class="t">Dodged it</div><div class="v">${s.uninfN} ${s.uninfN === 1 ? "classmate" : "classmates"} never caught it</div></div></div>` : `<div class="award"><span class="ic">😷</span><div><div class="t">Total wipeout</div><div class="v">One person contaminated the entire room</div></div></div>`}
    </div>` : ""}
    <div class="spread-wrap">${spreadSVG({ animate: playSpread })}</div>
    <div class="legend"><span class="badge pz">🔴 Patient Zero</span><span class="badge src">→ passed it on</span><span class="chip">🩶 never caught it</span></div>
    <button class="ghost small mt" data-a="replay-spread">▶ Replay the outbreak</button>
  </div>`;
}

// ════════════════════════════════════════════════════════════
//  ACTIONS
// ════════════════════════════════════════════════════════════
async function connectRoom(rc) {
  S.unsub.forEach((u) => u()); S.unsub = [];
  S.unsub.push(store.listen(rc, () => scheduleRender()));
}

async function hostCreate() {
  const rc = roomCode();
  await store.createRoom(rc, {
    phase: "lobby", patientZeroPid: null, answerRevealed: false, cluesRevealed: 0, createdAt: store.serverTime(),
  });
  // seed candidate objects (no codes — the object is physical-only, found by observation)
  for (let i = 0; i < DEFAULT_OBJECTS.length; i++) {
    await store.setObject(rc, "obj" + i, { name: DEFAULT_OBJECTS[i], isSource: i === 1 });
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
async function startMingleTimer(mins) { await store.updateRoom(S.session.roomCode, { mingleEndsAt: Date.now() + mins * 60000 }); }
async function addMingleTime(secs) {
  const base = S.room?.mingleEndsAt && S.room.mingleEndsAt > Date.now() ? S.room.mingleEndsAt : Date.now();
  await store.updateRoom(S.session.roomCode, { mingleEndsAt: base + secs * 1000 });
}
async function clearMingleTimer() { await store.updateRoom(S.session.roomCode, { mingleEndsAt: null }); }

async function logCode(raw, fact = "") {
  const my = me(); if (!my) return;
  const other = lookupPerson(raw);
  if (!other) return toast("No match for that code. Ask again!", true);
  if (other.id === my.id) return toast("That's your own code 🙂", true);
  if (!fact || fact.trim().length < 3) return toast("Type a new fact you learned about them 🙂", true);
  const cid = "PP_" + [my.id, other.id].sort().join("_");
  const already = S.contacts.some((c) => c.id === cid);
  if (!already) await store.addContact(S.session.roomCode, cid, { type: "person", a: my.id, b: other.id, createdAt: store.serverTime(), seq: Date.now() });
  // record the fact I learned about them (one per direction; updates if re-logged)
  await store.addFact(S.session.roomCode, "F_" + my.id + "_" + other.id, { by: my.id, about: other.id, text: fact.trim().slice(0, 120), tier: currentTraitTier, createdAt: store.serverTime() });
  toast(already ? `New fact logged about ${other.codename}! 🧠` : `Met ${other.codename}! 🤝`);
  return true;
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
    if (!S.objects.some((o) => o.isSource)) return toast("Mark which object you contaminated first.", true);
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
  const n = 12, taken = new Set();
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
  toast("Simulated a few minutes of mingling.");
  render();
}

// ════════════════════════════════════════════════════════════
//  RENDER
// ════════════════════════════════════════════════════════════
function header(role) {
  return `<div class="brand"><span class="logo">🦠</span><h1>First Day BreakOut</h1><span class="role">${role}</span></div>`;
}

// ── Re-render safety ────────────────────────────────────────
// A repaint replaces app.innerHTML, so it also replaces whatever input a
// student is half-way through typing into. Snapshots fire constantly during
// the mingle (every join / contact / fact from every phone in the room), so
// without these guards the code box clears itself out from under them.
//   1. scheduleRender (used by the store listeners) never repaints while a
//      text field has focus — it queues the repaint until they're done.
//   2. every repaint carries input values + caret position across.
let rafQueued = false, deferredRender = false;

function typingNow() {
  const el = document.activeElement;
  return !!el && app.contains(el) && (el.tagName === "INPUT" || el.tagName === "TEXTAREA");
}
// Data arrived from another phone. Repaint soon — but not mid-keystroke,
// unless the instructor moved the whole room to a new phase (that must land now).
let lastPhase = null;
function scheduleRender() {
  const phase = S.room?.phase || null;
  if (typingNow() && phase === lastPhase) { deferredRender = true; return; }
  if (rafQueued) return;
  rafQueued = true;
  requestAnimationFrame(() => { rafQueued = false; render(); });
}
// Once they leave the field, paint in whatever arrived while they were typing.
app.addEventListener("focusout", () => setTimeout(() => {
  if (deferredRender && !typingNow()) render();
}, 0));

function captureFields() {
  const snap = { values: {}, focus: null, start: null, end: null };
  app.querySelectorAll("input[id], textarea[id]").forEach((el) => (snap.values[el.id] = el.value));
  const a = document.activeElement;
  if (a && a.id && app.contains(a)) {
    snap.focus = a.id;
    try { snap.start = a.selectionStart; snap.end = a.selectionEnd; } catch { /* no caret on this type */ }
  }
  return snap;
}
function restoreFields(snap) {
  for (const [id, v] of Object.entries(snap.values)) {
    if (!v) continue;
    const el = $(id);
    if (!el) continue;
    // keep what they typed: an untouched new field, or the one they were editing
    if (!el.value || id === snap.focus) el.value = v;
  }
  if (!snap.focus) return;
  const el = $(snap.focus);
  if (!el) return;
  el.focus();
  if (snap.start != null) { try { el.setSelectionRange(snap.start, snap.end); } catch {} }
}

function render() {
  const snap = captureFields();
  deferredRender = false;
  paint();
  restoreFields(snap);
}

function paint() {
  lastPhase = S.room?.phase || null;
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
      <h2>First Day BreakOut</h2>
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
  const q = QUESTIONS[metCount % QUESTIONS.length];
  currentTraitTier = q.tier;
  const metNames = [...met].map((id) => S.players.find((p) => p.id === id)?.codename).filter(Boolean);
  const done = metCount >= total && total > 0;
  app.innerHTML = `<div class="wrap">${header("student")}
    <div class="idcard" style="padding:14px">
      <div style="display:flex;align-items:center;gap:12px;text-align:left">
        <div style="font-size:40px">${my.emoji}</div>
        <div><div class="codename" style="font-size:18px">${esc(my.codename)}</div>
        <div class="muted" style="font-size:13px">Your code: <b style="color:var(--teal);letter-spacing:3px">${my.code}</b></div></div>
      </div>
    </div>
    ${S.room?.mingleEndsAt ? `<div class="center" style="margin:8px 0 -2px">⏳ <span class="chip" id="mtimer">${fmtRemain(S.room.mingleEndsAt)}</span> <span class="muted" style="font-size:12px">left to mingle</span></div>` : ""}

    ${done ? `<div class="card center" style="border-color:var(--lime)"><div style="font-size:40px">🌟</div><h2>You met everyone!</h2><p class="sub">Legend. Help anyone still looking for people to meet.</p></div>`
      : `<div class="mission"><div class="tag">Ask your new classmate</div><div class="txt">${esc(q.q)}</div></div>`}

    <div class="card">
      <h2>Log who you met</h2>
      <p class="sub">Chat, ask the question above, then swap codes and jot their answer. <b>Already know them? Ask it anyway — learn something new.</b></p>
      <label class="fld">Their 4-letter code</label>
      <input id="logc" class="code-in" maxlength="4" autocapitalize="characters" autocomplete="off" placeholder="CODE" />
      <label class="fld">Their answer</label>
      <input id="logf" type="text" autocomplete="off" placeholder="${esc(q.ph)}" />
      <button class="mt" data-a="do-log">Add contact ✓</button>
      <div class="progress mt">
        <div class="bar"><span style="width:${pct}%"></span></div>
        <div class="cap"><span>Met ${metCount} of ${total} classmates</span><span>${pct}%</span></div>
      </div>
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
      <p class="sub">Two things to name: the <b>student</b> and the <b>object</b>. Find <b>Patient Zero</b> from the data — epidemiologists use <b>symptom-onset order</b>, so whoever showed symptoms <i>first</i> is the likely source (use the line list + dossier). Find the <b>contaminated object</b> the old-fashioned way: <b>look around</b> — what did the glowing hands all touch this morning?</p>
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
      </div>${spreadCard()}`
    : `<div class="card">
        <h2>File your conclusion</h2>
        <label class="fld">Who was Patient Zero?</label>
        <select id="gPZ">${["<option value=''>— choose —</option>", ...line.map((p) => `<option value="${p.id}" ${myGuess?.pzPid === p.id ? "selected" : ""}>${esc(p.codename)}</option>`)].join("")}</select>
        <label class="fld">Which object was contaminated? (from what you observed)</label>
        <select id="gOBJ">${["<option value=''>— choose —</option>", ...S.objects.map((o) => `<option value="${o.id}" ${myGuess?.objId === o.id ? "selected" : ""}>${esc(o.name)}</option>`)].join("")}</select>
        <button class="mt" data-a="do-guess">${myGuess ? "Update our answer" : "Submit our answer"}</button>
        ${myGuess ? `<p class="muted mt center">Filed: ${esc(pzName(myGuess.pzPid))} + ${esc(S.objects.find((o)=>o.id===myGuess.objId)?.name||"?")}. Waiting for the reveal…</p>` : ""}
      </div>`}

    <details class="card"><summary style="cursor:pointer;font-weight:700">📇 Full contact log (evidence)</summary>
      <div class="tbl-wrap mt"><table><thead><tr><th>#</th><th>Who</th><th>met</th></tr></thead><tbody>
        ${[...S.contacts].sort((a,b)=>(tms(a.createdAt)-tms(b.createdAt))||(a.seq-b.seq)).map((c,i)=>{
          const A = S.players.find((p)=>p.id===c.a)?.codename||"?";
          const B = S.players.find((p)=>p.id===c.b)?.codename||"?";
          return `<tr><td>${i+1}</td><td>${esc(A)}</td><td>🤝 ${esc(B)}</td></tr>`;
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
      <p class="sub">Mark the object you'll dust with UV powder so everyone touches it naturally. It has <b>no code and isn't tracked</b> — it just spreads the germ physically. Students figure out which object it was by <b>observation</b>, and you confirm it at the reveal.</p>
      <div class="list">
        ${S.objects.map((o) => `<div class="person">
          <span class="em">${o.isSource ? "☣️" : "📦"}</span>
          <div><div class="nm">${esc(o.name)}</div>${o.isSource ? `<div class="meta">this is the one you dusted</div>` : ""}</div>
          <div class="tail">${o.isSource ? `<span class="badge src">SOURCE</span>` : `<button class="small ghost" data-a="src" data-arg="${o.id}">make source</button>`}</div>
        </div>`).join("")}
      </div>
      <div class="row mt"><button class="ghost small" data-a="join-qr">📲 Join QR</button><button class="ghost small" data-a="cheatsheet">📄 Run-of-show</button></div>
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
    <div class="card center">
      <h2 style="margin-bottom:6px">⏱️ Mingle timer</h2>
      ${S.room?.mingleEndsAt
        ? `<div class="timer" id="mtimer">${fmtRemain(S.room.mingleEndsAt)}</div>
           <div class="row mt"><button class="ghost small" data-a="timer-add">+1:00</button><button class="ghost small" data-a="timer-reset">Reset</button></div>
           <p class="muted" style="font-size:12px;margin-top:8px">Shows on every student's phone too.</p>`
        : `<p class="sub">Put a countdown on every phone to keep the energy up.</p>
           <div class="row"><button class="ghost small" data-a="timer-10">Start 10:00</button><button class="small" data-a="timer-15">Start 15:00</button><button class="ghost small" data-a="timer-20">Start 20:00</button></div>`}
    </div>
    <div class="stats">
      <div class="stat"><div class="n">${ppl.length}</div><div class="l">students</div></div>
      <div class="stat"><div class="n">${S.contacts.length}</div><div class="l">handshakes</div></div>
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
      ? `<div class="card" style="border-color:var(--amber)"><h2>Answer revealed ✔</h2><p class="sub">On every student's screen now: <b>${esc(pzName(answerPZ))}</b> (Patient Zero) + <b>${esc(answerObj?.name||"?")}</b>.${getNote(answerPZ) ? ` <span class="muted">📌 ${esc(getNote(answerPZ))}</span>` : ""}</p></div>${spreadCard()}`
      : `<button data-a="reveal-answer">🎯 Reveal the answer to everyone</button>`}
    <button class="ghost mt" data-a="leave">End & reset</button>
  </div>`;
}

// ════════════════════════════════════════════════════════════
//  EVENT DELEGATION
// ════════════════════════════════════════════════════════════
function doLog() {
  const v = $("logc")?.value || "", f = $("logf")?.value || "";
  if (v.length < 3) return toast("Codes are 4 characters.", true);
  logCode(v, f).then((ok) => {
    if (!ok) return;
    const i = $("logc"), j = $("logf");
    if (i) i.value = ""; if (j) j.value = "";
    render(); // fields are empty now, so a repaint is safe — show the new count right away
    $("logc")?.focus();
  });
}

app.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-a]"); if (!btn) return;
  const a = btn.dataset.a, arg = btn.dataset.arg;
  // Tapping any control other than "add contact" means they're done typing —
  // release the repaint lock so queued screen changes (joining, phase flips) land.
  if (a !== "do-log" && typingNow()) document.activeElement.blur();
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
    case "replay-spread": playSpread = true; render(); setTimeout(() => { playSpread = false; }, 80); return;
    case "timer-10": return startMingleTimer(10);
    case "timer-15": return startMingleTimer(15);
    case "timer-20": return startMingleTimer(20);
    case "timer-add": return addMingleTime(60);
    case "timer-reset": return clearMingleTimer();
    case "do-guess": return submitGuess($("gPZ").value, $("gOBJ").value);
    case "cheatsheet": return window.open("./cheatsheet.html", "_blank");
    case "join-qr": return window.open("./join-qr.html", "_blank");
    case "demo-sim": return demoSimulate();
  }
});

// Tick the mingle countdown once a second (updates #mtimer in place — no full re-render).
setInterval(() => {
  const el = document.getElementById("mtimer");
  const end = S.room?.mingleEndsAt;
  if (!el || !end) return;
  el.textContent = fmtRemain(end);
  el.classList.toggle("done", Date.now() >= end);
}, 1000);

// ════════════════════════════════════════════════════════════
//  BOOT
// ════════════════════════════════════════════════════════════
(async function boot() {
  // ?demo in the URL forces the offline single-device Demo store even when
  // Firebase is configured — handy for dry-run previews without touching Firestore.
  const forceDemo = new URLSearchParams(location.search).has("demo");
  store = (isConfigured && !forceDemo) ? await makeFirestoreStore() : makeDemoStore();

  // Demo quick-starts (only in demo mode) for dry runs — add ?demo to the URL on the
  // live site to enable, e.g. …/?demo#host :
  //   #host   → host room pre-seeded with pretend classmates
  //   #demo   → fully-simulated investigation, instructor view
  //   #student→ preview a student's mingle screen
  //   #solve  → preview a student's investigation screen (with clues)
  //   #reveal → instructor investigation after the answer is revealed (spread tree)
  //   #solved → student investigation after the answer is revealed (spread tree)
  const hash = location.hash.replace("#", "");
  const DEMOS = ["host", "demo", "student", "solve", "reveal", "solved"];
  if (store.kind === "demo" && DEMOS.includes(hash)) {
    S.session = {}; localStorage.removeItem(SS);
    await hostCreate();
    await hostSetPZ(persons()[0].id);
    if (hash === "host") return;
    if (hash === "student") { await hostSetPhase("mingle"); await store.updateRoom(S.room.id, { mingleEndsAt: Date.now() + 14 * 60000 + 37000 }); S.session = { role: "player", roomCode: S.room.id, pid: persons()[1].id }; return render(); }
    demoSimulate();
    await hostSetPhase("reveal");
    await hostSetPhase("investigate");
    if (hash === "reveal" || hash === "solved") await store.updateRoom(S.room.id, { answerRevealed: true, cluesRevealed: 99 });
    if (hash === "solve" || hash === "solved") { if (hash === "solve") await store.updateRoom(S.room.id, { cluesRevealed: 2 }); S.session = { role: "player", roomCode: S.room.id, pid: persons()[1].id }; return render(); }
    return;
  }

  if (store.kind === "demo") { S.session = {}; } // demo data is in-memory; start fresh
  if (S.session?.roomCode && (S.session.role === "host" || S.session.role === "player") && store.kind === "firestore") {
    await connectRoom(S.session.roomCode);
  } else {
    render();
  }
})();
