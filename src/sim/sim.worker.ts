// Web Worker: runs a P-only control loop on a first-order plant and streams data

type StartMessage = {
  type: 'start';
  params: SimParams;
  running: boolean;
};

type UpdateMessage = {
  type: 'update';
  params: SimParams;
  running: boolean;
};
type RandomizeMessage = { type: 'randomize' };
type ResetMessage = { type: 'reset' };

type SimParams = {
  dt: number;
  kp: number;
  setpoint: number;
  // Inertial plant exposed param(s)
  friction: number;    // b (viscous)
};

type DataMessage = {
  type: 'data';
  t: number[];
  y: number[];
  u: number[];
  sp: number[];
};

let p: SimParams = {
  dt: 0.01,
  kp: 1,
  setpoint: 1,
  friction: 0.5
};
let running = true;

// Plant state and controller state
let y = 0; // position/output
let v = 0; // velocity
let u = 0; // actuator output after lag
let uCmd = 0; // instantaneous controller command before lag
let t = 0; // time

// Hidden plant parameters
let mass = 1.0;      // m
let K = 1.0;         // gain
const tauLag = 0.08; // actuator lag (seconds), small first-order lag
// Minimum control deadband: below ~2% of full-scale, actuator produces no motion
// We assume actuator "full-scale" is 1.0 in these units.
const U_DEADBAND = 0.02;

// Buffers for chart updates
const maxPoints = 2000;
const tBuf: number[] = [];
const yBuf: number[] = [];
const uBuf: number[] = [];
const spBuf: number[] = [];

function step() {
  // P-only: u = Kp * (r - y)
  const e = p.setpoint - y;
  uCmd = p.kp * e;
  // First-order actuator lag: du/dt = (uCmd - u)/tauLag
  const du = ((uCmd - u) / Math.max(tauLag, 1e-6)) * p.dt;
  u += du;

  // Apply deadband so tiny control outputs produce no movement
  const uEff = Math.abs(u) < U_DEADBAND ? 0 : u;

  // Inertial plant (no spring): m * dv/dt + b * v = K * u
  // dv/dt = (K*u - b*v) / m
  const effectiveMass = Math.max(mass, 1e-6);
  const dv = ((K * uEff - p.friction * v) / effectiveMass) * p.dt;
  v += dv;
  const dy = v * p.dt;
  y += dy;
  t += p.dt;

  tBuf.push(t);
  yBuf.push(y);
  uBuf.push(uEff);
  spBuf.push(p.setpoint);
  if (tBuf.length > maxPoints) {
    tBuf.shift();
    yBuf.shift();
    uBuf.shift();
    spBuf.shift();
  }
}

function flush() {
  const msg: DataMessage = {
    type: 'data',
    t: tBuf.slice(),
    y: yBuf.slice(),
    u: uBuf.slice(),
    sp: spBuf.slice()
  };
  postMessage(msg);
}

let simTimer: number | null = null;
let flushTimer: number | null = null;

function startLoop() {
  stopLoop();
  const intervalMs = Math.max(1, Math.floor(p.dt * 1000));
  // Run sim at intervalMs; can run multiple steps per tick if dt smaller
  simTimer = setInterval(() => {
    if (!running) return;
    const stepsPerTick = Math.max(1, Math.round((p.dt * 1000) / intervalMs));
    for (let i = 0; i < stepsPerTick; i++) step();
  }, intervalMs) as unknown as number;

  flushTimer = setInterval(() => {
    flush();
  }, 16) as unknown as number; // ~60fps to main thread
}

function stopLoop() {
  if (simTimer !== null) {
    clearInterval(simTimer as unknown as number);
    simTimer = null;
  }
  if (flushTimer !== null) {
    clearInterval(flushTimer as unknown as number);
    flushTimer = null;
  }
}

function resetState() {
  y = 0;
  v = 0;
  u = 0;
  t = 0;
  tBuf.length = 0;
  yBuf.length = 0;
  uBuf.length = 0;
  spBuf.length = 0;
}

self.addEventListener('message', (ev: MessageEvent) => {
  const msg = ev.data as StartMessage | UpdateMessage | RandomizeMessage | ResetMessage;
  if (msg.type === 'start') {
    p = msg.params;
    running = msg.running;
    resetState();
    startLoop();
  } else if (msg.type === 'update') {
    p = msg.params;
    running = msg.running;
    // Adjust loop timing
    startLoop();
  } else if (msg.type === 'randomize') {
    // Randomize hidden plant parameters
    mass = 0.5 + Math.random() * 4.5; // 0.5 .. 5.0
    K = 0.5 + Math.random() * 2.5;    // 0.5 .. 3.0
  } else if (msg.type === 'reset') {
    resetState();
  }
});

postMessage({ type: 'ready' });


