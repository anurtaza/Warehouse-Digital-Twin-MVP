# 🏭 Warehouse Digital Twin — MVP

3D цифровой двойник склада на Python + React + Three.js.

## Что внутри

```
warehouse-twin/
├── backend/
│   ├── app.py           # Flask + SocketIO сервер
│   ├── simulator.py     # Движок симуляции склада
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── App.jsx                    # Главный компонент + Three.js сцена
│   │   ├── App.css
│   │   └── components/
│   │       ├── MetricsBar.jsx         # Метрики в реальном времени
│   │       ├── ScenarioPanel.jsx      # What-if сценарии
│   │       ├── ThroughputChart.jsx    # Canvas-график пропускной способности
│   │       └── EventLog.jsx           # Лог событий
│   ├── index.html
│   ├── vite.config.js
│   ├── package.json
│   ├── Dockerfile
│   └── nginx.conf
└── docker-compose.yml
```

## Быстрый старт

### Вариант 1 — Docker (рекомендуется)

```bash
docker compose up --build
```

Открыть: http://localhost:3000

### Вариант 2 — Вручную

**Бэкенд:**
```bash
cd backend
pip install -r requirements.txt
python app.py
# Сервер: http://localhost:5000
```

**Фронтенд (в другом терминале):**
```bash
cd frontend
npm install
npm run dev
# UI: http://localhost:3000
```

## API

| Метод | Эндпоинт | Описание |
|-------|----------|----------|
| GET | `/api/state` | Полное состояние склада |
| GET | `/api/metrics` | Только метрики |
| GET | `/api/events` | Лог событий (до 50) |
| POST | `/api/scenario/{name}` | Переключить сценарий |

**Сценарии:** `normal`, `surge`, `agv_fail`, `low_staff`

**WebSocket события:**
- `state` — полное обновление каждую секунду
- `event` — новое событие в логе
- `scenario_changed` — смена сценария

## Подключение реального WMS

Замените `simulator.py` на коннектор к вашей системе:

```python
class WarehouseSimulator:
    def get_state(self):
        # Вместо симуляции — запрос к WMS API:
        return wms_client.fetch_current_state()

    def tick(self):
        # Polling реальных данных
        pass
```

Поддерживаемые протоколы подключения:
- REST API WMS (SAP EWM, 1C WMS, Manhattan)
- MQTT/OPC-UA от сенсоров и RFID
- PostgreSQL / ClickHouse для исторических данных

## Стек

| Слой | Технология |
|------|-----------|
| 3D рендер | Three.js (OrbitControls) |
| Фронтенд | React 18 + Vite |
| Реальное время | Socket.IO (WebSocket) |
| Бэкенд | Python Flask + Flask-SocketIO |
| Деплой | Docker Compose + Nginx |
