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

const API_ORIGIN = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
const API = API_ORIGIN ? `${API_ORIGIN}/api` : "/api";
const SOCKET_URL = API_ORIGIN || undefined;

export default function App() {
  const mountRef = useRef(null);
  const sceneRef = useRef({});
  const [metrics, setMetrics] = useState(null);
  const [insights, setInsights] = useState(null);
  const [analysis, setAnalysis] = useState([]);
  const [report, setReport] = useState(null);
  const [wms, setWms] = useState(null);
  const [fifo, setFifo] = useState(null);
  const [events, setEvents] = useState([]);
  const [agvsList, setAgvsList] = useState([]);
  const [plannerStatus, setPlannerStatus] = useState(null);
  const [scenario, setScenarioState] = useState("normal");
  const [role, setRole] = useState("manager");
  const [connected, setConnected] = useState(false);
  const [tooltip, setTooltip] = useState(null);
  const [selectedAgv, setSelectedAgv] = useState(0);
  const [routeTarget, setRouteTarget] = useState({ col: 0, row: 0 });
  const [workerRoute, setWorkerRoute] = useState(null);
  const [workerRouteForm, setWorkerRouteForm] = useState({
    startCol: 0,
    startRow: 0,
    goalCol: 5,
    goalRow: 3,
  });
  const [routeEditMode, setRouteEditMode] = useState(false);
  const [operatorMessage, setOperatorMessage] = useState("");
  const [sidebarWidth, setSidebarWidth] = useState(360);
  const socketRef = useRef(null);
  const raycasterRef = useRef(new THREE.Raycaster());
  const pointerRef = useRef(new THREE.Vector2());
  const selectedAgvRef = useRef(0);
  const routeEditModeRef = useRef(false);
  const assignRouteRef = useRef(null);

  // Auth
  const [token, setToken] = useState(null);
  const tokenRef = useRef(null);
  const [userRole, setUserRole] = useState(null);
  const userRoleRef = useRef(null);
  const [loginUser, setLoginUser] = useState("manager");
  const [loginPass, setLoginPass] = useState("managerpass");

  const activeRole = userRole || "viewer";
  const canOperate = activeRole === "operator" || activeRole === "manager";
  const canManage = activeRole === "manager";
  const isLogistics = activeRole === "logistics";
  const canViewOperations = canOperate || canManage;
  const canViewPlanning = canManage || isLogistics;
  const canViewWms = canManage || isLogistics;
  const canViewInsights = canManage || activeRole === "operator";
  const canPlanWorkerRoute = activeRole === "operator" || activeRole === "manager" || activeRole === "logistics";

  const authHeaders = (extra = {}) => {
    const headers = { ...extra };
    if (tokenRef.current) headers.Authorization = `Bearer ${tokenRef.current}`;
    return headers;
  };

  const refreshState = useCallback(() => {
    return fetch(`${API}/state`)
      .then((res) => res.json())
      .then((data) => {
        setMetrics(data.metrics);
        setInsights(data.insights);
        setAnalysis(data.analysis);
        setReport(data.report);
        setWms(data.wms);
        setFifo(data.fifo || null);
        setPlannerStatus(data.planner);
        setScenarioState(data.scenario);
        updateScene(data);
        setAgvsList(data.agvs || []);
        return data;
      })
      .catch(() => null);
  }, []);

  // ── WebSocket connection ──────────────────────────────────────
  useEffect(() => {
    const socket = io(SOCKET_URL, { transports: ["websocket"], path: "/socket.io" });
    socketRef.current = socket;

    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));

    socket.on("state", (data) => {
      setMetrics(data.metrics);
      setInsights(data.insights);
      setAnalysis(data.analysis);
      setReport(data.report);
      setWms(data.wms);
        setFifo(data.fifo || null);
      setPlannerStatus(data.planner);
      setScenarioState(data.scenario);
      updateScene(data);
      setAgvsList(data.agvs || []);
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
        setFifo(data.fifo || null);
        setPlannerStatus(data.planner);
        setScenarioState(data.scenario);
        updateScene(data);
        setAgvsList(data.agvs || []);
      })
      .catch(() => {});

    fetch(`${API}/events`)
      .then((res) => res.json())
      .then((data) => setEvents(data))
      .catch(() => {});

    return () => socket.disconnect();
  }, []);

  useEffect(() => {
    tokenRef.current = token;
  }, [token]);
  useEffect(() => {
    userRoleRef.current = userRole;
  }, [userRole]);
  useEffect(() => {
    selectedAgvRef.current = selectedAgv;
  }, [selectedAgv]);
  useEffect(() => {
    routeEditModeRef.current = routeEditMode;
  }, [routeEditMode]);
  useEffect(() => {
    const savedToken = localStorage.getItem("warehouse_token");
    const savedRole = localStorage.getItem("warehouse_role");
    const savedUser = localStorage.getItem("warehouse_user");
    if (savedToken && savedRole) {
      setToken(savedToken);
      setUserRole(savedRole);
      setRole(savedRole);
      setLoginUser(savedUser || savedRole);
    }
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
      workerRouteLine: null,
      workerRouteMarkers: [],
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
        if (target?.type === "Погрузчик") {
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

    const onCanvasClick = (event) => {
      if (!routeEditModeRef.current) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointerRef.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointerRef.current.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycasterRef.current.setFromCamera(pointerRef.current, camera);

      const cellObjects = Object.values(sceneRef.current.cellMeshes);
      const intersects = raycasterRef.current.intersectObjects(cellObjects, true);
      if (!intersects.length) return;

      const target = intersects[0].object.userData || intersects[0].object.parent?.userData;
      if (target?.type !== "cell") return;

      const cell = target.data;
      setOperatorMessage(`Планирование маршрута AGV-${selectedAgvRef.current} → ${cell.id}...`);
      setRouteTarget({ col: cell.col, row: cell.row });
      assignRouteRef.current?.(selectedAgvRef.current, cell.col, cell.row, cell.id);
    };

    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("click", onCanvasClick);

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
      Object.values(agvMeshes || {}).forEach((entry) => {
        if (!entry.backendPosition) return;

        const drift = entry.group.position.distanceTo(entry.backendPosition);
        if (drift > 4.5) {
          entry.group.position.copy(entry.backendPosition);
        }

        const previous = entry.group.position.clone();
        if (!entry.paused) {
          entry.group.position.lerp(entry.backendPosition, 0.14);
        }
        const delta = entry.group.position.clone().sub(previous);
        if (delta.length() > 0.002) {
          entry.targetRotation = Math.atan2(delta.x, delta.z);
          entry.wheels?.forEach((wheel) => {
            wheel.rotation.x += delta.length() * 8;
          });
        }

        if (entry.targetRotation !== undefined) {
          const current = entry.group.rotation.y;
          let delta = entry.targetRotation - current;
          delta = Math.atan2(Math.sin(delta), Math.cos(delta));
          entry.group.rotation.y = current + delta * 0.18;
        }
      });
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(raf);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("click", onCanvasClick);
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
    const currentIds = new Set(data.agvs.map((a) => String(a.id)));

    Object.keys(agvMeshes).forEach((id) => {
      if (!currentIds.has(id)) {
        scene.remove(agvMeshes[id].group);
        scene.remove(agvMeshes[id].routeLine);
        agvMeshes[id].routeMarkers?.forEach((marker) => scene.remove(marker));
        delete agvMeshes[id];
      }
    });

    const agvPoint = (col, row, y = 0.28) => new THREE.Vector3(
      OX + col * (CW + GAP_X),
      y,
      OZ + row * (CD + GAP_Z)
    );

    const buildRightAnglePath = (start, end) => {
      const path = [start.clone()];
      const xFirst = Math.abs(end.x - start.x) >= Math.abs(end.z - start.z);
      const corner = xFirst
        ? new THREE.Vector3(end.x, start.y, start.z)
        : new THREE.Vector3(start.x, start.y, end.z);

      if (corner.distanceTo(start) > 0.05 && corner.distanceTo(end) > 0.05) {
        path.push(corner);
      }
      path.push(end.clone());
      return path;
    };

    const orthogonalizePath = (points) => {
      const normalized = [];
      points.forEach((point, index) => {
        const current = point.clone();
        if (index === 0) {
          normalized.push(current);
          return;
        }
        const previous = normalized[normalized.length - 1];
        if (previous.distanceTo(current) < 0.05) return;

        const sameX = Math.abs(previous.x - current.x) < 0.05;
        const sameZ = Math.abs(previous.z - current.z) < 0.05;
        if (sameX || sameZ) {
          normalized.push(current);
          return;
        }

        const [, ...rest] = buildRightAnglePath(previous, current);
        rest.forEach((candidate) => {
          const last = normalized[normalized.length - 1];
          if (last.distanceTo(candidate) > 0.05) normalized.push(candidate);
        });
      });
      return normalized;
    };

    const corridorXs = Array.from({ length: COLS - 1 }, (_, index) => OX + (index + 0.5) * (CW + GAP_X));
    const corridorZs = Array.from({ length: ROWS - 1 }, (_, index) => OZ + (index + 0.5) * (CD + GAP_Z));
    const nearest = (value, list) => list.reduce(
      (best, current) => Math.abs(current - value) < Math.abs(best - value) ? current : best,
      list[0]
    );

    const buildAislePath = (start, end) => {
      const y = start.y;
      const startAisleX = nearest(start.x, corridorXs);
      const startAisleZ = nearest(start.z, corridorZs);
      const endAisleX = nearest(end.x, corridorXs);
      const endAisleZ = nearest(end.z, corridorZs);
      const path = [start.clone()];

      const addPoint = (x, z) => {
        const last = path[path.length - 1];
        const point = new THREE.Vector3(x, y, z);
        if (last.distanceTo(point) > 0.05) path.push(point);
      };

      if (Math.abs(start.x - startAisleX) <= Math.abs(start.z - startAisleZ)) {
        addPoint(startAisleX, start.z);
        addPoint(startAisleX, startAisleZ);
      } else {
        addPoint(start.x, startAisleZ);
        addPoint(startAisleX, startAisleZ);
      }

      addPoint(startAisleX, endAisleZ);
      addPoint(endAisleX, endAisleZ);

      if (Math.abs(end.x - endAisleX) <= Math.abs(end.z - endAisleZ)) {
        addPoint(endAisleX, end.z);
      } else {
        addPoint(end.x, endAisleZ);
      }
      addPoint(end.x, end.z);

      return orthogonalizePath(path);
    };

    const buildAisleSequencePath = (points) => {
      if (points.length <= 1) return points.map((point) => point.clone());
      const sequence = [];
      for (let index = 0; index < points.length - 1; index += 1) {
        const segment = buildAislePath(points[index], points[index + 1]);
        segment.forEach((point) => {
          const last = sequence[sequence.length - 1];
          if (!last || last.distanceTo(point) > 0.05) sequence.push(point);
        });
      }
      return sequence;
    };

    const displayRoutePath = (path) => path.map((point) => new THREE.Vector3(point.x, 0.9, point.z));

    const clearRouteMarkers = (entry) => {
      entry.routeMarkers?.forEach((marker) => {
        scene.remove(marker);
        marker.geometry?.dispose();
        marker.material?.dispose();
      });
      entry.routeMarkers = [];
    };

    const drawRouteMarkers = (entry, points, visible) => {
      clearRouteMarkers(entry);
      if (!visible || points.length < 2) return;

      const material = new THREE.MeshStandardMaterial({
        color: 0x7fffd4,
        emissive: 0x2ecc71,
        emissiveIntensity: 0.65,
        transparent: true,
        opacity: 0.95,
        depthTest: false,
      });

      for (let index = 0; index < points.length - 1; index += 1) {
        const start = points[index];
        const end = points[index + 1];
        const segment = end.clone().sub(start);
        const length = segment.length();
        if (length < 0.05) continue;

        const tube = new THREE.Mesh(
          new THREE.CylinderGeometry(0.055, 0.055, length, 10),
          material.clone()
        );
        tube.position.copy(start).add(end).multiplyScalar(0.5);
        tube.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          segment.clone().normalize()
        );
        tube.renderOrder = 12;
        scene.add(tube);
        entry.routeMarkers.push(tube);
      }
    };

    const chooseDriveIndex = (groupPosition, path, previousIndex = 1) => {
      if (path.length <= 1) return 0;
      let nearestIndex = 0;
      let nearestDistance = Infinity;
      path.forEach((point, index) => {
        const distance = groupPosition.distanceTo(point);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestIndex = index;
        }
      });
      const nextIndex = Math.max(1, Math.min(nearestIndex + 1, path.length - 1));
      if (previousIndex > nextIndex && previousIndex < path.length) return previousIndex;
      return nextIndex;
    };

    data.agvs.forEach((agv) => {
      const key = agv.id;
      const worldX = OX + agv.x * (CW + GAP_X);
      const worldZ = OZ + agv.z * (CD + GAP_Z);
      const targetX = OX + agv.tx * (CW + GAP_X);
      const targetZ = OZ + agv.tz * (CD + GAP_Z);
      const batteryColor = agv.battery < 30 ? 0xc0392b : agv.battery < 60 ? 0xf39c12 : 0x27ae60;

      let entry = agvMeshes[key];
      const backendPos = new THREE.Vector3(worldX, 0.18, worldZ);
      const targetPos = new THREE.Vector3(targetX, 0.18, targetZ);
      const displayNodes = agv.route_path?.length ? agv.route_path : agv.planned_path;
      const hasAssignedRoute = Boolean(displayNodes?.length > 1 && (agv.planned_path?.length || agv.hold_position || agv.manual));
      const plannedPoints = displayNodes?.length
        ? displayNodes.map(([col, row]) => agvPoint(col, row, 0.18))
        : [];
      const path = hasAssignedRoute
        ? orthogonalizePath(plannedPoints)
        : [backendPos];
      const routePath = displayRoutePath(path);

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
        const wheels = [
          makeWheel(0.3, 0.28),
          makeWheel(-0.3, 0.28),
          makeWheel(0.3, -0.28),
          makeWheel(-0.3, -0.28)
        ];

        group.add(body, platform, cabin, light, ...wheels);
        group.position.copy(backendPos);
        scene.add(group);

        const routeLine = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(routePath),
          new THREE.LineDashedMaterial({
            color: 0x7fffd4,
            dashSize: 0.55,
            gapSize: 0.18,
            transparent: true,
            opacity: 0.95,
            depthTest: false,
          })
        );
        routeLine.renderOrder = 10;
        routeLine.computeLineDistances();
        routeLine.visible = hasAssignedRoute;
        scene.add(routeLine);

        entry = {
          group,
          routeLine,
          routeMarkers: [],
          path,
          backendPosition: backendPos.clone(),
          targetRotation: group.rotation.y,
          wheels,
          paused: agv.paused,
          routeActive: hasAssignedRoute,
        };
        drawRouteMarkers(entry, routePath, hasAssignedRoute);
        agvMeshes[key] = entry;
      } else {
        entry.backendPosition = backendPos.clone();
        entry.paused = agv.paused;
        entry.routeActive = hasAssignedRoute;
        entry.routeLine.visible = hasAssignedRoute;
        entry.group.userData.data = { ...agv, worldTx: targetX, worldTz: targetZ };
        entry.group.children[0].material.color.setHex(batteryColor);
        entry.path = path;
        entry.routeLine.geometry.setFromPoints(routePath);
        entry.routeLine.computeLineDistances();
        drawRouteMarkers(entry, routePath, hasAssignedRoute);
      }
    });

    sceneRef.current.cellMeshes = cellMeshes;
    sceneRef.current.palletMeshes = palletMeshes;
    sceneRef.current.agvMeshes = agvMeshes;
    sceneRef.current.routeLines = routeLines;
    // update agv list for control panel
    setAgvsList(data.agvs || []);
  }, []);

  const assignRoute = (agvId, col, row, label = `C${col}/R${row}`) => {
    if (!canOperate) {
      setOperatorMessage("Маршрут может назначать только operator или manager.");
      return;
    }

    const nextCol = Number(col);
    const nextRow = Number(row);
    if (!Number.isInteger(nextCol) || !Number.isInteger(nextRow) || nextCol < 0 || nextCol > 9 || nextRow < 0 || nextRow > 5) {
      setOperatorMessage("Укажите координаты: колонка 0..9, ряд 0..5.");
      return;
    }

    const headers = authHeaders({ "Content-Type": "application/json" });
    setOperatorMessage(`Планирование маршрута Погрузчика-${agvId} → ${label}...`);
    fetch(`${API}/planner/assign`, {
      method: "POST",
      headers,
      body: JSON.stringify({ agv_id: agvId, col: nextCol, row: nextRow }),
    })
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) {
          setOperatorMessage(data.error === "forbidden"
            ? "Недостаточно прав для назначения маршрута."
            : `Маршрут не назначен: ${data.error || "ошибка"}`);
          return;
        }
        const state = data.state;
        setOperatorMessage(`Маршрут поставлен: Погрузчик-${agvId} → ${label}`);
        if (state) {
          setMetrics(state.metrics);
          setInsights(state.insights);
          setAnalysis(state.analysis);
          setReport(state.report);
          setWms(state.wms);
          setPlannerStatus(state.planner);
          updateScene(state);
          setAgvsList(state.agvs || []);
        }
      })
      .catch(() => setOperatorMessage("Не удалось назначить маршрут."));
  };

  useEffect(() => {
    assignRouteRef.current = assignRoute;
  }, [assignRoute]);

  const gridToWorld = (col, row, y = 0.34) => {
    const COLS = 10;
    const ROWS = 6;
    const CW = 2.0;
    const CD = 1.6;
    const GAP_X = 0.5;
    const GAP_Z = 1.4;
    const OX = -(COLS * (CW + GAP_X)) / 2 + CW / 2;
    const OZ = -(ROWS * (CD + GAP_Z)) / 2 + CD / 2;
    return new THREE.Vector3(OX + col * (CW + GAP_X), y, OZ + row * (CD + GAP_Z));
  };

  const renderWorkerRoute = (path) => {
    const { scene } = sceneRef.current;
    if (!scene) return;

    if (sceneRef.current.workerRouteLine) {
      scene.remove(sceneRef.current.workerRouteLine);
      sceneRef.current.workerRouteLine.geometry.dispose();
      sceneRef.current.workerRouteLine.material.dispose();
      sceneRef.current.workerRouteLine = null;
    }
    sceneRef.current.workerRouteMarkers?.forEach((marker) => {
      scene.remove(marker);
      marker.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
    });
    sceneRef.current.workerRouteMarkers = [];

    if (!path?.length) return;
    const points = path.map(([col, row]) => gridToWorld(col, row, 5.4));
    const routeGroup = new THREE.Group();
    const routeMaterial = new THREE.MeshStandardMaterial({
        color: 0x2ecc71,
        emissive: 0x2ecc71,
        emissiveIntensity: 0.55,
        transparent: true,
        opacity: 0.95,
    });

    for (let index = 0; index < points.length - 1; index += 1) {
      const start = points[index];
      const end = points[index + 1];
      const segment = end.clone().sub(start);
      const length = segment.length();
      if (length < 0.01) continue;

      const cylinder = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.08, length, 12),
        routeMaterial
      );
      cylinder.position.copy(start).add(end).multiplyScalar(0.5);
      cylinder.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        segment.clone().normalize()
      );
      routeGroup.add(cylinder);
    }

    scene.add(routeGroup);
    sceneRef.current.workerRouteLine = routeGroup;

    const makeMarker = (point, color, height) => {
      const group = new THREE.Group();
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.05, height, 12),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.18 })
      );
      pole.position.set(point.x, height / 2, point.z);
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(0.28, 16, 12),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.55 })
      );
      dot.position.set(point.x, height + 0.28, point.z);
      group.add(pole, dot);
      scene.add(group);
      return group;
    };

    const startGround = gridToWorld(path[0][0], path[0][1], 0.1);
    const goal = path[path.length - 1];
    const goalGround = gridToWorld(goal[0], goal[1], 0.1);
    const startMarker = makeMarker(startGround, 0x2ecc71, 5.2);
    const goalMarker = makeMarker(goalGround, 0xff4f4f, 5.2);
    const waypointMarkers = path.slice(1, -1).map(([col, row]) => {
      const point = gridToWorld(col, row, 5.4);
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(0.13, 10, 8),
        new THREE.MeshStandardMaterial({ color: 0x7fffd4, emissive: 0x2ecc71, emissiveIntensity: 0.25 })
      );
      marker.position.copy(point);
      scene.add(marker);
      return marker;
    });
    sceneRef.current.workerRouteMarkers = [startMarker, goalMarker, ...waypointMarkers];
  };

  const planWorkerRoute = () => {
    if (!canPlanWorkerRoute) {
      setOperatorMessage("Маршрут складовщика доступен для operator, logistics и manager.");
      return;
    }

    const payload = {
      start: {
        col: Number(workerRouteForm.startCol),
        row: Number(workerRouteForm.startRow),
      },
      goal: {
        col: Number(workerRouteForm.goalCol),
        row: Number(workerRouteForm.goalRow),
      },
    };

    fetch(`${API}/worker/route`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    })
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) {
          setOperatorMessage(`Маршрут складовщика не построен: ${data.error || "ошибка"}`);
          return;
        }
        setWorkerRoute(data);
        renderWorkerRoute(data.path);
        setOperatorMessage(`Маршрут складовщика построен на 3D: ${data.distance} шагов, ETA ${data.eta_minutes} мин`);
      })
      .catch(() => setOperatorMessage("Не удалось построить маршрут складовщика."));
  };

  const clearWorkerRoute = () => {
    setWorkerRoute(null);
    renderWorkerRoute([]);
    setOperatorMessage("Маршрут складовщика очищен с 3D-сцены.");
  };

  const sendAgvCommand = (id, cmd, args = {}) => {
    const headers = authHeaders({ "Content-Type": "application/json" });
    setOperatorMessage(`Команда Погрузчик-${id}: ${cmd}`);
    fetch(`${API}/agv/${id}/command`, {
      method: "POST",
      headers,
      body: JSON.stringify({ cmd, args }),
    })
      .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) {
          setOperatorMessage(data.error === "auth_required"
            ? "Войдите как operator или manager."
            : `Команда отклонена: ${data.error || "ошибка"}`);
          return;
        }
        setOperatorMessage(`Команда принята: Погрузчик-${id} ${cmd}`);
        if (data.state) {
          setMetrics(data.state.metrics);
          setInsights(data.state.insights);
          setAnalysis(data.state.analysis);
          setReport(data.state.report);
          setWms(data.state.wms);
          setFifo(data.state.fifo || null);
          setPlannerStatus(data.state.planner);
          updateScene(data.state);
          setAgvsList(data.state.agvs || []);
        }
      })
      .catch(() => setOperatorMessage("Не удалось отправить команду."));
  };

  // ── Scenario control ──────────────────────────────────────────
  const applyScenario = (name) => {
    fetch(`${API}/scenario/${name}`, {
      method: "POST",
      headers: authHeaders(),
    })
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) {
          setOperatorMessage("Сценарий может менять только manager.");
          return;
        }
        if (data.state) {
          setMetrics(data.state.metrics);
          setInsights(data.state.insights);
          setAnalysis(data.state.analysis);
          setReport(data.state.report);
          setWms(data.state.wms);
          setFifo(data.state.fifo || null);
          setPlannerStatus(data.state.planner);
          setScenarioState(data.state.scenario);
          updateScene(data.state);
          setAgvsList(data.state.agvs || []);
        }
      })
      .catch(() => setOperatorMessage("Не удалось переключить сценарий."));
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
    fetch(`${API}/optimize`, {
      method: "POST",
      headers: authHeaders(),
    })
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) {
          setOperatorMessage("Оптимизацию может запускать только manager.");
          return;
        }
        if (data.state) {
          setMetrics(data.state.metrics);
          setInsights(data.state.insights);
          setAnalysis(data.state.analysis);
          setReport(data.state.report);
          setWms(data.state.wms);
          setFifo(data.state.fifo || null);
          setPlannerStatus(data.state.planner);
          updateScene(data.state);
          setAgvsList(data.state.agvs || []);
        }
      })
      .catch(() => setOperatorMessage("Не удалось запустить оптимизацию."));
  };

  const login = () => {
    fetch(`${API}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: loginUser, password: loginPass }),
    })
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) {
          setOperatorMessage("Неверный логин или пароль.");
          return;
        }
        setToken(data.token);
        setUserRole(data.role);
        setRole(data.role);
        localStorage.setItem("warehouse_token", data.token);
        localStorage.setItem("warehouse_role", data.role);
        localStorage.setItem("warehouse_user", data.username);
        setOperatorMessage(`Вход выполнен: ${data.username} (${data.role})`);
      })
      .catch(() => setOperatorMessage("Не удалось войти."));
  };

  const logout = () => {
    setToken(null);
    setUserRole(null);
    localStorage.removeItem("warehouse_token");
    localStorage.removeItem("warehouse_role");
    localStorage.removeItem("warehouse_user");
    setOperatorMessage("Сессия завершена.");
  };

  const beginSidebarResize = (event) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    const onMove = (moveEvent) => {
      const nextWidth = Math.max(300, Math.min(520, startWidth + moveEvent.clientX - startX));
      setSidebarWidth(nextWidth);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div className="layout" style={{ gridTemplateColumns: `${sidebarWidth}px 1fr` }}>
      <aside className="sidebar">
        <button
          className="sidebar-resizer"
          type="button"
          aria-label="Изменить ширину панели"
          onPointerDown={beginSidebarResize}
        />
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

        <div className="section auth-panel">
          <div className="section-title">Доступ оператора</div>
          {userRole ? (
            <div className="auth-session">
              <div>
                <div className="auth-user">{loginUser || "user"}</div>
                <div className="auth-role">{userRole}</div>
              </div>
              <button className="action-btn secondary" onClick={logout}>Выйти</button>
            </div>
          ) : (
            <div className="login-grid">
              <select value={loginUser} onChange={(e) => {
                const value = e.target.value;
                setLoginUser(value);
                setLoginPass(`${value}pass`);
              }}>
                <option value="manager">manager</option>
                <option value="operator">operator</option>
                <option value="logistics">logistics</option>
                <option value="viewer">viewer</option>
              </select>
              <input value={loginPass} onChange={(e) => setLoginPass(e.target.value)} type="password" />
              <button className="action-btn" onClick={login}>Войти</button>
            </div>
          )}
        </div>

        {metrics && <MetricsBar metrics={metrics} />}
        <RolePanel role={activeRole} />
        <RoleSummaryPanel role={activeRole} metrics={metrics} insights={insights} wms={wms} />

        {canPlanWorkerRoute && (
        <div className="section worker-route-panel">
          <div className="section-title">Маршрут складовщика</div>
          <div className="worker-route-hint">
            Введите старт и цель, затем маршрут появится зелёной линией на 3D-сцене. Точки маршрута останутся ниже.
          </div>
          <div className="worker-route-grid">
            <label>
              Старт C
              <input
                type="number"
                min="0"
                max="9"
                value={workerRouteForm.startCol}
                onChange={(e) => setWorkerRouteForm((value) => ({ ...value, startCol: e.target.value }))}
              />
            </label>
            <label>
              Старт R
              <input
                type="number"
                min="0"
                max="5"
                value={workerRouteForm.startRow}
                onChange={(e) => setWorkerRouteForm((value) => ({ ...value, startRow: e.target.value }))}
              />
            </label>
            <label>
              Цель C
              <input
                type="number"
                min="0"
                max="9"
                value={workerRouteForm.goalCol}
                onChange={(e) => setWorkerRouteForm((value) => ({ ...value, goalCol: e.target.value }))}
              />
            </label>
            <label>
              Цель R
              <input
                type="number"
                min="0"
                max="5"
                value={workerRouteForm.goalRow}
                onChange={(e) => setWorkerRouteForm((value) => ({ ...value, goalRow: e.target.value }))}
              />
            </label>
          </div>
          <div className="worker-route-actions">
            <button className="action-btn compact" onClick={planWorkerRoute}>Построить на 3D</button>
            <button className="action-btn secondary compact" onClick={clearWorkerRoute}>Очистить</button>
          </div>
          {workerRoute && (
            <div className="worker-route-result">
              <div className="worker-route-summary">
                3D-маршрут построен · {workerRoute.distance} шагов · ETA {workerRoute.eta_minutes} мин
              </div>
              <div className="worker-route-endpoints">
                Старт: C{workerRoute.path[0][0]}/R{workerRoute.path[0][1]} · Цель: C{workerRoute.path.at(-1)[0]}/R{workerRoute.path.at(-1)[1]}
              </div>
              <div className="worker-route-steps">
                {workerRoute.path.map(([col, row], index) => (
                  <span key={`${col}-${row}-${index}`}>C{col}/R{row}</span>
                ))}
              </div>
            </div>
          )}
        </div>
        )}

        {canViewOperations && (
        <div className="section agv-control">
          <div className="section-title">Loader Control Center</div>
          {operatorMessage && <div className="operator-message">{operatorMessage}</div>}
          {plannerStatus && (
            <div className="planner-strip">
              <span>Reserved cells: {plannerStatus.reserved_vertices}</span>
              <span>Agents: {plannerStatus.agents}</span>
            </div>
          )}
          <div className="route-editor-head">
            <div>
              <div className="route-title">Построение маршрута</div>
              <div className="route-sub">Выберите Погрузчика, затем кликните по ячейке или задайте координаты</div>
            </div>
            <button
              className={`toggle-btn ${routeEditMode ? "active" : ""}`}
              disabled={!canOperate}
              onClick={() => setRouteEditMode((value) => !value)}
            >
              {routeEditMode ? "Editing" : "Route"}
            </button>
          </div>
          <div className="route-manual">
            <label>
              Колонка
              <input
                type="number"
                min="0"
                max="9"
                value={routeTarget.col}
                disabled={!canOperate}
                onChange={(e) => setRouteTarget((value) => ({ ...value, col: e.target.value }))}
              />
            </label>
            <label>
              Ряд
              <input
                type="number"
                min="0"
                max="5"
                value={routeTarget.row}
                disabled={!canOperate}
                onChange={(e) => setRouteTarget((value) => ({ ...value, row: e.target.value }))}
              />
            </label>
            <button
              className="action-btn compact"
              disabled={!canOperate}
              onClick={() => assignRoute(selectedAgv, routeTarget.col, routeTarget.row)}
            >
              Поставить
            </button>
          </div>
          {agvsList && agvsList.length === 0 && <div style={{opacity:0.7}}>No Loaders</div>}
          {agvsList && agvsList.map((a) => (
            <div
              key={a.id}
              className={`agv-card ${selectedAgv === a.id ? "selected" : ""}`}
              onClick={() => setSelectedAgv(a.id)}
            >
              <div className="agv-card-head">
                <strong>Погрузчик-{a.id}</strong>
                <span className={`agv-status ${a.paused ? "paused" : a.manual ? "manual" : ""}`}>{a.status}</span>
              </div>
              <div className="agv-detail">
                Battery {a.battery}% · Target {a.tx}, {a.tz}
                {a.planned_path?.length ? ` · Route ${a.planned_path.length} nodes` : ""}
              </div>
              <div className="agv-actions">
                <button className="icon-btn" disabled={!canOperate} onClick={(e) => { e.stopPropagation(); sendAgvCommand(a.id, "pause"); }}>Pause</button>
                <button className="icon-btn" disabled={!canOperate} onClick={(e) => { e.stopPropagation(); sendAgvCommand(a.id, "resume"); }}>Resume</button>
                <button className="icon-btn" disabled={!canOperate} onClick={(e) => { e.stopPropagation(); sendAgvCommand(a.id, "charge"); }}>Charge</button>
                <button className="icon-btn danger" disabled={!canOperate} onClick={(e) => { e.stopPropagation(); sendAgvCommand(a.id, "cancel"); }}>Убрать</button>
              </div>
            </div>
          ))}
        </div>
        )}

        {canManage && (
        <div className="section">
          <div className="section-title">Умная оптимизация</div>
          <button className="action-btn" onClick={optimizePlacement}>Оптимизировать размещение SKU</button>
        </div>
        )}

        {canManage && <ScenarioPanel current={scenario} onSelect={applyScenario} />}
        {canViewPlanning && <ScenarioAnalysisPanel analysis={analysis} />}

        {metrics && <ThroughputChart history={metrics.throughput_history} />}
        {canViewPlanning && report && <ReportPanel report={report} onExport={exportReport} />}
        {canViewInsights && insights && <InsightsPanel insights={insights} />}
        {canViewWms && wms && <WmsPanel wms={wms} />}

        {/* ── FIFO панель ─────────────────────────────────────── */}
        {(canViewOperations || canViewWms) && fifo && (
          <div className="section" style={{padding: "12px 14px"}}>
            <div className="section-title">FIFO — очередь задач</div>

            {/* Статистика */}
            <div style={{display:"flex", gap:8, marginBottom:10}}>
              {[
                {val: fifo.queue_length,      lbl: "в очереди"},
                {val: fifo.total_dispatched,  lbl: "выдано задач"},
                {val: fifo.fifo_shipped,      lbl: "отгружено"},
              ].map(({val, lbl}) => (
                <div key={lbl} style={{flex:1, background:"rgba(255,255,255,0.05)", borderRadius:6, padding:"6px 8px", textAlign:"center"}}>
                  <div style={{fontSize:18, fontWeight:600, color:"#7fffd4", lineHeight:1}}>{val}</div>
                  <div style={{fontSize:10, opacity:0.55, marginTop:3}}>{lbl}</div>
                </div>
              ))}
            </div>

            {/* Очередь задач AGV */}
            {fifo.task_queue && fifo.task_queue.length > 0 ? (
              <div style={{display:"flex", flexDirection:"column", gap:4, marginBottom:10}}>
                {fifo.task_queue.map((task) => (
                  <div key={task.seq} style={{display:"flex", alignItems:"center", gap:6, background:"rgba(127,255,212,0.07)", borderRadius:5, padding:"4px 8px", fontSize:12}}>
                    <span style={{color:"#7fffd4", fontWeight:600, minWidth:22}}>#{task.queue_pos}</span>
                    <span style={{color:"#a0c4ff", minWidth:52}}>AGV-{task.agv_id}</span>
                    <span style={{flex:1, opacity:0.8}}>→ C{task.col} / R{task.row}</span>
                    {task.order_id && <span style={{opacity:0.45, fontSize:11}}>{task.order_id}</span>}
                  </div>
                ))}
              </div>
            ) : (
              <div style={{fontSize:12, opacity:0.45, marginBottom:10, fontStyle:"italic"}}>
                Очередь пуста — задачи выдаются сразу
              </div>
            )}

            {/* Заказы WMS в FIFO-порядке */}
            {wms && wms.orders && wms.orders.length > 0 && (
              <>
                <div style={{fontSize:11, opacity:0.5, marginBottom:5, textTransform:"uppercase", letterSpacing:"0.04em"}}>
                  Заказы — порядок обработки
                </div>
                <div style={{display:"flex", flexDirection:"column", gap:3}}>
                  {wms.orders.slice(0, 7).map((order, i) => {
                    const statusColors = {pending:"#f39c12", picking:"#3498db", shipped:"#27ae60"};
                    const statusLabels = {pending:"ожидает", picking:"пикинг", shipped:"отгружен"};
                    return (
                      <div key={order.id} style={{
                        display:"flex", alignItems:"center", gap:6,
                        padding:"3px 8px", borderRadius:5, fontSize:11,
                        background: i === 0 ? "rgba(243,156,18,0.12)" : "rgba(255,255,255,0.03)",
                        borderLeft: i === 0 ? "2px solid #f39c12" : "2px solid transparent",
                      }}>
                        <span style={{opacity:0.4, minWidth:14}}>{i+1}</span>
                        <span style={{color:"#a0c4ff", minWidth:54}}>{order.id}</span>
                        <span style={{flex:1, opacity:0.65, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>{order.sku}</span>
                        <span style={{color: statusColors[order.status] || "#aaa", fontWeight:500}}>
                          {statusLabels[order.status] || order.status}
                        </span>
                        {order.cell_id && (
                          <span style={{opacity:0.4, fontSize:10}}>→ {order.cell_id}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}

        {(canOperate || canManage) && <EventLog events={events} />}
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
