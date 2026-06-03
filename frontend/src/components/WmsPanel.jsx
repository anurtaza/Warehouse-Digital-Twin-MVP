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
          <div className="metric-label">FIFO-очередь</div>
          <div className="metric-val">{wms.queued_orders ?? 0}</div>
          <div className="metric-sub">{wms.assigned_orders ?? 0} уже назначено</div>
        </div>
        <div className="metric">
          <div className="metric-label">Всего на складе</div>
          <div className="metric-val">{wms.inventory_total}</div>
          <div className="metric-sub">единиц</div>
        </div>
      </div>
      {wms.active_assignments?.length > 0 && (
        <>
          <div className="section-title" style={{ marginTop: 12 }}>Автоназначения FIFO</div>
          {wms.active_assignments.slice(0, 5).map((item) => (
            <div key={item.order_id} className="event-item">
              <span className="event-time">{item.order_id}</span>
              <span className="event-msg">
                {item.sku} → погрузчик-{item.agv_id} · {item.driver} · {item.cell_id}
                {item.route_steps !== undefined ? ` · ${item.route_steps} шагов` : ""}
                {item.eta_minutes ? ` · ETA ${item.eta_minutes} мин` : ""}
              </span>
            </div>
          ))}
        </>
      )}
      <div className="section-title" style={{ marginTop: 12 }}>Последние заказы</div>
      {wms.orders.slice(0, 5).map((order) => (
        <div key={order.id} className="event-item">
          <span className="event-time">{order.id}</span>
          <span className="event-msg">{order.sku} ×{order.qty} · {order.status}{order.cell_expiry_date ? ` · exp ${new Date(order.cell_expiry_date).toLocaleDateString()}` : ""}</span>
        </div>
      ))}
      {wms.inventory_forecast?.length > 0 && (
        <>
          <div className="section-title" style={{ marginTop: 12 }}>Прогноз запасов CCI</div>
          {wms.inventory_forecast.slice(0, 4).map((item) => (
            <div key={item.sku} className="event-item">
              <span className="event-time">{item.sku}</span>
              <span className="event-msg">{item.qty} ед. · хватит на {item.hours_left} ч</span>
            </div>
          ))}
        </>
      )}
      {wms.expiring_soon?.length > 0 && (
        <>
          <div className="section-title" style={{ marginTop: 12 }}>FEFO / срок годности</div>
          {wms.expiring_soon.slice(0, 4).map((cell) => (
            <div key={cell.id} className="event-item">
              <span className="event-time">{cell.id}</span>
              <span className="event-msg">{cell.sku} · {cell.expiry_days_left} дн. · {cell.zone_type}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
