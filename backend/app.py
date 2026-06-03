"""
Digital Twin Warehouse — Flask + SocketIO backend
Запуск: python app.py
"""
from flask import Flask, jsonify, request
from flask_socketio import SocketIO
from flask_cors import CORS
import os
import threading, time
from datetime import datetime, timedelta
from functools import wraps
import jwt
from simulator import WarehouseSimulator
from planner import planner

app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("JWT_SECRET", "warehouse-twin-secret")
CORS(app, origins="*")
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")

sim = WarehouseSimulator(cols=10, rows=6, shelves=4)

# Simple in-memory users (replace with real user store in production)
USERS = {
    "operator": {"password": "operatorpass", "role": "operator"},
    "manager": {"password": "managerpass", "role": "manager"},
    "logistics": {"password": "logisticspass", "role": "logistics"},
    "viewer": {"password": "viewerpass", "role": "viewer"},
}

def requires_role(*roles):
    def decorator(f):
        @wraps(f)
        def wrapped(*args, **kwargs):
            auth = request.headers.get("Authorization", "")
            token = None
            if auth.startswith("Bearer "):
                token = auth.split(" ", 1)[1]
            if not token:
                return jsonify({"error": "auth_required"}), 401
            try:
                payload = jwt.decode(token, app.config["SECRET_KEY"], algorithms=["HS256"])
            except Exception:
                return jsonify({"error": "invalid_token"}), 401
            if payload.get("role") not in roles:
                return jsonify({"error": "forbidden"}), 403
            request.user = payload
            return f(*args, **kwargs)
        return wrapped
    return decorator

@app.route('/api/login', methods=['POST'])
def login():
    data = request.get_json(force=True) if request.data else {}
    username = data.get('username')
    password = data.get('password')
    if username not in USERS or USERS[username]['password'] != password:
        return jsonify({'error': 'invalid_credentials'}), 401
    role = USERS[username]['role']
    payload = {
        'sub': username,
        'role': role,
        'exp': datetime.utcnow() + timedelta(hours=8)
    }
    token = jwt.encode(payload, app.config['SECRET_KEY'], algorithm='HS256')
    return jsonify({'token': token, 'role': role, 'username': username})


@app.route("/api/me")
@requires_role("viewer", "operator", "manager", "logistics")
def me():
    return jsonify(request.user)


# ─── REST endpoints ────────────────────────────────────────────────
@app.route("/api/state")
def get_state():
    state = sim.get_state()
    state["planner"] = planner.snapshot()
    return jsonify(state)


@app.route("/api/metrics")
def get_metrics():
    return jsonify(sim.get_metrics())


@app.route("/api/events")
def get_events():
    return jsonify(sim.get_events(limit=50))


@app.route("/api/scenario/<name>", methods=["POST"])
@requires_role("manager")
def set_scenario(name):
    valid = ["normal", "surge", "agv_fail", "low_staff"]
    if name not in valid:
        return jsonify({"error": "Unknown scenario"}), 400
    sim.set_scenario(name)
    planner.reset()
    state = sim.get_state()
    state["planner"] = planner.snapshot()
    socketio.emit("scenario_changed", {"scenario": name})
    socketio.emit("state", state)
    return jsonify({"ok": True, "scenario": name, "state": state})


@app.route("/api/optimize", methods=["POST"])
@requires_role("manager")
def optimize_placement():
    sim.optimize_placement()
    state = sim.get_state()
    state["planner"] = planner.snapshot()
    socketio.emit("optimization_completed", {"ok": True})
    socketio.emit("state", state)
    return jsonify({"ok": True, "state": state})


@app.route("/api/wms")
def get_wms():
    return jsonify(sim.wms.to_dict())


@app.route("/api/agv/<int:agv_id>/command", methods=["POST"])
@requires_role('operator','manager')
def agv_command(agv_id):
    data = request.get_json(force=True) if request.data else {}
    cmd = data.get("cmd")
    args = data.get("args", {})
    if cmd not in {"pause", "resume", "goto", "charge", "home", "cancel"}:
        return jsonify({"error": "invalid_command"}), 400
    agv = next((a for a in sim.agvs if a.id == agv_id), None)
    if not agv:
        return jsonify({"error": "agv_not_found"}), 404
    if cmd in {"cancel", "goto", "charge", "home"}:
        sim.release_task_for_agv(agv_id)
        planner.clear_agent(agv_id)
    agv.enqueue_command(cmd, args)
    state = sim.get_state()
    state["planner"] = planner.snapshot()
    socketio.emit("agv_command", {"id": agv_id, "cmd": cmd, "args": args})
    socketio.emit("state", state)
    sim._log_event(f"{request.user['sub']} → погрузчик-{agv_id}: {cmd}", "info")
    return jsonify({"ok": True, "id": agv_id, "cmd": cmd, "state": state})


@app.route('/api/planner/assign', methods=['POST'])
@requires_role('operator','manager')
def planner_assign():
    data = request.get_json(force=True) if request.data else {}
    agv_id = data.get('agv_id')
    col = data.get('col')
    row = data.get('row')
    if agv_id is None or col is None or row is None:
        return jsonify({'error': 'missing_params'}), 400
    agv = next((a for a in sim.agvs if a.id == agv_id), None)
    if not agv:
        return jsonify({'error': 'agv_not_found'}), 404
    if not (0 <= int(col) < sim.cols and 0 <= int(row) < sim.rows):
        return jsonify({'error': 'target_out_of_bounds'}), 400
    sim.release_task_for_agv(agv_id)
    path = planner.assign(agv, col, row, sim)
    if not path:
        return jsonify({'error': 'no_path'}), 409
    agv.assign_route(path, (int(col), int(row)), assigned_by=request.user["sub"])
    sim._log_event(f"{request.user['sub']} назначил погрузчику-{agv_id} маршрут → C{col}/R{row}", "info")
    state = sim.get_state()
    state["planner"] = planner.snapshot()
    socketio.emit('state', state)
    return jsonify({'ok': True, 'path': path, "state": state, "planner": planner.snapshot()})


@app.route('/api/worker/route', methods=['POST'])
@requires_role('operator', 'manager', 'logistics')
def worker_route():
    data = request.get_json(force=True) if request.data else {}
    start = data.get("start", {})
    goal = data.get("goal", {})
    required = (start.get("col"), start.get("row"), goal.get("col"), goal.get("row"))
    if any(value is None for value in required):
        return jsonify({"error": "missing_params"}), 400

    path = planner.shortest_worker_path(start["col"], start["row"], goal["col"], goal["row"])
    if not path:
        return jsonify({"error": "no_path"}), 409

    steps = []
    for prev, current in zip(path, path[1:]):
        if current[0] > prev[0]:
            direction = "east"
        elif current[0] < prev[0]:
            direction = "west"
        elif current[1] > prev[1]:
            direction = "south"
        else:
            direction = "north"
        steps.append({"from": prev, "to": current, "direction": direction})

    sim._log_event(
        f"{request.user['sub']} построил маршрут складовщика {path[0]} → {path[-1]}",
        "info",
    )
    return jsonify({
        "ok": True,
        "path": path,
        "steps": steps,
        "distance": max(len(path) - 1, 0),
        "eta_minutes": round(max(len(path) - 1, 0) * 0.35, 1),
    })


# ─── WebSocket ─────────────────────────────────────────────────────
@socketio.on("connect")
def on_connect():
    print("Client connected")
    state = sim.get_state()
    state["planner"] = planner.snapshot()
    socketio.emit("state", state)


@socketio.on("set_scenario")
def on_set_scenario(data):
    socketio.emit("auth_required", {"event": "set_scenario"})


@socketio.on("optimize")
def on_optimize(data):
    socketio.emit("auth_required", {"event": "optimize"})


@socketio.on("agv_command")
def on_agv_command(data):
    # Mutating AGV commands are handled through authenticated REST endpoints.
    socketio.emit("auth_required", {"event": "agv_command"})


# ─── Background simulation loop ────────────────────────────────────
def simulation_loop():
    while True:
        sim.tick(planner)
        state = sim.get_state()
        state["planner"] = planner.snapshot()
        socketio.emit("state", state)
        events = sim.get_events(limit=1)
        if events:
            socketio.emit("event", events[0])
        time.sleep(1)


if __name__ == "__main__":
    t = threading.Thread(target=simulation_loop, daemon=True)
    t.start()
    port = int(os.environ.get("PORT", 5000))
    print(f"🏭 Warehouse Digital Twin running on http://localhost:{port}")
    socketio.run(app, host="0.0.0.0", port=port, debug=False, allow_unsafe_werkzeug=True)
