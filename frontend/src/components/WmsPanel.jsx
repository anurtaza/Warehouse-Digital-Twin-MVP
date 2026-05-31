export default function WmsPanel({ wms }) {
  if (!wms) return null;

  return (
    <div className="section">
      <div className="section-title">WMS-интеграция</div>
      <div className="metrics-grid">
        <div className="metric">
          <div className="metric-label">Последний синхрон</div>
          <div className="metric-val">{new Date(wms.last_sync).toLocaleTimeString()}</div>
          <div className="metric-sub">время сервера</div>
        </div>
        <div className="metric">
          <div className="metric-label">Уникальных SKU</div>
          <div className="metric-val">{wms.unique_skus}</div>
          <div className="metric-sub">товаров на складе</div>
        </div>
        <div className="metric">
          <div className="metric-label">В очереди заказов</div>
          <div className="metric-val">{wms.pending_orders}</div>
          <div className="metric-sub">статус pending / picking</div>
        </div>
        <div className="metric">
          <div className="metric-label">Всего на складе</div>
          <div className="metric-val">{wms.inventory_total}</div>
          <div className="metric-sub">единиц</div>
        </div>
      </div>
      <div className="section-title" style={{ marginTop: 12 }}>Последние заказы</div>
      {wms.orders.slice(0, 5).map((order) => (
        <div key={order.id} className="event-item">
          <span className="event-time">{order.id}</span>
          <span className="event-msg">{order.sku} ×{order.qty} · {order.status}</span>
        </div>
      ))}
    </div>
  );
}
