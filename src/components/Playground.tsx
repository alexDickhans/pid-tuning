import React, { useEffect, useMemo, useRef, useState } from 'react';
import uPlot, { AlignedData } from 'uplot';
import 'uplot/dist/uPlot.min.css';

type SimParams = {
  dt: number;
  kp: number;
  setpoint: number;
  friction: number;
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
    friction: 0.5
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

  useEffect(() => {
    worker.postMessage({ type: 'update', params, running: isRunning });
  }, [worker, params, isRunning]);

  // On first mount, randomize the hidden system and friction, and ensure running
  useEffect(() => {
    setIsRunning(true);
    setParams(p => ({ ...p, dt: DEFAULT_DT, friction: +(Math.random() * 3.0).toFixed(2) }));
    worker.postMessage({ type: 'randomize' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep a live ref for graphsOpen so rAF loop sees the latest value
  useEffect(() => {
    graphsOpenRef.current = graphsOpen;
  }, [graphsOpen]);

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
    const yChart = new uPlot(
      {
        width: yWidth,
        height: 320,
        title: 'Setpoint (black) and Position y (blue)',
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
  }, [resetCounter, graphsOpen]);

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

  return (
    <div className="card">
      <h2 className="section-title">P Controller with Inertial Plant</h2>
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
          <span>Setpoint: {params.setpoint.toFixed(2)} | Position: {latestY.toFixed(2)}</span>
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
      </div>

      <div className="row" style={{ justifyContent: 'flex-start', gap: 12, margin: '12px 0' }}>
        <details onToggle={(e) => setGraphsOpen((e.target as HTMLDetailsElement).open)}>
          <summary style={{ cursor: 'pointer' }}>Graphs</summary>
        </details>
        <div className="row" style={{ gap: 8 }}>
          <button onClick={() => setIsRunning(r => !r)}>{isRunning ? 'Pause' : 'Play'}</button>
          <button onClick={() => setResetCounter(c => c + 1)}>Reset/Start</button>
          <button onClick={() => { setParams(p => ({ ...p, friction: +(Math.random() * 3.0).toFixed(2) })); worker.postMessage({ type: 'randomize' }); }}>Randomize System</button>
        </div>
      </div>

      {graphsOpen && (
        <>
          <div className="chart" ref={yPlotRef} />
          <div className="chart" ref={uPlotRef} />
        </>
      )}

      <div className="controls">
        <p>
          This example shows a proportional controller driving a simple inertial plant
          with viscous friction. Increasing Kp speeds up the response but can
          cause overshoot and oscillation. Try pausing, changing parameters, and resuming.
        </p>
        <div className="stack">

          <div>
            {/* Friction is randomized in code; slider removed per request */}
          </div>

          {/* dt fixed in code at 0.01; hidden from UI */}
        </div>
        <p>
          With only proportional action, steady-state error can remain for constant
          disturbances or friction. In later examples, integral action will remove
          this offset, and derivative action will improve damping.
        </p>
      </div>
    </div>
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


