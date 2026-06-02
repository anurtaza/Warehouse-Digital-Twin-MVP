"""
Симулятор состояния склада — имитирует сенсоры, AGV, заказы.
В реальном проекте здесь будет подключение к WMS/SCADA.
"""
import random, math
from datetime import datetime
from collections import Counter, deque


class WMSClient:
    def __init__(self, simulator):
        self.simulator = simulator
        self.orders = deque(maxlen=100)
        self.last_sync = datetime.now()
        self.next_order_id = 2001
        self.inventory = {}
        # FIFO-счётчик: сколько заказов отгружено строго по порядку
        self.fifo_shipped = 0

    def generate_orders(self):
        rate = SCENARIO_PARAMS[self.simulator.scenario]["order_rate"]
        if random.random() < min(0.7, rate / 120):
            sku = random.choice([c.sku for c in self.simulator.cells if c.fill and c.sku] + [f"SKU-{random.randint(1000,9999)}"])
            order = {
                "id": f"O-{self.next_order_id}",
                "sku": sku,
                "qty": random.randint(1, 8),
                "status": "pending",
                "created": datetime.now().isoformat(),
                # FIFO: порядковый номер в очереди
                "fifo_seq": self.next_order_id,
            }
            self.orders.append(order)   # append в конец — новые поступают сзади
            self.next_order_id += 1

    def pick_cell_for_sku(self, sku):
        """FIFO по ячейкам: вернуть ячейку с данным SKU, поступившую раньше всех."""
        candidates = [c for c in self.simulator.cells if c.fill and c.sku == sku]
        if not candidates:
            return None
        return min(candidates, key=lambda c: c.received_at)

    def update_order_statuses(self):
        """FIFO: обрабатываем заказы строго в порядке поступления.
        За один вызов — не более одного pending->picking и одного picking->shipped."""
        # Самый старый pending (левый край deque — первым пришёл)
        for order in self.orders:
            if order["status"] == "pending":
                order["status"] = "picking"
                cell = self.pick_cell_for_sku(order["sku"])
                if cell:
                    order["cell_id"] = cell.id
                    order["cell_received_at"] = cell.received_at.isoformat()
                break

        # Самый старый picking
        for order in self.orders:
            if order["status"] == "picking":
                order["status"] = "shipped"
                self.fifo_shipped += 1
                self.simulator.orders_done += 1
                # Освободить привязанную ячейку
                cell_id = order.get("cell_id")
                if cell_id:
                    for c in self.simulator.cells:
                        if c.id == cell_id and c.fill:
                            c.fill = False
                            c.hot = False
                            c.sku = None
                            c.qty = 0
                            break
                break

    def sync(self):
        self.last_sync = datetime.now()
        inventory = Counter()
        for cell in self.simulator.cells:
            if cell.fill and cell.sku:
                inventory[cell.sku] += cell.qty
        self.inventory = dict(inventory)

    def to_dict(self):
        top_skus = sorted(self.inventory.items(), key=lambda item: -item[1])[:5]
        # FIFO: показываем заказы в порядке поступления (левый край = старейший)
        orders_fifo = list(self.orders)
        return {
            "last_sync": self.last_sync.isoformat(),
            "unique_skus": len(self.inventory),
            "inventory_total": sum(self.inventory.values()),
            "pending_orders": sum(1 for o in self.orders if o["status"] != "shipped"),
            "orders": orders_fifo[:10],
            "top_skus": [{"sku": sku, "qty": qty} for sku, qty in top_skus],
            "fifo_shipped": self.fifo_shipped,
        }

SCENARIO_PARAMS = {
    "normal":   {"fill_target": 0.68, "agv_count": 4, "order_rate": 60,  "hot_chance": 0.05},
    "surge":    {"fill_target": 0.91, "agv_count": 6, "order_rate": 120, "hot_chance": 0.18},
    "agv_fail": {"fill_target": 0.70, "agv_count": 2, "order_rate": 30,  "hot_chance": 0.10},
    "low_staff":{"fill_target": 0.65, "agv_count": 4, "order_rate": 35,  "hot_chance": 0.08},
}


class Cell:
    def __init__(self, col, row, shelf):
        self.id = f"{chr(65+col)}{row+1}-S{shelf+1}"
        self.col, self.row, self.shelf = col, row, shelf
        self.fill = random.random() < 0.68
        self.hot = False
        self.sku = f"SKU-{random.randint(1000,9999)}" if self.fill else None
        self.qty = random.randint(1, 50) if self.fill else 0
        # FIFO: время поступления товара — определяет порядок пикинга
        self.received_at = datetime.now()

    def receive(self, sku, qty):
        """Принять новый товар в ячейку — сбрасывает FIFO-метку времени."""
        self.fill = True
        self.sku = sku
        self.qty = qty
        self.received_at = datetime.now()

    def to_dict(self):
        return {
            "id": self.id,
            "col": self.col, "row": self.row, "shelf": self.shelf,
            "fill": self.fill, "hot": self.hot,
            "sku": self.sku, "qty": self.qty,
            "received_at": self.received_at.isoformat(),
        }


class AGV:
    def __init__(self, agv_id, cols, rows):
        self.id = agv_id
        self.x = random.uniform(0, cols - 1)
        self.z = random.uniform(0, rows - 1)
        self.tx = random.uniform(0, cols - 1)
        self.tz = random.uniform(0, rows - 1)
        self.status = "active"
        self.battery = random.randint(40, 100)
        self.cols, self.rows = cols, rows
        # manual control / command queue
        self.command_queue = deque()
        self.manual = False
        self.paused = False
        self.hold_position = False
        self.manual_target = None
        self.blocked_ticks = 0
        self.assigned_by = None
        self.route_goal = None
        # planned path assigned by centralized planner: list of (col,row)
        self.planned_path = []
        self.route_path = []
        self.path_index = 0

    def _choose_new_target(self):
        # Цель по всей территории склада, мин расстояние 2.0
        for _ in range(30):
            tx = random.uniform(0.0, self.cols - 1.0)
            tz = random.uniform(0.0, self.rows - 1.0)
            if math.hypot(tx - self.x, tz - self.z) > 2.0:
                return tx, tz
        # fallback — противоположный угол
        return (self.cols - 1.0 - self.x), (self.rows - 1.0 - self.z)
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
            self.manual = True
            self.hold_position = False
            self.planned_path = []
            self.route_path = []
            self.path_index = 0
            self.manual_target = (0.0, 0.0)
            self.tx, self.tz = 0.0, 0.0
            self.status = "charging"
        elif cmd == "cancel":
            self.command_queue.clear()
            self.manual = False
            self.hold_position = False
            self.manual_target = None
            self.planned_path = []
            self.route_path = []
            self.path_index = 0
            self.route_goal = None
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
        """Process one simulation step. If allow_move is False, only process commands/status changes."""
        # Process one command per step. Resume/cancel must work even while paused.
        if self.command_queue:
            try:
                self._process_next_command()
            except Exception:
                pass

        # If a planned path exists, follow it (grid coords)
        if self.planned_path and self.path_index < len(self.planned_path):
            next_node = self.planned_path[self.path_index]
            # set tx/tz to next node coordinates
            self.tx, self.tz = float(next_node[0]), float(next_node[1])
            dx, dz = self.tx - self.x, self.tz - self.z
            dist = math.hypot(dx, dz)
            if allow_move and not self.paused and dist > 0:
                step = min(speed, dist)
                self.x += (dx / dist) * step
                self.z += (dz / dist) * step
                self.blocked_ticks = 0
            elif not allow_move and not self.paused:
                self.blocked_ticks += 1
            # if reached node, advance index
            if dist < 0.35:
                self.path_index += 1
                if self.path_index >= len(self.planned_path):
                    # finished path
                    self.planned_path = []
                    self.path_index = 0
                    self.manual = False
                    self.hold_position = True
                    self.manual_target = None
                    self.route_goal = None
                    self.tx, self.tz = self.x, self.z
                    self.status = "arrived"
            self.battery = max(10, self.battery - 0.02)
            return

        dx, dz = self.tx - self.x, self.tz - self.z
        dist = math.hypot(dx, dz)

        if self.hold_position and not self.manual and not self.planned_path:
            self.tx, self.tz = self.x, self.z
            self.status = "arrived"
            self.battery = max(10, self.battery - 0.01)
            return

        if self.manual:
            if dist < 0.35:
                # reached manual target
                self.manual = False
                self.manual_target = None
                self.status = "active"

        if not self.manual and not self.paused:
            if dist < 0.3 or dist == 0:
                self.tx, self.tz = self._choose_new_target()
                dx, dz = self.tx - self.x, self.tz - self.z
                dist = math.hypot(dx, dz)

        if allow_move and not self.paused and dist > 0:
            step = min(speed, dist)
            self.x += (dx / dist) * step
            self.z += (dz / dist) * step
            self.blocked_ticks = 0
        elif not allow_move and not self.paused:
            self.blocked_ticks += 1

        self.battery = max(10, self.battery - 0.02)

    def assign_route(self, path, goal, assigned_by=None):
        self.planned_path = path
        self.route_path = list(path)
        self.path_index = 0
        self.manual = True
        self.hold_position = False
        self.manual_target = tuple(goal)
        self.route_goal = tuple(goal)
        self.assigned_by = assigned_by
        if path:
            self.tx, self.tz = float(path[0][0]), float(path[0][1])
        self.status = "manual"

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
            "planned_path": self.planned_path[self.path_index:],
            "route_path": self.route_path,
        }


class WarehouseSimulator:
    def __init__(self, cols=10, rows=6, shelves=4):
        self.cols, self.rows, self.shelves = cols, rows, shelves
        self.scenario = "normal"
        self.tick_count = 0
        self.orders_total = 142
        self.orders_done = 0
        self.events = deque(maxlen=200)
        self.throughput_history = [random.randint(45, 75) for _ in range(20)]

        self.cells = [
            Cell(c, r, s)
            for c in range(cols)
            for r in range(rows)
            for s in range(shelves)
        ]
        self._rebuild_agvs()
        self.wms = WMSClient(self)
        self.wms.sync()
        # FIFO Level 3: очередь задач для AGV — назначаются строго по порядку поступления
        # Каждый элемент: {"agv_id": int, "col": int, "row": int, "order_id": str, "seq": int}
        self.task_queue = deque()
        self._task_seq = 0

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
                # FIFO: используем receive() чтобы выставить корректный received_at
                cell.receive(
                    sku=f"SKU-{random.randint(1000,9999)}",
                    qty=random.randint(1, 50),
                )
                cell.hot = random.random() < hot_chance
            else:
                cell.fill = False
                cell.hot = False
                cell.sku = None
                cell.qty = 0

        self._rebuild_agvs()
        # Сбросить очередь задач при смене сценария
        self.task_queue.clear()
        self._log_event(f"Сценарий изменён → {name}", "info")

    def enqueue_task(self, agv_id, col, row, order_id=None):
        """FIFO Level 3: добавить задачу в очередь Погрузчика. Порядок строго по seq."""
        self._task_seq += 1
        task = {
            "agv_id": agv_id,
            "col": col,
            "row": row,
            "order_id": order_id or "",
            "seq": self._task_seq,
            "created": datetime.now().isoformat(),
        }
        self.task_queue.append(task)
        self._log_event(
            f"[FIFO] Задача #{self._task_seq} → Погрузчик-{agv_id} цель C{col}/R{row}", "info"
        )
        return task

    def dispatch_tasks(self):
        """FIFO Level 3: выдать следующие задачи свободным Погрузчикам по порядку очереди."""
        if not self.task_queue:
            return
        free_agvs = {
            a.id: a for a in self.agvs
            if not a.planned_path and not a.paused and a.status in ("active", "arrived")
        }
        if not free_agvs:
            return
        # Берём задачи с головы очереди — первым пришёл, первым обслужен
        dispatched = []
        for task in list(self.task_queue):
            agv_id = task["agv_id"]
            # Если запрошенный AGV свободен — отправляем ему
            if agv_id in free_agvs:
                agv = free_agvs.pop(agv_id)
                dispatched.append(task)
                self._dispatch_to_agv(agv, task)
            elif free_agvs:
                # Иначе — ближайший свободный AGV (FIFO по задаче, не по AGV)
                agv = min(
                    free_agvs.values(),
                    key=lambda a: math.hypot(a.x - task["col"], a.z - task["row"])
                )
                free_agvs.pop(agv.id)
                dispatched.append(task)
                self._dispatch_to_agv(agv, task)
            if not free_agvs:
                break
        for task in dispatched:
            self.task_queue.remove(task)

    def _dispatch_to_agv(self, agv, task):
        """Построить маршрут и назначить его водителю."""
        path = self._build_path(agv, task["col"], task["row"])
        agv.assign_route(path, (task["col"], task["row"]), assigned_by="fifo_queue")
        self._log_event(
            f"[FIFO] AGV-{agv.id} → C{task['col']}/R{task['row']} "
            f"(задача #{task['seq']})", "info"
        )

    def _build_path(self, agv, goal_col, goal_row):
        """Простой путь по сетке: сначала по X, потом по Z (L-образный)."""
        path = []
        cx, cz = round(agv.x), round(agv.z)
        # Двигаемся по колонкам
        step_x = 1 if goal_col >= cx else -1
        for col in range(cx, goal_col + step_x, step_x):
            path.append((col, cz))
        # Двигаемся по рядам
        step_z = 1 if goal_row >= cz else -1
        for row in range(cz + step_z, goal_row + step_z, step_z):
            path.append((goal_col, row))
        # Убрать дубли
        seen = []
        for p in path:
            if not seen or seen[-1] != p:
                seen.append(p)
        return seen if seen else [(goal_col, goal_row)]

    def get_task_queue(self):
        """Вернуть текущую очередь задач для UI."""
        return [
            {**t, "queue_pos": i + 1}
            for i, t in enumerate(self.task_queue)
        ]

    def tick(self):
        self.tick_count += 1
        params = SCENARIO_PARAMS[self.scenario]

        # --- AGV movement with simple collision avoidance ---
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

        # FIFO Level 3: выдать задачи из очереди свободным водителям
        self.dispatch_tasks()

        if self.tick_count % 5 == 0:
            # FIFO: поступление новых товаров — обновляем received_at через receive()
            n = random.randint(1, 3)
            for _ in range(n):
                cell = random.choice(self.cells)
                if not cell.fill:
                    cell.receive(
                        sku=f"SKU-{random.randint(1000,9999)}",
                        qty=random.randint(1, 50),
                    )

        if self.tick_count % 7 == 0:
            # Товар убирается только через FIFO-пикинг (update_order_statuses).
            # Здесь оставляем лёгкий случайный outflow для реализма,
            # но orders_done не трогаем — он управляется WMS.
            n = random.randint(0, 1)
            for _ in range(n):
                filled = [c for c in self.cells if c.fill and not c.hot]
                if filled:
                    # Выбираем самую старую ячейку — FIFO
                    cell = min(filled, key=lambda c: c.received_at)
                    cell.fill = False
                    cell.hot = False
                    cell.sku = None
                    cell.qty = 0

        if self.tick_count % 4 == 0:
            self.orders_total += random.randint(0, 3)

        if self.tick_count % 10 == 0:
            rate = params["order_rate"] + random.randint(-5, 5)
            self.throughput_history.append(rate)

        self.wms.generate_orders()
        if self.tick_count % 5 == 0:
            self.wms.update_order_statuses()

        if self.tick_count % 3 == 0:
            self.wms.sync()

        if self.tick_count % 30 == 0:
            msgs = {
                "normal": ["Заказ выполнен", "Погрузчик вернулся на зарядку", "Пополнение зоны C"],
                "surge":  ["⚠ Перегрузка зоны B2", "Очередь растёт", "Вызвана экстра-смена"],
                "agv_fail": ["⚠ Погрузчик-3 неисправен", "Ручная обработка", "Задержка +25 мин"],
                "low_staff": ["⚠ Явка 55%", "Скорость снижена", "Приоритет срочным"],
            }
            self._log_event(random.choice(msgs[self.scenario]))

        if self.tick_count % 25 == 0:
            low_battery = [a for a in self.agvs if a.battery < 30]
            if low_battery:
                self._log_event(f"Низкий заряд у {len(low_battery)} Погрузчика", "warning")

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
            "throughput": self.throughput_history[-1] if self.throughput_history else 0,
            "throughput_history": list(self.throughput_history[-20:]),
            "scenario": self.scenario,
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
        hot_cells = [c.to_dict() for c in self.cells if c.hot][:5]

        recommendations = []
        if self.get_metrics()["fill_pct"] >= 88:
            recommendations.append("Перераспределить размещение SKU, чтобы снизить густоту зоны хранения.")
        if pending >= 18:
            recommendations.append("Увеличьте пропускную способность для ускорения обработки заказов.")
        if low_battery:
            recommendations.append(f"Зарядите {len(low_battery)} погрузчик, чтобы избежать простоев.")
        if self.scenario == "agv_fail":
            recommendations.append("Резервное планирование для ручной обработки при отказе погрузчика.")
        if not recommendations:
            recommendations.append("Система работает стабильно, продолжайте мониторинг.")

        return {
            "pending_orders": pending,
            "throughput_trend": trend,
            "low_battery": low_battery,
            "hot_cells": hot_cells,
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
                    "Высокая нагрузка" if name == "surge" else
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
            # FIFO: очередь задач AGV и статистика
            "fifo": {
                "task_queue": self.get_task_queue(),
                "queue_length": len(self.task_queue),
                "total_dispatched": self._task_seq - len(self.task_queue),
                "fifo_shipped": self.wms.fifo_shipped,
            },
        }

    def get_events(self, limit=20):
        return list(self.events)[:limit]
