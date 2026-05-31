export default function ReportPanel({ report, onExport }) {
  if (!report) return null;

  return (
    <div className="section">
      <div className="section-title">Бизнес-отчёт</div>
      <div className="metrics-grid">
        <div className="metric">
          <div className="metric-label">Обработано заказов</div>
          <div className="metric-val">{report.orders_processed}</div>
        </div>
        <div className="metric">
          <div className="metric-label">Заказов в очереди</div>
          <div className="metric-val">{report.pending_orders}</div>
        </div>
        <div className="metric">
          <div className="metric-label">Средняя пропускная</div>
          <div className="metric-val">{report.avg_throughput} ед/ч</div>
        </div>
        <div className="metric">
          <div className="metric-label">Горячих зон</div>
          <div className="metric-val">{report.hot_zone_count}</div>
        </div>
      </div>
      <button className="export-btn" onClick={onExport}>Экспорт отчёта</button>
    </div>
  );
}
