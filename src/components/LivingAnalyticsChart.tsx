/**
 * LivingAnalyticsChart — premium interactive analytics landscape.
 * Canvas birds · SVG mountain chart · Framer Motion drag · 60fps RAF
 */
import React, { useRef, useEffect, useState, useMemo, useCallback, useId } from "react";
import { motion, useMotionValue, useSpring } from "framer-motion";

// ─── Constants ────────────────────────────────────────────────────────────────

const PT_W    = 76;
const H       = 300;
const PAD_T   = 52;
const PAD_B   = 26;
const N_BIRDS = 7;
const SCARE_R = 60;
const ORANGE  = "#FF6B00";

// ─── Types ───────────────────────────────────────────────────────────────────

interface DP { label: string; v1: number; v2: number; v3: number }
type BS = "perched" | "flying" | "landing";
interface P  { x: number; y: number }

interface Bird {
  id: number;
  x: number; y: number;
  perchX: number; perchY: number;
  state: BS; timer: number;
  wingPhase: number; breathPhase: number; headBobPhase: number;
  size: number;
  cp0: P; cp1: P; cp2: P; cp3: P;
  flightT: number; flightSpeed: number;
  cooldown: number;
}

// ─── Static Data ─────────────────────────────────────────────────────────────

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function buildData(): DP[] {
  const out: DP[] = [];
  let v1 = 48, v2 = 29, v3 = 16;
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  // seed-like sequence so data is consistent across renders
  let seed = 42;
  const rng = () => { seed = (seed * 16807 + 0) % 2147483647; return (seed - 1) / 2147483646; };
  for (let y = 0; y < 3; y++) {
    for (let m = 0; m < 12; m++) {
      v1 = clamp(v1 + (rng() - 0.43) * 16, 10, 100);
      v2 = clamp(v2 + (rng() - 0.43) * 10, 5, 58);
      v3 = clamp(v3 + (rng() - 0.46) * 7,  3, 32);
      out.push({ label: `${MONTHS[m]} '${22 + y}`, v1: Math.round(v1), v2: Math.round(v2), v3: Math.round(v3) });
    }
  }
  return out;
}

const DATA: DP[] = buildData();

// ─── SVG path helpers ─────────────────────────────────────────────────────────

function buildArea(vals: number[], xOf: (i: number) => number, yOf: (v: number) => number, baseY: number, tension = 0.16): string {
  const n = vals.length;
  if (n < 2) return "";
  const pts = vals.map((v, i): [number, number] => [xOf(i), yOf(v)]);
  let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n - 1, i + 2)];
    const c1x = p1[0] + (p2[0] - p0[0]) * tension, c1y = p1[1] + (p2[1] - p0[1]) * tension;
    const c2x = p2[0] - (p3[0] - p1[0]) * tension, c2y = p2[1] - (p3[1] - p1[1]) * tension;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)},${c2x.toFixed(1)} ${c2y.toFixed(1)},${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d + ` L ${pts[n-1][0].toFixed(1)} ${baseY} L ${pts[0][0].toFixed(1)} ${baseY} Z`;
}

function buildLine(vals: number[], xOf: (i: number) => number, yOf: (v: number) => number, tension = 0.16): string {
  const n = vals.length;
  if (n < 2) return "";
  const pts = vals.map((v, i): [number, number] => [xOf(i), yOf(v)]);
  let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n - 1, i + 2)];
    const c1x = p1[0] + (p2[0] - p0[0]) * tension, c1y = p1[1] + (p2[1] - p0[1]) * tension;
    const c2x = p2[0] - (p3[0] - p1[0]) * tension, c2y = p2[1] - (p3[1] - p1[1]) * tension;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)},${c2x.toFixed(1)} ${c2y.toFixed(1)},${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}

function cbez(p0: P, p1: P, p2: P, p3: P, t: number): P {
  const m = 1 - t;
  return {
    x: m*m*m*p0.x + 3*m*m*t*p1.x + 3*m*t*t*p2.x + t*t*t*p3.x,
    y: m*m*m*p0.y + 3*m*m*t*p1.y + 3*m*t*t*p2.y + t*t*t*p3.y,
  };
}

// ─── Canvas bird drawing ──────────────────────────────────────────────────────

function drawBird(ctx: CanvasRenderingContext2D, b: Bird, dragX: number, dpr: number) {
  // Convert SVG coords → canvas screen coords
  const screenX = (b.x + dragX) * dpr;
  const screenY = b.y * dpr;

  const active = b.state === "flying" || b.state === "landing";
  const flap   = active
    ? Math.sin(b.wingPhase * 2.4) * 0.72
    : Math.sin(b.wingPhase * 0.9) * 0.12;

  const s    = b.size * dpr;
  const span = 22 * s;
  const drop = flap * span * 0.5;

  ctx.save();
  ctx.translate(screenX, screenY);
  ctx.globalAlpha = b.state === "perched" ? 0.60 : 0.85;
  ctx.strokeStyle = "rgba(8,8,8,0.90)";
  ctx.lineCap     = "round";
  ctx.lineWidth   = 2 * s;

  // Left wing
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(-span * 0.4, drop - s, -span * 0.72, drop * 0.22);
  ctx.stroke();

  // Right wing
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(span * 0.4, -drop - s, span * 0.72, -drop * 0.22);
  ctx.stroke();

  // Body
  ctx.fillStyle = "rgba(8,8,8,0.72)";
  ctx.beginPath();
  ctx.ellipse(2.5 * s, 0, 5 * s, 2 * s, 0, 0, Math.PI * 2);
  ctx.fill();

  // Head
  const headBob = active ? 0 : Math.sin(b.headBobPhase) * 2 * s;
  ctx.beginPath();
  ctx.arc(7 * s, -2.5 * s + headBob, 2.8 * s, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// ─── Bird physics ─────────────────────────────────────────────────────────────

function launchBird(b: Bird, mouse: P, peaks: P[]) {
  b.state = "flying"; b.timer = 0; b.flightT = 0;
  b.flightSpeed = 0.006 + Math.random() * 0.004;
  b.cp0 = { x: b.x, y: b.y };

  const adx = b.x - mouse.x, ady = b.y - mouse.y;
  const alen = Math.sqrt(adx * adx + ady * ady) || 1;
  b.cp1 = { x: b.x + (adx / alen) * 90 + (Math.random() - 0.5) * 60, y: b.y - 70 - Math.random() * 50 };

  const far  = peaks.filter(p => Math.abs(p.x - b.x) > 80);
  const dest = far.length ? far[Math.floor(Math.random() * far.length)] : peaks[Math.floor(Math.random() * peaks.length)];

  b.cp2 = { x: (b.cp1.x + dest.x) * 0.5 + (Math.random() - 0.5) * 80, y: Math.min(b.cp1.y, dest.y) - 35 - Math.random() * 30 };
  b.cp3 = { x: dest.x + (Math.random() - 0.5) * 20, y: dest.y - 5 };
}

function tickBird(b: Bird, svgMouse: P, peaks: P[]) {
  b.timer++;
  b.wingPhase    += b.state === "flying" ? 0.15 : 0.025;
  b.breathPhase  += 0.007;
  b.headBobPhase += 0.025;
  if (b.cooldown > 0) b.cooldown--;

  const dx = svgMouse.x - b.x, dy = svgMouse.y - b.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (b.state === "perched") {
    b.y = b.perchY + Math.sin(b.breathPhase) * 1.8;
    if (dist < SCARE_R && b.cooldown === 0) launchBird(b, svgMouse, peaks);

  } else if (b.state === "flying") {
    b.flightT += b.flightSpeed;
    if (b.flightT >= 1) {
      b.state = "landing"; b.timer = 0; b.x = b.cp3.x; b.y = b.cp3.y;
    } else {
      const pos = cbez(b.cp0, b.cp1, b.cp2, b.cp3, b.flightT);
      b.x = pos.x; b.y = pos.y;
    }

  } else if (b.state === "landing") {
    const bounce = Math.sin(b.timer * 0.28) * Math.exp(-b.timer * 0.055) * 5;
    b.y = b.cp3.y + bounce;
    if (b.timer > 55) {
      b.state = "perched"; b.perchX = b.cp3.x; b.perchY = b.cp3.y;
      b.cooldown = 150; b.timer = 0;
    }
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function LivingAnalyticsChart({ className = "" }: { className?: string }) {
  const wrapRef   = useRef<HTMLDivElement>(null);
  const svgRef    = useRef<SVGSVGElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const birdsRef  = useRef<Bird[]>([]);
  const mouseRef  = useRef<P>({ x: -9999, y: -9999 });
  const rafRef    = useRef<number>(0);
  const uid       = useId().replace(/:/g, "u");

  const [containerW, setContainerW] = useState(800);
  const totalW = DATA.length * PT_W;

  // Drag
  const mvX     = useMotionValue(0);
  const springX = useSpring(mvX, { stiffness: 160, damping: 26, mass: 0.9 });
  const minX    = Math.min(-(totalW - containerW), 0);

  // Scales (stable callbacks)
  const maxV = useMemo(() => Math.max(...DATA.map(d => d.v1)) * 1.13, []);
  const xOf  = useCallback((i: number) => i * PT_W + PT_W / 2, []);
  const yOf  = useCallback((v: number) => H - PAD_B - (v / maxV) * (H - PAD_T - PAD_B), [maxV]);

  // Pre-compute SVG paths
  const paths = useMemo(() => ({
    a1: buildArea(DATA.map(d => d.v1), xOf, yOf, H),
    a2: buildArea(DATA.map(d => d.v2), xOf, yOf, H),
    a3: buildArea(DATA.map(d => d.v3), xOf, yOf, H),
    l1: buildLine(DATA.map(d => d.v1), xOf, yOf),
    l2: buildLine(DATA.map(d => d.v2), xOf, yOf),
  }), [xOf, yOf]);

  // Local peaks for bird perching
  const peaks = useMemo<P[]>(() => {
    const ps: P[] = [];
    for (let i = 1; i < DATA.length - 1; i++) {
      if (DATA[i].v1 > DATA[i - 1].v1 && DATA[i].v1 > DATA[i + 1].v1)
        ps.push({ x: xOf(i), y: yOf(DATA[i].v1) });
    }
    if (ps.length < 4) {
      for (let i = 3; i < DATA.length - 3; i += 5)
        ps.push({ x: xOf(i), y: yOf(DATA[i].v1) });
    }
    return ps;
  }, [xOf, yOf]);

  // Resize observer
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setContainerW(e.contentRect.width));
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  // Init birds once peaks are ready
  useEffect(() => {
    if (!peaks.length) return;
    birdsRef.current = Array.from({ length: N_BIRDS }, (_, id) => {
      const pk = peaks[id % peaks.length];
      const px = pk.x + (Math.random() - 0.5) * 18;
      const py = pk.y - 5;
      return {
        id, x: px, y: py, perchX: px, perchY: py,
        state: "perched" as BS,
        timer: Math.floor(Math.random() * 200),
        wingPhase: Math.random() * Math.PI * 2,
        breathPhase: Math.random() * Math.PI * 2,
        headBobPhase: Math.random() * Math.PI * 2,
        size: 1.0 + Math.random() * 0.8,
        cp0: { x: 0, y: 0 }, cp1: { x: 0, y: 0 },
        cp2: { x: 0, y: 0 }, cp3: { x: 0, y: 0 },
        flightT: 0,
        flightSpeed: 0.005 + Math.random() * 0.005,
        cooldown: Math.floor(Math.random() * 80),
      };
    });
  }, [peaks]);

  // RAF loop: birds on canvas + SVG breathing
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let t0 = 0;

    const loop = (ts: number) => {
      if (!t0) t0 = ts;
      const t = (ts - t0) / 1000;

      // ── SVG breathing ──
      if (svgRef.current) {
        svgRef.current.style.transform = `translateY(${(Math.sin(t * 0.38) * 2).toFixed(2)}px)`;
      }

      // ── Canvas birds ──
      const dpr = window.devicePixelRatio || 1;
      const cw  = canvas.width  / dpr;
      const ch  = canvas.height / dpr;
      const ctx = canvas.getContext("2d");
      if (!ctx) { rafRef.current = requestAnimationFrame(loop); return; }

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const dragOffset = springX.get();
      const svgMouse: P = {
        x: mouseRef.current.x - dragOffset,
        y: mouseRef.current.y,
      };

      for (const b of birdsRef.current) {
        tickBird(b, svgMouse, peaks);
        drawBird(ctx, b, dragOffset, dpr);
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [peaks, springX]);

  // Resize canvas with DPR
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap   = wrapRef.current;
    if (!canvas || !wrap) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width  = wrap.offsetWidth  * dpr;
    canvas.height = wrap.offsetHeight * dpr;
    canvas.style.width  = wrap.offsetWidth  + "px";
    canvas.style.height = wrap.offsetHeight + "px";
  }, [containerW]);

  // Stats
  const last = DATA[DATA.length - 1];
  const prev = DATA[DATA.length - 2];
  const pct  = (((last.v1 - prev.v1) / prev.v1) * 100).toFixed(1);
  const up   = last.v1 >= prev.v1;

  return (
    <div
      ref={wrapRef}
      className={`relative w-full bg-white rounded-3xl overflow-hidden select-none border border-gray-100/80 shadow-[0_2px_24px_rgba(0,0,0,0.06)] ${className}`}
      style={{ height: H + 20 }}
      onMouseMove={e => {
        const r = wrapRef.current?.getBoundingClientRect();
        if (!r) return;
        mouseRef.current = { x: e.clientX - r.left, y: e.clientY - r.top };
      }}
      onMouseLeave={() => { mouseRef.current = { x: -9999, y: -9999 }; }}
    >
      {/* Header */}
      <div className="absolute top-0 left-0 z-20 px-6 pt-4 pointer-events-none">
        <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-gray-300">Revenue Landscape</p>
        <div className="flex items-baseline gap-2 mt-0.5">
          <p className="text-[22px] font-black tracking-tight text-gray-900 leading-none">$24,680</p>
          <span className="text-[11px] font-bold" style={{ color: up ? ORANGE : "#9ca3af" }}>
            {up ? "+" : ""}{pct}%
          </span>
        </div>
      </div>

      {/* Legend */}
      <div className="absolute top-4 right-5 z-20 flex items-center gap-3 pointer-events-none">
        {[{ label: "Primary", a: 0.85 }, { label: "Secondary", a: 0.45 }, { label: "Tertiary", a: 0.22 }].map(({ label, a }) => (
          <div key={label} className="flex items-center gap-1.5">
            <div className="h-[3px] w-4 rounded-full" style={{ background: `rgba(255,107,0,${a})` }} />
            <span className="text-[8px] font-medium tracking-wide text-gray-300">{label}</span>
          </div>
        ))}
      </div>

      {/* Drag hint */}
      <div className="absolute bottom-2 right-5 z-20 text-[8px] tracking-widest text-gray-200 pointer-events-none">
        drag to explore →
      </div>

      {/* Draggable SVG chart */}
      <motion.div
        className="absolute inset-0 cursor-grab active:cursor-grabbing"
        drag="x"
        dragConstraints={{ left: minX, right: 0 }}
        dragElastic={0.05}
        dragMomentum
        style={{ x: springX }}
        onDrag={(_, info) => mvX.set(Math.max(minX, Math.min(0, info.offset.x)))}
      >
        <svg
          ref={svgRef}
          width={totalW}
          height={H}
          viewBox={`0 0 ${totalW} ${H}`}
          style={{ display: "block", willChange: "transform" }}
        >
          <defs>
            <linearGradient id={`a1-${uid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"  stopColor={ORANGE} stopOpacity="0.42" />
              <stop offset="90%" stopColor={ORANGE} stopOpacity="0.01" />
            </linearGradient>
            <linearGradient id={`a2-${uid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"  stopColor={ORANGE} stopOpacity="0.22" />
              <stop offset="90%" stopColor={ORANGE} stopOpacity="0.005" />
            </linearGradient>
            <linearGradient id={`a3-${uid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"  stopColor={ORANGE} stopOpacity="0.11" />
              <stop offset="90%" stopColor={ORANGE} stopOpacity="0.002" />
            </linearGradient>
            <filter id={`glow-${uid}`} x="-10%" y="-40%" width="120%" height="180%">
              <feGaussianBlur stdDeviation="2" result="b" />
              <feComposite in="SourceGraphic" in2="b" operator="over" />
            </filter>
          </defs>

          {/* Mountain layers */}
          <path d={paths.a3} fill={`url(#a3-${uid})`} />
          <path d={paths.a2} fill={`url(#a2-${uid})`} />
          <path d={paths.a1} fill={`url(#a1-${uid})`} />

          {/* Stroke lines */}
          <path d={paths.l2} fill="none" stroke={ORANGE} strokeWidth="1"   strokeOpacity="0.28" />
          <path d={paths.l1} fill="none" stroke={ORANGE} strokeWidth="1.6" strokeOpacity="0.65" filter={`url(#glow-${uid})`} />

          {/* Date labels */}
          {DATA.map((d, i) => i % 3 === 0 ? (
            <text key={i} x={xOf(i)} y={H - 9} textAnchor="middle"
              fontSize={7.5} fill="rgba(0,0,0,0.18)"
              fontFamily="system-ui,-apple-system,sans-serif">
              {d.label}
            </text>
          ) : null)}
        </svg>
      </motion.div>

      {/* Canvas overlay for birds (pointer-events none so drag still works) */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 pointer-events-none z-10"
      />
    </div>
  );
}
