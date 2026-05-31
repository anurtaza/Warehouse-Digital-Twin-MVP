export default function InsightsPanel({ insights }) {
  if (!insights) return null;

  return (
    <div className="section">
      <div className="section-title">Инсайты и рекомендации</div>
      <div className="metrics-grid">
        <div className="metric">
          <div className="metric-label">Незавершённых заказов</div>
          <div className="metric-val">{insights.pending_orders}</div>
          <div className="metric-sub">Ожидают обработки</div>
        </div>
        <div className="metric">
          <div className="metric-label">Тренд пропускной способности</div>
          <div className="metric-val">{insights.throughput_trend > 0 ? `+${insights.throughput_trend}` : insights.throughput_trend} ед/ч</div>
          <div className="metric-sub">Последнее обновление</div>
        </div>
        <div className="metric">
          <div className="metric-label">AGV с низким зарядом</div>
          <div className="metric-val">{insights.low_battery.length}</div>
          <div className="metric-sub">менее 30%</div>
        </div>
      </div>

      <div className="insights-list">
        {insights.recommendations.map((item, index) => (
          <div key={index} className="insight-item">
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}
