import { useEffect, useRef, useState, useCallback, useMemo } from "react";
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
  const [events, setEvents] = useState([]);
  const [agvsList, setAgvsList] = useState([]);
  const [plannerStatus, setPlannerStatus] = useState(null);
  const [scenario, setScenarioState] = useState("normal");
  const [role, setRole] = useState("manager");
  const [connected, setConnected] = useState(false);
  const [tooltip, setTooltip] = useState(null);
  const [warehouseCells, setWarehouseCells] = useState([]);
  const [selectedAgv, setSelectedAgv] = useState(0);
  const [selectedPallet, setSelectedPallet] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [heatMapMode, setHeatMapMode] = useState(false);
  const [showSimulation, setShowSimulation] = useState(false);
  const [simulationScenario, setSimulationScenario] = useState("forklift_breakdown");
  const [simulationResult, setSimulationResult] = useState(null);
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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const socketRef = useRef(null);
  const raycasterRef = useRef(new THREE.Raycaster());
  const pointerRef = useRef(new THREE.Vector2());
  const selectedAgvRef = useRef(0);
  const selectedPalletRef = useRef(null);
  const routeEditModeRef = useRef(false);
  const assignRouteRef = useRef(null);

  // Auth
  const [token, setToken] = useState(null);
  const tokenRef = useRef(null);
  const [userRole, setUserRole] = useState(null);
  const userRoleRef = useRef(null);
  const [loginUser, setLoginUser] = useState("operational-manager");
  const [loginPass, setLoginPass] = useState("operationalmanagerpass");

  const activeRole = userRole || "warehouse-clerk";
  const normalizedRole = activeRole.toLowerCase();
  const isOperationalManager = normalizedRole === "operational-manager" || normalizedRole === "manager";
  const isSupervisor = normalizedRole === "supervisor" || normalizedRole === "operator";
  const isWarehouseClerk = normalizedRole === "warehouse-clerk" || normalizedRole === "viewer";
  const isSeniorWarehouseClerk = normalizedRole === "senior-warehouse-clerk" || normalizedRole === "logistics";
  const isForklift = normalizedRole === "forklift-operator" || normalizedRole === "forklift";
  const canOperate = isOperationalManager || isSupervisor || isForklift;
  const canManage = isOperationalManager;
  const canViewOperations = canOperate || canManage || isSeniorWarehouseClerk || isWarehouseClerk;
  const canViewPlanning = canManage || isSeniorWarehouseClerk || isSupervisor;
  const canViewWms = canManage || isSeniorWarehouseClerk || isSupervisor;
  const canViewInsights = canManage || isSupervisor || isOperationalManager;
  const canPlanWorkerRoute = isSupervisor || canManage || isSeniorWarehouseClerk;

  const alertItems = useMemo(() => {
    const items = [];
    if (metrics?.hot_zones) {
      items.push({ id: "alert-hot-zones", title: `${metrics.hot_zones} blocked pallets`, detail: "Action needed in zone B", severity: "high", action: "focusBlocked" });
    }
    if (metrics?.congestion_points) {
      items.push({ id: "alert-congestion", title: `Congestion near Dock ${metrics.congestion_points > 1 ? 2 : 1}`, detail: "Route flow is tightening", severity: "medium", action: "focusDock" });
    }
    if (metrics?.pending_orders) {
      items.push({ id: "alert-orders", title: `${metrics.pending_orders} orders pending`, detail: "Priority release window opening", severity: "medium", action: "focusDock" });
    }
    if (agvsList?.length) {
      const online = agvsList.filter((agv) => agv.battery > 0).length;
      items.push({ id: "alert-forklifts", title: `${online} forklifts online`, detail: "One operator is monitoring queue pressure", severity: "low", action: "focusFleet" });
    }
    if (insights?.recommendations?.length) {
      items.push({ id: "alert-recommendation", title: insights.recommendations[0], detail: "Suggested by TwinStock", severity: "low", action: "focusRecommendation" });
    }
    return items.slice(0, 4);
  }, [metrics, insights, agvsList]);

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
      // Forklift operators see only their own AGV and do not receive WMS details
      if (normalizedRole === "forklift-operator" || normalizedRole === "forklift") {
        setMetrics(null);
        setInsights(null);
        setAnalysis(null);
        setReport(null);
        setWms(null);
      } else {
        setMetrics(data.metrics);
        setInsights(data.insights);
        setAnalysis(data.analysis);
        setReport(data.report);
        setWms(data.wms);
      }
      setPlannerStatus(data.planner);
      setScenarioState(data.scenario);
      setWarehouseCells(data.cells || []);
      updateScene(data);
      setAgvsList(data.agvs || []);
    });

    socket.on("event", (ev) => {
      setEvents((prev) => [ev, ...prev].slice(0, 60));
    });

    fetch(`${API}/state`)
      .then((res) => res.json())
      .then((data) => {
        // Forklift operators see only their own AGV
        if ((userRole || "").toLowerCase() === "forklift-operator" || (userRole || "").toLowerCase() === "forklift") {
          setMetrics(null);
          setInsights(null);
          setAnalysis(null);
          setReport(null);
          setWms(null);
        } else {
          setMetrics(data.metrics);
          setInsights(data.insights);
          setAnalysis(data.analysis);
          setReport(data.report);
          setWms(data.wms);
        }
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
    selectedPalletRef.current = selectedPallet;
  }, [selectedPallet]);
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

    const configureCameraForViewport = () => {
      const isPhone = window.matchMedia("(max-width: 700px)").matches;
      if (isPhone) {
        camera.fov = 58;
        camera.position.set(31, 31, 39);
        controls.target.set(0, 1.6, 0);
        controls.minDistance = 16;
        controls.maxDistance = 95;
      } else {
        camera.fov = 50;
        camera.position.set(22, 24, 28);
        controls.target.set(0, 2, 0);
        controls.minDistance = 8;
        controls.maxDistance = 70;
      }
      camera.updateProjectionMatrix();
      controls.update();
    };

    // Camera
    const camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 200);
    camera.lookAt(0, 2, 0);

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.maxPolarAngle = Math.PI / 2.1;
    configureCameraForViewport();

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

    // ── Зарядная станция (за пределами склада) ───────────────────
    const chargePad = new THREE.Mesh(
      new THREE.BoxGeometry(2.4, 0.08, 2.4),
      new THREE.MeshStandardMaterial({
        color: 0x00ff88, emissive: 0x00ff88,
        emissiveIntensity: 0.35, roughness: 0.5,
      })
    );
    // CHARGE_STATION = col=-2, row=-2 → world coords
    const COLS_CS = 10, CW_CS = 2.0, GAP_X_CS = 0.5;
    const ROWS_CS = 6,  CD_CS = 1.6, GAP_Z_CS = 1.4;
    const OX_CS = -(COLS_CS * (CW_CS + GAP_X_CS)) / 2 + CW_CS / 2;
    const OZ_CS = -(ROWS_CS * (CD_CS + GAP_Z_CS)) / 2 + CD_CS / 2;
    chargePad.position.set(
      OX_CS + (-2) * (CW_CS + GAP_X_CS),
      0.04,
      OZ_CS + (-2) * (CD_CS + GAP_Z_CS)
    );
    scene.add(chargePad);
    // Значок молнии — столбик с жёлтым верхом
    const chargePole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 1.2, 8),
      new THREE.MeshStandardMaterial({ color: 0x27ae60, roughness: 0.4 })
    );
    chargePole.position.set(chargePad.position.x, 0.64, chargePad.position.z);
    scene.add(chargePole);
    const chargeTop = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 10, 8),
      new THREE.MeshStandardMaterial({
        color: 0xffff00, emissive: 0xffff00, emissiveIntensity: 0.7,
      })
    );
    chargeTop.position.set(chargePad.position.x, 1.3, chargePad.position.z);
    scene.add(chargeTop);

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
      cameraFocus: null,
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
            details: `SKU: ${cell.sku || "—"} · ${cell.qty} ед. · ${cell.zone_type || "ambient"} · exp: ${cell.expiry_days_left ?? "—"} дн. · heat: ${cell.activity_count || 0}`,
            x: event.clientX,
            y: event.clientY,
          });
          return;
        }
        if (target?.type === "agv") {
          const agv = target.data;
          const task = agv.route_task;
          const taskDetails = task
            ? ` · заказ ${task.order_id} · ${task.sku} · ${task.cell_id} · ETA ${task.eta_minutes} мин`
            : "";
          setTooltip({
            title: `Погрузчик-${agv.id}${agv.driver ? ` · ${agv.driver}` : ""}`,
            details: `Батарея ${agv.battery}% · ${agv.status}${agv.idle ? " · разгрузка" : agv.waiting ? " · ждёт FIFO-задание" : ""}${taskDetails}`,
            x: event.clientX,
            y: event.clientY,
          });
          return;
        }
      }
      setTooltip(null);
    };

    const onCanvasClick = (event) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointerRef.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointerRef.current.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycasterRef.current.setFromCamera(pointerRef.current, camera);

      const cellObjects = Object.values(sceneRef.current.cellMeshes);
      const agvObjects = Object.values(sceneRef.current.agvMeshes).map((entry) => entry.group);
      const intersects = raycasterRef.current.intersectObjects([...cellObjects, ...agvObjects], true);
      if (!intersects.length) return;

      const target = intersects[0].object.userData || intersects[0].object.parent?.userData;
      if (!target) return;

      if (routeEditModeRef.current && target.type === "cell") {
        const cell = target.data;
        setOperatorMessage(`Планирование маршрута погрузчика-${selectedAgvRef.current} → ${cell.id}...`);
        setRouteTarget({ col: cell.col, row: cell.row });
        assignRouteRef.current?.(selectedAgvRef.current, cell.col, cell.row, cell.id);
        return;
      }

      if (target.type === "cell") {
        const cell = target.data;
        const pallet = {
          id: `PL-${cell.id}`,
          cellId: cell.id,
          sku: cell.sku || "Empty slot",
          batch: `B-${String(cell.col + cell.row + 1).padStart(2, "0")}`,
          destinationDock: cell.zone_type === "cold" ? "Dock 3" : cell.zone_type === "dry" ? "Dock 1" : "Dock 2",
          currentZone: cell.zone_label || cell.zone_type || "ambient",
          stackLevel: cell.shelf + 1,
          status: cell.fill ? (cell.hot ? "Blocked" : "Ready") : "Empty",
          lastMovement: cell.activity_count > 0 ? `${Math.max(2, 14 - cell.activity_count)} min ago` : "No movement",
          operator: cell.hot ? "M. Silva" : "A. Chen",
          col: cell.col,
          row: cell.row,
        };
        setSelectedPallet(pallet);
        setSelectedAgv(0);
        focusOnCell(cell);
        setOperatorMessage(`Focused pallet ${pallet.id} in ${pallet.currentZone}`);
        return;
      }

      if (target.type === "agv") {
        const agv = target.data;
        setSelectedAgv(agv.id);
        setSelectedPallet(null);
        focusOnAgv(agv);
        setOperatorMessage(`Forklift ${agv.id} selected for operator review`);
      }
    };

    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("click", onCanvasClick);

    // Resize
    const onResize = () => {
      const w2 = el.clientWidth, h2 = el.clientHeight;
      renderer.setSize(w2, h2);
      camera.aspect = w2 / h2;
      configureCameraForViewport();
    };
    window.addEventListener("resize", onResize);

    // Animate
    let raf;
    let animTime = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      animTime += 0.016;
      if (sceneRef.current.cameraFocus) {
        const focus = sceneRef.current.cameraFocus;
        camera.position.lerp(focus.position, 0.08);
        controls.target.lerp(focus.target, 0.08);
        if (camera.position.distanceTo(focus.position) < 0.15 && controls.target.distanceTo(focus.target) < 0.15) {
          sceneRef.current.cameraFocus = null;
        }
      }
      controls.update();
      const { agvMeshes } = sceneRef.current;
      Object.values(agvMeshes || {}).forEach((entry) => {
        if (!entry.backendPosition) return;

        const drift = entry.group.position.distanceTo(entry.backendPosition);
        // Телепорт только при очень большом дрейфе (смена сценария)
        if (drift > 6.0) {
          entry.group.position.copy(entry.backendPosition);
        }

        const previous = entry.group.position.clone();
        if (!entry.paused) {
          // Адаптивный lerp — замедляется у цели, как настоящий водитель
          const lerpFactor = drift < 0.3 ? 0.05 : drift < 1.5 ? 0.09 : 0.12;
          entry.group.position.lerp(entry.backendPosition, lerpFactor);
        }
        const moved = entry.group.position.clone().sub(previous);
        const speed = moved.length();

        if (speed > 0.001) {
          entry.targetRotation = Math.atan2(moved.x, moved.z);
          // Вращение колёс пропорционально скорости
          entry.wheels?.forEach((wheel) => {
            wheel.rotation.x += speed * 10;
          });
          // Покачивание головы водителя при движении
          if (entry.helmet) {
            entry.helmet.position.y = 0.52 + Math.sin(animTime * 9) * 0.007 * Math.min(speed * 60, 1);
          }
        }

        if (entry.targetRotation !== undefined) {
          const current = entry.group.rotation.y;
          let angleDelta = entry.targetRotation - current;
          angleDelta = Math.atan2(Math.sin(angleDelta), Math.cos(angleDelta));
          // Водители поворачивают плавнее чем роботы
          entry.group.rotation.y = current + angleDelta * 0.11;
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
    const ZONE_COLORS = { cold: 0x27d4ff, ambient: 0x1a5fa5, dry: 0xd9a441 };
    const isSelectedCell = (cell) => selectedPalletRef.current?.cellId === cell.id;

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
      const activity = Math.min((cell.activity_count || 0) / 24, 1);
      const zoneColor = ZONE_COLORS[cell.zone_type] || COLORS.full;
      const selected = isSelectedCell(cell);
      const heatLevel = heatMapMode ? Math.min(1, activity * 1.25) : activity;
      mesh.position.set(bx, by, bz);
      mesh.visible = true;
      mesh.material.color.setHex(cell.fill ? (cell.expiry_risk ? 0xf39c12 : zoneColor) : zoneColor);
      mesh.material.opacity = cell.fill ? Math.min(1, 0.2 + heatLevel * 0.6) : 0.16;
      mesh.material.emissive?.setHex(selected ? 0x4a90e2 : cell.hot || heatLevel > 0.65 ? 0x5a2200 : 0x000000);
      mesh.material.emissiveIntensity = selected ? 0.42 : cell.hot || heatLevel > 0.65 ? 0.28 + heatLevel * 0.45 : 0;
      mesh.scale.set(selected ? 1.08 : 1, selected ? 1.08 : 1, selected ? 1.08 : 1);
      mesh.userData.data = cell;

      pallet.position.set(bx, by + 0.28, bz);
      pallet.visible = cell.fill;
      pallet.material.color.setHex(selected ? 0x7fb6ff : cell.expiry_risk ? 0xf39c12 : cell.hot ? 0xe74c3c : 0x8d6e63);
      pallet.material.emissive?.setHex(selected ? 0x4a90e2 : 0x000000);
      pallet.material.emissiveIntensity = selected ? 0.3 : 0;
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

    const normalizeRouteNodes = (nodes = []) => nodes
      .map(([col, row]) => [Number(col), Number(row)])
      .filter(([col, row]) => Number.isFinite(col) && Number.isFinite(row))
      .filter(([col, row], index, list) => {
        if (index === 0) return true;
        const [prevCol, prevRow] = list[index - 1];
        return col !== prevCol || row !== prevRow;
      });

    const simplifyRouteNodes = (nodes) => {
      const normalized = normalizeRouteNodes(nodes);
      if (normalized.length <= 2) return normalized;

      const simplified = [normalized[0]];
      for (let index = 1; index < normalized.length - 1; index += 1) {
        const [prevCol, prevRow] = normalized[index - 1];
        const [col, row] = normalized[index];
        const [nextCol, nextRow] = normalized[index + 1];
        const prevDir = [Math.sign(col - prevCol), Math.sign(row - prevRow)];
        const nextDir = [Math.sign(nextCol - col), Math.sign(nextRow - row)];
        if (prevDir[0] !== nextDir[0] || prevDir[1] !== nextDir[1]) {
          simplified.push([col, row]);
        }
      }
      simplified.push(normalized[normalized.length - 1]);
      return simplified;
    };

    const buildCorridorRoutePath = (nodes) => {
      const turns = simplifyRouteNodes(nodes);
      if (turns.length <= 1) {
        return turns.map(([col, row]) => agvPoint(col, row, 0.22));
      }

      const nodePoint = ([col, row], y = 0.22) => agvPoint(col, row, y);
      const orientation = (from, to) => Math.abs(to[0] - from[0]) >= Math.abs(to[1] - from[1]) ? "h" : "v";
      const addPoint = (path, point) => {
        const last = path[path.length - 1];
        if (!last || last.distanceTo(point) > 0.05) path.push(point);
      };
      const corridorPoint = (node, orient) => {
        const center = nodePoint(node);
        return orient === "h"
          ? new THREE.Vector3(center.x, center.y, nearest(center.z, corridorZs))
          : new THREE.Vector3(nearest(center.x, corridorXs), center.y, center.z);
      };
      const turnPoint = (node) => {
        const center = nodePoint(node);
        return new THREE.Vector3(nearest(center.x, corridorXs), center.y, nearest(center.z, corridorZs));
      };

      const path = [];
      const firstOrientation = orientation(turns[0], turns[1]);
      addPoint(path, nodePoint(turns[0]));
      addPoint(path, corridorPoint(turns[0], firstOrientation));

      for (let index = 1; index < turns.length - 1; index += 1) {
        addPoint(path, turnPoint(turns[index]));
      }

      const lastOrientation = orientation(turns[turns.length - 2], turns[turns.length - 1]);
      addPoint(path, corridorPoint(turns[turns.length - 1], lastOrientation));
      addPoint(path, nodePoint(turns[turns.length - 1]));

      return orthogonalizePath(path);
    };

    const displayRoutePath = (path) => path.map((point) => new THREE.Vector3(point.x, 0.28, point.z));

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

      let finalSegment = null;
      for (let index = 0; index < points.length - 1; index += 1) {
        const start = points[index];
        const end = points[index + 1];
        const segment = end.clone().sub(start);
        const length = segment.length();
        if (length < 0.05) continue;
        finalSegment = { start, end, segment };

        const tube = new THREE.Mesh(
          new THREE.CylinderGeometry(0.075, 0.075, length, 12),
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

      if (finalSegment) {
        const arrow = new THREE.ArrowHelper(
          finalSegment.segment.clone().normalize(),
          finalSegment.end,
          0.75,
          0x00ffff,
        );
        scene.add(arrow);
        entry.routeMarkers.push(arrow);
      }

      const startMarker = new THREE.Mesh(
        new THREE.SphereGeometry(0.34, 18, 14),
        new THREE.MeshStandardMaterial({
          color: 0x00ff00,
          emissive: 0x00ff00,
          emissiveIntensity: 0.9,
          depthTest: false,
        })
      );
      startMarker.position.copy(points[0]);
      startMarker.position.y = 0.75;
      startMarker.renderOrder = 14;
      scene.add(startMarker);
      entry.routeMarkers.push(startMarker);

      const endMarker = new THREE.Mesh(
        new THREE.SphereGeometry(0.38, 18, 14),
        new THREE.MeshStandardMaterial({
          color: 0xff0000,
          emissive: 0xff0000,
          emissiveIntensity: 0.9,
          depthTest: false,
        })
      );
      endMarker.position.copy(points[points.length - 1]);
      endMarker.position.y = 0.78;
      endMarker.renderOrder = 14;
      scene.add(endMarker);
      entry.routeMarkers.push(endMarker);
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
      const canSeeRoute = userRoleRef.current !== "forklift" || `forklift-${agv.id}` === loginUser;
      const path = hasAssignedRoute
        ? buildCorridorRoutePath(displayNodes)
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

        // ── Фигурка водителя ──────────────────────────────────────
        const helmetColors = [0xff6b35, 0x2ec4b6, 0xe71d36, 0xffbe0b, 0x9b59b6, 0x1abc9c, 0xe67e22, 0x3498db];
        const helmetColor = helmetColors[agv.id % helmetColors.length];
        const helmet = new THREE.Mesh(
          new THREE.SphereGeometry(0.13, 10, 8),
          new THREE.MeshStandardMaterial({
            color: helmetColor, roughness: 0.4,
            emissive: helmetColor, emissiveIntensity: 0.18,
          })
        );
        helmet.position.set(-0.05, 0.52, 0);

        const torso = new THREE.Mesh(
          new THREE.BoxGeometry(0.18, 0.20, 0.13),
          new THREE.MeshStandardMaterial({ color: 0x2c3e50, roughness: 0.7 })
        );
        torso.position.set(-0.05, 0.36, 0);

        const vest = new THREE.Mesh(
          new THREE.BoxGeometry(0.20, 0.11, 0.15),
          new THREE.MeshStandardMaterial({
            color: 0xf39c12, roughness: 0.5,
            emissive: 0xf39c12, emissiveIntensity: 0.08,
          })
        );
        vest.position.set(-0.05, 0.385, 0);

        const armMat = new THREE.MeshStandardMaterial({ color: 0x2c3e50, roughness: 0.7 });
        const makeArm = (side) => {
          const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.17, 8), armMat);
          arm.rotation.z = side * 0.55;
          arm.position.set(-0.05 + side * 0.16, 0.34, 0);
          return arm;
        };
        // ─────────────────────────────────────────────────────────

        const group = new THREE.Group();
        group.userData = { type: "agv", data: { ...agv, worldTx: targetX, worldTz: targetZ } };
        const wheels = [
          makeWheel(0.3, 0.28),
          makeWheel(-0.3, 0.28),
          makeWheel(0.3, -0.28),
          makeWheel(-0.3, -0.28)
        ];

        group.add(body, platform, cabin, light, helmet, torso, vest, makeArm(-1), makeArm(1), ...wheels);
        group.position.copy(backendPos);
        scene.add(group);

        // routeLine — защита от пустого массива точек
        const safeRoutePoints = routePath.length >= 2
          ? routePath
          : [backendPos.clone(), backendPos.clone().add(new THREE.Vector3(0.01, 0, 0))];
        const routeLine = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(safeRoutePoints),
          new THREE.LineDashedMaterial({
            color: 0x00e5ff,
            dashSize: 0.45,
            gapSize: 0.15,
            transparent: true,
            opacity: 0.9,
            depthTest: false,
          })
        );
        routeLine.renderOrder = 10;
        routeLine.computeLineDistances();
        routeLine.visible = hasAssignedRoute && canSeeRoute;
        scene.add(routeLine);

        entry = {
          group,
          routeLine,
          routeMarkers: [],
          path,
          backendPosition: backendPos.clone(),
          targetRotation: group.rotation.y,
          wheels,
          helmet,
          paused: agv.paused,
          routeActive: hasAssignedRoute,
        };
        drawRouteMarkers(entry, routePath, hasAssignedRoute && canSeeRoute);
        agvMeshes[key] = entry;
      } else {
        entry.backendPosition = backendPos.clone();
        entry.paused = agv.paused;
        entry.routeActive = hasAssignedRoute;
        entry.group.userData.data = { ...agv, worldTx: targetX, worldTz: targetZ };
        entry.group.children[0].material.color.setHex(batteryColor);
        entry.path = path;
        // Защита от пустого массива — BufferGeometry требует минимум 2 точки
        const updatePoints = routePath.length >= 2
          ? routePath
          : [entry.group.position.clone(), entry.group.position.clone().add(new THREE.Vector3(0.01, 0, 0))];
        entry.routeLine.geometry.setFromPoints(updatePoints);
        entry.routeLine.geometry.attributes.position.needsUpdate = true;
        entry.routeLine.computeLineDistances();
        entry.routeLine.visible = hasAssignedRoute && canSeeRoute &&routePath.length >= 2;
        drawRouteMarkers(entry, routePath, hasAssignedRoute && canSeeRoute);
      }
    });

    sceneRef.current.cellMeshes = cellMeshes;
    sceneRef.current.palletMeshes = palletMeshes;
    sceneRef.current.agvMeshes = agvMeshes;
    sceneRef.current.routeLines = routeLines;
    // update agv list for control panel
    setAgvsList(data.agvs || []);
  }, []);

  const focusOnCell = useCallback((cell) => {
    if (!sceneRef.current?.camera || !sceneRef.current?.controls) return;
    const COLS = 10;
    const ROWS = 6;
    const CW = 2.0;
    const CD = 1.6;
    const GAP_X = 0.5;
    const GAP_Z = 1.4;
    const OX = -(COLS * (CW + GAP_X)) / 2 + CW / 2;
    const OZ = -(ROWS * (CD + GAP_Z)) / 2 + CD / 2;
    const target = new THREE.Vector3(
      OX + cell.col * (CW + GAP_X),
      5.2,
      OZ + cell.row * (CD + GAP_Z)
    );
    const lookAt = new THREE.Vector3(
      OX + cell.col * (CW + GAP_X),
      1.1,
      OZ + cell.row * (CD + GAP_Z)
    );
    sceneRef.current.cameraFocus = { position: target.clone().add(new THREE.Vector3(6, 4.2, 6)), target: lookAt };
  }, []);

  const focusOnAgv = useCallback((agv) => {
    if (!sceneRef.current?.camera || !sceneRef.current?.controls) return;
    const COLS = 10;
    const ROWS = 6;
    const CW = 2.0;
    const CD = 1.6;
    const GAP_X = 0.5;
    const GAP_Z = 1.4;
    const OX = -(COLS * (CW + GAP_X)) / 2 + CW / 2;
    const OZ = -(ROWS * (CD + GAP_Z)) / 2 + CD / 2;
    const target = new THREE.Vector3(
      OX + agv.x * (CW + GAP_X),
      4.4,
      OZ + agv.z * (CD + GAP_Z)
    );
    sceneRef.current.cameraFocus = { position: target.clone().add(new THREE.Vector3(3.7, 3.2, 3.7)), target: target.clone().add(new THREE.Vector3(0, 0, 0)) };
  }, []);

  const handleSearch = (event) => {
    event.preventDefault();
    const term = searchTerm.trim().toLowerCase();
    if (!term) return;

    const byCell = warehouseCells.find((cell) => cell.id?.toLowerCase().includes(term) || cell.sku?.toLowerCase().includes(term));
    if (byCell) {
      const pallet = {
        id: `PL-${byCell.id}`,
        cellId: byCell.id,
        sku: byCell.sku || "Empty slot",
        batch: `B-${String(byCell.col + byCell.row + 1).padStart(2, "0")}`,
        destinationDock: byCell.zone_type === "cold" ? "Dock 3" : byCell.zone_type === "dry" ? "Dock 1" : "Dock 2",
        currentZone: byCell.zone_label || byCell.zone_type || "ambient",
        stackLevel: byCell.shelf + 1,
        status: byCell.fill ? (byCell.hot ? "Blocked" : "Ready") : "Empty",
        lastMovement: `${Math.max(2, 14 - (byCell.activity_count || 0))} min ago`,
        operator: byCell.hot ? "M. Silva" : "A. Chen",
        col: byCell.col,
        row: byCell.row,
      };
      setSelectedPallet(pallet);
      focusOnCell(byCell);
      setOperatorMessage(`Search result: ${pallet.id} in ${pallet.currentZone}`);
      return;
    }

    const byAgv = agvsList.find((agv) => String(agv.id).includes(term) || agv.driver?.toLowerCase().includes(term) || agv.route_task?.sku?.toLowerCase().includes(term));
    if (byAgv) {
      setSelectedAgv(byAgv.id);
      focusOnAgv(byAgv);
      setOperatorMessage(`Search result: forklift ${byAgv.id}`);
      return;
    }

    const byEvent = events.find((ev) => ev.msg?.toLowerCase().includes(term));
    if (byEvent) {
      setOperatorMessage(`Matched event: ${byEvent.msg}`);
      return;
    }

    setOperatorMessage(`No match found for “${searchTerm}”`);
  };

  const runSimulation = () => {
    const scenarios = {
      forklift_breakdown: {
        loadingTime: "28 → 36 min",
        congestion: "Low → High",
        occupancy: "82 → 91%",
        recommendation: "Reassign pallet #5421 to B-04 for Dock 2 access",
      },
      demand_spike: {
        loadingTime: "26 → 41 min",
        congestion: "Low → Severe",
        occupancy: "80 → 94%",
        recommendation: "Open the temporary dock and rebalance pallets",
      },
      zone_closure: {
        loadingTime: "24 → 33 min",
        congestion: "Medium → High",
        occupancy: "79 → 88%",
        recommendation: "Move cold pallets closer to Dock 3",
      },
      temporary_dock: {
        loadingTime: "27 → 24 min",
        congestion: "Medium → Low",
        occupancy: "81 → 85%",
        recommendation: "Keep the temporary dock active for the next hour",
      },
    };
    const next = scenarios[simulationScenario] || scenarios.forklift_breakdown;
    setSimulationResult(next);
    setShowSimulation(true);
    setOperatorMessage(`Simulation completed: ${next.recommendation}`);
  };

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
    setOperatorMessage(`Планирование маршрута погрузчика-${agvId} → ${label}...`);
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
        setOperatorMessage(`Маршрут поставлен: погрузчик-${agvId} → ${label}`);
        if (state) {
          setMetrics(state.metrics);
          setInsights(state.insights);
          setAnalysis(state.analysis);
          setReport(state.report);
          setWms(state.wms);
          setPlannerStatus(state.planner);
          setWarehouseCells(state.cells || []);
          setWarehouseCells(state.cells || []);
          updateScene(state);
          setAgvsList(state.agvs || []);
        }
      })
      .catch(() => setOperatorMessage("Не удалось назначить маршрут."));
  };

  useEffect(() => {
    assignRouteRef.current = assignRoute;
  }, [assignRoute]);

  useEffect(() => {
    if (!warehouseCells.length && !agvsList.length) return;
    updateScene({ cells: warehouseCells, agvs: agvsList });
  }, [heatMapMode, selectedPallet, selectedAgv, warehouseCells, agvsList, updateScene]);

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
    // Сначала очищаем старый маршрут — иначе точки остаются на сцене
    clearWorkerRoute();

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
    const { scene } = sceneRef.current;
    if (scene) {
      // Убрать линию маршрута
      if (sceneRef.current.workerRouteLine) {
        scene.remove(sceneRef.current.workerRouteLine);
        sceneRef.current.workerRouteLine.traverse?.((child) => {
          child.geometry?.dispose();
          child.material?.dispose();
        });
        sceneRef.current.workerRouteLine = null;
      }
      // Убрать все маркеры-точки (стартовый, финишный, промежуточные)
      (sceneRef.current.workerRouteMarkers || []).forEach((marker) => {
        scene.remove(marker);
        marker.traverse?.((child) => {
          child.geometry?.dispose();
          child.material?.dispose();
        });
      });
      sceneRef.current.workerRouteMarkers = [];
    }
    setWorkerRoute(null);
    setOperatorMessage("Маршрут складовщика очищен с 3D-сцены.");
  };

  const sendAgvCommand = (id, cmd, args = {}) => {
    const headers = authHeaders({ "Content-Type": "application/json" });
    setOperatorMessage(`Команда погрузчику-${id}: ${cmd}`);
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
        setOperatorMessage(`Команда принята: погрузчик-${id} ${cmd}`);
        if (data.state) {
          setMetrics(data.state.metrics);
          setInsights(data.state.insights);
          setAnalysis(data.state.analysis);
          setReport(data.state.report);
          setWms(data.state.wms);
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
          setPlannerStatus(data.state.planner);
          setScenarioState(data.state.scenario);
          setWarehouseCells(data.state.cells || []);
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

  useEffect(() => {
    if (!metrics && !insights) return;
    const demoTimer = window.setTimeout(() => {
      setSelectedPallet({
        id: "PL-A3-18",
        cellId: "A3-S1",
        sku: "Cola Zero",
        batch: "B-09",
        destinationDock: "Dock 2",
        currentZone: "Ambient zone",
        stackLevel: 2,
        status: "Blocked",
        lastMovement: "18 min ago",
        operator: "M. Silva",
        col: 0,
        row: 2,
      });
      setShowSimulation(true);
      setSimulationScenario("forklift_breakdown");
      setSimulationResult({ loadingTime: "28 → 36 min", congestion: "Low → High", occupancy: "82 → 91%", recommendation: "Move pallet #5421 to B-04 for Dock 2 access" });
      setOperatorMessage("Guided demo: delay detected and TwinStock recommended a better placement.");
    }, 1400);
    return () => window.clearTimeout(demoTimer);
  }, [metrics, insights]);

  return (
    <div className="layout" style={{ "--sidebar-width": `${sidebarWidth}px` }}>
      <button
        className="mobile-menu-btn"
        type="button"
        aria-label={mobileMenuOpen ? "Закрыть меню" : "Открыть меню"}
        aria-expanded={mobileMenuOpen}
        onClick={() => setMobileMenuOpen((value) => !value)}
      >
        <span />
        <span />
        <span />
      </button>
      {mobileMenuOpen && (
        <button
          className="mobile-sidebar-backdrop"
          type="button"
          aria-label="Закрыть меню"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}
      <aside className={`sidebar ${mobileMenuOpen ? "open" : ""}`}>
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
                const passwordByUser = {
                  "operational-manager": "operationalmanagerpass",
                  "supervisor": "supervisorpass",
                  "warehouse-clerk": "warehouseclerkpass",
                  "senior-warehouse-clerk": "seniorwarehouseclerkpass",
                  "forklift-operator": "forkliftoperatorpass",
                };
                setLoginPass(passwordByUser[value] || `${value}pass`);
              }}>
                <optgroup label="Операционный контроль">
                  <option value="operational-manager">Операционный менеджер</option>
                  <option value="supervisor">Супервайзер</option>
                </optgroup>
                <optgroup label="Складская команда">
                  <option value="senior-warehouse-clerk">Старший кладовщик</option>
                  <option value="warehouse-clerk">Кладовщик</option>
                </optgroup>
                <optgroup label="Погрузчики">
                  <option value="forklift-operator">Оператор погрузчика</option>
                </optgroup>
              </select>
              <input value={loginPass} onChange={(e) => setLoginPass(e.target.value)} type="password" />
              <button className="action-btn" onClick={login}>Войти</button>
            </div>
          )}
        </div>

        <div className="section">
          <div className="section-title">Operations center</div>
          <form className="search-shell" onSubmit={handleSearch}>
            <input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Search pallet, SKU, truck, forklift" />
            <button type="submit" className="action-btn compact">Find</button>
          </form>
          <div className="alert-strip">
            {alertItems.map((item) => (
              <button key={item.id} type="button" className={`alert-pill ${item.severity}`} onClick={() => {
                if (item.action === "focusRecommendation") {
                  setOperatorMessage(item.title);
                } else if (item.action === "focusFleet") {
                  setSelectedAgv(agvsList[0]?.id || 0);
                } else {
                  setSelectedPallet({
                    id: "PL-OPS-01",
                    cellId: "B4-S2",
                    sku: "Sprite",
                    batch: "B-14",
                    destinationDock: "Dock 2",
                    currentZone: "Ambient zone",
                    stackLevel: 3,
                    status: "Blocked",
                    lastMovement: "11 min ago",
                    operator: "J. Kim",
                    col: 1,
                    row: 3,
                  });
                }
              }}>
                <span className="alert-icon">{item.severity === "high" ? "●" : item.severity === "medium" ? "◐" : "◌"}</span>
                <span>{item.title}</span>
              </button>
            ))}
          </div>
        </div>

        {metrics && <MetricsBar metrics={metrics} />}
        <RolePanel role={activeRole} />
        <RoleSummaryPanel role={activeRole} metrics={metrics} insights={insights} wms={wms} />

        {selectedPallet && (
          <div className="section pallet-focus-card">
            <div className="section-title">Selected pallet</div>
            <div className="pallet-card-title">{selectedPallet.id}</div>
            <div className="pallet-card-grid">
              <div><span className="pallet-label">SKU</span><strong>{selectedPallet.sku}</strong></div>
              <div><span className="pallet-label">Batch</span><strong>{selectedPallet.batch}</strong></div>
              <div><span className="pallet-label">Dock</span><strong>{selectedPallet.destinationDock}</strong></div>
              <div><span className="pallet-label">Zone</span><strong>{selectedPallet.currentZone}</strong></div>
              <div><span className="pallet-label">Stack</span><strong>Level {selectedPallet.stackLevel}</strong></div>
              <div><span className="pallet-label">Status</span><strong>{selectedPallet.status}</strong></div>
              <div><span className="pallet-label">Last movement</span><strong>{selectedPallet.lastMovement}</strong></div>
              <div><span className="pallet-label">Operator</span><strong>{selectedPallet.operator}</strong></div>
            </div>
          </div>
        )}

        {selectedAgv && agvsList.find((agv) => agv.id === selectedAgv) && (
          <div className="section forklift-focus-card">
            <div className="section-title">Forklift details</div>
            {(() => {
              const agv = agvsList.find((entry) => entry.id === selectedAgv);
              return (
                <>
                  <div className="forklift-focus-title">Forklift #{agv.id}</div>
                  <div className="pallet-card-grid">
                    <div><span className="pallet-label">Operator</span><strong>{agv.driver}</strong></div>
                    <div><span className="pallet-label">Battery</span><strong>{agv.battery}%</strong></div>
                    <div><span className="pallet-label">Speed</span><strong>{Math.max(1, Math.round((agv.battery / 100) * 8))} m/s</strong></div>
                    <div><span className="pallet-label">Current task</span><strong>{agv.route_task?.sku || "Idle"}</strong></div>
                    <div><span className="pallet-label">Current load</span><strong>{agv.route_task?.qty || 0} pallet</strong></div>
                    <div><span className="pallet-label">ETA</span><strong>{agv.route_task?.eta_minutes || 0} min</strong></div>
                  </div>
                </>
              );
            })()}
          </div>
        )}

        <div className="section">
          <div className="section-title">Warehouse view</div>
          <div className="toggle-group">
            <button type="button" className={`toggle-btn ${!heatMapMode ? "active" : ""}`} onClick={() => setHeatMapMode(false)}>Normal view</button>
            <button type="button" className={`toggle-btn ${heatMapMode ? "active" : ""}`} onClick={() => setHeatMapMode(true)}>Heat map</button>
          </div>
          <button type="button" className="action-btn secondary" onClick={() => setShowSimulation(true)}>Run what-if</button>
        </div>

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

        {isForklift && (
        <div className="section forklift-dashboard">
          <div className="section-title">Кабина погрузчика</div>
          {agvsList.length > 0 ? (
            agvsList
              .filter(agv => `forklift-${agv.id}` === loginUser)
              .map(agv => (
              <div key={agv.id} className="forklift-card">
                <div className="forklift-header">
                  <div className="forklift-id">🏗️ Погрузчик #{agv.id}</div>
                  <div className={`forklift-status ${agv.status}`}>{agv.status}</div>
                </div>
                <div className="forklift-info">
                  <div className="battery-section">
                    <span className="battery-label">🔋 Батарея: {agv.battery}%</span>
                    <div className="battery-bar-container">
                      <div className="battery-bar-fill" style={{width: `${agv.battery}%`, backgroundColor: agv.battery > 50 ? '#2a7a3b' : agv.battery > 20 ? '#e67e22' : '#c0392b'}}></div>
                    </div>
                  </div>
                  {agv.driver && (
                    <div className="info-row">
                      <span className="label">👤 Водитель:</span>
                      <span className="value">{agv.driver}</span>
                    </div>
                  )}
                  {agv.route_goal && (
                    <div className="info-row">
                      <span className="label">🎯 Цель:</span>
                      <span className="value">
                        {agv.route_task?.order_id} · {agv.route_task?.sku}
                      </span>
                    </div>
                  )}
                  {agv.route_task && (
                    <div className="info-row">
                      <span className="label">📋 Задача:</span>
                      <span className="value">
                         {agv.route_task?.order_id} · {agv.route_task?.sku}
                     </span>
                    </div>
                 )}
                 {agv.route_task && (
                   <div className="info-row">
                     <span className="label">📌 Сегодня:</span>
                     <span className="value">
                       1. Забрать {agv.route_task?.sku} из {agv.route_task?.cell_id}<br />
                       2. Доставить груз по маршруту<br />
                       3. Следовать указаниям навигации<br />
                       4. Завершить текущий заказ<br />
                       5. Ожидать следующую FIFO-задачу
                     </span>
                   </div>
                  )}
                  {agv.route_path && agv.route_path.length > 0 && (
                    <div className="info-row">
                      <span className="label">🛣️ Маршрут:</span>
                      <span className="value">{agv.route_path.length} шагов</span>
                    </div>
                  )}
                  {agv.route_task?.eta_minutes && (
                    <div className="info-row">
                      <span className="label">⏱ ETA:</span>
                      <span className="value">{agv.route_task.eta_minutes} мин</span>
                      </div>
                  )}
                  {agv.assigned_by && (
                    <div className="info-row">
                      <span className="label">👥 Назначено:</span>
                      <span className="value">{agv.assigned_by}</span>
                    </div>
                  )}
                </div>
              </div>
            ))
          ) : (
            <div className="no-data">Нет назначенных задач. Ожидание...</div>
          )}
        </div>
        )}

        {canViewOperations && (
        <div className="section agv-control">
          <div className="section-title">Аккаунты погрузчиков</div>
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
              <div className="route-sub">Выберите погрузчик, затем кликните по ячейке или задайте координаты маршрута водителю</div>
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
          {agvsList && agvsList.length === 0 && <div style={{opacity:0.7}}>Нет погрузчиков</div>}
          {agvsList && agvsList.map((a) => {
            const task = a.route_task;
            const routeLength = task?.route_steps ?? Math.max((a.route_path?.length || a.planned_path?.length || 1) - 1, 0);
            return (
              <div
                key={a.id}
                className={`agv-card ${selectedAgv === a.id ? "selected" : ""}`}
                onClick={() => setSelectedAgv(a.id)}
              >
                <div className="agv-card-head">
                  <strong>Погрузчик-{a.id}</strong>
                  <span className={`agv-status ${a.paused ? "paused" : a.manual ? "manual" : ""}`}>{a.status}</span>
                </div>
                {a.driver && (
                  <div style={{ fontSize: 11, opacity: 0.72, marginBottom: 4, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span>Водитель: {a.driver}</span>
                    {a.idle && <span style={{ color: "#f39c12", fontWeight: 600 }}>разгрузка</span>}
                    {a.waiting && !a.idle && <span style={{ color: "#7fb7ff", fontWeight: 600 }}>ждёт FIFO-заказ</span>}
                    {a.status === "charging" && <span style={{ color: "#00ff88", fontWeight: 600 }}>зарядка</span>}
                  </div>
                )}
                <div className="agv-detail">
                  Батарея {a.battery}% · Цель: {a.route_goal ? `C${a.route_goal[0]}/R${a.route_goal[1]}` : `C${Math.round(a.tx)}/R${Math.round(a.tz)}`}
                  {routeLength ? ` · маршрут ${routeLength} шагов` : ""}
                </div>
                <div className="agv-detail" style={{ marginTop: 6, opacity: 0.8 }}>
                  Назначил: {a.assigned_by || "—"} · Режим: {task?.dispatch_mode === "auto_fifo" ? "Auto FIFO" : a.manual ? "manual" : "standby"}
                </div>
                {task ? (
                  <div className="agv-detail" style={{ marginTop: 6, color: "#cfe3ff" }}>
                    Задача: {task.order_id} · {task.sku} · {task.cell_id}
                    {task.expiry_days_left != null ? ` · exp ${task.expiry_days_left} дн.` : ""}
                    {task.eta_minutes ? ` · ETA ${task.eta_minutes} мин` : ""}
                  </div>
                ) : (
                  <div className="agv-detail" style={{ marginTop: 6, opacity: 0.58 }}>
                    {a.route_goal ? `Цель поставлена: C${a.route_goal[0]}/R${a.route_goal[1]}` : "Нет активной задачи"}
                  </div>
                )}
                {routeLength > 0 && a.route_path?.length > 0 && (
                  <div className="agv-detail" style={{ marginTop: 6, opacity: 0.72, fontSize: 12 }}>
                    Как добраться: {a.route_path.slice(0, 8).map(([col, row]) => `C${col}/R${row}`).join(" → ")}{a.route_path.length > 8 ? " …" : ""}
                  </div>
                )}
                <div className="agv-actions">
                  <button className="icon-btn" disabled={!canOperate} onClick={(e) => { e.stopPropagation(); sendAgvCommand(a.id, "pause"); }}>Пауза</button>
                  <button className="icon-btn" disabled={!canOperate} onClick={(e) => { e.stopPropagation(); sendAgvCommand(a.id, "resume"); }}>Продолжить</button>
                  <button className="icon-btn" disabled={!canOperate} onClick={(e) => { e.stopPropagation(); sendAgvCommand(a.id, "charge"); }}>Зарядить</button>
                  <button className="icon-btn danger" disabled={!canOperate} onClick={(e) => { e.stopPropagation(); sendAgvCommand(a.id, "cancel"); }}>Отмена</button>
                </div>
              </div>
            );
          })}
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

        {(canOperate || canManage) && <EventLog events={events} />}
      </aside>

      <main className="viewport" ref={mountRef}>
        <div className="ops-banner">
          <div className="ops-banner-title">TwinStock command center</div>
          <div className="ops-banner-subtitle">Live warehouse operations · guided supervisor workflows</div>
          <div className="ops-banner-actions">
            <button type="button" className="action-btn compact" onClick={() => setShowSimulation(true)}>What-if</button>
            <button type="button" className="action-btn secondary compact" onClick={() => setHeatMapMode((value) => !value)}>{heatMapMode ? "Heat map on" : "Heat map off"}</button>
          </div>
        </div>
        {simulationResult && showSimulation && (
          <div className="simulation-modal">
            <div className="simulation-card">
              <div className="section-title">What-if simulation</div>
              <select value={simulationScenario} onChange={(e) => setSimulationScenario(e.target.value)}>
                <option value="forklift_breakdown">Forklift breakdown</option>
                <option value="demand_spike">+30% demand</option>
                <option value="zone_closure">Close warehouse zone</option>
                <option value="temporary_dock">Add temporary loading dock</option>
              </select>
              <button type="button" className="action-btn" onClick={runSimulation}>Run simulation</button>
              {simulationResult && (
                <div className="simulation-result">
                  <div className="simulation-row"><span>Current KPI</span><strong>Loading time 28 min</strong></div>
                  <div className="simulation-row"><span>Predicted KPI</span><strong>Loading time {simulationResult.loadingTime}</strong></div>
                  <div className="simulation-row"><span>Congestion</span><strong>{simulationResult.congestion}</strong></div>
                  <div className="simulation-row"><span>Occupancy</span><strong>{simulationResult.occupancy}</strong></div>
                  <div className="simulation-recommendation">{simulationResult.recommendation}</div>
                </div>
              )}
              <button type="button" className="action-btn secondary" onClick={() => setShowSimulation(false)}>Close</button>
            </div>
          </div>
        )}
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
