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
  ki?: number;
  kd?: number;
  setpoint: number;
  // Inertial plant exposed param(s)
  friction: number;    // b (viscous)
  // Plant selection and flywheel params
  plant?: 'sled' | 'flywheel';
  drag?: number;         // flywheel viscous drag
  inertiaJ?: number;     // flywheel inertia
  loadTorque?: number;   // constant opposing torque
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
  ki: 0,
  kd: 0,
  setpoint: 1,
  friction: 0.5,
  plant: 'sled',
  drag: 0.2,
  inertiaJ: 0.05,
  loadTorque: 0
};
let running = true;

// Plant state and controller state
let y = 0; // position/output
let v = 0; // velocity
let u = 0; // actuator output after lag (physical output)
let uCmd = 0; // instantaneous controller command before lag (requested)
let t = 0; // time
// Flywheel state (angular speed)
let omega = 0;
// Integral of error for PI control
let ei = 0;
// Previous error for derivative term
let ePrev = 0;

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
  // PI control with improved anti-windup
  const ki = p.ki ?? 0;
  const kp = p.kp;
  const kd = p.kd ?? 0;
  // Predict saturation using the command side and error direction
  const de = (e - ePrev) / Math.max(p.dt, 1e-6);
  // Optional derivative clamp to avoid extreme spikes from large setpoint steps
  const DE_CLAMP = 1e3;
  const deClamped = Math.max(-DE_CLAMP, Math.min(DE_CLAMP, de));
  const uCmdNoI = kp * e + kd * deClamped;
  const uCmdTentative = uCmdNoI + ki * ei;
  const uCmdSat = Math.max(-1, Math.min(1, uCmdTentative));
  const saturatingHigh = uCmdTentative > 1 && e > 0;
  const saturatingLow  = uCmdTentative < -1 && e < 0;
  if (!(saturatingHigh || saturatingLow)) {
    ei += e * p.dt;
    // Simple integrator clamp to prevent numeric blow-up
    const EI_MAX = 1e3;
    if (ei > EI_MAX) ei = EI_MAX;
    if (ei < -EI_MAX) ei = -EI_MAX;
  }
  // Recompute command after possible ei update and clamp command for actuator
  uCmd = Math.max(-1, Math.min(1, kp * e + ki * ei + kd * deClamped));
  // First-order actuator lag: du/dt = (uCmd - u)/tauLag
  const du = ((uCmd - u) / Math.max(tauLag, 1e-6)) * p.dt;
  u += du;
  // Output clamp to simulate actuator limits (physical saturation)
  u = Math.max(-1, Math.min(1, u));

  // Apply deadband so tiny control outputs produce no movement
  const uEff = Math.abs(u) < U_DEADBAND ? 0 : u;

  if ((p.plant ?? 'sled') === 'flywheel') {
    // Flywheel plant: J * domega/dt + b * omega + tauLoad = K * u
    const J = Math.max(p.inertiaJ ?? 0.05, 1e-6);
    const b = p.drag ?? 0.2;
    const tauLoad = p.loadTorque ?? 0;
    const domega = ((K * uEff - b * omega - tauLoad) / J) * p.dt;
    omega += domega;
    y = omega; // output is speed
  } else {
    // Inertial sled (no spring): m * dv/dt + b * v = K * u
    const effectiveMass = Math.max(mass, 1e-6);
    const dv = ((K * uEff - p.friction * v) / effectiveMass) * p.dt;
    v += dv;
    const dy = v * p.dt;
    y += dy;
  }
  t += p.dt;
  ePrev = e;

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
  omega = 0;
  ei = 0;
  ePrev = 0;
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


