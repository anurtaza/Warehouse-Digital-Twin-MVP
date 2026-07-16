export default function MetricsBar({ metrics }) {
  const alertColor = metrics.hot_zones >= 5 ? "#c0392b" : metrics.hot_zones >= 3 ? "#e67e22" : "#27ae60";
  const fillDelta = metrics.benchmarks?.fill_delta ?? 0;
  const throughputDelta = metrics.benchmarks?.throughput_delta ?? 0;
  const healthScore = Math.max(60, Math.min(100, 100 - (metrics.hot_zones || 0) * 4 - (metrics.congestion_points || 0) * 3 + (metrics.benchmarks?.fifo_compliance >= 95 ? 5 : 0)));
  const healthReasons = [
    metrics.benchmarks?.fifo_compliance >= 95 ? "Good FIFO" : "FIFO drift",
    metrics.hot_zones >= 3 ? "High congestion" : "Balanced flow",
    metrics.pending_orders >= 10 ? "Two delayed trucks" : "Stable dispatch",
  ];

  return (
    <div className="section">
      <div className="section-title">Warehouse health</div>
      <div className="health-card">
        <div className="health-score">{healthScore}<span>/100</span></div>
        <div className="health-copy">Warehouse Health</div>
        <div className="health-reasons">
          {healthReasons.map((reason) => <span key={reason}>{reason}</span>)}
        </div>
      </div>
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
        <div className="metric">
          <div className="metric-label">Fill rate vs CCI</div>
          <div className="metric-val">{fillDelta > 0 ? `+${fillDelta}` : fillDelta}%</div>
          <div className="metric-sub">цель {metrics.benchmarks?.fill_target ?? 90}%</div>
        </div>
        <div className="metric">
          <div className="metric-label">Throughput vs план</div>
          <div className="metric-val">{throughputDelta > 0 ? `+${throughputDelta}` : throughputDelta}</div>
          <div className="metric-sub">цель {metrics.benchmarks?.throughput_target ?? 60} ед/ч</div>
        </div>
        <div className="metric">
          <div className="metric-label">FIFO compliance</div>
          <div className="metric-val">{metrics.benchmarks?.fifo_compliance ?? 100}%</div>
          <div className="metric-sub">FEFO по сроку годности</div>
        </div>
        <div className="metric">
          <div className="metric-label">CCI риски</div>
          <div className="metric-val">{(metrics.expiring_soon || 0) + (metrics.maintenance_due || 0) + (metrics.congestion_points || 0)}</div>
          <div className="metric-sub">expiry / ТО / конгестия</div>
        </div>
      </div>
    </div>
  );
}
