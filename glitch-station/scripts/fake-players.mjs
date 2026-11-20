// Fills a room with headless fake players that ready up and wander around
// (PRD phase 1 load test). Unlike in game bots, these are real network
// clients, so they exercise sockets, rate limits and snapshots.
//
//   node scripts/fake-players.mjs ABCD            (9 players, local server)
//   node scripts/fake-players.mjs ABCD 4 https://glitch-station.<you>.workers.dev

const code = (process.argv[2] ?? "").toUpperCase();
const count = Number(process.argv[3] ?? 9);
const base = (process.argv[4] ?? "http://127.0.0.1:8787").replace(/\/$/, "");
if (!/^[A-Z]{4}$/.test(code)) {
  console.error("Usage: node scripts/fake-players.mjs ROOMCODE [count] [server]");
  process.exit(1);
}
const ws = base.replace(/^http/, "ws") + "/ws";

let bytes = 0;
let snaps = 0;
for (let i = 0; i < count; i++) {
  const sock = new WebSocket(`${ws}?room=${code}`);
  let seq = 0;
  let me = null;
  let started = false;
  let dir = { dx: 0, dy: 0 };
  sock.addEventListener("open", () => {
    sock.send(JSON.stringify({ t: "hello", name: `Fake ${i + 1}`, color: (i + 3) % 12, accessory: "none", token: null }));
    setTimeout(() => sock.send(JSON.stringify({ t: "lobbySet", color: null, accessory: null, ready: true })), 300);
  });
  sock.addEventListener("message", (e) => {
    bytes += e.data.length;
    const msg = JSON.parse(e.data);
    if (msg.t === "snap") snaps++;
    if (msg.t === "welcome") me = msg.you;
    // If a fake player ends up host, it starts the match once everyone is ready.
    if (msg.t === "lobby" && msg.phase === "lobby" && msg.host === me && !started) {
      const others = msg.players.filter((p) => p.id !== me);
      if (msg.players.length >= 5 && others.every((p) => p.ready)) { started = true; sock.send(JSON.stringify({ t: "start" })); console.log("fake host started the match"); }
    }
    if (msg.t === "lobby" && msg.phase === "lobby") started = false;
    if (msg.t === "error") console.log(`fake ${i + 1}: ${msg.code}`);
  });
  setInterval(() => {
    if (Math.random() < 0.05) { const a = Math.random() * Math.PI * 2; dir = { dx: Math.cos(a), dy: Math.sin(a) }; }
    if (sock.readyState === 1) sock.send(JSON.stringify({ t: "input", seq: ++seq, dx: +dir.dx.toFixed(2), dy: +dir.dy.toFixed(2) }));
  }, 50);
}
setInterval(() => {
  console.log(`${count} fake players · ${snaps} snapshots · ${(bytes / 1024).toFixed(0)} KB received (${snaps ? Math.round(bytes / snaps) : 0} bytes per snapshot avg)`);
  bytes = 0; snaps = 0;
}, 5000);
console.log(`Joining ${count} fake players to room ${code}. Ctrl+C to stop.`);
