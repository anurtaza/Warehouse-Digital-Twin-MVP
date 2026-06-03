"""
Симулятор состояния склада — имитирует сенсоры, погрузчики с водителями и заказы.
Погрузчиками управляют люди; цифровой двойник строит рекомендуемые маршруты.
"""
import random, math
from datetime import datetime, timedelta
from collections import Counter, deque

# Зарядная станция — за пределами склада (угол, col=-2, row=-2)
CHARGE_STATION = (-2.0, -2.0)

# Список водителей
DRIVERS = [
    "Алексей К.", "Мария С.", "Дмитрий П.", "Анна В.",
    "Сергей Н.", "Ирина М.", "Павел Ж.", "Елена Т.",
]

SKU_CATALOG = [
    ("Cola Classic", "ambient", 180),
    ("Cola Zero", "ambient", 180),
    ("Fanta", "ambient", 150),
    ("Sprite", "ambient", 150),
    ("BonAqua", "dry", 365),
    ("Fuse Tea", "ambient", 210),
    ("Piko Juice", "cold", 90),
]

ZONE_BY_ROW = {
    0: "cold",
    1: "cold",
    2: "ambient",
    3: "ambient",
    4: "dry",
    5: "dry",
}

ZONE_LABELS = {
    "cold": "Cold zone",
    "ambient": "Ambient zone",
    "dry": "Dry zone",
}


class WMSClient:
    def __init__(self, simulator):
        self.simulator = simulator
        self.orders = deque(maxlen=100)
        self.last_sync = datetime.now()
        self.next_order_id = 2001
        self.inventory = {}
        self.fifo_shipped = 0  # счётчик отгруженных заказов через FIFO

    def generate_orders(self):
        rate = SCENARIO_PARAMS[self.simulator.scenario]["order_rate"]
        if random.random() < min(0.9, rate / 240):
            sku = random.choice([c.sku for c in self.simulator.cells if c.fill and c.sku] + [random.choice(SKU_CATALOG)[0]])
            order = {
                "id": f"O-{self.next_order_id}",
                "sku": sku,
                "qty": random.randint(1, 8),
                "status": "pending",
                "created": datetime.now().isoformat(),
                "fifo_seq": self.next_order_id,
                "urgent": random.random() < SCENARIO_PARAMS[self.simulator.scenario].get("urgent_order_chance", 0),
            }
            self.orders.append(order)   # append в конец — новые поступают сзади
            self.next_order_id += 1

    def pick_cell_for_sku(self, sku):
        """FEFO/FIFO: сначала ближайший срок годности, затем самое раннее поступление."""
        reserved_cell_ids = {
            order.get("cell_id") for order in self.orders
            if order.get("status") in {"queued", "assigned", "picking"}
        }
        candidates = [
            c for c in self.simulator.cells
            if c.fill and c.sku == sku and c.id not in reserved_cell_ids
        ]
        if not candidates:
            return None
        return min(candidates, key=lambda c: (c.expiry_date or datetime.max, c.received_at))

    def prepare_pick_queue(self):
        """FEFO/FIFO: превращаем заказы WMS в очередь задач для погрузчиков.

        Заказы больше не отгружаются сами по таймеру: они ждут, пока диспетчер
        назначит ячейку погрузчику и погрузчик физически доедет до цели.
        """
        for order in self.orders:
            if order["status"] in {"pending", "awaiting_stock"}:
                cell = self.pick_cell_for_sku(order["sku"])
                if cell:
                    order["status"] = "queued"
                    order["cell_id"] = cell.id
                    order["cell_col"] = cell.col
                    order["cell_row"] = cell.row
                    order["cell_received_at"] = cell.received_at.isoformat()
                    order["cell_expiry_date"] = cell.expiry_date.isoformat() if cell.expiry_date else None
                    order["zone_type"] = cell.zone_type
                    order["assigned_agv_id"] = None
                    order["assigned_driver"] = None
                else:
                    order["status"] = "awaiting_stock"

    def complete_order(self, order_id, agv_id):
        for order in self.orders:
            if order["id"] == order_id and order["status"] in {"assigned", "picking"}:
                order["status"] = "shipped"
                order["completed_by_agv_id"] = agv_id
                order["completed_at"] = datetime.now().isoformat()
                self.fifo_shipped += 1
                self.simulator.orders_done += 1
                cell_id = order.get("cell_id")
                if cell_id:
                    for c in self.simulator.cells:
                        if c.id == cell_id and c.fill:
                            c.clear()
                            break
                return order
        return None

    def sync(self):
        self.last_sync = datetime.now()
        inventory = Counter()
        for cell in self.simulator.cells:
            if cell.fill and cell.sku:
                inventory[cell.sku] += cell.qty
        self.inventory = dict(inventory)

    def to_dict(self):
        top_skus = sorted(self.inventory.items(), key=lambda item: -item[1])[:5]
        forecast = []
        order_counts = Counter(order["sku"] for order in self.orders if order["status"] != "shipped")
        base_rate = max(1, SCENARIO_PARAMS[self.simulator.scenario]["order_rate"] / 60)
        for sku, qty in top_skus:
            demand = max(1, order_counts.get(sku, 0) + base_rate)
            forecast.append({
                "sku": sku,
                "qty": qty,
                "hours_left": round(qty / demand, 1),
            })
        expiring_soon = [
            c.to_dict() for c in self.simulator.cells
            if c.fill and c.expiry_days_left() is not None and c.expiry_days_left() <= 30
        ][:8]
        return {
            "last_sync": self.last_sync.isoformat(),
            "unique_skus": len(self.inventory),
            "inventory_total": sum(self.inventory.values()),
            "pending_orders": sum(1 for o in self.orders if o["status"] != "shipped"),
            "queued_orders": sum(1 for o in self.orders if o["status"] == "queued"),
            "assigned_orders": sum(1 for o in self.orders if o["status"] in {"assigned", "picking"}),
            "active_assignments": [
                {
                    "order_id": order["id"],
                    "sku": order["sku"],
                    "cell_id": order.get("cell_id"),
                    "agv_id": order.get("assigned_agv_id"),
                    "driver": order.get("assigned_driver"),
                    "eta_minutes": order.get("eta_minutes"),
                    "route_steps": order.get("route_steps"),
                }
                for order in self.orders
                if order["status"] in {"assigned", "picking"}
            ][:8],
            "orders": list(self.orders)[:10],  # левый край = самый старый (FIFO)
            "top_skus": [{"sku": sku, "qty": qty} for sku, qty in top_skus],
            "fifo_shipped": self.fifo_shipped,
            "inventory_forecast": forecast,
            "expiring_soon": expiring_soon,
        }

SCENARIO_PARAMS = {
    "normal":   {"fill_target": 0.68, "agv_count": 4, "order_rate": 60,  "hot_chance": 0.05, "urgent_order_chance": 0.00},
    "surge":    {"fill_target": 0.95, "agv_count": 6, "order_rate": 240, "hot_chance": 0.28, "urgent_order_chance": 0.30},
    "agv_fail": {"fill_target": 0.70, "agv_count": 2, "order_rate": 30,  "hot_chance": 0.10, "urgent_order_chance": 0.00},
    "low_staff":{"fill_target": 0.65, "agv_count": 4, "order_rate": 35,  "hot_chance": 0.08, "urgent_order_chance": 0.00},
}


class Cell:
    def __init__(self, col, row, shelf):
        self.id = f"{chr(65+col)}{row+1}-S{shelf+1}"
        self.col, self.row, self.shelf = col, row, shelf
        self.zone_type = ZONE_BY_ROW.get(row, "ambient")
        self.activity_count = 0
        self.fill = random.random() < 0.68
        self.hot = False
        # FIFO: время поступления товара — определяет порядок пикинга
        self.received_at = datetime.now()
        self.expiry_date = None
        self.sku = None
        self.qty = 0
        if self.fill:
            sku, _, shelf_life_days = random.choice(self.compatible_skus())
            self.receive(sku=sku, qty=random.randint(1, 50), shelf_life_days=shelf_life_days)

    def compatible_skus(self):
        matches = [item for item in SKU_CATALOG if item[1] == self.zone_type]
        return matches or SKU_CATALOG

    def receive(self, sku, qty, shelf_life_days=None):
        """Принять новый товар — сбрасывает FIFO-метку времени."""
        if shelf_life_days is None:
            shelf_life_days = next((days for name, _, days in SKU_CATALOG if name == sku), 180)
        self.fill = True
        self.sku = sku
        self.qty = qty
        self.received_at = datetime.now()
        # Срок годности нужен CCI для FEFO/FIFO compliance по напиткам.
        self.expiry_date = self.received_at + timedelta(days=random.randint(max(15, shelf_life_days // 3), shelf_life_days))
        self.activity_count += 1

    def clear(self):
        self.fill = False
        self.hot = False
        self.sku = None
        self.qty = 0
        self.expiry_date = None
        self.activity_count += 1

    def expiry_days_left(self):
        if not self.expiry_date:
            return None
        return max(0, (self.expiry_date.date() - datetime.now().date()).days)

    def to_dict(self):
        expiry_days = self.expiry_days_left()
        return {
            "id": self.id,
            "col": self.col, "row": self.row, "shelf": self.shelf,
            "fill": self.fill, "hot": self.hot,
            "sku": self.sku, "qty": self.qty,
            "zone_type": self.zone_type,
            "zone_label": ZONE_LABELS.get(self.zone_type, self.zone_type),
            "received_at": self.received_at.isoformat(),
            "expiry_date": self.expiry_date.isoformat() if self.expiry_date else None,
            "expiry_days_left": expiry_days,
            "expiry_risk": bool(expiry_days is not None and expiry_days <= 30),
            "activity_count": self.activity_count,
        }


class AGV:
    def __init__(self, agv_id, cols, rows):
        self.id = agv_id
        self.x = random.uniform(0, cols - 1)
        self.z = random.uniform(0, rows - 1)
        self.tx = random.uniform(0, cols - 1)
        self.tz = random.uniform(0, rows - 1)
        self.status = "waiting"
        self.battery = random.randint(40, 100)
        self.cols, self.rows = cols, rows
        # Водитель — человек управляет погрузчиком
        self.driver = DRIVERS[agv_id % len(DRIVERS)]
        self.driver_skill = random.uniform(0.82, 1.0)  # влияет на скорость
        self.accel_phase = 0.0    # плавный разгон (0..1)
        self.idle_ticks = 0       # водитель стоит (погрузка/разгрузка)
        self.wear_level = random.randint(8, 42)
        self.maintenance_due_at = datetime.now() + timedelta(days=random.randint(7, 45))
        # manual control / command queue
        self.command_queue = deque()
        self.manual = False
        self.paused = False
        self.hold_position = False
        self.manual_target = None
        self.blocked_ticks = 0
        self.assigned_by = None
        self.route_goal = None
        self.route_task = None
        self.completed_task_id = None
        # planned path assigned by centralized planner: list of (col,row)
        self.planned_path = []
        self.route_path = []
        self.path_index = 0

    def _choose_new_target(self):
        """Используется только для команды charge — отправить на зарядную."""
        if self.status == "charging":
            return CHARGE_STATION
        # Водитель ждёт задание — стоит на месте
        return (self.x, self.z)
    def enqueue_command(self, cmd, args=None):
        if args is None:
            args = {}
        self.command_queue.append((cmd, args))
        return True

    def _process_next_command(self):
        if not self.command_queue:
            return False
        cmd, args = self.command_queue.popleft()
        if cmd == "pause":
            self.paused = True
            self.status = "paused"
        elif cmd == "resume":
            self.paused = False
            if self.hold_position:
                self.route_path = []
            self.hold_position = False
            self.status = "manual" if self.manual or self.planned_path else "active"
        elif cmd == "goto":
            col = args.get("col")
            row = args.get("row")
            if col is not None and row is not None:
                self.manual = True
                self.hold_position = False
                self.manual_target = (float(col), float(row))
                self.tx, self.tz = float(col), float(row)
                self.status = "manual"
        elif cmd in ("charge", "home"):
            # Водитель отгоняет погрузчик на зарядную станцию (за пределами склада)
            self.manual = True
            self.hold_position = False
            self.planned_path = []
            self.route_path = []
            self.path_index = 0
            cx, cz = CHARGE_STATION
            self.manual_target = (cx, cz)
            self.tx, self.tz = cx, cz
            self.status = "charging"
            self.accel_phase = 0.0
        elif cmd == "cancel":
            self.command_queue.clear()
            self.manual = False
            self.hold_position = False
            self.manual_target = None
            self.planned_path = []
            self.route_path = []
            self.path_index = 0
            self.route_goal = None
            self.route_task = None
            self.status = "active"
        return True

    def peek_next_pos(self, speed=0.25):
        """Compute tentative next position without applying it."""
        if self.planned_path and self.path_index < len(self.planned_path):
            tx, tz = self.planned_path[self.path_index]
        else:
            tx, tz = self.tx, self.tz

        dx, dz = tx - self.x, tz - self.z
        dist = math.hypot(dx, dz)
        if self.paused or dist == 0:
            return (self.x, self.z)
        step = min(speed, dist)
        nx = self.x + (dx / dist) * step
        nz = self.z + (dz / dist) * step
        return (nx, nz)

    def step(self, allow_move=True, speed=0.25):
        """Один шаг симуляции. Водитель едет плавно: разгон, микро-паузы, ожидание задания."""
        # Обработка команд — даже во время паузы (resume/cancel должны работать)
        if self.command_queue:
            try:
                self._process_next_command()
            except Exception:
                pass

        # Водитель стоит — погрузка/разгрузка
        if self.idle_ticks > 0:
            self.idle_ticks -= 1
            self.battery = max(10, self.battery - 0.008)
            self.wear_level = min(100, self.wear_level + 0.01)
            return

        # Нет задания и не едет вручную — водитель ждёт
        if not self.planned_path and not self.manual and not self.paused:
            self.status = "waiting"
            self.tx, self.tz = self.x, self.z
            self.accel_phase = 0.0
            self.battery = max(10, self.battery - 0.006)
            return

        # Плавный разгон/торможение — имитация водителя
        if allow_move and not self.paused:
            self.accel_phase = min(1.0, self.accel_phase + 0.07)
        else:
            self.accel_phase = max(0.0, self.accel_phase - 0.15)

        human_speed = speed * self.driver_skill * (0.40 + 0.60 * self.accel_phase)
        human_speed *= random.uniform(0.97, 1.03)  # микро-вариация скорости

        # Движение по плановому маршруту (список узлов от planner)
        if self.planned_path and self.path_index < len(self.planned_path):
            next_node = self.planned_path[self.path_index]
            self.tx, self.tz = float(next_node[0]), float(next_node[1])
            dx, dz = self.tx - self.x, self.tz - self.z
            dist = math.hypot(dx, dz)
            if allow_move and not self.paused and dist > 0 and human_speed > 0:
                move = min(human_speed, dist)
                self.x += (dx / dist) * move
                self.z += (dz / dist) * move
                self.blocked_ticks = 0
                self.wear_level = min(100, self.wear_level + 0.035)
            elif not allow_move and not self.paused:
                self.blocked_ticks += 1
                self.wear_level = min(100, self.wear_level + 0.02)
            if dist < 0.35:
                self.path_index += 1
                # Водитель делает короткую паузу на каждой точке (берёт/ставит груз)
                if random.random() < 0.15:
                    self.idle_ticks = random.randint(1, 3)
                if self.path_index >= len(self.planned_path):
                    if self.route_task:
                        self.completed_task_id = self.route_task.get("order_id")
                    self.planned_path = []
                    self.path_index = 0
                    self.manual = False
                    self.hold_position = True
                    self.manual_target = None
                    self.route_goal = None
                    self.tx, self.tz = self.x, self.z
                    self.status = "unloading" if self.route_task else "arrived"
                    self.idle_ticks = random.randint(3, 7)  # разгрузка
                    self.accel_phase = 0.0
            self.battery = max(10, self.battery - 0.015)
            return

        dx, dz = self.tx - self.x, self.tz - self.z
        dist = math.hypot(dx, dz)

        if self.hold_position and not self.manual and not self.planned_path:
            self.tx, self.tz = self.x, self.z
            self.status = "arrived"
            self.battery = max(10, self.battery - 0.008)
            return

        if self.manual:
            if dist < 0.35:
                # Водитель доехал до ручной цели
                self.manual = False
                self.manual_target = None
                self.accel_phase = 0.0
                if self.status == "charging":
                    pass  # остаётся charging пока не resume
                else:
                    self.status = "waiting"

        if allow_move and not self.paused and dist > 0 and human_speed > 0:
            move = min(human_speed, dist)
            self.x += (dx / dist) * move
            self.z += (dz / dist) * move
            self.blocked_ticks = 0
            self.wear_level = min(100, self.wear_level + 0.035)
        elif not allow_move and not self.paused:
            self.blocked_ticks += 1
            self.wear_level = min(100, self.wear_level + 0.02)

        self.battery = max(10, self.battery - 0.015)

    def assign_route(self, path, goal, assigned_by=None, task=None, mode="manual"):
        self.planned_path = path
        self.route_path = list(path)
        self.path_index = 0
        self.manual = mode == "manual"
        self.hold_position = False
        self.manual_target = tuple(goal)
        self.route_goal = tuple(goal)
        self.assigned_by = assigned_by
        self.route_task = task
        self.completed_task_id = None
        if path:
            self.tx, self.tz = float(path[0][0]), float(path[0][1])
        self.status = "manual" if self.manual else "assigned"

    def finish_current_task(self):
        self.route_task = None
        self.route_goal = None
        self.assigned_by = None
        self.completed_task_id = None
        self.hold_position = False
        if self.idle_ticks > 0:
            self.status = "unloading"
        elif not self.paused and not self.manual and not self.planned_path:
            self.status = "waiting"

    def to_dict(self):
        return {
            "id": self.id,
            "x": round(self.x, 2), "z": round(self.z, 2),
            "tx": round(self.tx, 2), "tz": round(self.tz, 2),
            "status": self.status,
            "battery": round(self.battery),
            "paused": bool(self.paused),
            "manual": bool(self.manual),
            "hold_position": bool(self.hold_position),
            "queue": len(self.command_queue),
            "blocked_ticks": self.blocked_ticks,
            "route_goal": self.route_goal,
            "assigned_by": self.assigned_by,
            "route_task": self.route_task,
            "completed_task_id": self.completed_task_id,
            "planned_path": self.planned_path[self.path_index:],
            "route_path": self.route_path,
            # Поля водителя
            "driver": self.driver,
            "driver_skill": round(self.driver_skill, 2),
            "idle": self.idle_ticks > 0,
            "waiting": self.status == "waiting",
            "wear_level": round(self.wear_level, 1),
            "maintenance_due_at": self.maintenance_due_at.isoformat(),
            "maintenance_risk": self.wear_level >= 70 or self.maintenance_due_at <= datetime.now() + timedelta(days=5),
        }


class WarehouseSimulator:
    def __init__(self, cols=10, rows=6, shelves=4):
        self.cols, self.rows, self.shelves = cols, rows, shelves
        self.scenario = "normal"
        self.tick_count = 0
        self.orders_total = 0
        self.orders_done = 0
        self.events = deque(maxlen=200)
        self.throughput_history = [random.randint(45, 75) for _ in range(20)]
        self.auto_dispatch_enabled = True
        self.dispatch_count_by_agv = Counter()

        self.cells = [
            Cell(c, r, s)
            for c in range(cols)
            for r in range(rows)
            for s in range(shelves)
        ]
        self._rebuild_agvs()
        self.wms = WMSClient(self)
        self.wms.sync()

        # Seed the simulator with a few starting WMS orders so auto-dispatch
        # has tasks immediately when the simulation starts.
        for _ in range(20):
            self.wms.generate_orders()
            if len(self.wms.orders) >= 4:
                break
        self.orders_total = self.orders_done + len(self.wms.orders)
        self.wms.prepare_pick_queue()

    def _rebuild_agvs(self):
        count = SCENARIO_PARAMS[self.scenario]["agv_count"]
        self.agvs = [AGV(i, self.cols, self.rows) for i in range(count)]

    def set_scenario(self, name: str):
        if name not in SCENARIO_PARAMS:
            return
        self.scenario = name
        params = SCENARIO_PARAMS[name]
        target_fill = params["fill_target"]
        hot_chance = params["hot_chance"]

        for cell in self.cells:
            if random.random() < target_fill:
                sku, _, shelf_life_days = random.choice(cell.compatible_skus())
                cell.receive(
                    sku=sku,
                    qty=random.randint(1, 50),
                    shelf_life_days=shelf_life_days,
                )
                cell.hot = random.random() < hot_chance
            else:
                cell.clear()

        self._rebuild_agvs()
        self.dispatch_count_by_agv = Counter()
        self._log_event(f"Сценарий изменён → {name}", "info")

    def _find_cell_by_id(self, cell_id):
        return next((cell for cell in self.cells if cell.id == cell_id), None)

    def _is_forklift_available(self, agv):
        return (
            not agv.paused
            and not agv.manual
            and not agv.planned_path
            and not agv.route_task
            and agv.idle_ticks == 0
            and agv.status in {"waiting", "arrived", "unloading", "active"}
            and agv.battery > 18
        )

    def _dispatch_score(self, agv, cell):
        workload = self.dispatch_count_by_agv.get(agv.id, 0) * 2.0
        distance = math.hypot(agv.x - cell.col, agv.z - cell.row)
        battery_penalty = max(0, 35 - agv.battery) / 10
        return workload + distance + battery_penalty

    def auto_dispatch(self, planner):
        if not self.auto_dispatch_enabled or planner is None:
            return 0

        self.wms.prepare_pick_queue()
        available = [agv for agv in self.agvs if self._is_forklift_available(agv)]
        if not available:
            return 0

        assigned = 0
        queued_orders = [
            order for order in self.wms.orders
            if order["status"] == "queued" and order.get("cell_id")
        ]
        queued_orders.sort(key=lambda order: (
            0 if order.get("urgent") else 1,
            order.get("cell_expiry_date") or "",
            order.get("fifo_seq", 0),
        ))

        for order in queued_orders:
            if not available:
                break
            cell = self._find_cell_by_id(order.get("cell_id"))
            if not cell or not cell.fill:
                order["status"] = "pending"
                continue

            agv = min(available, key=lambda candidate: self._dispatch_score(candidate, cell))
            path = planner.assign(agv, cell.col, cell.row, self)
            if not path:
                continue

            task = {
                "order_id": order["id"],
                "sku": order["sku"],
                "qty": order.get("qty", 0),
                "cell_id": cell.id,
                "cell_col": cell.col,
                "cell_row": cell.row,
                "zone_type": cell.zone_type,
                "expiry_date": cell.expiry_date.isoformat() if cell.expiry_date else None,
                "expiry_days_left": cell.expiry_days_left(),
                "route_steps": max(len(path) - 1, 0),
                "eta_minutes": round(max(len(path) - 1, 0) * 0.45, 1),
                "dispatch_mode": "auto_fifo",
            }
            agv.assign_route(
                path,
                (cell.col, cell.row),
                assigned_by="auto-dispatcher",
                task=task,
                mode="auto",
            )
            order["status"] = "assigned"
            order["assigned_agv_id"] = agv.id
            order["assigned_driver"] = agv.driver
            order["route_steps"] = task["route_steps"]
            order["eta_minutes"] = task["eta_minutes"]
            self.dispatch_count_by_agv[agv.id] += 1
            available.remove(agv)
            assigned += 1
            self._log_event(
                f"Автодиспетчер назначил заказ {order['id']} → погрузчик-{agv.id} ({agv.driver}), {cell.id}, {order['sku']}",
                "info",
            )

        return assigned

    def release_task_for_agv(self, agv_id):
        for agv in self.agvs:
            if agv.id != agv_id or not agv.route_task:
                continue
            order_id = agv.route_task.get("order_id")
            for order in self.wms.orders:
                if order["id"] == order_id and order["status"] in {"assigned", "picking"}:
                    order["status"] = "queued"
                    order["assigned_agv_id"] = None
                    order["assigned_driver"] = None
                    order.pop("route_steps", None)
                    order.pop("eta_minutes", None)
                    return order
        return None

    def tick(self, planner=None):
        self.tick_count += 1
        params = SCENARIO_PARAMS[self.scenario]
        self.auto_dispatch(planner)

        # --- Forklift movement with simple collision avoidance ---
        # 1) compute tentative next positions
        tentative = {}
        speed = 0.14
        for agv in self.agvs:
            tentative[agv.id] = agv.peek_next_pos(speed=speed)

        # 2) detect conflicts and decide who must wait
        blocked = set()
        MIN_SEP = 0.6
        ids = [a.id for a in self.agvs]
        for i in range(len(ids)):
            for j in range(i + 1, len(ids)):
                a_id = ids[i]
                b_id = ids[j]
                ax, az = tentative[a_id]
                bx, bz = tentative[b_id]
                if math.hypot(ax - bx, az - bz) < MIN_SEP:
                    # block the one with higher id (simple deterministic tie-break)
                    if a_id > b_id:
                        blocked.add(a_id)
                    else:
                        blocked.add(b_id)

        # 3) apply steps respecting blocked set
        for agv in self.agvs:
            allow = agv.id not in blocked
            agv.step(allow_move=allow, speed=speed)
            if agv.completed_task_id:
                completed = self.wms.complete_order(agv.completed_task_id, agv.id)
                if completed:
                    self._log_event(
                        f"Погрузчик-{agv.id} ({agv.driver}) отгрузил {completed['id']} по FIFO/FEFO",
                        "success",
                    )
                agv.finish_current_task()
            col = max(0, min(self.cols - 1, int(round(agv.x))))
            row = max(0, min(self.rows - 1, int(round(agv.z))))
            for cell in self.cells:
                if cell.col == col and cell.row == row and cell.shelf == 0:
                    cell.activity_count += 1
                    if cell.activity_count >= 14:
                        cell.hot = True
                    break

        if self.tick_count % 5 == 0:
            # FIFO: новые товары поступают через receive() — фиксирует время
            n = random.randint(1, 3)
            for _ in range(n):
                cell = random.choice(self.cells)
                if not cell.fill:
                    sku, _, shelf_life_days = random.choice(cell.compatible_skus())
                    cell.receive(
                        sku=sku,
                        qty=random.randint(1, 50),
                        shelf_life_days=shelf_life_days,
                    )

        if self.tick_count % 4 == 0:
            self.orders_total += random.randint(0, 3)

        if self.tick_count % 10 == 0:
            rate = params["order_rate"] + random.randint(-5, 5)
            self.throughput_history.append(rate)

        self.wms.generate_orders()
        if self.tick_count % 5 == 0:
            self.wms.prepare_pick_queue()

        if self.tick_count % 3 == 0:
            self.wms.sync()

        if self.tick_count % 30 == 0:
            msgs = {
                "normal": ["Заказ выполнен", "Погрузчик вернулся на зарядку", "Пополнение зоны C"],
                "surge":  ["⚠ Перегрузка зоны B2", "Очередь растёт", "Вызвана экстра-смена"],
                "agv_fail": ["⚠ Погрузчик неисправен", "Ручная обработка", "Задержка +25 мин"],
                "low_staff": ["⚠ Явка 55%", "Скорость снижена", "Приоритет срочным"],
            }
            self._log_event(random.choice(msgs[self.scenario]))

        if self.tick_count % 25 == 0:
            low_battery = [a for a in self.agvs if a.battery < 30]
            if low_battery:
                self._log_event(f"Низкий заряд у {len(low_battery)} погрузчика", "warning")

    def _log_event(self, msg: str, level: str = "info"):
        self.events.appendleft({
            "ts": datetime.now().isoformat(),
            "msg": msg,
            "level": level,
            "scenario": self.scenario,
        })

    def get_metrics(self):
        filled = sum(1 for c in self.cells if c.fill)
        total = len(self.cells)
        hot = sum(1 for c in self.cells if c.hot)
        fill_target = 90
        throughput_target = 60 if self.scenario != "surge" else 210
        fifo_total = max(1, self.wms.fifo_shipped)
        expiring_soon = sum(1 for c in self.cells if c.fill and c.expiry_days_left() is not None and c.expiry_days_left() <= 30)
        maintenance_due = sum(1 for a in self.agvs if a.to_dict()["maintenance_risk"])
        congestion_points = sum(1 for a in self.agvs if a.blocked_ticks >= 3)
        return {
            "fill_pct": round(filled / total * 100),
            "filled": filled,
            "total": total,
            "hot_zones": hot,
            "agv_active": len(self.agvs),
            "agv_total": len(self.agvs),
            "orders_total": self.orders_total,
            "orders_done": self.orders_done,
            "pending_orders": max(self.orders_total - self.orders_done, 0),
            "fifo_queue": sum(1 for o in self.wms.orders if o["status"] == "queued"),
            "fifo_assigned": sum(1 for o in self.wms.orders if o["status"] in {"assigned", "picking"}),
            "throughput": self.throughput_history[-1] if self.throughput_history else 0,
            "throughput_history": list(self.throughput_history[-20:]),
            "scenario": self.scenario,
            "benchmarks": {
                "fill_target": fill_target,
                "fill_delta": round(filled / total * 100) - fill_target,
                "throughput_target": throughput_target,
                "throughput_delta": (self.throughput_history[-1] if self.throughput_history else 0) - throughput_target,
                "fifo_compliance": 100 if fifo_total else 100,
            },
            "expiring_soon": expiring_soon,
            "maintenance_due": maintenance_due,
            "congestion_points": congestion_points,
            "energy_kwh_shift": round(sum(100 - a.battery for a in self.agvs) * 0.12, 1),
        }

    def optimize_placement(self):
        shipping = (0, 0)
        def dist(cell):
            return math.hypot(cell.col - shipping[0], cell.row - shipping[1])

        filled_cells = [c for c in self.cells if c.fill]
        if not filled_cells:
            return

        priority_cells = sorted(
            filled_cells,
            key=lambda c: ((200 if c.hot else 0) + c.qty - dist(c) * 6),
            reverse=True,
        )[:8]

        targets = sorted(self.cells, key=lambda c: dist(c))
        moved = 0

        for cell in priority_cells:
            if dist(cell) <= 3:
                continue
            for target in targets:
                if target is cell or dist(target) >= dist(cell):
                    continue
                if target.fill and target.hot and not cell.hot:
                    continue
                cell.sku, target.sku = target.sku, cell.sku
                cell.qty, target.qty = target.qty, cell.qty
                cell.hot, target.hot = target.hot, cell.hot
                cell.fill, target.fill = target.fill, cell.fill
                moved += 1
                break

        self.wms.sync()
        self._log_event(f"Оптимизация размещения SKU выполнена ({moved} перемещений)", "info")

    def get_insights(self):
        pending = max(self.orders_total - self.orders_done, 0)
        trend = 0
        if len(self.throughput_history) > 1:
            trend = self.throughput_history[-1] - self.throughput_history[-2]

        low_battery = [a.to_dict() for a in self.agvs if a.battery < 30]
        hot_cells = sorted(
            [c.to_dict() for c in self.cells if c.activity_count > 0],
            key=lambda c: c["activity_count"],
            reverse=True,
        )[:8]
        expiring_soon = [c.to_dict() for c in self.cells if c.fill and c.expiry_days_left() is not None and c.expiry_days_left() <= 30][:8]
        maintenance_due = [a.to_dict() for a in self.agvs if a.to_dict()["maintenance_risk"]]
        congestion = [a.to_dict() for a in self.agvs if a.blocked_ticks >= 3]

        recommendations = []
        if self.get_metrics()["fill_pct"] >= 88:
            recommendations.append("Перераспределить размещение SKU, чтобы снизить густоту зоны хранения.")
        if pending >= 18:
            recommendations.append("Увеличьте пропускную способность для ускорения обработки заказов.")
        if low_battery:
            recommendations.append(f"Зарядите {len(low_battery)} погрузчика, чтобы избежать простоев.")
        if expiring_soon:
            recommendations.append(f"FEFO/FIFO: {len(expiring_soon)} паллет близки к сроку годности, поставьте их в приоритет отгрузки.")
        if maintenance_due:
            recommendations.append(f"ТО: {len(maintenance_due)} погрузчика требуют проверки до пикового окна.")
        if congestion:
            recommendations.append(f"Конгестия: {len(congestion)} погрузчика ждут в проходах, перераспределите маршруты.")
        if self.scenario == "surge":
            recommendations.append("Летний сезон CCI: спрос выше нормы, держите Cola Classic/Zero ближе к зоне отгрузки.")
        if self.scenario == "agv_fail":
            recommendations.append("Резервное планирование для ручной обработки при отказе погрузчика.")
        if not recommendations:
            recommendations.append("Система работает стабильно, продолжайте мониторинг.")

        return {
            "pending_orders": pending,
            "throughput_trend": trend,
            "low_battery": low_battery,
            "hot_cells": hot_cells,
            "expiring_soon": expiring_soon,
            "maintenance_due": maintenance_due,
            "congestion": congestion,
            "recommendations": recommendations,
        }

    def get_scenario_analysis(self):
        base_metrics = self.get_metrics()
        analysis = []
        for name, params in SCENARIO_PARAMS.items():
            projected_throughput = int(params["order_rate"] * 0.88)
            projected_fill = int(params["fill_target"] * 100)
            analysis.append({
                "scenario": name,
                "projected_throughput": projected_throughput,
                "projected_fill_pct": projected_fill,
                "key_message": (
                    "Летний сезон CCI" if name == "surge" else
                    "Риск простоя" if name == "agv_fail" else
                    "Нехватка персонала" if name == "low_staff" else
                    "Штатный режим"
                ),
            })
        return analysis

    def get_report(self):
        metrics = self.get_metrics()
        return {
            "generated_at": datetime.now().isoformat(),
            "orders_processed": self.orders_done,
            "pending_orders": metrics["pending_orders"],
            "avg_throughput": int(sum(self.throughput_history) / len(self.throughput_history)),
            "hot_zone_count": metrics["hot_zones"],
            "agv_count": metrics["agv_total"],
        }

    def get_state(self):
        return {
            "tick": self.tick_count,
            "scenario": self.scenario,
            "metrics": self.get_metrics(),
            "insights": self.get_insights(),
            "analysis": self.get_scenario_analysis(),
            "report": self.get_report(),
            "wms": self.wms.to_dict(),
            "cells": [c.to_dict() for c in self.cells],
            "agvs": [a.to_dict() for a in self.agvs],
        }

    def get_events(self, limit=20):
        return list(self.events)[:limit]
