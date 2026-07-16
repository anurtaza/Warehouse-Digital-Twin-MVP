const ROLE_LABELS = {
  "operational-manager": "Операционный менеджер",
  supervisor: "Супервайзер",
  "senior-warehouse-clerk": "Старший кладовщик",
  "warehouse-clerk": "Кладовщик",
  "forklift-operator": "Оператор погрузчика",
  manager: "Операционный менеджер",
  operator: "Супервайзер",
  logistics: "Старший кладовщик",
  viewer: "Кладовщик",
  forklift: "Оператор погрузчика",
};

export default function RoleSummaryPanel({ role, metrics, insights, wms }) {
  const normalizedRole = (role || "warehouse-clerk").toLowerCase();
  if (normalizedRole === "forklift" || normalizedRole === "forklift-operator") {
    return null;
  }
  
  if (!metrics || !insights || !wms) return null;

  const summary = {
    "operational-manager": {
      title: "Стратегия склада",
      detail: insights.recommendations?.[0] || "Мониторинг проходит в штатном режиме.",
      cards: [
        { label: "Заполняемость", value: `${metrics.fill_pct}%` },
        { label: "Пропускная", value: `${metrics.throughput} ед/ч` },
        { label: "В очереди", value: `${wms.pending_orders}` },
      ],
    },
    supervisor: {
      title: "Операционная готовность",
      detail: insights.low_battery.length > 0
        ? `Низкий заряд у ${insights.low_battery.length} погрузчика, план зарядки.`
        : "Погрузчики готовы к работе, никаких аварий не обнаружено.",
      cards: [
        { label: "Погрузчиков активных", value: `${metrics.agv_active}/${metrics.agv_total}` },
        { label: "Горячих зон", value: `${metrics.hot_zones}` },
        { label: "Заказы в работе", value: `${wms.pending_orders}` },
      ],
    },
    "senior-warehouse-clerk": {
      title: "Логистика и KPI",
      detail: `Топ SKU: ${wms.top_skus.slice(0, 2).map((i) => i.sku).join(", ") || "нет данных"}.`, 
      cards: [
        { label: "Уникальных SKU", value: `${wms.unique_skus}` },
        { label: "Средняя пропускная", value: `${Math.round((metrics.throughput_history || [0]).reduce((a,b)=>a+b,0) / (metrics.throughput_history?.length||1))} ед/ч` },
        { label: "Запасов на складе", value: `${wms.inventory_total}` },
      ],
    },
    "warehouse-clerk": {
      title: "Обзор без управления",
      detail: "Доступен мониторинг склада без операторских команд и изменения сценариев.",
      cards: [
        { label: "Заполняемость", value: `${metrics.fill_pct}%` },
        { label: "Погрузчики онлайн", value: `${metrics.agv_active}/${metrics.agv_total}` },
        { label: "Сценарий", value: metrics.scenario },
      ],
    },
    manager: {
      title: "Стратегия склада",
      detail: insights.recommendations?.[0] || "Мониторинг проходит в штатном режиме.",
      cards: [
        { label: "Заполняемость", value: `${metrics.fill_pct}%` },
        { label: "Пропускная", value: `${metrics.throughput} ед/ч` },
        { label: "В очереди", value: `${wms.pending_orders}` },
      ],
    },
    operator: {
      title: "Операционная готовность",
      detail: insights.low_battery.length > 0
        ? `Низкий заряд у ${insights.low_battery.length} погрузчика, план зарядки.`
        : "Погрузчики готовы к работе, никаких аварий не обнаружено.",
      cards: [
        { label: "Погрузчиков активных", value: `${metrics.agv_active}/${metrics.agv_total}` },
        { label: "Горячих зон", value: `${metrics.hot_zones}` },
        { label: "Заказы в работе", value: `${wms.pending_orders}` },
      ],
    },
    logistics: {
      title: "Логистика и KPI",
      detail: `Топ SKU: ${wms.top_skus.slice(0, 2).map((i) => i.sku).join(", ") || "нет данных"}.`, 
      cards: [
        { label: "Уникальных SKU", value: `${wms.unique_skus}` },
        { label: "Средняя пропускная", value: `${Math.round((metrics.throughput_history || [0]).reduce((a,b)=>a+b,0) / (metrics.throughput_history?.length||1))} ед/ч` },
        { label: "Запасов на складе", value: `${wms.inventory_total}` },
      ],
    },
    viewer: {
      title: "Обзор без управления",
      detail: "Доступен мониторинг склада без операторских команд и изменения сценариев.",
      cards: [
        { label: "Заполняемость", value: `${metrics.fill_pct}%` },
        { label: "Погрузчики онлайн", value: `${metrics.agv_active}/${metrics.agv_total}` },
        { label: "Сценарий", value: metrics.scenario },
      ],
    },
    forklift: {
      title: "Кабина погрузчика",
      detail: "Просмотр текущего задания, маршрута и статуса батареи.",
      cards: [
        { label: "Модель", value: "AGV Класс-A" },
        { label: "Станция", value: "Активна" },
        { label: "Версия ПО", value: "2.1" },
      ],
    },
  }[normalizedRole] || {
    title: "Роль",
    detail: "Выберите профиль для персонализированного дашборда.",
    cards: [],
  };

  return (
    <div className="section role-summary">
      <div className="role-summary-head">
        <div>
          <div className="role-badge">{ROLE_LABELS[normalizedRole] || "Профиль"}</div>
          <div className="role-summary-title">{summary.title}</div>
        </div>
        <div className="role-summary-detail">{summary.detail}</div>
      </div>
      <div className="metrics-grid">
        {summary.cards.map((card) => (
          <div key={card.label} className="metric">
            <div className="metric-label">{card.label}</div>
            <div className="metric-val">{card.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
