"""
Digital Twin Warehouse — Flask + SocketIO backend
Запуск: python app.py
"""
from flask import Flask, jsonify
from flask_socketio import SocketIO
from flask_cors import CORS
import os
import threading, time, random, math
from datetime import datetime
from simulator import WarehouseSimulator

app = Flask(__name__)
app.config["SECRET_KEY"] = "warehouse-twin-secret"
CORS(app, origins="*")
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")

sim = WarehouseSimulator(cols=10, rows=6, shelves=4)


# ─── REST endpoints ────────────────────────────────────────────────
@app.route("/api/state")
def get_state():
    return jsonify(sim.get_state())


@app.route("/api/metrics")
def get_metrics():
    return jsonify(sim.get_metrics())


@app.route("/api/events")
def get_events():
    return jsonify(sim.get_events(limit=50))


@app.route("/api/scenario/<name>", methods=["POST"])
def set_scenario(name):
    valid = ["normal", "surge", "agv_fail", "low_staff"]
    if name not in valid:
        return jsonify({"error": "Unknown scenario"}), 400
    sim.set_scenario(name)
    state = sim.get_state()
    socketio.emit("scenario_changed", {"scenario": name})
    socketio.emit("state", state)
    return jsonify({"ok": True, "scenario": name, "state": state})


@app.route("/api/optimize", methods=["POST"])
def optimize_placement():
    sim.optimize_placement()
    state = sim.get_state()
    socketio.emit("optimization_completed", {"ok": True})
    socketio.emit("state", state)
    return jsonify({"ok": True, "state": state})


@app.route("/api/wms")
def get_wms():
    return jsonify(sim.wms.to_dict())


# ─── WebSocket ─────────────────────────────────────────────────────
@socketio.on("connect")
def on_connect():
    print("Client connected")
    socketio.emit("state", sim.get_state())


@socketio.on("set_scenario")
def on_set_scenario(data):
    sim.set_scenario(data.get("scenario", "normal"))
    socketio.emit("state", sim.get_state())


@socketio.on("optimize")
def on_optimize(data):
    sim.optimize_placement()
    socketio.emit("state", sim.get_state())


# ─── Background simulation loop ────────────────────────────────────
def simulation_loop():
    while True:
        sim.tick()
        state = sim.get_state()
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
