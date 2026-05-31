import { useEffect, useRef } from "react";

export default function ThroughputChart({ history }) {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !history?.length) return;
    const ctx = canvas.getContext("2d");
    const w = canvas.offsetWidth || 268;
    const h = canvas.offsetHeight || 70;
    canvas.width = w;
    canvas.height = h;

    ctx.clearRect(0, 0, w, h);
    const max = Math.max(...history) + 5;
    const min = Math.max(0, Math.min(...history) - 5);
    const pad = { x: 6, y: 6 };

    const px = (i) => pad.x + (i / (history.length - 1)) * (w - 2 * pad.x);
    const py = (v) => h - pad.y - ((v - min) / (max - min)) * (h - 2 * pad.y);

    ctx.beginPath();
    history.forEach((v, i) => i === 0 ? ctx.moveTo(px(i), py(v)) : ctx.lineTo(px(i), py(v)));
    ctx.strokeStyle = "#378ADD";
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.stroke();

    ctx.lineTo(px(history.length - 1), h);
    ctx.lineTo(px(0), h);
    ctx.closePath();
    ctx.fillStyle = "rgba(55,138,221,0.12)";
    ctx.fill();

    ctx.fillStyle = "#7a8fa6";
    ctx.font = "10px system-ui";
    ctx.fillText("Пропускная способность (ед/ч)", pad.x, 11);
    ctx.textAlign = "right";
    ctx.fillText(Math.round(history.at(-1)), w - pad.x, 11);
  }, [history]);

  return (
    <div className="section">
      <div className="chart-wrap">
        <canvas ref={ref} style={{ width: "100%", height: 70 }} />
      </div>
    </div>
  );
}
