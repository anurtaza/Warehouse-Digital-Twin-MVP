const ROLES = [
  { id: "manager", label: "Менеджер склада" },
  { id: "operator", label: "Оператор" },
  { id: "logistics", label: "Логист" },
];

export default function RolePanel({ role, onSelect }) {
  return (
    <div className="section">
      <div className="section-title">Роль пользователя</div>
      <div className="role-grid">
        {ROLES.map((item) => (
          <button
            key={item.id}
            className={`role-btn ${role === item.id ? "active" : ""}`}
            onClick={() => onSelect(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}
