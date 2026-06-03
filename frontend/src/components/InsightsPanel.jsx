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
          <div className="metric-label">Погрузчик с низким зарядом</div>
          <div className="metric-val">{insights.low_battery.length}</div>
          <div className="metric-sub">менее 30%</div>
        </div>
        <div className="metric">
          <div className="metric-label">Предиктивное ТО</div>
          <div className="metric-val">{insights.maintenance_due?.length || 0}</div>
          <div className="metric-sub">wear / due date</div>
        </div>
        <div className="metric">
          <div className="metric-label">Expiry risk</div>
          <div className="metric-val">{insights.expiring_soon?.length || 0}</div>
          <div className="metric-sub">до 30 дней</div>
        </div>
        <div className="metric">
          <div className="metric-label">Конгестия</div>
          <div className="metric-val">{insights.congestion?.length || 0}</div>
          <div className="metric-sub">ожидание в проходах</div>
        </div>
      </div>

      <div className="insights-list">
        {insights.recommendations.map((item, index) => (
          <div key={index} className="insight-item">
            {item}
          </div>
        ))}
      </div>

      {insights.hot_cells?.length > 0 && (
        <div className="insights-list">
          <div className="section-title">Тепловая карта активности</div>
          {insights.hot_cells.slice(0, 5).map((cell) => (
            <div key={cell.id} className="insight-item">
              {cell.id}: {cell.activity_count} событий · {cell.zone_type} · {cell.sku || "empty"}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
