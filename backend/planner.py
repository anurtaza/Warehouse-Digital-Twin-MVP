import heapq


class RoutePlanner:
    """Centralized time-expanded A* planner with vertex and edge reservations."""

    def __init__(self, cols, rows, horizon=36):
        self.cols = cols
        self.rows = rows
        self.horizon = horizon
        self.vertex_reservations = {}
        self.edge_reservations = {}
        self.agent_reservations = {}

    def reset(self):
        self.vertex_reservations.clear()
        self.edge_reservations.clear()
        self.agent_reservations.clear()

    def clamp_node(self, col, row):
        return (
            max(0, min(self.cols - 1, int(round(col)))),
            max(0, min(self.rows - 1, int(round(row)))),
        )

    def prune(self, now):
        self.vertex_reservations = {
            key: value for key, value in self.vertex_reservations.items() if key[2] >= now
        }
        self.edge_reservations = {
            key: value for key, value in self.edge_reservations.items() if key[2] >= now
        }
        for agv_id, records in list(self.agent_reservations.items()):
            kept = [record for record in records if record[2] >= now]
            if kept:
                self.agent_reservations[agv_id] = kept
            else:
                self.agent_reservations.pop(agv_id, None)

    def clear_agent(self, agv_id):
        for record in self.agent_reservations.pop(agv_id, []):
            kind = record[0]
            if kind == "vertex":
                self.vertex_reservations.pop(record[1], None)
            elif kind == "edge":
                self.edge_reservations.pop(record[1], None)

    def neighbors(self, node):
        col, row = node
        yield node
        for dc, dr in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            next_col, next_row = col + dc, row + dr
            if 0 <= next_col < self.cols and 0 <= next_row < self.rows:
                yield (next_col, next_row)

    @staticmethod
    def heuristic(a, b):
        return abs(a[0] - b[0]) + abs(a[1] - b[1])

    def is_reserved(self, agv_id, current, next_node, next_time):
        vertex_owner = self.vertex_reservations.get((next_node[0], next_node[1], next_time))
        if vertex_owner is not None and vertex_owner != agv_id:
            return True

        edge_owner = self.edge_reservations.get((
            next_node[0],
            next_node[1],
            current[0],
            current[1],
            next_time,
        ))
        return edge_owner is not None and edge_owner != agv_id

    def plan(self, agv_id, start, goal, start_time):
        start = self.clamp_node(*start)
        goal = self.clamp_node(*goal)
        self.prune(start_time)

        frontier = []
        heapq.heappush(frontier, (self.heuristic(start, goal), 0, start_time, start))
        came_from = {(start, start_time): None}
        cost_so_far = {(start, start_time): 0}
        best_key = (start, start_time)

        while frontier:
            _, cost, time_step, current = heapq.heappop(frontier)
            if self.heuristic(current, goal) < self.heuristic(best_key[0], goal):
                best_key = (current, time_step)
            if current == goal:
                best_key = (current, time_step)
                break
            if time_step - start_time >= self.horizon:
                continue

            for neighbor in self.neighbors(current):
                next_time = time_step + 1
                if self.is_reserved(agv_id, current, neighbor, next_time):
                    continue

                move_cost = 2 if neighbor == current else 1
                new_cost = cost + move_cost
                key = (neighbor, next_time)
                if key in cost_so_far and new_cost >= cost_so_far[key]:
                    continue

                cost_so_far[key] = new_cost
                priority = new_cost + self.heuristic(neighbor, goal)
                heapq.heappush(frontier, (priority, new_cost, next_time, neighbor))
                came_from[key] = (current, time_step)

        if best_key[0] != goal:
            return None

        path = []
        key = best_key
        while key is not None:
            path.append(key[0])
            key = came_from[key]
        return list(reversed(path))

    def reserve_path(self, agv_id, path, start_time):
        self.clear_agent(agv_id)
        records = []
        prev = None
        for offset, node in enumerate(path):
            time_step = start_time + offset
            vertex_key = (node[0], node[1], time_step)
            self.vertex_reservations[vertex_key] = agv_id
            records.append(("vertex", vertex_key, time_step))

            if prev is not None:
                edge_key = (prev[0], prev[1], node[0], node[1], time_step)
                self.edge_reservations[edge_key] = agv_id
                records.append(("edge", edge_key, time_step))
            prev = node

        self.agent_reservations[agv_id] = records

    def assign(self, agv, goal_col, goal_row, sim):
        start = self.clamp_node(agv.x, agv.z)
        goal = self.clamp_node(goal_col, goal_row)
        path = self.plan(agv.id, start, goal, sim.tick_count)
        if not path:
            return None

        self.reserve_path(agv.id, path, sim.tick_count)
        return path

    def shortest_worker_path(self, start_col, start_row, goal_col, goal_row):
        start = self.clamp_node(start_col, start_row)
        goal = self.clamp_node(goal_col, goal_row)
        frontier = []
        heapq.heappush(frontier, (self.heuristic(start, goal), 0, start))
        came_from = {start: None}
        cost_so_far = {start: 0}

        while frontier:
            _, cost, current = heapq.heappop(frontier)
            if current == goal:
                break

            for neighbor in self.neighbors(current):
                if neighbor == current:
                    continue
                new_cost = cost + 1
                if neighbor not in cost_so_far or new_cost < cost_so_far[neighbor]:
                    cost_so_far[neighbor] = new_cost
                    priority = new_cost + self.heuristic(neighbor, goal)
                    heapq.heappush(frontier, (priority, new_cost, neighbor))
                    came_from[neighbor] = current

        if goal not in came_from:
            return None

        path = []
        current = goal
        while current is not None:
            path.append(current)
            current = came_from[current]
        return list(reversed(path))

    def snapshot(self):
        return {
            "reserved_vertices": len(self.vertex_reservations),
            "reserved_edges": len(self.edge_reservations),
            "agents": len(self.agent_reservations),
            "horizon": self.horizon,
        }


planner = RoutePlanner(cols=10, rows=6)
