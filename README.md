# 🦠 First Day BreakOut

A first-day-of-school **ice breaker that turns into a contact-tracing mystery** for health-tech students.

Students *think* they're playing a get-to-know-you mingle game. Secretly, the app is logging who met whom (and in what order), while **real UV/Glo Germ powder** on one returning senior ("Patient Zero") and one high-traffic object spreads physically through the room. When everyone's mingled, you **kill the lights, hit the blacklight** — glowing hands everywhere — and the app flips into an **outbreak investigation** where students use a real epidemiology **line list** to trace the illness back to its origin: the student *and* the object.

---

## 🎬 The flow at a glance

| Phase | Students see | You (instructor) do |
|---|---|---|
| **Setup** | "Join the room" | Powder your senior + one object. In the app, mark them secretly. |
| **Mingle** | A friendly get-to-know-you game with missions | Watch live coverage; nudge stragglers |
| **Reveal** | "Outbreak detected — check your hands" | Blacklight ON. Room gasps. |
| **Investigate** | A line list + contact log to solve | Show epi curve; collect answers; reveal the truth |

The mingling *is* the germ spread and *is* the data. No QR scanning — students just chat, swap 4-letter codes, and type them in.

---

## ✅ What you need

- **19 students, each with a phone** on the same Wi-Fi/data (any modern browser).
- **1 returning senior** to be your secret Patient Zero.
- **Glo Germ / UV powder + a blacklight** (you've got this).
- **1 high-traffic object** to contaminate — sign-in tablet, hand-sanitizer pump, candy bowl, door handle, coffee carafe. Pick something *everyone naturally touches*.
- A laptop/tablet + projector for the **host screen** (nice but optional).

---

## 🔧 One-time setup (~10 min)

### 1. Wire up Firebase (for real multi-phone play)
Open **`js/firebase-config.js`** — it has step-by-step comments. In short:
1. Create a free project at <https://console.firebase.google.com> (reuse your Google account).
2. Register a **Web app** (`</>`), copy the `firebaseConfig` values into that file.
3. **Build → Firestore Database → Create database → Test mode.**

> **Tip:** Until you paste real keys, the app runs in **Demo Mode** on a single device with pretend classmates — great for a dry run. Just open `index.html`.

**Recommended Firestore rules** (paste in Firestore → Rules). Open enough for a classroom, auto-locks after your event day — **edit the date**:
```
rules_version = '2';
service cloud.firestore {
  match /databases/{db}/documents {
    match /rooms/{room}/{document=**} {
      allow read, write: if request.time < timestamp.date(2026, 9, 5);
    }
    match /rooms/{room} {
      allow read, write: if request.time < timestamp.date(2026, 9, 5);
    }
  }
}
```

### 2. Host it
Any static host works. To match your other apps, use **GitHub Pages**:
```
# from the PatientZero folder
git init && git add . && git commit -m "First Day Outbreak"
gh repo create outbreak --public --source=. --push
# then: repo → Settings → Pages → Deploy from branch → main / root
```
Your URL becomes `https://<you>.github.io/outbreak/`. Or just run locally:
`python -m http.server 8000` → open `http://localhost:8000`.

> ⚠️ Phones need **HTTPS** (GitHub Pages gives this free) or `localhost`. A laptop's `http://192.168.x.x` sometimes gets blocked by phone browsers.

---

## 🕹️ Running it on the day

### Before students arrive
1. **Powder:** dust the senior's palms (and maybe a lanyard/pen they'll hand out) and dust **one high-traffic object** everyone will touch. The object has **no code and isn't tracked in the app** — it's there purely to spread the germ physically, and students crack it by observation.
2. Open the app → **"I'm the Instructor — Host"**. A **4-letter room code** appears. Put it + the URL on the projector (or print the **📲 Join QR** poster).

### As students arrive
4. They open the URL → **Join** → instantly get an **anonymous codename + 4-letter germ ID**. *No name, email, or personal info is ever asked for or stored.* (They can tap **↻ Give me a different codename** if they want another.)
5. **Choose Patient Zero once you see who's here** — you can set or change it any time before Reveal:
   - Ask your returning senior for the **codename on their phone** and tap **set** next to it → **Patient Zero** 🔴, **or**
   - Tap **⭐** to mark the returning seniors as they arrive, then hit **🎲 Random senior** to let the app pick one.
   - Then **powder that person** (the dusted sign-in pen or a welcome handshake — see "Deciding Patient Zero at sign-in" below).
6. In the app, mark which object you dusted as **SOURCE** ☣️ (default is the sanitizer pump — change it to whatever you actually dusted). This is just your answer key for the reveal; students never see it.
7. Press **Start the mingle**.

> **🖐️ Deciding Patient Zero at sign-in (covertly):** the powder must end up on whoever you tap. Two easy ways to decide in the moment: **(a)** dust the **sign-in pen** and hand *only* your chosen senior that pen (clean pen for everyone else); or **(b)** keep a pinch of powder in your palm and give them a "welcome back!" handshake. Then tap their codename in the app. Nobody notices, and you never commit before you see who showed up.

### The mingle (~15–20 min)
- **Set a countdown** on the host screen (Start 10/15/20 min) — it shows on every student's phone to keep the energy up.
- Students get a rotating **health-tech question to ask** ("What's your dream healthcare job?", "Any family in healthcare?"). They chat, **type each other's code**, and jot the answer. Goal: **meet everyone**. (No "go find someone" — calmer with a big group.)
- **Every meeting also records one new trait** about that person. The prompt climbs a **generic → personal ladder** (general → interest → background → personal), so a cohort that already knows each other still has to trade *new* info — and the traits stay usable as clues later (see below).
- Meanwhile, make sure everyone naturally uses the **dusted object** (sign in on it, grab a candy, sanitize) so the powder spreads — but there's nothing to log for it.
- Your screen shows **coverage %** and a **"still need to mingle"** nudge list. End when you're happy (100% is ideal; you control it).

### The reveal 🦠
8. Press **Reveal the outbreak**. **Turn off lights, turn on the blacklight.** Let them find the glow on their hands.
9. Your screen shows **"X of 19 contaminated"** and talking points. With everyone-meets-everyone, expect **most of the room to glow** — that's the lesson.

### The investigation 🔬
10. Press **Open the investigation**. Each phone shows a **line list** (symptom-onset order), a **suspect dossier**, and the full **contact log**.
11. In teams, students reason like disease detectives:
    - **Patient Zero** = earliest symptom onset (top of the line list). Confirm against the contact log.
    - **The object** = figured out by **observation** — look at the glowing hands and ask "what did we all touch this morning?" The app doesn't track it; it's a discussion + eyes-on-the-room deduction.
    - **Which real classmate is that codename?** Open the **🗂 Suspect Dossier** for any case to read the traits classmates recorded about them (general → personal) and match the codename to a face in the room.
12. **Stuck, or want a group finale?** Press **🔍 Drip a clue about Patient Zero** — it pushes the recorded traits about your index case to *every* phone, one at a time, **starting generic and getting more personal**, until the room shouts out who it is.
13. Teams **submit** their answer (a person + an object). When ready, press **🎯 Reveal the answer** — every phone lights up with the truth and whether they got it.
14. **Debrief with the spread map + stats.** After the reveal, a **🌳 How it spread** transmission tree appears on your screen and every phone — each arrow is one classmate passing the germ to the next, branching out from Patient Zero. Alongside it: outbreak **stats** (total reach, longest chain, average onward spread) and **awards** — 🦠 **Super-spreader** (infected the most directly), 🤝 **Most social**, 🧼 **Dodged it**. Hit **▶ Replay the outbreak** to animate it rippling through the room in real time order.

---

## 🧪 The epidemiology (why it's solvable)

The app seeds the "infection" from Patient Zero (onset 0), then spreads it **forward in time** along the exact meetings students logged: you can only catch it from someone who was already contagious *before* you met them. That produces a genuine **line list** and **epi curve**, and because Patient Zero starts at onset 0 they sit at the top of the list — the same logic real outbreak investigators use with symptom-onset dates, compressed into 20 minutes. The **object** runs on a parallel *physical* track: the UV powder spreads by touch, and students identify the fomite the way real investigators often do first — by observation ("what did all the sick people have in common?").

---

## 🛟 Troubleshooting

- **"No room with that code"** — codes are 4 letters, case-insensitive. Make sure you didn't reset the host (that ends the room).
- **A student can't find someone's code** — they have to *ask*; that's the ice breaker working. Codes are on each student's own screen (top of their mingle page).
- **Students don't spot the object** — nudge them: "everyone's hands glow — what's the one thing you all touched on the way in?" It's an eyes-on-the-room deduction, not an app lookup.
- **Someone joined twice** — harmless; just don't mark a duplicate as Patient Zero.
- **Want *fewer* people infected** (spot-the-sick version) — end the mingle early, before full coverage. Less of the room will glow.
- **Reset everything** — host presses **End & reset**. (Old room data lingers in Firestore harmlessly; the rules date auto-expires access.)

---

## 🔒 Privacy
**No names, emails, accounts, or personal information — ever.** Each student is stored only as a random **codename**, an emoji, and a 4-letter code, in a room that stops accepting reads/writes after your event date. Nothing ties a codename to a real identity except what happens in the room. Delete the Firestore data anytime from the console.

---

## 📁 Files
```
index.html            app shell
css/styles.css        styling
js/app.js             all game logic (host + student + epidemiology engine + trait/clue system)
js/firebase-config.js ← paste your Firebase keys here
cheatsheet.html       printable one-page facilitator run-of-show (also linked from the host "📄 Run-of-show" button)
join-qr.html          printable "Scan to join" QR poster (also linked from the host "📲 Join QR" button)
manifest.json, sw.js  PWA (installable, offline-tolerant)
```

## 🧪 Dry run before the day
Just open `index.html` (Demo Mode). Handy quick-start links:
- `index.html#host` — host lobby pre-seeded with pretend classmates
- `index.html#demo` — jump to a fully-simulated investigation (instructor view)
- `index.html#student` — preview a student's mingle screen
- `index.html#solve` — preview a student's investigation screen (with clues + dossier)

Have a great first day. 🧬
