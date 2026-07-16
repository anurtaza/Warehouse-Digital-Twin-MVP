const ROLES = [
  { id: "operational-manager", label: "Операционный менеджер", access: "Полный контроль, сценарии, оптимизация и редактирование" },
  { id: "supervisor", label: "Супервайзер", access: "Мониторинг операций, маршруты и координация" },
  { id: "senior-warehouse-clerk", label: "Старший кладовщик", access: "WMS, заказы, SKU, throughput и рабочие маршруты" },
  { id: "warehouse-clerk", label: "Кладовщик", access: "Только просмотр склада и общих KPI" },
  { id: "forklift-operator", label: "Оператор погрузчика", access: "Кабина с задачами, маршрутом и батареей" },
];

export default function RolePanel({ role }) {
  return (
    <div className="section">
      <div className="section-title">Доступ по роли</div>
      <div className="role-grid">
        {ROLES.map((item) => (
          <div
            key={item.id}
            className={`role-btn ${role === item.id ? "active" : ""}`}
          >
            <div>{item.label}</div>
            <span>{item.access}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
