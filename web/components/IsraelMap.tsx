// Hand-drawn Israel silhouette used across the app (welcome hero + result map
// panel). The outline path and pin positions come straight from the design doc.
// Pins are decorative region anchors — the app has no per-trip geo-coordinates,
// so the map orients the user to the country/region rather than plotting exact
// waypoints.

export const ISRAEL_OUTLINE =
  "M347 44 L354 46 L352 67 L354 74 L364 87 L358 106 L365 113 L365 122 L355 147 L335 168 L327 171 L327 207 L333 248 L330 260 L333 303 L323 317 L318 349 L324 380 L319 394 L324 409 L321 425 L326 431 L320 441 L320 450 L304 493 L305 560 L297 590 L291 646 L282 660 L275 663 L268 650 L268 638 L263 619 L249 593 L247 580 L228 537 L214 522 L215 515 L207 491 L172 410 L170 400 L181 389 L184 370 L202 350 L195 340 L211 309 L218 288 L239 185 L239 148 L242 144 L248 145 L252 140 L255 104 L276 99 L284 99 L290 104 L303 100 L309 91 L310 68 L316 66 L322 70 L331 59 L342 53 L347 44 Z";

export interface MapPin {
  left: number; // %
  top: number; // %
  label: string;
  color?: string;
  labelSide?: "left" | "right";
  active?: boolean;
}

const REGION_PINS: MapPin[] = [
  { left: 61.4, top: 8.8, label: "Galilee", labelSide: "right" },
  { left: 39.4, top: 46.3, label: "Tel Aviv", labelSide: "left" },
  { left: 48.8, top: 82.3, label: "Negev", labelSide: "left" },
  { left: 51.2, top: 97, label: "Eilat", labelSide: "right", color: "var(--terra)" },
];

function Pin({ pin }: { pin: MapPin }) {
  const color = pin.color ?? "var(--olive)";
  const labelStyle: React.CSSProperties =
    pin.labelSide === "left"
      ? { right: 11 }
      : { left: 11 };
  return (
    <div className="tm-pin" style={{ left: `${pin.left}%`, top: `${pin.top}%` }}>
      <div className="tm-pin-dot" style={{ background: color }} />
      <span
        className="tm-pin-label"
        style={{
          ...labelStyle,
          ...(pin.active ? { background: "var(--ink-2)", color: "#eef1e6", borderColor: "var(--ink-2)" } : {}),
        }}
      >
        {pin.label}
      </span>
    </div>
  );
}

export default function IsraelMap({
  pins = REGION_PINS,
  strokeWidth = 2.2,
  glow = false,
}: {
  pins?: MapPin[];
  strokeWidth?: number;
  glow?: boolean;
}) {
  return (
    <div className="tm-israel" style={{ width: "100%", height: "100%" }}>
      {glow && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "radial-gradient(circle at 50% 45%,#e9ecdb,var(--paper) 72%)",
            borderRadius: "50%",
          }}
        />
      )}
      <svg viewBox="160 34 215 639" aria-hidden="true">
        <path
          d={ISRAEL_OUTLINE}
          fill="none"
          stroke="#3d5a40"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {pins.map((p) => (
        <Pin key={p.label} pin={p} />
      ))}
    </div>
  );
}
