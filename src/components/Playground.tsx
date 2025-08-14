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
  const [params, setParams] = useState<SimParams>({
    dt: DEFAULT_DT,
    kp: 1.0,
    setpoint: 1.0,
    friction: 0.5
  });
  const [isRunning, setIsRunning] = useState(true);
  const [resetCounter, setResetCounter] = useState(0);
  const [graphsOpen, setGraphsOpen] = useState(false);

  const yPlotRef = useRef<HTMLDivElement | null>(null);
  const uPlotRef = useRef<HTMLDivElement | null>(null);
  const graphsContainerRef = useRef<HTMLElement | null>(null);
  const yPlot = useRef<uPlot | null>(null);
  const uPlotInstance = useRef<uPlot | null>(null);
  const dataBuffer = useRef<SimDataMessage | null>(null);
  const [latestY, setLatestY] = useState(0);
  const [graphsInView, setGraphsInView] = useState(false);

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

  // uPlot initialization
  useEffect(() => {
    if (!graphsOpen) return;
    if (!yPlotRef.current || !uPlotRef.current) return;
    const now = Date.now() / 1000;
    const initData = [
      [now], // t
      [0], // sp
      [0], // y
    ];
    const yChart = new uPlot(
      {
        width: 800,
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

    const uChart = new uPlot(
      {
        width: 800,
        height: 200,
        title: 'Control Output u(t)',
        scales: { x: { time: false } },
        series: [
          {},
          { label: 'u', stroke: 'green' }
        ]
      },
      [[now], [0]],
      uPlotRef.current
    );

    yPlot.current = yChart;
    uPlotInstance.current = uChart;
    // Seed plots from buffered data if available
    const buf = dataBuffer.current;
    if (buf) {
      const { t, y, u, sp } = buf;
      yPlot.current.setData([t, sp, y] as AlignedData);
      uPlotInstance.current.setData([t, u] as AlignedData);
    }

    return () => {
      yChart.destroy();
      uChart.destroy();
      yPlot.current = null;
      uPlotInstance.current = null;
    };
  }, [resetCounter, graphsOpen]);

  // Track if the graphs container is in viewport
  useEffect(() => {
    const el = graphsContainerRef.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === el) {
          setGraphsInView(entry.isIntersecting);
        }
      }
    }, { threshold: 0.1 });
    io.observe(el);
    return () => io.disconnect();
  }, [graphsContainerRef.current]);

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
        // Only push data to charts if they exist and are in view
        if (graphsOpen && graphsInView && yPlot.current && uPlotInstance.current) {
          const tArr = t;
          const yData = [tArr, sp, y] as AlignedData;
          yPlot.current.setData(yData);
          const uData = [tArr, u] as AlignedData;
          uPlotInstance.current.setData(uData);
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
    <>
      <div style={{ marginBottom: 16 }}>
        <label className="section-title" style={{ display: 'block', marginBottom: 8 }}>Position and Setpoint</label>
        <div className="position-bar-outer">
          <div
            ref={barRef}
            className="position-bar"
            onMouseDown={(e) => setpointFromClick(e.clientX)}
            onClick={(e) => setpointFromClick(e.clientX)}
          >
            <BarMarkers y={latestY} sp={params.setpoint} min={rangeMin} max={rangeMax} />
          </div>
          <div className="row" style={{ justifyContent: 'space-between', marginTop: 6 }}>
            <span>Click anywhere on the bar to set the setpoint</span>
            <span>Setpoint: {params.setpoint.toFixed(2)} | Position: {latestY.toFixed(2)}</span>
          </div>
        </div>
      </div>

      <div className="layout">
      <div className="controls">
        <h2 className="section-title">P Controller with Inertial Plant</h2>
        <p>
          This example shows a proportional controller driving a simple inertial plant
          with viscous friction. Increasing Kp speeds up the response but can
          cause overshoot and oscillation. Try pausing, changing parameters, and resuming.
        </p>
        <div className="stack">
          <div>
            <label>Kp</label>
            <div className="row">
              <input
                type="range"
                min="0"
                max="10"
                step="0.01"
                value={params.kp}
                onChange={(e) => setParams(p => ({ ...p, kp: Number(e.target.value) }))}
              />
              <input
                type="number"
                value={params.kp}
                step={0.01}
                onChange={(e) => setParams(p => ({ ...p, kp: Number(e.target.value) }))}
              />
            </div>
          </div>

          <div>
            {/* Friction is randomized in code; slider removed per request */}
          </div>

          {/* dt fixed in code at 0.01; hidden from UI */}

          <div className="row">
            <button onClick={() => setIsRunning(r => !r)}>{isRunning ? 'Pause' : 'Play'}</button>
            <button onClick={() => setResetCounter(c => c + 1)}>Reset/Start</button>
            <button onClick={() => { setParams(p => ({ ...p, friction: +(Math.random() * 3.0).toFixed(2) })); worker.postMessage({ type: 'randomize' }); }}>Randomize System</button>
          </div>
        </div>
        <p>
          With only proportional action, steady-state error can remain for constant
          disturbances or friction. In later examples, integral action will remove
          this offset, and derivative action will improve damping.
        </p>
      </div>
      <div ref={el => { graphsContainerRef.current = el as unknown as HTMLElement; }}>
        <details onToggle={(e) => setGraphsOpen((e.target as HTMLDetailsElement).open)}>
          <summary style={{ cursor: 'pointer' }}>Graphs</summary>
          <div className="chart" ref={yPlotRef} />
          <div className="chart" ref={uPlotRef} />
        </details>
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


