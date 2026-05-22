/**
 * LivingAnalyticsChart — premium interactive analytics landscape.
 * Orange (#FF6B00) palette · Framer Motion drag · SVG birds · 60fps
 */
import React, {
  useRef, useEffect, useState, useMemo, useCallback, useId,
} from "react";
import {
  motion, useMotionValue, useSpring, useAnimationFrame,
} from "framer-motion";

// ─── Constants ────────────────────────────────────────────────────────────────

const PT_W   = 76;   // px per data point
const H      = 300;  // svg height
const PAD_T  = 52;   // top padding (header clearance)
const PAD_B  = 26;   // bottom padding (labels)
const N_BIRDS = 7;
const SCARE_R = 78;  // mouse scare radius (px)
const ORANGE  = "#FF6B00";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DataPoint { label: string; v1: number; v2: number; v3: number }
type BirdState = "perched" | "flying" | "landing";

interface Bird {
  id: number;
  x: number; y: number;
  perchX: number; perchY: number;
  state: BirdState;
  timer: number;
  wingPhase: number;
  breathPhase: number;
  headBobPhase: number;
  size: number;
  // Cubic bezier flight curve
  cp0: P; cp1: P; cp2: P; cp3: P;
  flightT: number;
  flightSpeed: number;
  cooldown: number; // frames before can be scared again
}

interface P { x: number; y: number }

// ─── Dummy Data ───────────────────────────────────────────────────────────────

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function buildData(): DataPoint[] {
  const out: DataPoint[] = [];
  let v1 = 48, v2 = 29, v3 = 16;
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  for (let y = 0; y < 3; y++) {
    for (let m = 0; m < 12; m++) {
      v1 = clamp(v1 + (Math.random() - 0.43) * 16, 10, 100);
      v2 = clamp(v2 + (Math.random() - 0.43) * 10, 5,  58);
      v3 = clamp(v3 + (Math.random() - 0.46) * 7,  3,  32);
      out.push({
        label: `${MONTHS[m]} '${22 + y}`,
        v1: Math.round(v1),
        v2: Math.round(v2),
        v3: Math.round(v3),
      });
    }
  }
  return out;
}

const DATA: DataPoint[] = buildData();

// ─── SVG Math ─────────────────────────────────────────────────────────────────

/** Catmull-Rom → cubic bezier, closed at bottom → area shape */
function buildArea(
  vals: number[],
  xOf: (i: number) => number,
  yOf: (v: number) => number,
  baseY: number,
  tension = 0.16,
): string {
  const n = vals.length;
  if (n < 2) return "";
  const pts = vals.map((v, i): [number, number] => [xOf(i), yOf(v)]);
  let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(n - 1, i + 2)];
    const c1x = p1[0] + (p2[0] - p0[0]) * tension;
    const c1y = p1[1] + (p2[1] - p0[1]) * tension;
    const c2x = p2[0] - (p3[0] - p1[0]) * tension;
    const c2y = p2[1] - (p3[1] - p1[1]) * tension;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  d += ` L ${pts[n - 1][0].toFixed(1)} ${baseY} L ${pts[0][0].toFixed(1)} ${baseY} Z`;
  return d;
}

/** Same curve but open (stroke only) */
function buildLine(
  vals: number[],
  xOf: (i: number) => number,
  yOf: (v: number) => number,
  tension = 0.16,
): string {
  const n = vals.length;
  if (n < 2) return "";
  const pts = vals.map((v, i): [number, number] => [xOf(i), yOf(v)]);
  let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(n - 1, i + 2)];
    const c1x = p1[0] + (p2[0] - p0[0]) * tension;
    const c1y = p1[1] + (p2[1] - p0[1]) * tension;
    const c2x = p2[0] - (p3[0] - p1[0]) * tension;
    const c2y = p2[1] - (p3[1] - p1[1]) * tension;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}

/** Cubic bezier interpolation */
function cbez(p0: P, p1: P, p2: P, p3: P, t: number): P {
  const m = 1 - t;
  return {
    x: m*m*m*p0.x + 3*m*m*t*p1.x + 3*m*t*t*p2.x + t*t*t*p3.x,
    y: m*m*m*p0.y + 3*m*m*t*p1.y + 3*m*t*t*p2.y + t*t*t*p3.y,
  };
}

// ─── Bird DOM helpers (no re-render) ─────────────────────────────────────────

const NS = "http://www.w3.org/2000/svg";

function paintBird(g: SVGGElement, bird: Bird) {
  while (g.firstChild) g.removeChild(g.firstChild);

  const { wingPhase, state, size } = bird;
  const flying = state === "flying";
  const landing = state === "landing";
  const active = flying || landing;

  // Wing flap: fast when flying, idle tremor when perched
  const flap = active
    ? Math.sin(wingPhase * 2.4) * 0.68
    : Math.sin(wingPhase * 0.9) * 0.10;

  const span = 11 * size;
  const drop = flap * span * 0.5;

  // Wings
  const lw = document.createElementNS(NS, "path");
  lw.setAttribute("d",
    `M 0 0 Q ${(-span * 0.38).toFixed(1)} ${(drop - 0.5).toFixed(1)} ${(-span * 0.65).toFixed(1)} ${(drop * 0.28).toFixed(1)}`
  );
  lw.setAttribute("stroke", "rgba(10,10,10,0.85)");
  lw.setAttribute("stroke-width", `${(1.15 * size).toFixed(2)}`);
  lw.setAttribute("fill", "none");
  lw.setAttribute("stroke-linecap", "round");

  const rw = document.createElementNS(NS, "path");
  rw.setAttribute("d",
    `M 0 0 Q ${(span * 0.38).toFixed(1)} ${(-drop - 0.5).toFixed(1)} ${(span * 0.65).toFixed(1)} ${(-drop * 0.28).toFixed(1)}`
  );
  rw.setAttribute("stroke", "rgba(10,10,10,0.85)");
  rw.setAttribute("stroke-width", `${(1.15 * size).toFixed(2)}`);
  rw.setAttribute("fill", "none");
  rw.setAttribute("stroke-linecap", "round");

  // Body
  const body = document.createElementNS(NS, "ellipse");
  body.setAttribute("cx", `${(1.2 * size).toFixed(1)}`);
  body.setAttribute("cy", "0");
  body.setAttribute("rx", `${(2.8 * size).toFixed(1)}`);
  body.setAttribute("ry", `${(1.1 * size).toFixed(1)}`);
  body.setAttribute("fill", "rgba(10,10,10,0.72)");

  // Head
  const head = document.createElementNS(NS, "circle");
  head.setAttribute("cx", `${(3.5 * size).toFixed(1)}`);
  const headBob = active ? 0 : Math.sin(bird.headBobPhase) * 1.2;
  head.setAttribute("cy", `${(-1.2 * size + headBob).toFixed(1)}`);
  head.setAttribute("r", `${(1.3 * size).toFixed(1)}`);
  head.setAttribute("fill", "rgba(10,10,10,0.75)");

  g.appendChild(body);
  g.appendChild(lw);
  g.appendChild(rw);
  g.appendChild(head);
}

function launchBird(b: Bird, mouse: P, peaks: P[]) {
  b.state = "flying";
  b.timer = 0;
  b.flightT = 0;
  b.flightSpeed = 0.0055 + Math.random() * 0.0045;

  b.cp0 = { x: b.x, y: b.y };

  // Escape direction: away from mouse + upward arc
  const adx = b.x - mouse.x;
  const ady = b.y - mouse.y;
  const alen = Math.sqrt(adx * adx + ady * ady) || 1;
  b.cp1 = {
    x: b.x + (adx / alen) * 90 + (Math.random() - 0.5) * 70,
    y: b.y - 65 - Math.random() * 55,
  };

  // Destination: random peak that isn't too close to current position
  const far = peaks.filter(p => Math.abs(p.x - b.x) > 80);
  const dest = far.length
    ? far[Math.floor(Math.random() * far.length)]
    : peaks[Math.floor(Math.random() * peaks.length)];

  b.cp2 = {
    x: (b.cp1.x + dest.x) * 0.5 + (Math.random() - 0.5) * 90,
    y: Math.min(b.cp1.y, dest.y) - 35 - Math.random() * 35,
  };

  b.cp3 = {
    x: dest.x + (Math.random() - 0.5) * 22,
    y: dest.y - 4,
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

interface LivingAnalyticsChartProps {
  className?: string;
}

export default function LivingAnalyticsChart({ className = "" }: LivingAnalyticsChartProps) {
  const wrapRef    = useRef<HTMLDivElement>(null);
  const svgRef     = useRef<SVGSVGElement>(null);
  const birdRefs   = useRef<(SVGGElement | null)[]>(new Array(N_BIRDS).fill(null));
  const birdsRef   = useRef<Bird[]>([]);
  const mouseRef   = useRef<P>({ x: -9999, y: -9999 });

  const [containerW, setContainerW] = useState(800);
  const uid = useId().replace(/:/g, "x");

  const totalW = DATA.length * PT_W;

  // Drag
  const mvX    = useMotionValue(0);
  const springX = useSpring(mvX, { stiffness: 160, damping: 26, mass: 0.9 });
  const minX   = Math.min(-(totalW - containerW), 0);

  // Scales
  const maxV = useMemo(() => Math.max(...DATA.map(d => d.v1)) * 1.13, []);
  const xOf  = useCallback((i: number) => i * PT_W + PT_W / 2, []);
  const yOf  = useCallback((v: number) =>
    H - PAD_B - (v / maxV) * (H - PAD_T - PAD_B), [maxV]);

  // Pre-computed paths (never change)
  const paths = useMemo(() => ({
    a1: buildArea(DATA.map(d => d.v1), xOf, yOf, H),
    a2: buildArea(DATA.map(d => d.v2), xOf, yOf, H),
    a3: buildArea(DATA.map(d => d.v3), xOf, yOf, H),
    l1: buildLine(DATA.map(d => d.v1), xOf, yOf),
    l2: buildLine(DATA.map(d => d.v2), xOf, yOf),
  }), [xOf, yOf]);

  // Local peaks → bird perch positions
  const peaks = useMemo<P[]>(() => {
    const ps: P[] = [];
    for (let i = 1; i < DATA.length - 1; i++) {
      if (DATA[i].v1 > DATA[i - 1].v1 && DATA[i].v1 > DATA[i + 1].v1) {
        ps.push({ x: xOf(i), y: yOf(DATA[i].v1) });
      }
    }
    if (ps.length < 4) {
      for (let i = 3; i < DATA.length - 3; i += 5) {
        ps.push({ x: xOf(i), y: yOf(DATA[i].v1) });
      }
    }
    return ps;
  }, [xOf, yOf]);

  // Init birds when peaks are ready
  useEffect(() => {
    if (!peaks.length) return;
    birdsRef.current = Array.from({ length: N_BIRDS }, (_, id) => {
      const pk = peaks[id % peaks.length];
      const px = pk.x + (Math.random() - 0.5) * 20;
      const py = pk.y - 4;
      return {
        id, x: px, y: py, perchX: px, perchY: py,
        state: "perched",
        timer: Math.floor(Math.random() * 180),
        wingPhase: Math.random() * Math.PI * 2,
        breathPhase: Math.random() * Math.PI * 2,
        headBobPhase: Math.random() * Math.PI * 2,
        size: 0.6 + Math.random() * 0.6,
        cp0: { x: 0, y: 0 }, cp1: { x: 0, y: 0 },
        cp2: { x: 0, y: 0 }, cp3: { x: 0, y: 0 },
        flightT: 0,
        flightSpeed: 0.005 + Math.random() * 0.004,
        cooldown: 0,
      } as Bird;
    });
  }, [peaks]);

  // Resize observer
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setContainerW(e.contentRect.width));
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  // ── RAF: birds + breathing ─────────────────────────────────────────────────
  useAnimationFrame((elapsed) => {
    const t = elapsed / 1000;
    const birds = birdsRef.current;
    const refs  = birdRefs.current;
    if (!birds.length || !peaks.length) return;

    const dragOff = springX.get();
    // Convert screen mouse to SVG coordinates
    const svgMouse: P = {
      x: mouseRef.current.x - dragOff,
      y: mouseRef.current.y,
    };

    for (let idx = 0; idx < birds.length; idx++) {
      const b = birds[idx];
      b.timer++;
      b.wingPhase     += b.state === "flying" ? 0.15  : 0.025;
      b.breathPhase   += 0.007;
      b.headBobPhase  += 0.025;
      if (b.cooldown > 0) b.cooldown--;

      const dx   = svgMouse.x - b.x;
      const dy   = svgMouse.y - b.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (b.state === "perched") {
        // Subtle breath float
        b.y = b.perchY + Math.sin(b.breathPhase) * 1.5;

        // Scared by mouse
        if (dist < SCARE_R && b.cooldown === 0) {
          launchBird(b, svgMouse, peaks);
        }

      } else if (b.state === "flying") {
        b.flightT += b.flightSpeed;

        if (b.flightT >= 1) {
          b.state = "landing";
          b.timer = 0;
          b.x = b.cp3.x;
          b.y = b.cp3.y;
        } else {
          const pos = cbez(b.cp0, b.cp1, b.cp2, b.cp3, b.flightT);
          b.x = pos.x;
          b.y = pos.y;
        }

      } else if (b.state === "landing") {
        // Spring-bounce settle
        const bounce = Math.sin(b.timer * 0.28) * Math.exp(-b.timer * 0.055) * 4;
        b.y = b.cp3.y + bounce;

        if (b.timer > 55) {
          b.state    = "perched";
          b.perchX   = b.cp3.x;
          b.perchY   = b.cp3.y;
          b.cooldown = 140;
          b.timer    = 0;
        }
      }

      // Update DOM directly (zero re-renders)
      const g = refs[idx];
      if (!g) continue;
      g.setAttribute("transform", `translate(${b.x.toFixed(1)},${b.y.toFixed(1)})`);
      g.setAttribute("opacity", b.state === "perched" ? "0.55" : "0.80");
      paintBird(g, b);
    }

    // Whole-chart breathing (1-2px gentle float)
    if (svgRef.current) {
      const breathY = Math.sin(t * 0.38) * 1.9;
      svgRef.current.style.transform = `translateY(${breathY.toFixed(2)}px)`;
    }
  });

  // ── Latest total ──────────────────────────────────────────────────────────
  const latestV = DATA[DATA.length - 1].v1;
  const prevV   = DATA[DATA.length - 2].v1;
  const pct     = ((latestV - prevV) / prevV * 100).toFixed(1);
  const up      = latestV >= prevV;

  return (
    <div
      ref={wrapRef}
      className={`relative w-full bg-white rounded-3xl overflow-hidden select-none border border-gray-100/80 shadow-[0_2px_24px_rgba(0,0,0,0.06)] ${className}`}
      style={{ height: H + 20 }}
      onMouseMove={(e) => {
        const r = wrapRef.current?.getBoundingClientRect();
        if (!r) return;
        mouseRef.current = { x: e.clientX - r.left, y: e.clientY - r.top };
      }}
      onMouseLeave={() => { mouseRef.current = { x: -9999, y: -9999 }; }}
    >
      {/* ── Header ── */}
      <div className="absolute top-0 left-0 z-10 px-6 pt-4 pointer-events-none">
        <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-gray-300">
          Revenue Landscape
        </p>
        <div className="flex items-baseline gap-2 mt-0.5">
          <p className="text-[22px] font-black tracking-tight text-gray-900 leading-none">
            $24,680
          </p>
          <span
            className="text-[11px] font-bold"
            style={{ color: up ? ORANGE : "#9ca3af" }}
          >
            {up ? "+" : ""}{pct}%
          </span>
        </div>
      </div>

      {/* ── Legend ── */}
      <div className="absolute top-4 right-5 z-10 flex items-center gap-3 pointer-events-none">
        {[
          { label: "Primary",   alpha: 0.85 },
          { label: "Secondary", alpha: 0.45 },
          { label: "Tertiary",  alpha: 0.22 },
        ].map(({ label, alpha }) => (
          <div key={label} className="flex items-center gap-1.5">
            <div
              className="h-[3px] w-4 rounded-full"
              style={{ background: `rgba(255,107,0,${alpha})` }}
            />
            <span className="text-[8px] font-medium tracking-wide text-gray-300">{label}</span>
          </div>
        ))}
      </div>

      {/* ── Drag hint ── */}
      <div className="absolute bottom-2 right-5 z-10 text-[8px] tracking-widest text-gray-200 pointer-events-none">
        drag to explore →
      </div>

      {/* ── Draggable chart ── */}
      <motion.div
        className="absolute inset-0 cursor-grab active:cursor-grabbing"
        drag="x"
        dragConstraints={{ left: minX, right: 0 }}
        dragElastic={0.05}
        dragMomentum
        style={{ x: springX }}
        onDrag={(_, info) => {
          mvX.set(Math.max(minX, Math.min(0, info.offset.x)));
        }}
      >
        <svg
          ref={svgRef}
          width={totalW}
          height={H}
          viewBox={`0 0 ${totalW} ${H}`}
          style={{ display: "block", willChange: "transform" }}
        >
          <defs>
            {/* Mountain gradients */}
            <linearGradient id={`ga1-${uid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor={ORANGE} stopOpacity="0.42" />
              <stop offset="88%"  stopColor={ORANGE} stopOpacity="0.01" />
            </linearGradient>
            <linearGradient id={`ga2-${uid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor={ORANGE} stopOpacity="0.22" />
              <stop offset="88%"  stopColor={ORANGE} stopOpacity="0.005" />
            </linearGradient>
            <linearGradient id={`ga3-${uid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor={ORANGE} stopOpacity="0.11" />
              <stop offset="88%"  stopColor={ORANGE} stopOpacity="0.002" />
            </linearGradient>
            {/* Soft glow filter for line */}
            <filter id={`glow-${uid}`} x="-10%" y="-40%" width="120%" height="180%">
              <feGaussianBlur stdDeviation="2.5" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
            {/* Tiny blur for perched birds */}
            <filter id={`bblur-${uid}`} x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="0.45" />
            </filter>
          </defs>

          {/* ── Mountain layers (back→front) ── */}
          <path d={paths.a3} fill={`url(#ga3-${uid})`} />
          <path d={paths.a2} fill={`url(#ga2-${uid})`} />
          <path d={paths.a1} fill={`url(#ga1-${uid})`} />

          {/* ── Line strokes ── */}
          <path
            d={paths.l2}
            fill="none"
            stroke={ORANGE}
            strokeWidth="1"
            strokeOpacity="0.28"
          />
          <path
            d={paths.l1}
            fill="none"
            stroke={ORANGE}
            strokeWidth="1.6"
            strokeOpacity="0.65"
            filter={`url(#glow-${uid})`}
          />

          {/* ── Month labels ── */}
          {DATA.map((d, i) =>
            i % 3 === 0 ? (
              <text
                key={i}
                x={xOf(i)}
                y={H - 9}
                textAnchor="middle"
                fontSize={7.5}
                fill="rgba(0,0,0,0.18)"
                fontFamily="system-ui,-apple-system,sans-serif"
                letterSpacing="0.4"
              >
                {d.label}
              </text>
            ) : null
          )}

          {/* ── Bird containers (DOM-mutated each frame) ── */}
          {Array.from({ length: N_BIRDS }, (_, i) => (
            <g
              key={i}
              ref={el => { birdRefs.current[i] = el; }}
              filter={`url(#bblur-${uid})`}
            />
          ))}
        </svg>
      </motion.div>
    </div>
  );
}
