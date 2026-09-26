import { useEffect, useRef } from "react";
import { CORE, FRAME } from "./floors";

const SHELL = "M 5 3.2 H 75.6 V 40 L 60 56.6 H 5 Z";

function doorGeom(room) {
  const door = room.door;
  if (!door) return null;
  const { edge, offset, width } = door;
  if (edge === "s") {
    const x = room.x + offset;
    const y = room.y + room.h;
    return {
      gap: [x, y, x + width, y],
      arc: `M ${x} ${y} A ${width} ${width} 0 0 0 ${x + width} ${y - width}`,
    };
  }
  if (edge === "n") {
    const x = room.x + offset;
    const y = room.y;
    return {
      gap: [x, y, x + width, y],
      arc: `M ${x} ${y} A ${width} ${width} 0 0 1 ${x + width} ${y + width}`,
    };
  }
  if (edge === "w") {
    const x = room.x;
    const y = room.y + offset;
    return {
      gap: [x, y, x, y + width],
      arc: `M ${x} ${y} A ${width} ${width} 0 0 1 ${x + width} ${y + width}`,
    };
  }
  const x = room.x + room.w;
  const y = room.y + offset;
  return {
    gap: [x, y, x, y + width],
    arc: `M ${x} ${y} A ${width} ${width} 0 0 0 ${x - width} ${y + width}`,
  };
}

function Pictogram({ x, y, fill, children }) {
  const size = 1.55;
  return (
    <g transform={`translate(${x - size / 2} ${y - size / 2})`} style={{ pointerEvents: "none" }}>
      <rect width={size} height={size} rx="0.18" fill={fill} />
      <g transform="translate(0.22 0.22) scale(0.046)">
        {children}
      </g>
    </g>
  );
}

function Stairs({ item }) {
  const cx = item.x + item.w / 2;
  const cy = item.y + item.h / 2;
  return (
    <g data-kind="stair" className="map-hit">
      <rect x={item.x} y={item.y} width={item.w} height={item.h} fill="#e7edf3" stroke="#d0d7e2" strokeWidth="0.06" />
      <Pictogram x={cx} y={cy - 0.35} fill="#3b82f6">
        <path d="M8 20h4v-4h4v-4h4V8" fill="none" stroke="#fff" strokeWidth="2.4" />
        <circle cx="8" cy="8" r="2.2" fill="#fff" />
      </Pictogram>
      <text x={cx} y={item.y + item.h - 0.28} textAnchor="middle" fontSize="0.72" fontWeight="700" fill="#1d4ed8" style={{ pointerEvents: "none", stroke: "#ffffff", strokeWidth: 0.22, paintOrder: "stroke" }}>
        Stair
      </text>
    </g>
  );
}

function Elevator({ item, active }) {
  const cx = item.x + item.w / 2;
  const cy = item.y + item.h / 2;
  return (
    <g data-kind="elevator" className="map-hit">
      <rect
        x={item.x}
        y={item.y}
        width={item.w}
        height={item.h}
        fill={active ? "#dbeafe" : "#e7edf3"}
        stroke={active ? "#2563eb" : "#d0d7e2"}
        strokeWidth="0.06"
      />
      <Pictogram x={cx} y={cy - 0.28} fill="#111827">
        <circle cx="8" cy="7" r="2" fill="#fff" />
        <circle cx="16" cy="7" r="2" fill="#fff" />
        <path d="M5 18c.4-3 2-4.5 3-4.5s2.6 1.5 3 4.5H5zM13 18c.4-3 2-4.5 3-4.5s2.6 1.5 3 4.5h-6z" fill="#fff" />
      </Pictogram>
      <text x={cx} y={item.y + item.h - 0.22} textAnchor="middle" fontSize="0.58" fontWeight="700" fill="#111827" style={{ pointerEvents: "none", stroke: "#ffffff", strokeWidth: 0.18, paintOrder: "stroke" }}>
        Elev {item.label}
      </text>
    </g>
  );
}

function shortUse(room) {
  const type = room.type || "";
  if (type.includes("ICU")) return "Intensive care";
  if (type.includes("Trauma")) return "Trauma bay";
  if (type.includes("Exam")) return "Exam room";
  if (type.includes("Operating")) return "Operating room";
  if (type.includes("Med/Surg")) return "Patient room";
  if (type.includes("Observation")) return "Observation";
  if (type.includes("Fast track")) return "Fast track";
  if (room.kind === "restroom") return "Lavatory";
  return type;
}

function RoomTag({ room, selected }) {
  const ink = { pointerEvents: "none", stroke: "rgba(255,255,255,0.9)", strokeWidth: 0.12, paintOrder: "stroke" };
  if (room.kind === "restroom") {
    return (
      <text
        x={room.x + room.w / 2}
        y={room.y + room.h - 0.22}
        textAnchor="middle"
        fontSize="0.7"
        fontWeight="700"
        fill="#92400e"
        style={ink}
      >
        WC
      </text>
    );
  }
  const wide = room.w >= 6.5 || room.h >= 6;
  const title = room.census ? room.id : (room.label || room.type);
  const sub = room.h >= 3.8 && (room.census || wide) ? shortUse(room) : "";
  const titleSize = Math.min(wide ? 1.25 : 1.05, room.w * 0.23, room.h * 0.22);
  const subSize = Math.min(wide ? 0.72 : 0.58, titleSize * 0.62);
  return (
    <g style={{ pointerEvents: "none" }}>
      <text
        x={room.x + room.w / 2}
        y={room.y + room.h / 2 - (sub ? titleSize * 0.15 : titleSize * 0.32)}
        textAnchor="middle"
        fontSize={titleSize}
        fontWeight="700"
        fill={selected ? "#14532d" : "#0f172a"}
        style={ink}
      >
        {title}
      </text>
      {sub && (
        <text
          x={room.x + room.w / 2}
          y={room.y + room.h / 2 + subSize * 1.35}
          textAnchor="middle"
          fontSize={subSize}
          fontWeight="700"
          fill={selected ? "#14532d" : "#1e293b"}
          style={ink}
        >
          {sub}
        </text>
      )}
    </g>
  );
}

function Lavatory({ x, y }) {
  return (
    <Pictogram x={x} y={y} fill="#f59e0b">
      <circle cx="8" cy="6" r="2" fill="#fff" />
      <circle cx="16" cy="6" r="2" fill="#fff" />
      <path d="M5 16c.6-3 2.2-4 3-4s2.4 1 3 4H5zM13 16c.6-3 2.2-4 3-4s2.4 1 3 4h-6z" fill="#fff" />
    </Pictogram>
  );
}

export default function FloorPlan({
  floor,
  deptFilter,
  selectedId,
  showBeds,
  showLabels,
  zoom,
  pan,
  elevatorOpen,
  onPanZoom,
  onSelect,
  onHover,
  onElevator,
  onStair,
}) {
  const svgRef = useRef(null);
  const drag = useRef(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return undefined;
    const stopWheel = (event) => event.preventDefault();
    svg.addEventListener("wheel", stopWheel, { passive: false });
    return () => svg.removeEventListener("wheel", stopWheel);
  }, []);

  function unitsPerPixel() {
    const rect = svgRef.current.getBoundingClientRect();
    return {
      x: FRAME.w / zoom / rect.width,
      y: FRAME.h / zoom / rect.height,
    };
  }

  function pointerDown(event) {
    if (event.button !== 0) return;
    drag.current = {
      x: event.clientX,
      y: event.clientY,
      moved: false,
      pan: { ...pan },
      roomId: event.target.closest?.("[data-room]")?.getAttribute("data-room") || null,
      kind: event.target.closest?.("[data-kind]")?.getAttribute("data-kind") || null,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function pointerMove(event) {
    if (drag.current) {
      const dx = event.clientX - drag.current.x;
      const dy = event.clientY - drag.current.y;
      if (Math.hypot(dx, dy) > 4) drag.current.moved = true;
      const scale = unitsPerPixel();
      onPanZoom(
        {
          x: drag.current.pan.x - dx * scale.x,
          y: drag.current.pan.y - dy * scale.y,
        },
        zoom,
      );
      onHover(null);
      return;
    }
    const node = event.target.closest?.("[data-room]");
    if (!node) {
      onHover(null);
      return;
    }
    const room = floor.rooms.find((item) => item.id === node.getAttribute("data-room"));
    if (room) onHover({ room, x: event.clientX, y: event.clientY });
  }

  function pointerUp() {
    const info = drag.current;
    drag.current = null;
    if (!info || info.moved) return;
    if (info.kind === "elevator") onElevator();
    else if (info.kind === "stair") onStair();
    else if (info.roomId) onSelect(info.roomId);
  }

  const view = {
    x: FRAME.x + pan.x,
    y: FRAME.y + pan.y,
    w: FRAME.w / zoom,
    h: FRAME.h / zoom,
  };

  return (
    <svg
      ref={svgRef}
      className="floor-svg"
      fontFamily="Source Sans 3, Segoe UI, sans-serif"
      viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onPointerLeave={() => onHover(null)}
      role="img"
      aria-label={`${floor.name} floor plan`}
    >
      <defs>
        <clipPath id="plate">
          <path d={SHELL} />
        </clipPath>
        <filter id="plate-shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="0.35" stdDeviation="0.45" floodColor="#94a3b8" floodOpacity="0.45" />
        </filter>
      </defs>

      <rect x={FRAME.x} y={FRAME.y} width={FRAME.w} height={FRAME.h} fill="#ffffff" />
      <path d={SHELL} fill="#ffffff" stroke="#e7ebf0" strokeWidth="0.45" filter="url(#plate-shadow)" />
      <g clipPath="url(#plate)">
        {floor.rooms.map((room) => {
          const dim = deptFilter !== "all" && room.dept !== deptFilter;
          const selected = room.id === selectedId;
          const picked = floor.rooms.find((item) => item.id === selectedId);
          const sameWing = Boolean(picked && room.dept === picked.dept && room.kind !== "restroom");
          const door = doorGeom(room);
          let fill = "#d9dee6";
          if (sameWing) fill = "#c5e4f6";
          if (selected) fill = "#c8f0d4";
          if (room.kind === "restroom") fill = "#eef2f6";
          return (
            <g key={room.id} data-room={room.id} className="map-hit" opacity={dim ? 0.3 : 1}>
              <rect
                x={room.x}
                y={room.y}
                width={room.w}
                height={room.h}
                fill={fill}
                stroke={selected ? "#15803d" : "#9aabbd"}
                strokeWidth={selected ? 0.14 : 0.07}
                strokeDasharray={selected ? "0.32 0.18" : undefined}
              />
              {door && (
                <line
                  x1={door.gap[0]}
                  y1={door.gap[1]}
                  x2={door.gap[2]}
                  y2={door.gap[3]}
                  stroke="#ffffff"
                  strokeWidth="0.22"
                  style={{ pointerEvents: "none" }}
                />
              )}
              {room.kind === "restroom" && (
                <Lavatory x={room.x + room.w / 2} y={room.y + room.h / 2 - 0.15} />
              )}
              {showLabels && <RoomTag room={room} selected={selected} />}
            </g>
          );
        })}

        {CORE.map((item) =>
          item.kind === "stair" ? (
            <Stairs key={item.id} item={item} />
          ) : (
            <Elevator key={item.id} item={item} active={elevatorOpen} />
          ),
        )}
      </g>

      <text
        x="66"
        y="60.5"
        textAnchor="end"
        fontSize="4.2"
        fontWeight="700"
        fill="#e5e7eb"
        style={{ pointerEvents: "none" }}
      >
        {floor.code === "B1" ? "B1" : `${floor.code.replace("F", "")}F`}
      </text>
    </svg>
  );
}
