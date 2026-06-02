export default function MetricsBar({ metrics }) {
  const alertColor = metrics.hot_zones >= 5 ? "#c0392b" : metrics.hot_zones >= 3 ? "#e67e22" : "#27ae60";
  return (
    <div className="section">
      <div className="section-title">Метрики в реальном времени</div>
      <div className="metrics-grid">
        <div className="metric">
          <div className="metric-label">Заполненность</div>
          <div className="metric-val">{metrics.fill_pct}%</div>
          <div className="metric-sub">{metrics.filled} / {metrics.total} ячеек</div>
        </div>
        <div className="metric">
          <div className="metric-label">Погрузчиков активно</div>
          <div className="metric-val">{metrics.agv_active}/{metrics.agv_total}</div>
          <div className="metric-sub">{metrics.agv_total - metrics.agv_active} на зарядке</div>
        </div>
        <div className="metric">
          <div className="metric-label">Заказов сегодня</div>
          <div className="metric-val">{metrics.orders_total}</div>
          <div className="metric-sub">выполнено: {metrics.orders_done}</div>
        </div>
        <div className="metric">
          <div className="metric-label">Узких мест</div>
          <div className="metric-val" style={{ color: alertColor }}>{metrics.hot_zones}</div>
          <div className="metric-sub">{metrics.throughput} ед/ч</div>
        </div>
      </div>
    </div>
  );
}
