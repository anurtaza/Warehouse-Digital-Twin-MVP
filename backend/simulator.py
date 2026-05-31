"""
Симулятор состояния склада — имитирует сенсоры, AGV, заказы.
В реальном проекте здесь будет подключение к WMS/SCADA.
"""
import random, math
from datetime import datetime
from collections import deque


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

    def tick(self):
        dx, dz = self.tx - self.x, self.tz - self.z
        dist = math.hypot(dx, dz)
        if dist < 0.2:
            self.tx = random.uniform(0.5, self.cols - 1.5)
            self.tz = random.uniform(0.5, self.rows - 1.5)
        else:
            speed = 0.15
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

        if self.tick_count % 30 == 0:
            msgs = {
                "normal": ["Заказ выполнен", "AGV вернулся на зарядку", "Пополнение зоны C"],
                "surge":  ["⚠ Перегрузка зоны B2", "Очередь растёт", "Вызвана экстра-смена"],
                "agv_fail": ["⚠ AGV-3 неисправен", "Ручная обработка", "Задержка +25 мин"],
                "low_staff": ["⚠ Явка 55%", "Скорость снижена", "Приоритет срочным"],
            }
            self._log_event(random.choice(msgs[self.scenario]))

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
            "agv_total": 6,
            "orders_total": self.orders_total,
            "orders_done": self.orders_done,
            "throughput": self.throughput_history[-1] if self.throughput_history else 0,
            "throughput_history": list(self.throughput_history[-20:]),
            "scenario": self.scenario,
        }

    def get_state(self):
        return {
            "tick": self.tick_count,
            "scenario": self.scenario,
            "metrics": self.get_metrics(),
            "cells": [c.to_dict() for c in self.cells],
            "agvs": [a.to_dict() for a in self.agvs],
        }

    def get_events(self, limit=20):
        return list(self.events)[:limit]
