// End to end smoke test against a running server (npm run dev, or a deployed URL):
// creates a room, joins 5 headless players, starts a practice match and
// checks that roles stay private and snapshots arrive.
//
//   node scripts/smoke.mjs                              (local, via wrangler on 8787)
//   node scripts/smoke.mjs https://glitch-station.<you>.workers.dev

const base = (process.argv[2] ?? "http://127.0.0.1:8787").replace(/\/$/, "");
const wsBase = base.replace(/^http/, "ws") + "/ws";
const fail = (msg) => { console.error("FAIL:", msg); process.exit(1); };

const health = await fetch(`${base}/health`).then((r) => r.json()).catch(() => null);
if (!health?.ok) fail(`no server at ${base}`);
console.log("health ok, protocol", health.protocol);

const { code } = await fetch(`${base}/api/rooms`, { method: "POST" }).then((r) => r.json());
if (!/^[A-Z]{4}$/.test(code)) fail("bad room code");
console.log("room", code);

function player(name, color) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${wsBase}?room=${code}`);
    const p = { ws, name, inbox: [], id: null };
    const timer = setTimeout(() => reject(new Error(`${name} timed out`)), 10000);
    ws.addEventListener("open", () => ws.send(JSON.stringify({ t: "hello", name, color, accessory: "none", token: null })));
    ws.addEventListener("message", (e) => {
      const msg = JSON.parse(e.data);
      p.inbox.push(msg);
      if (msg.t === "welcome") { p.id = msg.you; clearTimeout(timer); resolve(p); }
    });
    ws.addEventListener("error", () => reject(new Error(`${name} socket error`)));
  });
}

const players = [];
for (let i = 0; i < 5; i++) players.push(await player(`Smoke${i}`, i));
const send = (p, msg) => p.ws.send(JSON.stringify(msg));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await wait(300);

const lobby = players[0].inbox.filter((m) => m.t === "lobby").at(-1);
if (lobby?.players.length !== 5) fail(`lobby shows ${lobby?.players.length} players`);
if (lobby.host !== players[0].id) fail("first player is not host");
console.log("lobby ok: 5 players, host is first");

// Non host cannot start; ready everyone, then start.
send(players[1], { t: "start" });
for (const p of players.slice(1)) send(p, { t: "lobbySet", color: null, accessory: null, ready: true });
await wait(200);
send(players[0], { t: "start" });
await wait(1500);

const starts = players.map((p) => p.inbox.find((m) => m.t === "matchStart"));
if (starts.some((s) => !s)) fail("not everyone got matchStart");
const glitches = starts.filter((s) => s.role === "glitch").length;
if (glitches !== 1) fail(`expected 1 Glitch, got ${glitches}`);
for (const [i, s] of starts.entries()) {
  if (s.role === "crew" && s.partners.length) fail("crew got partner info");
  const raw = JSON.stringify(players[i].inbox);
  if (s.role === "crew" && raw.includes('"glitch"')) fail("crew client saw the word glitch in its traffic");
}
console.log("roles ok: 1 Glitch, crew traffic has no role data");

await wait(4000);
const snaps = players[0].inbox.filter((m) => m.t === "snap");
if (snaps.length < 20) fail(`only ${snaps.length} snapshots`);
console.log(`snapshots ok: ${snaps.length} in ~4 s`);

// Bad frames are refused, not fatal.
players[0].ws.send("{nope");
await wait(200);
if (!players[0].inbox.some((m) => m.t === "error" && m.code === "bad_message")) fail("bad frame not rejected");
console.log("bad frame rejected");

for (const p of players) p.ws.close();
console.log("PASS");
process.exit(0);
