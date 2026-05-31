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
            }
            self.orders.appendleft(order)
            self.next_order_id += 1

    def update_order_statuses(self):
        for order in list(self.orders):
            if order["status"] == "pending" and random.random() < 0.18:
                order["status"] = "picking"
            elif order["status"] == "picking" and random.random() < 0.14:
                order["status"] = "shipped"

    def sync(self):
        self.last_sync = datetime.now()
        inventory = Counter()
        for cell in self.simulator.cells:
            if cell.fill and cell.sku:
                inventory[cell.sku] += cell.qty
        self.inventory = dict(inventory)

    def to_dict(self):
        top_skus = sorted(self.inventory.items(), key=lambda item: -item[1])[:5]
        return {
            "last_sync": self.last_sync.isoformat(),
            "unique_skus": len(self.inventory),
            "inventory_total": sum(self.inventory.values()),
            "pending_orders": sum(1 for order in self.orders if order["status"] != "shipped"),
            "orders": list(self.orders)[:10],
            "top_skus": [{"sku": sku, "qty": qty} for sku, qty in top_skus],
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

    def to_dict(self):
        return {
            "id": self.id,
            "col": self.col, "row": self.row, "shelf": self.shelf,
            "fill": self.fill, "hot": self.hot,
            "sku": self.sku, "qty": self.qty,
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

    def _choose_new_target(self):
        # Цель по всей территории склада, мин расстояние 2.0
        for _ in range(30):
            tx = random.uniform(0.0, self.cols - 1.0)
            tz = random.uniform(0.0, self.rows - 1.0)
            if math.hypot(tx - self.x, tz - self.z) > 2.0:
                return tx, tz
        # fallback — противоположный угол
        return (self.cols - 1.0 - self.x), (self.rows - 1.0 - self.z)

    def tick(self):
        dx, dz = self.tx - self.x, self.tz - self.z
        dist = math.hypot(dx, dz)

        # Меняем цель только когда добрались — убран random.random() < 0.3
        if dist < 0.3:
            self.tx, self.tz = self._choose_new_target()
            dx, dz = self.tx - self.x, self.tz - self.z
            dist = math.hypot(dx, dz)

        if dist > 0:
            speed = 0.25
            self.x += dx / dist * speed
            self.z += dz / dist * speed

        self.battery = max(10, self.battery - 0.02)

    def to_dict(self):
        return {
            "id": self.id,
            "x": round(self.x, 2), "z": round(self.z, 2),
            "tx": round(self.tx, 2), "tz": round(self.tz, 2),
            "status": self.status,
            "battery": round(self.battery),
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
            cell.fill = random.random() < target_fill
            cell.hot = cell.fill and (random.random() < hot_chance)
            cell.sku = f"SKU-{random.randint(1000,9999)}" if cell.fill else None
            cell.qty = random.randint(1, 50) if cell.fill else 0

        self._rebuild_agvs()
        self._log_event(f"Сценарий изменён → {name}", "info")

    def tick(self):
        self.tick_count += 1
        params = SCENARIO_PARAMS[self.scenario]

        for agv in self.agvs:
            agv.tick()

        if self.tick_count % 5 == 0:
            n = random.randint(1, 3)
            for _ in range(n):
                cell = random.choice(self.cells)
                if not cell.fill:
                    cell.fill = True
                    cell.sku = f"SKU-{random.randint(1000,9999)}"
                    cell.qty = random.randint(1, 50)

        if self.tick_count % 7 == 0:
            n = random.randint(1, 2)
            for _ in range(n):
                filled = [c for c in self.cells if c.fill]
                if filled:
                    cell = random.choice(filled)
                    cell.fill = False
                    cell.hot = False
                    cell.sku = None
                    cell.qty = 0
                    self.orders_done += 1

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
                "normal": ["Заказ выполнен", "AGV вернулся на зарядку", "Пополнение зоны C"],
                "surge":  ["⚠ Перегрузка зоны B2", "Очередь растёт", "Вызвана экстра-смена"],
                "agv_fail": ["⚠ AGV-3 неисправен", "Ручная обработка", "Задержка +25 мин"],
                "low_staff": ["⚠ Явка 55%", "Скорость снижена", "Приоритет срочным"],
            }
            self._log_event(random.choice(msgs[self.scenario]))

        if self.tick_count % 25 == 0:
            low_battery = [a for a in self.agvs if a.battery < 30]
            if low_battery:
                self._log_event(f"Низкий заряд у {len(low_battery)} AGV", "warning")

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
            recommendations.append(f"Зарядите {len(low_battery)} AGV, чтобы избежать простоев.")
        if self.scenario == "agv_fail":
            recommendations.append("Резервное планирование для ручной обработки при отказе AGV.")
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
        }

    def get_events(self, limit=20):
        return list(self.events)[:limit]
