const LEVEL_COLORS = {
  info: "#27ae60",
  warning: "#e67e22",
  error: "#c0392b",
};

export default function EventLog({ events }) {
  return (
    <div className="section event-log" style={{ borderBottom: "none", padding: 0 }}>
      <div className="section-title" style={{ padding: "10px 16px 0" }}>Лог событий</div>
      {events.map((ev, i) => {
        const t = new Date(ev.ts);
        const time = `${String(t.getHours()).padStart(2,"0")}:${String(t.getMinutes()).padStart(2,"0")}`;
        const color = LEVEL_COLORS[ev.level] || "#378ADD";
        return (
          <div key={i} className="event-item">
            <span className="event-time">{time}</span>
            <div className="event-dot" style={{ background: color }} />
            <span className="event-msg">{ev.msg}</span>
          </div>
        );
      })}
    </div>
  );
}
