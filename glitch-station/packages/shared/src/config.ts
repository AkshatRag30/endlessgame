/**
 * Every tunable number in Glitch Station lives here (PRD section 16 rule).
 * Values come from the PRD; the client and the server read from this object
 * instead of hard coding numbers.
 */
export const CONFIG = {
  protocolVersion: 2,

  net: {
    /** Server simulation and snapshot rate (PRD section 10). */
    tickRate: 20,
    /** Others are drawn this far in the past for smooth interpolation. */
    interpolationDelayMs: 100,
    /** How often the client measures round trip time. */
    pingIntervalMs: 2000,
    /** Largest client message the server will even try to parse. */
    maxMessageBytes: 1024,
    /** Reconnect backoff for the client socket. */
    reconnectMinMs: 500,
    reconnectMaxMs: 8000,
    /** Green ping threshold in the HUD. */
    pingTargetMs: 150,
    /** Token bucket per connection: sustained messages per second and burst. */
    msgRatePerS: 40,
    msgBurst: 80,
    /** Max movement inputs the server applies per player per tick (catch up after jitter). */
    maxInputsPerTick: 3,
    maxQueuedInputs: 12,
  },

  room: {
    codeLength: 4,
    /** No lookalike letters: I, L and O are left out. */
    codeAlphabet: "ABCDEFGHJKMNPQRSTUVWXYZ",
    minPlayers: 5,
    /** Practice mode (host toggle) lets a small group fill in with bots or play short handed. */
    practiceMinPlayers: 3,
    maxPlayers: 10,
    emptyRoomCloseMs: 10 * 60 * 1000,
    reconnectGraceMs: 60 * 1000,
    nameMaxChars: 14,
    roomCreatePerMinutePerIp: 10,
  },

  map: {
    /** Pixels per tile when drawing. Gameplay works in tile units. */
    tilePx: 32,
    playerRadius: 0.35,
    interactRange: 1.6,
    spawnRadius: 3,
  },

  movement: {
    walkTilesPerSecond: 4.5,
  },

  vision: {
    crewTiles: 6,
    glitchTiles: 8,
    blackoutCrewTiles: 2,
  },

  glitch: {
    eliminateRangeTiles: 1.2,
    eliminateCooldownS: 25,
    sabotageCooldownS: 30,
    firstSabotageDelayS: 15,
    meltdownTimerS: 40,
    lockDoorsS: 10,
    conduitCooldownS: 1,
  },

  tasks: {
    /** A task must stay open at least this long before the server accepts it (anti cheat). */
    minTaskMs: 1200,
    longStageMs: 8000,
    fixMinMs: 1000,
  },

  meeting: {
    discussionS: 45,
    votingS: 60,
    resultS: 6,
    emergencyCooldownS: 20,
    emergencyPerPlayer: 1,
    chatMaxChars: 80,
    /** Chat token bucket: one message per this many ms, with a small burst. */
    chatEveryMs: 1500,
    chatBurst: 3,
  },

  roleRevealMs: 4000,
} as const;

export type Config = typeof CONFIG;
