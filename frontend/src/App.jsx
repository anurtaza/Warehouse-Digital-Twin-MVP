import { useEffect, useRef, useState, useCallback } from "react";
import { io } from "socket.io-client";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import MetricsBar from "./components/MetricsBar";
import EventLog from "./components/EventLog";
import ScenarioPanel from "./components/ScenarioPanel";
import ThroughputChart from "./components/ThroughputChart";
import InsightsPanel from "./components/InsightsPanel";
import WmsPanel from "./components/WmsPanel";
import RolePanel from "./components/RolePanel";
import RoleSummaryPanel from "./components/RoleSummaryPanel";
import ScenarioAnalysisPanel from "./components/ScenarioAnalysisPanel";
import ReportPanel from "./components/ReportPanel";
import "./App.css";

const API = import.meta.env.VITE_API_URL || "/api";

export default function App() {
  const mountRef = useRef(null);
  const sceneRef = useRef({});
  const [metrics, setMetrics] = useState(null);
  const [insights, setInsights] = useState(null);
  const [analysis, setAnalysis] = useState([]);
  const [report, setReport] = useState(null);
  const [wms, setWms] = useState(null);
  const [events, setEvents] = useState([]);
  const [scenario, setScenarioState] = useState("normal");
  const [role, setRole] = useState("manager");
  const [connected, setConnected] = useState(false);
  const [tooltip, setTooltip] = useState(null);
  const socketRef = useRef(null);
  const raycasterRef = useRef(new THREE.Raycaster());
  const pointerRef = useRef(new THREE.Vector2());

  // ── WebSocket connection ──────────────────────────────────────
  useEffect(() => {
    const socket = io({ transports: ["websocket"], path: "/socket.io" });
    socketRef.current = socket;

    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));

    socket.on("state", (data) => {
      setMetrics(data.metrics);
      setInsights(data.insights);
      setAnalysis(data.analysis);
      setReport(data.report);
      setWms(data.wms);
      setScenarioState(data.scenario);
      updateScene(data);
    });

    socket.on("event", (ev) => {
      setEvents((prev) => [ev, ...prev].slice(0, 60));
    });

    fetch(`${API}/state`)
      .then((res) => res.json())
      .then((data) => {
        setMetrics(data.metrics);
        setInsights(data.insights);
        setAnalysis(data.analysis);
        setReport(data.report);
        setWms(data.wms);
        setScenarioState(data.scenario);
        updateScene(data);
      })
      .catch(() => {});

    fetch(`${API}/events`)
      .then((res) => res.json())
      .then((data) => setEvents(data))
      .catch(() => {});

    return () => socket.disconnect();
  }, []);

  // ── Three.js setup ────────────────────────────────────────────
  useEffect(() => {
    const el = mountRef.current;
    const w = el.clientWidth, h = el.clientHeight;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0x0f1923);
    el.appendChild(renderer.domElement);

    // Scene
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x0f1923, 40, 90);

    // Camera
    const camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 200);
    camera.position.set(22, 24, 28);
    camera.lookAt(0, 2, 0);

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.target.set(0, 2, 0);
    controls.maxPolarAngle = Math.PI / 2.1;
    controls.minDistance = 8;
    controls.maxDistance = 70;

    // Lights
    scene.add(new THREE.AmbientLight(0x334455, 0.9));
    const sun = new THREE.DirectionalLight(0xffffff, 1.3);
    sun.position.set(20, 30, 15);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    scene.add(sun);
    const fill = new THREE.PointLight(0x3366ff, 0.5, 50);
    fill.position.set(-15, 10, 0);
    scene.add(fill);

    // Floor
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(60, 50),
      new THREE.MeshLambertMaterial({ color: 0x1a2030 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
    scene.add(new THREE.GridHelper(60, 30, 0x243040, 0x243040));

    // Zone labels as colored planes
    const makePlane = (color, sx, sz, px, pz) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(sx, sz),
        new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.5 })
      );
      m.rotation.x = -Math.PI / 2;
      m.position.set(px, 0.05, pz);
      scene.add(m);
    };
    makePlane(0x8e44ad, 5, 5, 14, 0);   // shipping
    makePlane(0x27ae60, 4, 4, -14, 0);  // receiving

    // Optional rack markers are removed to keep the warehouse open and show aisles clearly.
    const buildRacks = () => {
      // No heavy partition walls here; the cell pallets define the rack geometry.
    };
    buildRacks();

    sceneRef.current = {
      scene,
      renderer,
      camera,
      controls,
      cellMeshes: {},
      palletMeshes: {},
      agvMeshes: {},
      routeLines: {},
    };

    const onPointerMove = (event) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointerRef.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointerRef.current.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycasterRef.current.setFromCamera(pointerRef.current, camera);

      const cellObjects = Object.values(sceneRef.current.cellMeshes);
      const agvObjects = Object.values(sceneRef.current.agvMeshes).map((item) => item.group);
      const intersects = raycasterRef.current.intersectObjects([...cellObjects, ...agvObjects], true);

      if (intersects.length > 0) {
        const target = intersects[0].object.userData || intersects[0].object.parent?.userData;
        if (target?.type === "cell") {
          const cell = target.data;
          setTooltip({
            title: cell.id,
            details: `SKU: ${cell.sku || "—"} · Кол-во: ${cell.qty} · ${cell.hot ? "Горячая зона" : cell.fill ? "Заполнена" : "Свободна"}`,
            x: event.clientX,
            y: event.clientY,
          });
          return;
        }
        if (target?.type === "agv") {
          const agv = target.data;
          setTooltip({
            title: agv.id,
            details: `Батарея: ${agv.battery}% · Цель: ${agv.tx}, ${agv.tz}`,
            x: event.clientX,
            y: event.clientY,
          });
          return;
        }
      }
      setTooltip(null);
    };

    renderer.domElement.addEventListener("pointermove", onPointerMove);

    // Resize
    const onResize = () => {
      const w2 = el.clientWidth, h2 = el.clientHeight;
      renderer.setSize(w2, h2);
      camera.aspect = w2 / h2;
      camera.updateProjectionMatrix();
    };
    window.addEventListener("resize", onResize);

    // Animate
    let raf;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      controls.update();
      const { agvMeshes } = sceneRef.current;
      Object.values(agvMeshes).forEach((entry) => {
        const { group, path } = entry;
        if (!path || path.length < 2) return;

        const targetPoint = path[entry.pathIndex || 1];
        const dx = targetPoint.x - group.position.x;
        const dz = targetPoint.z - group.position.z;
        const dist = Math.hypot(dx, dz);
        const speed = 0.14;
        if (dist < 0.08) {
          entry.pathIndex = Math.min((entry.pathIndex || 1) + 1, path.length - 1);
        } else {
          group.position.x += (dx / dist) * speed;
          group.position.z += (dz / dist) * speed;
          group.rotation.y = Math.atan2(dx, dz);
        }
      });
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(raf);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("resize", onResize);
      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
  }, []);

  // ── Update 3D scene from WS data ─────────────────────────────
  const updateScene = useCallback((data) => {
    const { scene, cellMeshes, palletMeshes, agvMeshes, routeLines } = sceneRef.current;
    if (!scene) return;

    const COLS = 10, ROWS = 6, SHELVES = 4;
    const CW = 2.0, CD = 1.6, CH = 1.1;
    const GAP_X = 0.5, GAP_Z = 1.4;
    const OX = -(COLS * (CW + GAP_X)) / 2 + CW / 2;
    const OZ = -(ROWS * (CD + GAP_Z)) / 2 + CD / 2;

    const COLORS = { empty: 0x233142, full: 0x1a5fa5, hot: 0xc0392b };

    // Update / create cell boxes
    data.cells.forEach((cell) => {
      const key = cell.id;
      const bx = OX + cell.col * (CW + GAP_X);
      const by = cell.shelf * CH + CH / 2 + 0.05;
      const bz = OZ + cell.row * (CD + GAP_Z);

      if (!cellMeshes[key]) {
        const material = new THREE.MeshStandardMaterial({ color: COLORS.empty, transparent: true, opacity: 0.18, roughness: 0.6 });
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(CW - 0.15, CH - 0.1, CD - 0.15),
          material
        );
        mesh.castShadow = true;
        mesh.userData = { type: "cell", data: cell };
        scene.add(mesh);
        cellMeshes[key] = mesh;

        const pallet = new THREE.Mesh(
          new THREE.BoxGeometry(CW - 0.4, 0.22, CD - 0.4),
          new THREE.MeshStandardMaterial({ color: 0x8d6e63, roughness: 0.7, metalness: 0.1 })
        );
        pallet.position.set(bx, by + 0.28, bz);
        pallet.castShadow = true;
        pallet.visible = false;
        scene.add(pallet);
        palletMeshes[key] = pallet;
      }

      const mesh = cellMeshes[key];
      const pallet = palletMeshes[key];
      mesh.position.set(bx, by, bz);
      mesh.visible = true;
      mesh.material.color.setHex(cell.fill ? (cell.hot ? COLORS.hot : COLORS.full) : COLORS.empty);
      mesh.material.opacity = cell.fill ? 1 : 0.18;
      mesh.userData.data = cell;

      pallet.position.set(bx, by + 0.28, bz);
      pallet.visible = cell.fill;
      pallet.material.color.setHex(cell.hot ? 0xe74c3c : 0x8d6e63);
    });

    const TOTAL_W = COLS * (CW + GAP_X);
    const TOTAL_D = ROWS * (CD + GAP_Z);
    const currentIds = new Set(data.agvs.map((a) => a.id));

    Object.keys(agvMeshes).forEach((id) => {
      if (!currentIds.has(id)) {
        scene.remove(agvMeshes[id].group);
        scene.remove(agvMeshes[id].routeLine);
        delete agvMeshes[id];
      }
    });

    const buildAisleLines = (OX, OZ, CW, CD, GAP_X, GAP_Z) => {
      const corridorXs = [];
      const corridorZs = [];
      for (let i = 0; i < COLS - 1; i++) {
        corridorXs.push(OX + (i + 0.5) * (CW + GAP_X));
      }
      for (let i = 0; i < ROWS - 1; i++) {
        corridorZs.push(OZ + (i + 0.5) * (CD + GAP_Z));
      }
      return { corridorXs, corridorZs };
    };

    const chooseClosest = (value, list) => {
      return list.reduce((best, current) => Math.abs(current - value) < Math.abs(best - value) ? current : best, list[0]);
    };

    const buildAislePath = (start, target) => {
      const { corridorXs, corridorZs } = buildAisleLines(OX, OZ, CW, CD, GAP_X, GAP_Z);
      const nearest = (value, list) => list.reduce((best, current) => Math.abs(current - value) < Math.abs(best - value) ? current : best, list[0]);
      const startCorridorX = nearest(start.x, corridorXs);
      const startCorridorZ = nearest(start.z, corridorZs);
      const targetCorridorX = nearest(target.x, corridorXs);
      const targetCorridorZ = nearest(target.z, corridorZs);

      const path = [new THREE.Vector3(start.x, start.y, start.z)];
      const addPoint = (x, y, z) => {
        const last = path[path.length - 1];
        if (Math.abs(last.x - x) > 0.01 || Math.abs(last.z - z) > 0.01) {
          path.push(new THREE.Vector3(x, y, z));
        }
      };

      // 1) Выход на ближайший коридор
      const dxToX = Math.abs(start.x - startCorridorX);
      const dzToZ = Math.abs(start.z - startCorridorZ);
      if (dxToX <= dzToZ) {
        addPoint(startCorridorX, start.y, start.z);
      } else {
        addPoint(start.x, start.y, startCorridorZ);
      }

      // 2) Движение по X/Z внутри склада: перейти на пересечение коридоров
      const current = path[path.length - 1];
      const onXcorridor = Math.abs(current.x - startCorridorX) < 0.01;
      const onZcorridor = Math.abs(current.z - startCorridorZ) < 0.01;

      if (onXcorridor) {
        addPoint(current.x, start.y, targetCorridorZ);
        addPoint(targetCorridorX, start.y, targetCorridorZ);
      } else if (onZcorridor) {
        addPoint(targetCorridorX, start.y, current.z);
        addPoint(targetCorridorX, start.y, targetCorridorZ);
      }

      // 3) Вход в целевую ячейку
      addPoint(target.x, start.y, target.z);
      return path;
    };

    data.agvs.forEach((agv) => {
      const key = agv.id;
      const worldX = OX + agv.x * (CW + GAP_X);
      const worldZ = OZ + agv.z * (CD + GAP_Z);
      const targetX = OX + agv.tx * (CW + GAP_X);
      const targetZ = OZ + agv.tz * (CD + GAP_Z);
      const batteryColor = agv.battery < 30 ? 0xc0392b : agv.battery < 60 ? 0xf39c12 : 0x27ae60;

      let entry = agvMeshes[key];
      const startPos = entry ? entry.group.position.clone() : new THREE.Vector3(worldX, 0.18, worldZ);
      const targetPos = new THREE.Vector3(targetX, 0.18, targetZ);
      const path = buildAislePath(startPos, targetPos);

      if (!entry) {
        const body = new THREE.Mesh(
          new THREE.BoxGeometry(0.9, 0.22, 0.62),
          new THREE.MeshStandardMaterial({ color: batteryColor, roughness: 0.35, metalness: 0.5 })
        );
        body.position.set(0, 0.16, 0);

        const platform = new THREE.Mesh(
          new THREE.BoxGeometry(0.85, 0.08, 0.6),
          new THREE.MeshStandardMaterial({ color: 0x1e2f3c, roughness: 0.6, metalness: 0.3 })
        );
        platform.position.set(0, 0.06, 0);

        const cabin = new THREE.Mesh(
          new THREE.BoxGeometry(0.45, 0.18, 0.42),
          new THREE.MeshStandardMaterial({ color: 0x34495e, roughness: 0.5, metalness: 0.25 })
        );
        cabin.position.set(-0.05, 0.24, 0);

        const light = new THREE.Mesh(
          new THREE.SphereGeometry(0.07, 10, 8),
          new THREE.MeshStandardMaterial({ color: 0x7fffd4, emissive: 0x7fffd4, emissiveIntensity: 0.65 })
        );
        light.position.set(0.34, 0.18, 0);

        const wheelMesh = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.4, metalness: 0.7 });
        const makeWheel = (x, z) => {
          const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.14, 12), wheelMesh);
          wheel.rotation.z = Math.PI / 2;
          wheel.position.set(x, 0.06, z);
          return wheel;
        };

        const group = new THREE.Group();
        group.userData = { type: "agv", data: { ...agv, worldTx: targetX, worldTz: targetZ } };
        group.add(body, platform, cabin, light,
          makeWheel(0.3, 0.28),
          makeWheel(-0.3, 0.28),
          makeWheel(0.3, -0.28),
          makeWheel(-0.3, -0.28)
        );
        group.position.copy(startPos);
        scene.add(group);

        const routeLine = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(path),
          new THREE.LineDashedMaterial({ color: 0x57c7ff, dashSize: 0.4, gapSize: 0.2, transparent: true, opacity: 0.7 })
        );
        routeLine.computeLineDistances();
        scene.add(routeLine);

        entry = { group, routeLine, path, pathIndex: 1 };
        agvMeshes[key] = entry;
      } else {
        const distance = entry.group.position.distanceTo(startPos);
        if (distance > 1.5) {
          entry.group.position.copy(startPos);
        }
        entry.group.rotation.y = Math.atan2(targetX - entry.group.position.x, targetZ - entry.group.position.z);
        entry.group.userData.data = { ...agv, worldTx: targetX, worldTz: targetZ };
        entry.group.children[0].material.color.setHex(batteryColor);
        entry.path = path;
        entry.pathIndex = Math.min(entry.pathIndex || 1, entry.path.length - 1);
        entry.routeLine.geometry.setFromPoints(path);
        entry.routeLine.computeLineDistances();
      }
    });

    sceneRef.current.cellMeshes = cellMeshes;
    sceneRef.current.palletMeshes = palletMeshes;
    sceneRef.current.agvMeshes = agvMeshes;
    sceneRef.current.routeLines = routeLines;
  }, []);

  // ── Scenario control ──────────────────────────────────────────
  const applyScenario = (name) => {
    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit("set_scenario", { scenario: name });
    } else {
      fetch(`${API}/scenario/${name}`, { method: "POST" });
    }
  };
  const exportReport = () => {
    const payload = report && metrics ? {
      report,
      metrics,
      scenario,
      generated_at: report?.generated_at,
    } : null;
    if (!payload) return;
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `warehouse-report-${new Date().toISOString().slice(0,10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const optimizePlacement = () => {
    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit("optimize", {});
      return;
    }
    fetch(`${API}/optimize`, { method: "POST" })
      .then((res) => res.json())
      .then((data) => {
        if (data.state) {
          setMetrics(data.state.metrics);
          setInsights(data.state.insights);
          setWms(data.state.wms);
          updateScene(data.state);
        }
      })
      .catch(() => {});
  };

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="logo">
          <span className="logo-icon">🏭</span>
          <div>
            <div className="logo-title">Digital Twin</div>
            <div className="logo-sub">Склад A3</div>
          </div>
          <span className={`status ${connected ? "ok" : "off"}`}>
            {connected ? "● Live" : "○ Офлайн"}
          </span>
        </div>

        {metrics && <MetricsBar metrics={metrics} />}
        <RolePanel role={role} onSelect={setRole} />
        <RoleSummaryPanel role={role} metrics={metrics} insights={insights} wms={wms} />
        {report && <ReportPanel report={report} onExport={exportReport} />}
        {insights && <InsightsPanel insights={insights} />}
        {wms && <WmsPanel wms={wms} />}

        <div className="section">
          <div className="section-title">Умная оптимизация</div>
          <button className="action-btn" onClick={optimizePlacement}>Оптимизировать размещение SKU</button>
        </div>

        <ScenarioPanel current={scenario} onSelect={applyScenario} />
        <ScenarioAnalysisPanel analysis={analysis} />

        {metrics && <ThroughputChart history={metrics.throughput_history} />}

        <EventLog events={events} />
      </aside>

      <main className="viewport" ref={mountRef}>
        {tooltip && (
          <div className="tooltip" style={{ left: tooltip.x + 14, top: tooltip.y + 14 }}>
            <div className="tooltip-title">{tooltip.title}</div>
            <div className="tooltip-detail">{tooltip.details}</div>
          </div>
        )}
      </main>
    </div>
  );
}
