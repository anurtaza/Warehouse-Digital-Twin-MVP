const ROLES = [
  { id: "manager", label: "Менеджер склада", access: "Все KPI, сценарии, оптимизация, погрузчики" },
  { id: "operator", label: "Оператор погрузчиков", access: "Погрузчики, водители, маршруты и текущие задачи" },
  { id: "logistics", label: "Логист", access: "WMS, заказы, SKU, throughput, отчеты" },
  { id: "viewer", label: "Наблюдатель", access: "Только обзор 3D-сцены и общих KPI" },
  { id: "forklift", label: "Водитель погрузчика", access: "Кабина с целями, маршрутом и батареей" },
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
