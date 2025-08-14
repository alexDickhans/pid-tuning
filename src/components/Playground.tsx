import React, { useEffect, useMemo, useRef, useState } from 'react';
import uPlot, { AlignedData } from 'uplot';
import 'uplot/dist/uPlot.min.css';

type SimParams = {
  dt: number;
  kp: number;
  ki?: number;
  setpoint: number;
  friction: number;
  plant?: 'sled' | 'flywheel';
  drag?: number;
  inertiaJ?: number;
  loadTorque?: number;
};

type SimDataMessage = {
  type: 'data';
  t: number[];
  y: number[];
  u: number[];
  sp: number[];
};

export function Playground(): JSX.Element {
  const DEFAULT_DT = 0.01;
  const GRAPH_WINDOW_SEC = 10; // visible time window for scrolling plots
  const EPS = 1e-6;
  const [params, setParams] = useState<SimParams>({
    dt: DEFAULT_DT,
    kp: 1.0,
    setpoint: 1.0,
    friction: 0.5,
    plant: 'sled',
    drag: 0.2,
    inertiaJ: 0.05,
    loadTorque: 0
  });
  const [isRunning, setIsRunning] = useState(true);
  const [resetCounter, setResetCounter] = useState(0);
  const [graphsOpen, setGraphsOpen] = useState(false);
  const graphsOpenRef = useRef(false);

  const yPlotRef = useRef<HTMLDivElement | null>(null);
  const uPlotRef = useRef<HTMLDivElement | null>(null);
  const yPlot = useRef<uPlot | null>(null);
  const uPlotInstance = useRef<uPlot | null>(null);
  const dataBuffer = useRef<SimDataMessage | null>(null);
  const [latestY, setLatestY] = useState(0);

  const worker = useMemo(() => new Worker(new URL('../sim/sim.worker.ts', import.meta.url), { type: 'module' }), [resetCounter]);
  // Second simulation: PI controller
  const [paramsPI, setParamsPI] = useState<SimParams>({
    dt: DEFAULT_DT,
    kp: 1.0,
    ki: 0.2,
    setpoint: 1.0,
    friction: 0.5,
    plant: 'flywheel',
    drag: 0.2,
    inertiaJ: 0.05,
    loadTorque: 0
  });
  const [isRunningPI, setIsRunningPI] = useState(true);
  const [resetCounterPI, setResetCounterPI] = useState(0);
  const [graphsOpenPI, setGraphsOpenPI] = useState(false);
  const graphsOpenRefPI = useRef(false);
  const yPlotRefPI = useRef<HTMLDivElement | null>(null);
  const uPlotRefPI = useRef<HTMLDivElement | null>(null);
  const yPlotPI = useRef<uPlot | null>(null);
  const uPlotInstancePI = useRef<uPlot | null>(null);
  const dataBufferPI = useRef<SimDataMessage | null>(null);
  const [latestYPI, setLatestYPI] = useState(0);
  const workerPI = useMemo(() => new Worker(new URL('../sim/sim.worker.ts', import.meta.url), { type: 'module' }), [resetCounterPI]);

  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      const msg = ev.data as SimDataMessage | { type: 'ready' };
      if ((msg as any).type === 'data') {
        dataBuffer.current = msg as SimDataMessage;
      }
    }
    worker.addEventListener('message', onMessage);
    worker.postMessage({ type: 'start', params, running: isRunning });
    return () => {
      worker.removeEventListener('message', onMessage);
      worker.terminate();
    };
  }, [worker]);
  // Hook up PI worker
  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      const msg = ev.data as SimDataMessage | { type: 'ready' };
      if ((msg as any).type === 'data') {
        dataBufferPI.current = msg as SimDataMessage;
      }
    }
    workerPI.addEventListener('message', onMessage);
    workerPI.postMessage({ type: 'start', params: paramsPI, running: isRunningPI });
    return () => {
      workerPI.removeEventListener('message', onMessage);
      workerPI.terminate();
    };
  }, [workerPI]);

  useEffect(() => {
    worker.postMessage({ type: 'update', params, running: isRunning });
  }, [worker, params, isRunning]);
  useEffect(() => {
    workerPI.postMessage({ type: 'update', params: paramsPI, running: isRunningPI });
  }, [workerPI, paramsPI, isRunningPI]);

  // On first mount, randomize the hidden system and friction, and ensure running
  useEffect(() => {
    setIsRunning(true);
    setParams(p => ({
      ...p,
      dt: DEFAULT_DT,
      friction: +(Math.random() * 3.0).toFixed(2),
      drag: +(Math.random() * 2.0).toFixed(2),
      inertiaJ: +(0.001 + Math.random() * (0.2 - 0.001)).toFixed(3),
      loadTorque: +(Math.random() * 1.0).toFixed(2)
    }));
    worker.postMessage({ type: 'randomize' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // On first mount of PI sim
  useEffect(() => {
    setIsRunningPI(true);
    setParamsPI(p => ({
      ...p,
      dt: DEFAULT_DT,
      friction: +(Math.random() * 3.0).toFixed(2),
      drag: +(Math.random() * 2.0).toFixed(2),
      inertiaJ: +(0.001 + Math.random() * (0.2 - 0.001)).toFixed(3),
      loadTorque: +(Math.random() * 1.0).toFixed(2)
    }));
    workerPI.postMessage({ type: 'randomize' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep a live ref for graphsOpen so rAF loop sees the latest value
  useEffect(() => {
    graphsOpenRef.current = graphsOpen;
  }, [graphsOpen]);
  useEffect(() => {
    graphsOpenRefPI.current = graphsOpenPI;
  }, [graphsOpenPI]);

  // uPlot initialization
  useEffect(() => {
    if (!graphsOpen) return;
    if (!yPlotRef.current || !uPlotRef.current) return;
    const initData: AlignedData = [
      [0], // t
      [0], // sp
      [0], // y
    ];
    const yWidth = yPlotRef.current.clientWidth || 800;
    const yTitle = (params.plant ?? 'sled') === 'flywheel'
      ? 'Setpoint (black) and Speed ω (blue)'
      : 'Setpoint (black) and Position y (blue)';
    const yChart = new uPlot(
      {
        width: yWidth,
        height: 320,
        title: yTitle,
        scales: { x: { time: false } },
        series: [
          {},
          { label: 'Setpoint', stroke: 'black' },
          { label: 'PV', stroke: 'blue' }
        ]
      },
      initData,
      yPlotRef.current
    );

    const uWidth = uPlotRef.current.clientWidth || yWidth;
    const uChart = new uPlot(
      {
        width: uWidth,
        height: 200,
        title: 'Control Output u(t)',
        scales: { x: { time: false } },
        series: [
          {},
          { label: 'u', stroke: 'green' }
        ]
      },
      ([[0], [0]] as unknown) as AlignedData,
      uPlotRef.current
    );

    yPlot.current = yChart;
    uPlotInstance.current = uChart;
    // Seed plots from buffered data if available
    const buf = dataBuffer.current;
    if (buf) {
      const { t, y, u, sp } = buf;
      const tLast = t.length ? t[t.length - 1] : 0;
      const start = tLast - GRAPH_WINDOW_SEC;
      const i0 = findStartIndex(t, start);
      const tSlice = t.slice(i0);
      const spSlice = sp.slice(i0);
      const ySlice = y.slice(i0);
      const uSlice = u.slice(i0);
      yPlot.current.setData([tSlice, spSlice, ySlice] as AlignedData);
      uPlotInstance.current.setData([tSlice, uSlice] as AlignedData);
      if (tSlice.length >= 2) {
        const xmin = tSlice[0];
        const xmax = Math.max(tSlice[tSlice.length - 1], xmin + EPS);
        yPlot.current.setScale('x', { min: xmin, max: xmax });
        uPlotInstance.current.setScale('x', { min: xmin, max: xmax });
      }
    }

    const resizeObserver = new ResizeObserver(() => {
      if (yPlotRef.current && yPlot.current) {
        const w = yPlotRef.current.clientWidth || 800;
        yPlot.current.setSize({ width: w, height: 320 });
      }
      if (uPlotRef.current && uPlotInstance.current) {
        const w = uPlotRef.current.clientWidth || 800;
        uPlotInstance.current.setSize({ width: w, height: 200 });
      }
    });
    resizeObserver.observe(yPlotRef.current);
    resizeObserver.observe(uPlotRef.current);

    return () => {
      resizeObserver.disconnect();
      yChart.destroy();
      uChart.destroy();
      yPlot.current = null;
      uPlotInstance.current = null;
    };
  }, [resetCounter, graphsOpen, params.plant]);
  // uPlot initialization for PI sim
  useEffect(() => {
    if (!graphsOpenPI) return;
    if (!yPlotRefPI.current || !uPlotRefPI.current) return;
    const initData: AlignedData = [
      [0],
      [0],
      [0],
    ];
    const yWidth = yPlotRefPI.current.clientWidth || 800;
    const yTitle = (paramsPI.plant ?? 'sled') === 'flywheel'
      ? 'Setpoint (black) and Speed ω (blue)'
      : 'Setpoint (black) and Position y (blue)';
    const yChart = new uPlot(
      {
        width: yWidth,
        height: 320,
        title: yTitle,
        scales: { x: { time: false } },
        series: [
          {},
          { label: 'Setpoint', stroke: 'black' },
          { label: 'PV', stroke: 'blue' }
        ]
      },
      initData,
      yPlotRefPI.current
    );

    const uWidth = uPlotRefPI.current.clientWidth || yWidth;
    const uChart = new uPlot(
      {
        width: uWidth,
        height: 200,
        title: 'Control Output u(t)',
        scales: { x: { time: false } },
        series: [
          {},
          { label: 'u', stroke: 'green' }
        ]
      },
      ([[0], [0]] as unknown) as AlignedData,
      uPlotRefPI.current
    );

    yPlotPI.current = yChart;
    uPlotInstancePI.current = uChart;
    const buf = dataBufferPI.current;
    if (buf) {
      const { t, y, u, sp } = buf;
      const tLast = t.length ? t[t.length - 1] : 0;
      const start = tLast - GRAPH_WINDOW_SEC;
      const i0 = findStartIndex(t, start);
      const tSlice = t.slice(i0);
      const spSlice = sp.slice(i0);
      const ySlice = y.slice(i0);
      const uSlice = u.slice(i0);
      yPlotPI.current.setData([tSlice, spSlice, ySlice] as AlignedData);
      uPlotInstancePI.current.setData([tSlice, uSlice] as AlignedData);
      if (tSlice.length >= 2) {
        const xmin = tSlice[0];
        const xmax = Math.max(tSlice[tSlice.length - 1], xmin + EPS);
        yPlotPI.current.setScale('x', { min: xmin, max: xmax });
        uPlotInstancePI.current.setScale('x', { min: xmin, max: xmax });
      }
    }

    const resizeObserver = new ResizeObserver(() => {
      if (yPlotRefPI.current && yPlotPI.current) {
        const w = yPlotRefPI.current.clientWidth || 800;
        yPlotPI.current.setSize({ width: w, height: 320 });
      }
      if (uPlotRefPI.current && uPlotInstancePI.current) {
        const w = uPlotRefPI.current.clientWidth || 800;
        uPlotInstancePI.current.setSize({ width: w, height: 200 });
      }
    });
    resizeObserver.observe(yPlotRefPI.current);
    resizeObserver.observe(uPlotRefPI.current);

    return () => {
      resizeObserver.disconnect();
      yChart.destroy();
      uChart.destroy();
      yPlotPI.current = null;
      uPlotInstancePI.current = null;
    };
  }, [resetCounterPI, graphsOpenPI, paramsPI.plant]);

  // We keep simulation always running and update charts when open
  useEffect(() => {
    // Clear any stale buffer when reset occurs so charts don't seed from old data
    dataBuffer.current = null;
  }, [resetCounter]);

  // Animation loop to push buffered data to charts ~60fps
  useEffect(() => {
    let raf = 0;
    const frame = () => {
      const buf = dataBuffer.current;
      if (buf) {
        const { t, y, u, sp } = buf;
        // Always update latestY for the position bar, regardless of graphs mount/state
        const lastY = y.length ? y[y.length - 1] : 0;
        setLatestY(lastY);
        // Only push data to charts if they exist and graphs are open
        if (graphsOpenRef.current && yPlot.current && uPlotInstance.current) {
          const tArr = t;
          const tLast = tArr.length ? tArr[tArr.length - 1] : 0;
          const start = tLast - GRAPH_WINDOW_SEC;
          const i0 = findStartIndex(tArr, start);
          const tSlice = tArr.slice(i0);
          const spSlice = sp.slice(i0);
          const ySlice = y.slice(i0);
          const uSlice = u.slice(i0);
          yPlot.current.setData([tSlice, spSlice, ySlice] as AlignedData);
          uPlotInstance.current.setData([tSlice, uSlice] as AlignedData);
          if (tSlice.length >= 2) {
            const xmin = tSlice[0];
            const xmax = Math.max(tSlice[tSlice.length - 1], xmin + EPS);
            yPlot.current.setScale('x', { min: xmin, max: xmax });
            uPlotInstance.current.setScale('x', { min: xmin, max: xmax });
          }
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);
  // Animation loop for PI charts
  useEffect(() => {
    let raf = 0;
    const frame = () => {
      const buf = dataBufferPI.current;
      if (buf) {
        const { t, y, u, sp } = buf;
        const lastY = y.length ? y[y.length - 1] : 0;
        setLatestYPI(lastY);
        if (graphsOpenRefPI.current && yPlotPI.current && uPlotInstancePI.current) {
          const tArr = t;
          const tLast = tArr.length ? tArr[tArr.length - 1] : 0;
          const start = tLast - GRAPH_WINDOW_SEC;
          const i0 = findStartIndex(tArr, start);
          const tSlice = tArr.slice(i0);
          const spSlice = sp.slice(i0);
          const ySlice = y.slice(i0);
          const uSlice = u.slice(i0);
          yPlotPI.current.setData([tSlice, spSlice, ySlice] as AlignedData);
          uPlotInstancePI.current.setData([tSlice, uSlice] as AlignedData);
          if (tSlice.length >= 2) {
            const xmin = tSlice[0];
            const xmax = Math.max(tSlice[tSlice.length - 1], xmin + EPS);
            yPlotPI.current.setScale('x', { min: xmin, max: xmax });
            uPlotInstancePI.current.setScale('x', { min: xmin, max: xmax });
          }
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Horizontal bar for position and setpoint mapping
  const barRef = useRef<HTMLDivElement | null>(null);
  const rangeMin = -5;
  const rangeMax = 5;
  const rangeWidth = rangeMax - rangeMin;

  function setpointFromClick(clientX: number) {
    const el = barRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = Math.min(Math.max(clientX - rect.left, 0), rect.width);
    const sp = rangeMin + (x / rect.width) * rangeWidth;
    setParams(p => ({ ...p, setpoint: sp }));
  }
  // PI setpoint bar
  const barRefPI = useRef<HTMLDivElement | null>(null);
  function setpointFromClickPI(clientX: number) {
    const el = barRefPI.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = Math.min(Math.max(clientX - rect.left, 0), rect.width);
    const sp = rangeMin + (x / rect.width) * rangeWidth;
    setParamsPI(p => ({ ...p, setpoint: sp }));
  }

  return (
    <>
    <div className="card">
      <h2 className="section-title">P Controller</h2>
      <div className="controls">
        <p>
          This simulator lets you explore how a proportional (P) controller works with a simple system that has mass and friction—imagine pushing a sled on a rough surface. In a proportional controller, the control action (how hard you push) is directly proportional (Kp * error) to the error, which is the difference between the current position and the target value (the setpoint). That means if the system is far from the setpoint, the controller pushes harder; if it's close, it pushes more gently. The <b>Kp</b> value is the proportional gain: it determines how strongly the system reacts to being off target. A higher Kp makes the system respond faster, but if it's too high, the system might overshoot the target or start to oscillate back and forth. You can pause the simulation, change the settings, and then resume to see how the system behaves. Try moving the setpoint and adjusting Kp to see what happens!
        </p>
        <p>
          Hint: P control alone has a few quirks. With constant friction or load, it can stop a little short of the target (steady‑state error). Turning Kp way up can make it jump past the target and wobble. And if the motor can only push so hard (it saturates), P control may still struggle to land exactly on the goal. These limits are why we often add the Integral (I) part next.
        </p>
      </div>
      <div className="interactive">
      <div className="row" style={{ gap: 12, marginBottom: 12, alignItems: 'center' }}>
        <span>Plant</span>
        <div className="segmented">
          <button
            className={(params.plant ?? 'sled') === 'sled' ? 'is-active' : ''}
            onClick={() => setParams(p => ({ ...p, plant: 'sled' }))}
          >Sled</button>
          <button
            className={(params.plant ?? 'sled') === 'flywheel' ? 'is-active' : ''}
            onClick={() => setParams(p => ({ ...p, plant: 'flywheel' }))}
          >Flywheel</button>
        </div>
      </div>
      <div className="position-bar-outer">
        <div
          ref={barRef}
          className="position-bar"
          onMouseDown={(e) => setpointFromClick(e.clientX)}
          onClick={(e) => setpointFromClick(e.clientX)}
        >
          <BarMarkers y={latestY} sp={params.setpoint} min={rangeMin} max={rangeMax} />
        </div>

        <div className="row" style={{ justifyContent: 'flex-start', marginTop: 8, gap: 16 }}>
          <span>Click anywhere on the bar to set the setpoint</span>
          <span>
            Setpoint: {params.setpoint.toFixed(2)} |
            {(params.plant ?? 'sled') === 'flywheel' ? ' Speed' : ' Position'}:
            {' '}{latestY.toFixed(2)}
          </span>
        </div>
        <div className="row" style={{ width: '100%' }}>
          <label htmlFor="kp" style={{ margin: 0, minWidth: 28, textAlign: 'right' }}>Kp</label>
          <input
            id="kp"
            type="range"
            min="0"
            max="10"
            step="0.01"
            value={params.kp}
            onChange={(e) => setParams(p => ({ ...p, kp: Number(e.target.value) }))}
            style={{ flex: 1 }}
          />
          <input
            type="number"
            value={params.kp}
            step={0.01}
            onChange={(e) => setParams(p => ({ ...p, kp: Number(e.target.value) }))}
          />
        </div>
        {/* Flywheel plant parameters are randomized, not user-editable */}
      </div>

      <div className="row toolbar" style={{ justifyContent: 'flex-start', gap: 12, margin: '12px 0' }}>
        <details onToggle={(e) => setGraphsOpen((e.target as HTMLDetailsElement).open)}>
          <summary style={{ cursor: 'pointer' }}>Graphs</summary>
        </details>
        <div className="row button-row" style={{ gap: 8 }}>
          <button onClick={() => setIsRunning(r => !r)}>{isRunning ? 'Pause' : 'Play'}</button>
          <button onClick={() => setResetCounter(c => c + 1)}>Reset/Start</button>
          <button onClick={() => {
            setParams(p => ({
              ...p,
              friction: +(Math.random() * 3.0).toFixed(2),
              drag: +(Math.random() * 2.0).toFixed(2),
              inertiaJ: +(0.001 + Math.random() * (0.2 - 0.001)).toFixed(3),
              loadTorque: +(Math.random() * 1.0).toFixed(2)
            }));
            worker.postMessage({ type: 'randomize' });
          }}>Randomize System</button>
        </div>
      </div>

      {graphsOpen && (
        <>
          <div className="chart" ref={yPlotRef} />
          <div className="chart" ref={uPlotRef} />
        </>
      )}
      </div>

      <div className="controls">
        <h2 className="section-title">Integral (I) Control</h2>
        <p>
          Proportional control reacts to how far you are from the target right now. But if
          there is constant friction or load pushing back, P control alone can stop a little
          short of the target. This small miss is called steady-state error.
        </p>
        <p>
          Integral control adds a gentle “memory” of past error. If the system stays below the
          target for a while, the memory grows and tells the controller to add a little extra
          push. If the system is above the target, the memory shrinks. Over time, this extra push
          cancels out the friction/load so the system can land exactly on the target.
        </p>
        <p>
          In simple words: Proportional fixes “how far off are we right now?” and Integral fixes
          “have we been off for a while?”. Together they reach the goal faster and more accurately.
        </p>
        <p>
          Tuning tip: start with Ki = 0 and raise it slowly. If Ki is too high, the system can
          overshoot and bounce. For motors and flywheels (speed control), a little integral is often
          essential to remove the speed drop caused by friction and load.
        </p>
      </div>
    </div>
    <div className="card" style={{ marginTop: -10 }}>
        <h2 className="section-title">PI Controller</h2>
        <div className="controls">
          <p>
            This simulator adds Integral (I) control on top of Proportional (P). Use Kp and Ki to
            reach the setpoint accurately. Start with a small Ki and increase until the steady-state
            error disappears without causing oscillation.
          </p>
        </div>
        <div className="interactive">
          <div className="row" style={{ gap: 12, marginBottom: 12, alignItems: 'center' }}>
            <span>Plant</span>
            <div className="segmented">
              <button
                className={(paramsPI.plant ?? 'sled') === 'sled' ? 'is-active' : ''}
                onClick={() => setParamsPI(p => ({ ...p, plant: 'sled' }))}
              >Sled</button>
              <button
                className={(paramsPI.plant ?? 'sled') === 'flywheel' ? 'is-active' : ''}
                onClick={() => setParamsPI(p => ({ ...p, plant: 'flywheel' }))}
              >Flywheel</button>
            </div>
          </div>
          <div className="position-bar-outer">
            <div
              ref={barRefPI}
              className="position-bar"
              onMouseDown={(e) => setpointFromClickPI(e.clientX)}
              onClick={(e) => setpointFromClickPI(e.clientX)}
            >
              <BarMarkers y={latestYPI} sp={paramsPI.setpoint} min={rangeMin} max={rangeMax} />
            </div>

            <div className="row" style={{ justifyContent: 'flex-start', marginTop: 8, gap: 16 }}>
              <span>Click anywhere on the bar to set the setpoint</span>
              <span>
                Setpoint: {paramsPI.setpoint.toFixed(2)} |
                {(paramsPI.plant ?? 'sled') === 'flywheel' ? ' Speed' : ' Position'}:
                {' '}{latestYPI.toFixed(2)}
              </span>
            </div>
            <div className="row" style={{ width: '100%' }}>
              <label htmlFor="kpPI" style={{ margin: 0, minWidth: 28, textAlign: 'right' }}>Kp</label>
              <input
                id="kpPI"
                type="range"
                min="0"
                max="10"
                step="0.01"
                value={paramsPI.kp}
                onChange={(e) => setParamsPI(p => ({ ...p, kp: Number(e.target.value) }))}
                style={{ flex: 1 }}
              />
              <input
                type="number"
                value={paramsPI.kp}
                step={0.01}
                onChange={(e) => setParamsPI(p => ({ ...p, kp: Number(e.target.value) }))}
              />
            </div>
            <div className="row" style={{ width: '100%' }}>
              <label htmlFor="kiPI" style={{ margin: 0, minWidth: 28, textAlign: 'right' }}>Ki</label>
              <input
                id="kiPI"
                type="range"
                min="0"
                max="5"
                step="0.001"
                value={paramsPI.ki ?? 0}
                onChange={(e) => setParamsPI(p => ({ ...p, ki: Number(e.target.value) }))}
                style={{ flex: 1 }}
              />
              <input
                type="number"
                value={paramsPI.ki ?? 0}
                step={0.001}
                onChange={(e) => setParamsPI(p => ({ ...p, ki: Number(e.target.value) }))}
              />
            </div>
          </div>

          <div className="row toolbar" style={{ justifyContent: 'flex-start', gap: 12, margin: '12px 0' }}>
            <details onToggle={(e) => setGraphsOpenPI((e.target as HTMLDetailsElement).open)}>
              <summary style={{ cursor: 'pointer' }}>Graphs</summary>
            </details>
            <div className="row button-row" style={{ gap: 8 }}>
              <button onClick={() => setIsRunningPI(r => !r)}>{isRunningPI ? 'Pause' : 'Play'}</button>
              <button onClick={() => setResetCounterPI(c => c + 1)}>Reset/Start</button>
              <button onClick={() => {
                setParamsPI(p => ({
                  ...p,
                  friction: +(Math.random() * 3.0).toFixed(2),
                  drag: +(Math.random() * 2.0).toFixed(2),
                  inertiaJ: +(0.001 + Math.random() * (0.2 - 0.001)).toFixed(3),
                  loadTorque: +(Math.random() * 1.0).toFixed(2)
                }));
                workerPI.postMessage({ type: 'randomize' });
              }}>Randomize System</button>
            </div>
          </div>

          {graphsOpenPI && (
            <>
              <div className="chart" ref={yPlotRefPI} />
              <div className="chart" ref={uPlotRefPI} />
            </>
          )}
        </div>
      </div>
    </>
  );
}

function BarMarkers({ y, sp, min, max }: { y: number; sp: number; min: number; max: number }): JSX.Element {
  const span = max - min;
  const yPct = ((y - min) / span) * 100;
  const spPct = ((sp - min) / span) * 100;
  return (
    <div className="bar-markers">
      <div className="marker setpoint" style={{ left: `${spPct}%` }} title={`Setpoint ${sp.toFixed(2)}`} />
      <div className="marker position" style={{ left: `${yPct}%` }} title={`Position ${y.toFixed(2)}`} />
    </div>
  );
}

function findStartIndex(tArr: number[], start: number): number {
  // Binary search for first index where t >= start
  let lo = 0;
  let hi = tArr.length - 1;
  let ans = tArr.length;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (tArr[mid] >= start) {
      ans = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }
  return ans === tArr.length ? Math.max(0, tArr.length - 1) : ans;
}


