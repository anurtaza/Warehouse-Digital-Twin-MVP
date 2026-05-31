import { useEffect, useRef, useState, useCallback } from "react";
import { io } from "socket.io-client";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import MetricsBar from "./components/MetricsBar";
import EventLog from "./components/EventLog";
import ScenarioPanel from "./components/ScenarioPanel";
import ThroughputChart from "./components/ThroughputChart";
import "./App.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:5000";

export default function App() {
  const mountRef = useRef(null);
  const sceneRef = useRef({});
  const [metrics, setMetrics] = useState(null);
  const [events, setEvents] = useState([]);
  const [scenario, setScenarioState] = useState("normal");
  const [connected, setConnected] = useState(false);
  const socketRef = useRef(null);

  // ── WebSocket connection ──────────────────────────────────────
  useEffect(() => {
    const socket = io(API, { transports: ["websocket"] });
    socketRef.current = socket;

    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));

    socket.on("state", (data) => {
      setMetrics(data.metrics);
      setScenarioState(data.scenario);
      updateScene(data);
    });

    socket.on("event", (ev) => {
      setEvents((prev) => [ev, ...prev].slice(0, 60));
    });

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

    sceneRef.current = { scene, renderer, camera, controls, cellMeshes: {}, agvMeshes: [] };

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
      agvMeshes.forEach(({ group, data }) => {
        const dx = data.tx - group.position.x;
        const dz = data.tz - group.position.z;
        const dist = Math.hypot(dx, dz);
        if (dist > 0.1) {
          group.position.x += (dx / dist) * 0.12;
          group.position.z += (dz / dist) * 0.12;
          group.rotation.y = Math.atan2(dx, dz);
        }
      });
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
  }, []);

  // ── Update 3D scene from WS data ─────────────────────────────
  const updateScene = useCallback((data) => {
    const { scene, cellMeshes, agvMeshes } = sceneRef.current;
    if (!scene) return;

    const COLS = 10, ROWS = 6, SHELVES = 4;
    const CW = 2.0, CD = 1.6, CH = 1.1;
    const GAP_X = 0.5, GAP_Z = 1.4;
    const OX = -(COLS * (CW + GAP_X)) / 2 + CW / 2;
    const OZ = -(ROWS * (CD + GAP_Z)) / 2 + CD / 2;

    const COLORS = { free: 0x2a7a3b, full: 0x1a5fa5, hot: 0xc0392b };

    // Update / create cell boxes
    data.cells.forEach((cell) => {
      const key = cell.id;
      const bx = OX + cell.col * (CW + GAP_X);
      const by = cell.shelf * CH + CH / 2 + 0.05;
      const bz = OZ + cell.row * (CD + GAP_Z);

      if (!cellMeshes[key]) {
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(CW - 0.15, CH - 0.1, CD - 0.15),
          new THREE.MeshLambertMaterial({ color: COLORS.free })
        );
        mesh.castShadow = true;
        scene.add(mesh);
        cellMeshes[key] = mesh;

        // Shelf frame (created once)
        if (cell.shelf === 0) {
          const frame = new THREE.Mesh(
            new THREE.BoxGeometry(CW + 0.1, SHELVES * CH + 0.4, CD + 0.1),
            new THREE.MeshLambertMaterial({ color: 0x3a4a5a })
          );
          frame.position.set(bx, (SHELVES * CH) / 2, bz);
          frame.castShadow = true;
          scene.add(frame);
        }
      }

      const mesh = cellMeshes[key];
      mesh.position.set(bx, by, bz);
      mesh.visible = cell.fill;
      mesh.material.color.setHex(cell.hot ? COLORS.hot : COLORS.full);
    });

    // Update AGVs
    agvMeshes.forEach(({ group }) => scene.remove(group));
    agvMeshes.length = 0;

    const TOTAL_W = COLS * (CW + GAP_X);
    const TOTAL_D = ROWS * (CD + GAP_Z);

    data.agvs.forEach((agv) => {
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(0.9, 0.35, 0.7),
        new THREE.MeshLambertMaterial({ color: 0xe67e22 })
      );
      const mast = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 1.4, 0.12),
        new THREE.MeshLambertMaterial({ color: 0xf39c12 })
      );
      mast.position.set(0.3, 0.88, 0);
      const fork = new THREE.Mesh(
        new THREE.BoxGeometry(0.6, 0.06, 0.08),
        new THREE.MeshLambertMaterial({ color: 0xd35400 })
      );
      fork.position.set(0.6, 0.2, 0);

      const group = new THREE.Group();
      group.add(body, mast, fork);
      group.position.set(
        agv.x - TOTAL_W / 2 + (CW + GAP_X) / 2,
        0.18,
        agv.z - TOTAL_D / 2 + (CD + GAP_Z) / 2
      );
      scene.add(group);
      agvMeshes.push({ group, data: { tx: agv.tx - TOTAL_W / 2, tz: agv.tz - TOTAL_D / 2 } });
    });

    sceneRef.current.cellMeshes = cellMeshes;
    sceneRef.current.agvMeshes = agvMeshes;
  }, []);

  // ── Scenario control ──────────────────────────────────────────
  const applyScenario = (name) => {
    fetch(`${API}/api/scenario/${name}`, { method: "POST" });
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

        <ScenarioPanel current={scenario} onSelect={applyScenario} />

        {metrics && <ThroughputChart history={metrics.throughput_history} />}

        <EventLog events={events} />
      </aside>

      <main className="viewport" ref={mountRef} />
    </div>
  );
}
