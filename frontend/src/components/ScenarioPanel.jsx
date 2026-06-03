const SCENARIOS = [
  { id: "normal",   icon: "⚙️", name: "Обычный",  desc: "Штатный режим" },
  { id: "surge",    icon: "📈", name: "Летний сезон",   desc: "+400% заказов" },
  { id: "agv_fail", icon: "🤖", name: "Отказ Погрузчиков", desc: "2 из 6 работают" },
  { id: "low_staff",icon: "👤", name: "Нехватка",  desc: "55% персонала" },
];

export default function ScenarioPanel({ current, onSelect }) {
  return (
    <div className="section">
      <div className="section-title">Сценарии (what-if)</div>
      <div className="scenario-grid">
        {SCENARIOS.map((s) => (
          <button
            key={s.id}
            className={`scn-btn ${current === s.id ? "active" : ""}`}
            onClick={() => onSelect(s.id)}
          >
            <div className="scn-icon">{s.icon}</div>
            <div className="scn-name">{s.name}</div>
            <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 1 }}>{s.desc}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
