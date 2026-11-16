// 지도 화면 전체를 담당하는 클래스
// - 타일을 그려서 화면에 붙이고
// - 마우스/터치로 끌기·확대를 처리하고
// - 도시 이름, 태풍 표시, 거리 측정 선을 겹쳐 그립니다.
import {
  TILE, lonToX, latToY, xToLon, yToLat, setGeoData, hasGeoData,
  renderBaseTile, renderCloudTile, renderLineTile,
} from './tiles.js';
import { loadCloudTile, loadBaseTile, hasRealClouds, timeKey } from './satellite.js';
import { loadRadarFrames, pickRadarFrame, loadRadarTile, loadFireTile } from './remoteTiles.js';
import { WeatherField, LAYER_VALUE, gridStepFor } from './weatherField.js';
import { rampColor } from './earth.js';
import { cities, countries } from '../data/places.js';

const MIN_ZOOM = 1.6;
const MAX_ZOOM = 11;
const MAX_TILES = 420; // 저장해 둘 타일의 최대 개수

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

// 구름이 보이는 지도 / 예보 색이 보이는 지도
const SATELLITE_LAYERS = ['satellite', 'satellite-hd', 'radar', 'precipitation'];

export class MapView {
  constructor(container, { lon, lat, zoom, onChange, onMapClick, onPlaceClick, onStormClick, onLatestTime, onSatelliteFail }) {
    this.onLatestTime = onLatestTime;
    this.onSatelliteFail = onSatelliteFail;
    this.container = container;
    this.lon = lon;
    this.lat = lat;
    this.zoom = zoom;
    this.onChange = onChange;
    this.onMapClick = onMapClick;
    this.onPlaceClick = onPlaceClick;
    this.onStormClick = onStormClick;

    this.layer = 'satellite';
    this.options = { clouds: true, lines: true, labels: true, storms: true, graticule: false, crosshair: false };
    this.cloudShift = 0; // 구름이 흘러간 정도(경도, 도)
    this.measure = null; // 거리 측정 점들
    this.marker = null; // 현재 위치 표시
    this.cache = new Map();
    this.pendingTiles = new Set(); // 인터넷에서 받아오는 중인 위성 타일
    this.failedTiles = new Set(); // 받지 못한 위성 타일 → 직접 만든 구름으로 대신
    this.satelliteOn = false;
    this.latestName = 'latest'; // '가장 최근 사진' 묶음 이름 (새 사진을 받을 때마다 바뀜)
    this.satelliteTime = null;
    this.satelliteKey = null;
    this.shownSatelliteKey = null;
    this.ratio = Math.min(2, window.devicePixelRatio || 1);
    this.frame = 0;
    // 실제 날씨 값(격자)과 레이더 사진 목록
    this.field = new WeatherField(() => this.requestRender());
    this.radarFrames = [];
    this.refreshRadar();
    // 10분마다 가장 최근 위성 사진을 새로 받고, 2분마다 실패했던 타일을 다시 시도합니다
    this.latestTimer = setInterval(() => this.refreshLatest(), 10 * 60000);
    this.retryTimer = setInterval(() => {
      if (this.failedTiles.size && navigator.onLine !== false) {
        this.failedTiles.clear();
        this.requestRender();
      }
    }, 2 * 60000);

    // 화면 요소 만들기
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'map-canvas';
    this.overlay = document.createElement('canvas');
    this.overlay.className = 'map-overlay';
    this.labelLayer = document.createElement('div');
    this.labelLayer.className = 'map-labels';
    // 태풍 경로 위의 점들은 태풍 표시와 따로 담습니다
    this.trackLayer = document.createElement('div');
    this.trackLayer.className = 'map-track';
    this.stormLayer = document.createElement('div');
    this.stormLayer.className = 'map-storms';
    this.markerEl = document.createElement('div');
    this.markerEl.className = 'map-marker';
    // 구조: #map > .viewport > [지도 그림, 덧그림, .overlays(이름·태풍·현재 위치)]
    this.viewport = document.createElement('div');
    this.viewport.className = 'viewport';
    this.overlaysEl = document.createElement('div');
    this.overlaysEl.className = 'overlays';
    this.overlaysEl.append(this.labelLayer, this.trackLayer, this.stormLayer, this.markerEl);
    this.viewport.append(this.canvas, this.overlay, this.overlaysEl);
    container.append(this.viewport);

    this.storms = []; // 실제 열대 저기압 목록 (App이 받아서 넣어 줍니다)
    this.stormEls = [];
    this.createLabels();
    this.bindEvents();
    this.resize();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
  }

  // ── 데이터 불러오기 ──────────────────────────────
  async loadGeo(landUrl, countriesUrl) {
    const [land, countriesTopo] = await Promise.all([
      fetch(landUrl).then((r) => r.json()),
      fetch(countriesUrl).then((r) => r.json()),
    ]);
    setGeoData(land, countriesTopo);
    this.cache.clear();
    this.requestRender();
  }

  // ── 상태 바꾸기 ──────────────────────────────────
  setLayer(layer) {
    this.layer = layer;
    this.requestRender();
  }

  setOptions(options) {
    this.options = { ...this.options, ...options };
    this.labelLayer.style.display = this.options.labels ? '' : 'none';
    this.stormLayer.style.display = this.options.storms ? '' : 'none';
    this.trackLayer.style.display = this.options.storms ? '' : 'none';
    if (this.options.wind) this.startWind();
    else this.stopWind();
    this.requestRender();
  }

  setCloudShift(shift) {
    this.cloudShift = shift;
    this.requestRender();
  }

  setMeasure(measure) {
    this.measure = measure;
    this.requestRender();
  }

  setMarker(marker) {
    this.marker = marker;
    this.requestRender();
  }

  getView() {
    return { lon: this.lon, lat: this.lat, zoom: this.zoom };
  }

  setView(lon, lat, zoom = this.zoom) {
    this.stopAnimation();
    this.lon = ((((lon + 180) % 360) + 360) % 360) - 180;
    this.lat = clamp(lat, -84, 84);
    this.zoom = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
    this.requestRender();
  }

  // 부드럽게 다른 곳으로 이동
  flyTo({ lon, lat, zoom = this.zoom }, duration = 900) {
    this.stopAnimation();
    const start = { lon: this.lon, lat: this.lat, zoom: this.zoom };
    let dLon = lon - start.lon;
    if (dLon > 180) dLon -= 360;
    if (dLon < -180) dLon += 360;
    const startTime = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - startTime) / duration);
      const e = easeInOut(t);
      this.lon = start.lon + dLon * e;
      this.lat = start.lat + (lat - start.lat) * e;
      this.zoom = start.zoom + (zoom - start.zoom) * e;
      this.renderNow();
      if (t < 1) this.animation = requestAnimationFrame(step);
      else this.animation = null;
    };
    this.animation = requestAnimationFrame(step);
  }

  // 화면의 한 점을 기준으로 확대/축소
  zoomAround(screenX, screenY, delta, animate = false) {
    const targetZoom = clamp(this.zoom + delta, MIN_ZOOM, MAX_ZOOM);
    if (!animate) {
      this.applyZoomAround(screenX, screenY, targetZoom);
      return;
    }
    this.stopAnimation();
    const startZoom = this.zoom;
    const startTime = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - startTime) / 250);
      this.applyZoomAround(screenX, screenY, startZoom + (targetZoom - startZoom) * easeInOut(t), true);
      if (t < 1) this.animation = requestAnimationFrame(step);
      else this.animation = null;
    };
    this.animation = requestAnimationFrame(step);
  }

  zoomBy(delta) {
    this.zoomAround(this.width / 2, this.height / 2, delta, true);
  }

  applyZoomAround(sx, sy, newZoom, immediate = false) {
    const before = this.screenToWorld(sx, sy);
    this.zoom = newZoom;
    const ws = this.worldSize();
    const cx = before.x * ws - (sx - this.width / 2);
    const cy = before.y * ws - (sy - this.height / 2);
    this.setCenterWorld(cx / ws, cy / ws);
    if (immediate) this.renderNow();
    else this.requestRender();
  }

  stopAnimation() {
    if (this.animation) cancelAnimationFrame(this.animation);
    this.animation = null;
  }

  // ── 좌표 계산 ────────────────────────────────────
  worldSize(zoom = this.zoom) {
    return TILE * 2 ** zoom;
  }

  setCenterWorld(x, y) {
    this.lon = xToLon(((x % 1) + 1) % 1);
    this.lat = clamp(yToLat(clamp(y, 0.0001, 0.9999)), -84, 84);
  }

  screenToWorld(sx, sy) {
    const ws = this.worldSize();
    return {
      x: lonToX(this.lon) + (sx - this.width / 2) / ws,
      y: latToY(this.lat) + (sy - this.height / 2) / ws,
    };
  }

  screenToLonLat(sx, sy) {
    const w = this.screenToWorld(sx, sy);
    return { lon: xToLon(((w.x % 1) + 1) % 1), lat: yToLat(clamp(w.y, 0, 1)) };
  }

  // 위도/경도 → 화면 좌표 (세계 지도가 옆으로 반복되므로 가장 가까운 쪽을 고릅니다)
  project(lat, lon) {
    const ws = this.worldSize();
    let dx = (lonToX(lon) - lonToX(this.lon)) * ws;
    if (dx > ws / 2) dx -= ws;
    if (dx < -ws / 2) dx += ws;
    const dy = (latToY(lat) - latToY(this.lat)) * ws;
    return { x: this.width / 2 + dx, y: this.height / 2 + dy };
  }

  // 기준점(ref) 가까이에 있는 쪽 지도 복사본으로 투영합니다 (경로가 경도 180°에서 끊기지 않도록)
  projectNear(lat, lon, ref) {
    const p = this.project(lat, lon);
    if (!ref) return p;
    const ws = this.worldSize();
    while (p.x - ref.x > ws / 2) p.x -= ws;
    while (p.x - ref.x < -ws / 2) p.x += ws;
    return p;
  }

  // 경로 전체를 이어지게 투영 (첫 점은 화면 가운데에 가까운 쪽)
  projectPath(points) {
    let prev = null;
    return points.map((pt) => {
      prev = this.projectNear(pt.lat, pt.lon, prev);
      return prev;
    });
  }

  // 1픽셀이 몇 미터인지 (화면 가운데 기준)
  metersPerPixel() {
    return (156543.034 * Math.cos((this.lat * Math.PI) / 180)) / 2 ** this.zoom;
  }

  // ── 크기 변경 ────────────────────────────────────
  resize() {
    const rect = this.container.getBoundingClientRect();
    this.width = Math.max(1, Math.round(rect.width));
    this.height = Math.max(1, Math.round(rect.height));
    const dpr = window.devicePixelRatio || 1;
    for (const c of [this.canvas, this.overlay]) {
      c.width = Math.round(this.width * dpr);
      c.height = Math.round(this.height * dpr);
      c.style.width = `${this.width}px`;
      c.style.height = `${this.height}px`;
    }
    this.dpr = dpr;
    this.renderNow();
  }

  // ── 그리기 ───────────────────────────────────────
  requestRender() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.renderNow();
    });
  }

  getTile(type, z, x, y, create) {
    const key = `${type}|${z}/${x}/${y}`;
    let tile = this.cache.get(key);
    if (tile) {
      // 최근에 쓴 타일을 뒤로 보내 오래된 것부터 지웁니다
      this.cache.delete(key);
      this.cache.set(key, tile);
      return tile;
    }
    if (!create) return null;
    if (type === 'base') tile = renderBaseTile(z, x, y, this.ratio);
    else if (type === 'base-dim') tile = renderBaseTile(z, x, y, this.ratio, true);
    else if (type === 'clouds') tile = renderCloudTile(z, x, y, this.ratio);
    else tile = renderLineTile(z, x, y, this.ratio);
    this.cache.set(key, tile);
    if (this.cache.size > MAX_TILES) this.cache.delete(this.cache.keys().next().value);
    return tile;
  }

  // 지금 지도에 필요한 층 목록 (아래에서 위로 그립니다)
  tileTypes() {
    const types = [];
    const satellite = SATELLITE_LAYERS.includes(this.layer);
    types.push({ type: satellite ? 'base' : 'base-dim' });
    if (satellite && this.options.clouds) types.push({ type: 'clouds', shift: true });
    // 레이더 지도이거나, 위성 지도 위에 레이더를 겹쳐 볼 때: 실제 레이더 사진
    if (this.layer === 'radar' || (satellite && this.options.radar)) types.push({ type: 'radar' });
    // 예보 지도(기온, 바람, 강수량...): 실제 격자 값으로 색칠
    if (LAYER_VALUE[this.layer]) types.push({ type: 'field' });
    // 고온 지점: 위성이 찾은 실제 열 이상 지점
    if (this.options.heat) types.push({ type: 'fire' });
    if (this.options.lines) types.push({ type: 'lines' });
    return types;
  }

  // 화면에 보이는 위도·경도 범위 (경도는 180°를 넘어갈 수 있음)
  viewBounds() {
    const a = this.screenToWorld(0, 0);
    const b = this.screenToWorld(this.width, this.height);
    return {
      west: a.x * 360 - 180,
      east: b.x * 360 - 180,
      north: yToLat(clamp(a.y, 0, 1)),
      south: yToLat(clamp(b.y, 0, 1)),
    };
  }

  renderNow() {
    if (!this.width) return;
    const ctx = this.canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    let missing = false;
    if (hasGeoData()) {
      const budgetEnd = performance.now() + (this.firstPaintDone ? 14 : 400);
      for (const layer of this.tileTypes()) {
        if (layer.type === 'field') this.drawField(ctx);
        else if (layer.type === 'radar' || layer.type === 'fire') this.drawRemoteLayer(ctx, layer.type);
        else if (this.drawTileLayer(ctx, layer, budgetEnd)) missing = true;
      }
      // 바람 애니메이션에 쓸 바람 값도 미리 받아 둡니다
      if (this.options.wind) this.field.ensure('wind', gridStepFor(this.zoom), this.viewBounds());
      if (!missing) this.firstPaintDone = true;
    } else {
      missing = true;
    }

    this.drawOverlay();
    this.updateLabels();
    this.updateStorms();
    this.updateMarker();
    if (this.onChange) this.onChange(this.getView(), this.metersPerPixel());
    if (missing && hasGeoData()) this.requestRender();
  }

  // 타일 한 층을 그립니다. 아직 못 그린 타일이 있으면 true
  drawTileLayer(ctx, { type, shift }, budgetEnd) {
    const dpr = this.dpr;
    const z = clamp(Math.round(this.zoom), 1, 11);
    const n = 2 ** z;
    const scale = 2 ** (this.zoom - z);
    const ts = TILE * scale * dpr; // 기기 픽셀 단위 타일 크기
    const ws = TILE * n * scale * dpr;
    // 직접 만든 구름만 시간에 따라 옆으로 흐르게 합니다 (실제 사진은 시각별로 따로 받음)
    const shiftPx = shift && !this.satelliteOn ? (this.cloudShift / 360) * ws : 0;
    const cx = lonToX(this.lon) * ws - shiftPx;
    const cy = latToY(this.lat) * ws;
    const left = cx - this.canvas.width / 2;
    const top = cy - this.canvas.height / 2;
    const x0 = Math.floor(left / ts);
    const x1 = Math.floor((left + this.canvas.width) / ts);
    const y0 = Math.max(0, Math.floor(top / ts));
    const y1 = Math.min(n - 1, Math.floor((top + this.canvas.height) / ts));

    // 화면 가운데에 가까운 타일부터 그립니다
    const list = [];
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const d = (tx + 0.5 - cx / ts) ** 2 + (ty + 0.5 - cy / ts) ** 2;
        list.push({ tx, ty, d });
      }
    }
    list.sort((a, b) => a.d - b.d);

    // 실제 위성 구름: 화면에 필요한 사진이 모두 도착했을 때 한꺼번에 바꿉니다.
    // (조각조각 섞여 보이지 않도록) 그 전에는 이전 시각의 사진이나 직접 만든 구름을 보여 줍니다
    let realMode = null;
    if (type === 'clouds' && this.satelliteOn) {
      const covered = list
        .map(({ tx, ty }) => ({ wx: ((tx % n) + n) % n, ty }))
        .filter(({ wx, ty }) => hasRealClouds(z, wx, ty));
      if (covered.length) {
        const settled = (key) => covered.every(({ wx, ty }) => {
          const k = this.realKey(z, wx, ty, key);
          return this.cache.has(k) || this.failedTiles.has(k);
        });
        for (const { wx, ty } of covered) this.requestRealCloudTile(z, wx, ty);
        if (settled(this.satelliteKey)) realMode = this.satelliteKey;
        // 이미 보여 주고 있는 시각이면 (지도를 옮긴 경우) 도착한 타일부터 바로 보여 줍니다
        else if (this.shownSatelliteKey === this.satelliteKey) realMode = this.satelliteKey;
        // 다른 시각으로 넘어가는 중이면, 새 사진이 다 올 때까지 이전 사진을 그대로 둡니다
        else if (this.shownSatelliteKey && settled(this.shownSatelliteKey)) realMode = this.shownSatelliteKey;
        if (realMode) this.shownSatelliteKey = realMode;
      }
    }

    // 실제 지구 사진(바닥): 마찬가지로 화면에 필요한 사진이 다 오면 한꺼번에 바꿉니다
    let realBase = false;
    if (type === 'base' && this.satelliteOn) {
      const tiles = list.map(({ tx, ty }) => ({ wx: ((tx % n) + n) % n, ty }));
      for (const { wx, ty } of tiles) this.requestBaseTile(z, wx, ty);
      const ready = tiles.every(({ wx, ty }) => this.cache.has(this.baseKey(z, wx, ty)) || this.failedTiles.has(this.baseKey(z, wx, ty)));
      if (ready) this.baseShown = true;
      realBase = this.baseShown;
    }

    let missing = false;
    ctx.imageSmoothingEnabled = true;
    for (const { tx, ty } of list) {
      const wx = ((tx % n) + n) % n;
      const sx = Math.round(tx * ts - left);
      const sy = Math.round(ty * ts - top);
      const size = Math.round((tx + 1) * ts - left) - sx;
      const sizeY = Math.round((ty + 1) * ts - top) - sy;
      const canCreate = performance.now() < budgetEnd;
      let tile;
      if (realBase) {
        const key = this.baseKey(z, wx, ty);
        const real = this.cache.get(key);
        if (real) {
          ctx.drawImage(real, sx, sy, size, sizeY);
          continue;
        }
        if (!this.failedTiles.has(key)) {
          this.drawParentTile(ctx, (pz, px, py) => this.cache.get(this.baseKey(pz, px, py)), z, wx, ty, sx, sy, size, sizeY);
          continue;
        }
      }
      if (realMode && hasRealClouds(z, wx, ty)) {
        const real = this.cache.get(this.realKey(z, wx, ty, realMode));
        if (real) {
          ctx.drawImage(real, sx, sy, size, sizeY);
          continue;
        }
        if (!this.failedTiles.has(this.realKey(z, wx, ty, realMode))) {
          // 받는 중: 덜 확대된 사진이 있으면 늘려서 보여 주고, 없으면 잠시 비워 둡니다
          this.drawParentTile(ctx, (pz, px, py) => this.cache.get(this.realKey(pz, px, py, realMode)), z, wx, ty, sx, sy, size, sizeY);
          continue;
        }
        // 받지 못한 타일만 직접 만든 구름으로 채웁니다
      }
      tile = this.getTile(type, z, wx, ty, canCreate);
      if (tile) {
        ctx.drawImage(tile, sx, sy, size, sizeY);
        continue;
      }
      missing = true;
      // 아직 없으면 더 낮은 확대 단계의 타일을 늘려서 대신 보여 줍니다
      for (let up = 1; up <= 4 && z - up >= 1; up++) {
        const pz = z - up;
        const f = 2 ** up;
        const px = Math.floor(wx / f);
        const py = Math.floor(ty / f);
        const parent = this.getTile(type, pz, px, py, false);
        if (parent) {
          const sub = parent.width / f;
          ctx.drawImage(parent, (wx % f) * sub, (ty % f) * sub, sub, sub, sx, sy, size, sizeY);
          break;
        }
      }
    }
    return missing;
  }

  // 윗단계(덜 확대된) 타일의 일부를 늘려서 그리기
  drawParentTile(ctx, lookup, z, wx, ty, sx, sy, size, sizeY) {
    for (let up = 1; up <= 4 && z - up >= 1; up++) {
      const f = 2 ** up;
      const parent = lookup(z - up, Math.floor(wx / f), Math.floor(ty / f));
      if (parent) {
        const sub = parent.width / f;
        ctx.drawImage(parent, (wx % f) * sub, (ty % f) * sub, sub, sub, sx, sy, size, sizeY);
        return true;
      }
    }
    return false;
  }

  // ── 실제 위성 구름 ───────────────────────────────
  // date: 날짜면 그 시각의 사진, null이면 '가장 최근 사진', false면 실제 사진을 쓰지 않습니다
  setSatelliteTime(date) {
    if (date === false) {
      this.satelliteOn = false;
      this.requestRender();
      return;
    }
    const key = date ? timeKey(date) : this.latestName;
    this.satelliteOn = true;
    if (key === this.satelliteKey) return;
    this.satelliteTime = date;
    this.satelliteKey = key;
    this.requestRender();
  }

  // 인터넷이 다시 연결되었을 때 등: 실패했던 사진을 모두 다시 받아 봅니다
  retryNetwork() {
    this.failedTiles.clear();
    this.realFailures = 0;
    this.refreshRadar();
    this.refreshLatest();
  }

  // 가장 최근 위성 사진을 새로 받기 (10분마다 새 사진이 올라옵니다).
  // 이름을 바꿔 새로 받고, 다 도착할 때까지는 이전 사진을 그대로 보여 줍니다
  refreshLatest() {
    const wasLatest = this.satelliteKey === this.latestName;
    this.latestGeneration = (this.latestGeneration || 0) + 1;
    this.latestName = `latest-${this.latestGeneration}`;
    this.latestActual = null;
    this.latestReported = false;
    this.latestProbing = false;
    if (wasLatest) this.satelliteKey = this.latestName;
    this.requestRender();
  }

  realKey(z, x, y, key = this.satelliteKey) {
    return `real@${key}|${z}/${x}/${y}`;
  }

  baseKey(z, x, y) {
    return `bm|${z}/${x}/${y}`;
  }

  // 실제 지구 사진 타일 받아 오기
  requestBaseTile(z, x, y) {
    const key = this.baseKey(z, x, y);
    if (this.cache.has(key) || this.failedTiles.has(key) || this.pendingTiles.has(key)) return;
    this.pendingTiles.add(key);
    loadBaseTile(z, x, y, this.ratio)
      .then((canvas) => {
        this.cache.set(key, canvas);
        if (this.cache.size > MAX_TILES) this.cache.delete(this.cache.keys().next().value);
      })
      .catch(() => this.failedTiles.add(key))
      .finally(() => {
        this.pendingTiles.delete(key);
        this.requestRender();
      });
  }

  // 실제 구름 타일을 (아직 없으면) 인터넷에서 받아 오기 시작합니다
  requestRealCloudTile(z, x, y) {
    const key = this.realKey(z, x, y);
    if (this.cache.has(key) || this.failedTiles.has(key) || this.pendingTiles.has(key)) return;
    const isLatest = this.satelliteKey === this.latestName;
    // 처음에는 (화면 가운데에 가장 가까운) 타일 하나만 먼저 받아 사진 시각을 알아낸 뒤,
    // 나머지 타일을 모두 같은 시각으로 받습니다
    const probing = isLatest && !this.latestActual;
    if (probing && this.latestProbing) return;
    if (probing) this.latestProbing = true;
    this.pendingTiles.add(key);
    // '가장 최근' 사진은 첫 타일이 알려 준 시각으로 나머지를 맞춰 받습니다 (타일끼리 시각이 같도록)
    loadCloudTile(z, x, y, isLatest ? this.latestActual || null : this.satelliteTime, this.ratio)
      .then(({ canvas, time }) => {
        this.cache.set(key, canvas);
        if (this.cache.size > MAX_TILES) this.cache.delete(this.cache.keys().next().value);
        this.realSuccesses = (this.realSuccesses || 0) + 1;
        if (isLatest && time && !this.latestActual) this.latestActual = time;
        // 가장 최근 사진의 실제 시각을 한 번 알려 줍니다 (시계 표시용)
        if (isLatest && time && !this.latestReported && this.onLatestTime) {
          this.latestReported = true;
          this.onLatestTime(time);
        }
      })
      .catch(() => {
        this.failedTiles.add(key);
        this.realFailures = (this.realFailures || 0) + 1;
        // 하나도 받지 못하고 계속 실패하면(인터넷이 안 되는 경우) 직접 만든 구름으로 돌아갑니다
        if (!this.realSuccesses && this.realFailures >= 6 && this.onSatelliteFail) this.onSatelliteFail();
      })
      .finally(() => {
        this.pendingTiles.delete(key);
        if (probing) this.latestProbing = false;
        this.requestRender();
      });
  }

  // 태풍 경로, 거리 측정, 위도/경도 격자, 십자선
  drawOverlay() {
    const ctx = this.overlay.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    if (this.options.graticule) this.drawGraticule(ctx);
    if (this.options.storms) for (const storm of this.storms) this.drawStormTrack(ctx, storm);
    if (this.measure && this.measure.points.length) this.drawMeasure(ctx);
    if (this.options.crosshair) {
      const cx = this.width / 2;
      const cy = this.height / 2;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx - 10, cy);
      ctx.lineTo(cx + 10, cy);
      ctx.moveTo(cx, cy - 10);
      ctx.lineTo(cx, cy + 10);
      ctx.stroke();
    }
  }

  // ── 실제 레이더·고온 지점 타일 ────────────────────
  // 레이더 사진 목록을 받아 옵니다 (10분마다 새 사진이 나옵니다)
  refreshRadar() {
    clearTimeout(this.radarTimer);
    loadRadarFrames()
      .then((frames) => {
        this.radarFrames = frames;
        this.radarError = false;
        this.requestRender();
      })
      .catch(() => {
        this.radarError = true;
      })
      .finally(() => {
        if (!this.destroyed) this.radarTimer = setTimeout(() => this.refreshRadar(), 10 * 60000);
      });
  }

  // 화면에 보이는 타일 목록 (가운데부터)
  visibleTiles() {
    const z = clamp(Math.round(this.zoom), 1, 11);
    const n = 2 ** z;
    const ts = TILE * 2 ** (this.zoom - z) * this.dpr;
    const ws = ts * n;
    const cx = lonToX(this.lon) * ws;
    const cy = latToY(this.lat) * ws;
    const left = cx - this.canvas.width / 2;
    const top = cy - this.canvas.height / 2;
    const list = [];
    const y0 = Math.max(0, Math.floor(top / ts));
    const y1 = Math.min(n - 1, Math.floor((top + this.canvas.height) / ts));
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = Math.floor(left / ts); tx <= Math.floor((left + this.canvas.width) / ts); tx++) {
        const sx = Math.round(tx * ts - left);
        const sy = Math.round(ty * ts - top);
        list.push({
          wx: ((tx % n) + n) % n,
          ty,
          sx,
          sy,
          w: Math.round((tx + 1) * ts - left) - sx,
          h: Math.round((ty + 1) * ts - top) - sy,
          d: (tx + 0.5 - cx / ts) ** 2 + (ty + 0.5 - cy / ts) ** 2,
        });
      }
    }
    list.sort((a, b) => a.d - b.d);
    return { z, list };
  }

  drawRemoteLayer(ctx, kind) {
    let prefix;
    let load;
    let fallback = null; // 새 사진이 오기 전까지 보여 줄 이전 사진
    if (kind === 'radar') {
      const frame = pickRadarFrame(this.radarFrames, this.satelliteTime);
      if (!frame) return;
      prefix = `radar@${frame.url}`;
      load = (z, x, y) => loadRadarTile(frame, z, x, y, this.ratio);
      if (this.shownRadar && this.shownRadar !== prefix) fallback = this.shownRadar;
    } else {
      prefix = 'fire';
      load = (z, x, y) => loadFireTile(z, x, y, this.ratio);
    }
    const { z, list } = this.visibleTiles();
    const key = (pre, tz, x, y) => `${pre}|${tz}/${x}/${y}`;
    let complete = true;
    for (const t of list) {
      const k = key(prefix, z, t.wx, t.ty);
      if (!this.cache.has(k) && !this.failedTiles.has(k) && !this.pendingTiles.has(k)) {
        this.pendingTiles.add(k);
        load(z, t.wx, t.ty)
          .then((canvas) => {
            this.cache.set(k, canvas);
            if (this.cache.size > MAX_TILES) this.cache.delete(this.cache.keys().next().value);
          })
          .catch(() => this.failedTiles.add(k))
          .finally(() => {
            this.pendingTiles.delete(k);
            this.requestRender();
          });
      }
      if (!this.cache.has(k) && !this.failedTiles.has(k)) complete = false;
    }
    // 레이더: 새 시각의 사진이 다 오면 바꿉니다 (조각조각 섞이지 않게)
    const use = kind === 'radar' && !complete && fallback ? fallback : prefix;
    if (kind === 'radar' && (complete || !fallback)) this.shownRadar = prefix;
    ctx.imageSmoothingEnabled = true;
    for (const t of list) {
      const tile = this.cache.get(key(use, z, t.wx, t.ty));
      if (tile) ctx.drawImage(tile, t.sx, t.sy, t.w, t.h);
      else this.drawParentTile(ctx, (pz, px, py) => this.cache.get(key(use, pz, px, py)), z, t.wx, t.ty, t.sx, t.sy, t.w, t.h);
    }
  }

  // ── 예보 지도: 실제 격자 값을 색으로 ─────────────
  drawField(ctx) {
    const [group, pick] = LAYER_VALUE[this.layer];
    const step = gridStepFor(this.zoom);
    const bounds = this.viewBounds();
    this.field.ensure(group, step, bounds);

    // 화면을 6픽셀 칸으로 나눠 계산한 뒤, 부드럽게 늘려서 그립니다
    const cell = 6;
    const w = Math.ceil(this.width / cell) + 1;
    const h = Math.ceil(this.height / cell) + 1;
    if (!this.fieldCanvas || this.fieldCanvas.width !== w || this.fieldCanvas.height !== h) {
      this.fieldCanvas = document.createElement('canvas');
      this.fieldCanvas.width = w;
      this.fieldCanvas.height = h;
    }
    const fctx = this.fieldCanvas.getContext('2d');
    const image = fctx.createImageData(w, h);
    const data = image.data;

    // 이번 화면에 필요한 격자 값을 배열로 한 번만 꺼내 둡니다 (빠르게 계산하려고)
    const nLon = Math.round(360 / step);
    const i0 = Math.floor((bounds.west + 180) / step) - 1;
    const i1 = Math.ceil((bounds.east + 180) / step) + 1;
    const j0 = Math.max(0, Math.floor((bounds.south + 90) / step) - 1);
    const j1 = Math.min(Math.round(180 / step), Math.ceil((bounds.north + 90) / step) + 1);
    const gw = i1 - i0 + 1;
    const grid = new Float32Array(gw * (j1 - j0 + 1)).fill(NaN);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const point = this.field.points.get(this.field.key(group, step, ((i % nLon) + nLon) % nLon, j));
        const v = point ? pick(point) : null;
        if (v != null) grid[(j - j0) * gw + (i - i0)] = v;
      }
    }

    const ramp = /temperature|dew/.test(this.layer) ? 'temperature'
      : /wind/.test(this.layer) ? 'wind'
        : this.layer === 'humidity' ? 'humidity' : this.layer;
    const color = [0, 0, 0];
    const lons = [];
    for (let x = 0; x < w; x++) lons.push(this.screenToWorld(x * cell, 0).x * 360 - 180);
    for (let y = 0; y < h; y++) {
      const lat = yToLat(clamp(this.screenToWorld(0, y * cell).y, 0, 1));
      const fj = (lat + 90) / step - j0;
      const j = Math.floor(fj);
      const ty = fj - j;
      if (j < 0 || j >= j1 - j0) continue;
      for (let x = 0; x < w; x++) {
        const fi = (lons[x] + 180) / step - i0;
        const i = Math.floor(fi);
        const tx = fi - i;
        if (i < 0 || i >= gw - 1) continue;
        const a = grid[j * gw + i];
        const b = grid[j * gw + i + 1];
        const c = grid[(j + 1) * gw + i];
        const d = grid[(j + 1) * gw + i + 1];
        const v = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
        if (Number.isNaN(v)) continue;
        let alpha = 0.8;
        if (ramp === 'precipitation') {
          // 강수량(mm/시간)을 0~1 색 단계로: 0.1 → 약함, 4 → 보통, 25 → 강함
          if (v < 0.05) continue;
          rampColor('precipitation', Math.min(1, 0.2 + Math.log10(1 + v) * 0.55), color);
          alpha = Math.min(0.85, 0.35 + v * 0.5);
        } else {
          rampColor(ramp, v, color);
        }
        const k = (y * w + x) * 4;
        data[k] = color[0];
        data[k + 1] = color[1];
        data[k + 2] = color[2];
        data[k + 3] = alpha * 255;
      }
    }
    fctx.putImageData(image, 0, 0);
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.fieldCanvas, 0, 0, w * cell * this.dpr, h * cell * this.dpr);
    ctx.restore();
  }

  // 바람 애니메이션: 작은 입자들이 바람 방향으로 흐릅니다
  startWind() {
    if (this.windTimer) return;
    if (!this.windCanvas) {
      this.windCanvas = document.createElement('canvas');
      this.windCanvas.className = 'map-wind';
      this.overlaysEl.prepend(this.windCanvas);
    }
    const canvas = this.windCanvas;
    const particles = [];
    const reset = (p) => {
      p.x = Math.random() * this.width;
      p.y = Math.random() * this.height;
      p.age = Math.floor(Math.random() * 80);
    };
    for (let i = 0; i < 900; i++) {
      const p = {};
      reset(p);
      particles.push(p);
    }
    const tick = () => {
      if (canvas.width !== this.canvas.width) {
        canvas.width = this.canvas.width;
        canvas.height = this.canvas.height;
        canvas.style.width = `${this.width}px`;
        canvas.style.height = `${this.height}px`;
      }
      const ctx = canvas.getContext('2d');
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      // 이전 프레임을 조금씩 지워서 꼬리가 남게
      ctx.globalCompositeOperation = 'destination-in';
      ctx.fillStyle = 'rgba(0,0,0,0.9)';
      ctx.fillRect(0, 0, this.width, this.height);
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      const step = gridStepFor(this.zoom);
      for (const p of particles) {
        const { lat, lon } = this.screenToLonLat(p.x, p.y);
        // 그 위치의 실제 바람 (km/h). 아직 값이 없으면 움직이지 않고 기다립니다
        const wind = this.field.wind(step, lat, lon);
        let nx = p.x;
        let ny = p.y;
        if (wind) {
          // 50 km/h ≈ 한 프레임에 3픽셀 (너무 느린 바람도 조금은 보이게)
          const k = 0.06;
          nx = p.x + wind.u * k;
          ny = p.y - wind.v * k;
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(nx, ny);
        }
        p.x = nx;
        p.y = ny;
        p.age += 1;
        if (p.age > 100 || p.x < 0 || p.x > this.width || p.y < 0 || p.y > this.height) reset(p);
      }
      ctx.stroke();
      this.windTimer = requestAnimationFrame(tick);
    };
    this.windTimer = requestAnimationFrame(tick);
  }

  stopWind() {
    if (this.windTimer) cancelAnimationFrame(this.windTimer);
    this.windTimer = null;
    if (this.windCanvas) {
      const ctx = this.windCanvas.getContext('2d');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.windCanvas.width, this.windCanvas.height);
    }
  }

  drawGraticule(ctx) {
    const stepDeg = this.zoom < 3 ? 30 : this.zoom < 5 ? 10 : this.zoom < 7 ? 5 : 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let lat = -80; lat <= 80; lat += stepDeg) {
      const p = this.project(lat, this.lon);
      ctx.moveTo(0, p.y);
      ctx.lineTo(this.width, p.y);
    }
    for (let lon = -180; lon < 180; lon += stepDeg) {
      const p = this.project(this.lat, lon);
      if (p.x < 0 || p.x > this.width) continue;
      ctx.moveTo(p.x, 0);
      ctx.lineTo(p.x, this.height);
    }
    ctx.stroke();
  }

  // 태풍 경로: 회색 원뿔(예상 범위) + 등급별 색 선 (지나온 길은 진하게, 예상 경로는 점선)
  drawStormTrack(ctx, storm) {
    storm.screenPoints = [];
    for (const ring of storm.cone || []) {
      if (ring.length < 3) continue;
      // 원뿔도 폭풍 위치에서부터 이어서 투영합니다
      const pts = this.projectPath([storm.position, ...ring]).slice(1);
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.fillStyle = 'rgba(205, 210, 218, 0.38)';
      ctx.fill();
    }
    const track = [...storm.past, ...storm.forecast];
    if (track.length < 2) return;
    // 지금 위치를 기준으로 앞뒤 경로를 이어서 투영
    const nowIndex = storm.past.length - 1;
    const before = this.projectPath([...storm.past].reverse()).reverse();
    const after = this.projectPath([storm.past[nowIndex], ...storm.forecast]).slice(1);
    const pts = [...before, ...after];
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (let i = 1; i < pts.length; i++) {
      const forecast = i > nowIndex;
      ctx.beginPath();
      ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
      ctx.lineTo(pts[i].x, pts[i].y);
      ctx.strokeStyle = track[i - 1].color;
      ctx.setLineDash(forecast ? [7, 5] : []);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    // 경로 점을 DOM에 놓을 때 쓰도록 저장
    storm.screenPoints = pts;
  }

  drawMeasure(ctx) {
    const pts = this.measure.points.map((p) => this.project(p.lat, p.lon));
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    if (this.measure.mode === 'area' && pts.length > 2) {
      ctx.closePath();
      ctx.fillStyle = 'rgba(10, 132, 255, 0.25)';
      ctx.fill();
    }
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([6, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
    for (const p of pts) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#0a84ff';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  // ── 도시 이름 ────────────────────────────────────
  createLabels() {
    this.labels = [...countries, ...cities].map((place) => {
      const el = document.createElement(place.kind === 'city' ? 'a' : 'div');
      el.className = place.kind === 'city' ? 'label' : 'label country';
      if (place.kind === 'city') {
        el.href = place.path;
        el.addEventListener('click', (event) => {
          event.preventDefault();
          if (this.onPlaceClick) this.onPlaceClick(place);
        });
        el.innerHTML = '<div class="anchor"></div>';
      }
      const text = document.createElement('div');
      text.className = 'text';
      text.textContent = place.name;
      el.append(text);
      this.labelLayer.append(el);
      // 글자 폭 추정 (한글은 글자당 약 13px)
      const width = [...place.name].reduce((w, ch) => w + (ch.charCodeAt(0) > 0x1100 ? 12.6 : 7.4), 10);
      return { place, el, width, visible: false };
    });
    // 순서: 나라 이름은 뒤로(겹치면 도시가 우선), 도시는 rank 순
    this.labels.sort((a, b) => {
      const ra = a.place.kind === 'country' ? 50 : a.place.rank;
      const rb = b.place.kind === 'country' ? 50 : b.place.rank;
      return ra - rb;
    });
  }

  updateLabels() {
    if (!this.options.labels) return;
    const placed = [];
    for (const label of this.labels) {
      const { place, el, width } = label;
      let show = this.zoom >= place.minZoom - 0.25;
      let p;
      if (show) {
        p = this.project(place.lat, place.lon);
        // 화면 밖이라도 가까운 곳(한 타일 거리)의 이름은 미리 준비해 둡니다
        show = p.x > -256 && p.x < this.width + 256 && p.y > -256 && p.y < this.height + 256;
      }
      if (show) {
        // 이름끼리 겹치지 않게 확인합니다
        const box = place.kind === 'city'
          ? { x0: p.x - width / 2, x1: p.x + width / 2, y0: p.y - 26, y1: p.y + 4 }
          : { x0: p.x - width / 2, x1: p.x + width / 2, y0: p.y - 10, y1: p.y + 10 };
        const onScreen = p.x > -40 && p.x < this.width + 40 && p.y > -20 && p.y < this.height + 30;
        if (onScreen) {
          show = !placed.some((b) => b.x0 < box.x1 && b.x1 > box.x0 && b.y0 < box.y1 && b.y1 > box.y0);
          if (show) placed.push(box);
        }
      }
      if (show) {
        el.style.transform = `translate3d(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px, 0)`;
        if (!label.visible) el.style.display = '';
      } else if (label.visible || label.visible === false) {
        el.style.display = 'none';
      }
      label.visible = show;
    }
  }

  // ── 태풍 표시 ────────────────────────────────────
  // 태풍 목록 바꾸기 (처음 받았을 때, 새로 받아 왔을 때)
  setStorms(list) {
    this.storms = list || [];
    this.stormLayer.replaceChildren();
    this.trackLayer.replaceChildren();
    this.stormEls = this.storms.map((storm) => {
      const el = document.createElement('a');
      el.href = `#${storm.id}`;
      el.className = `storm-dot ${storm.kind} rank${storm.rank < 0 ? `-${-storm.rank}` : storm.rank}${storm.south ? ' south' : ''}`;
      el.setAttribute('aria-label', storm.name);
      el.title = storm.name;
      el.innerHTML = storm.kind === 'cyclone'
        ? `<div class="dot"><svg viewBox="0 0 30 30" class="cyclone-icon" aria-hidden="true">
            <path d="M15 4.5c-4.4 0-8.6 1.7-10.5 5.6 2.4-1.7 5.2-2.2 7.6-1.6A7 7 0 0 0 15 22c4.4 0 8.6-1.7 10.5-5.6-2.4 1.7-5.2 2.2-7.6 1.6A7 7 0 0 0 15 4.5Z" />
            <circle cx="15" cy="15" r="3.2" class="eye" /></svg></div>`
        : '<div class="dot"><div class="ring"></div><div class="icon"></div></div>';
      el.addEventListener('click', (event) => {
        event.preventDefault();
        if (this.onStormClick) this.onStormClick(storm);
      });
      // 경로 위의 점들 (지금 위치는 아이콘으로 보여 주므로 제외). 점의 색이 그때의 등급입니다
      const timeText = (t) => (t ? `${t.getUTCMonth() + 1}/${t.getUTCDate()} ${String(t.getUTCHours()).padStart(2, '0')}시 UTC` : '');
      const points = [...storm.past.slice(0, -1), ...storm.forecast].map((p, i) => {
        const dotEl = document.createElement('div');
        dotEl.className = `track-point${i >= storm.past.length - 1 ? ' forecast' : ''}`;
        dotEl.style.backgroundColor = p.color;
        dotEl.title = `${i >= storm.past.length - 1 ? '예상' : '지나온'} 위치 · ${timeText(p.time)}`;
        this.trackLayer.append(dotEl);
        return { index: i < storm.past.length - 1 ? i : i + 1, el: dotEl };
      });
      this.stormLayer.append(el);
      return { storm, el, points };
    });
    this.requestRender();
  }

  updateStorms() {
    if (!this.options.storms) return;
    for (const { storm, el, points } of this.stormEls) {
      const p = this.project(storm.position.lat, storm.position.lon);
      el.style.transform = `translate3d(${(p.x - 20).toFixed(1)}px, ${(p.y - 20).toFixed(1)}px, 0)`;
      // drawStormTrack이 계산해 둔 화면 좌표를 그대로 씁니다 (선과 점이 정확히 겹치도록)
      const pts = storm.screenPoints || [];
      for (const { index, el: dotEl } of points) {
        const q = pts[index] || this.project(-89, 0);
        dotEl.style.transform = `translate3d(${(q.x - 4).toFixed(1)}px, ${(q.y - 4).toFixed(1)}px, 0)`;
      }
    }
  }

  updateMarker() {
    if (!this.marker) {
      this.markerEl.style.display = 'none';
      return;
    }
    const p = this.project(this.marker.lat, this.marker.lon);
    this.markerEl.style.display = 'block';
    this.markerEl.style.transform = `translate3d(${p.x - 9}px, ${p.y - 9}px, 0)`;
  }

  // ── 마우스·터치·키보드 ───────────────────────────
  bindEvents() {
    const el = this.container;
    const pointers = new Map();
    let drag = null;
    let pinch = null;
    let velocity = { x: 0, y: 0 };
    let lastMove = 0;

    const local = (event) => {
      const rect = el.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };

    const panBy = (dx, dy) => {
      const ws = this.worldSize();
      const x = lonToX(this.lon) - dx / ws;
      const y = latToY(this.lat) - dy / ws;
      this.setCenterWorld(x, y);
      this.requestRender();
    };
    this.panBy = panBy;

    el.addEventListener('pointerdown', (event) => {
      if (event.target.closest('.label, .storm-dot')) return;
      if (event.button !== 0 && event.pointerType === 'mouse') return;
      this.stopAnimation();
      el.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, local(event));
      if (pointers.size === 1) {
        const p = local(event);
        drag = { start: p, last: p, time: performance.now(), moved: 0 };
        velocity = { x: 0, y: 0 };
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: this.zoom };
        drag = null;
      }
      el.classList.add('dragging');
    });

    el.addEventListener('pointermove', (event) => {
      if (!pointers.has(event.pointerId)) return;
      const p = local(event);
      pointers.set(event.pointerId, p);
      if (pinch && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const target = pinch.zoom + Math.log2(dist / pinch.dist);
        this.applyZoomAround((a.x + b.x) / 2, (a.y + b.y) / 2, clamp(target, MIN_ZOOM, MAX_ZOOM));
        return;
      }
      if (!drag) return;
      const dx = p.x - drag.last.x;
      const dy = p.y - drag.last.y;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      const now = performance.now();
      const dt = Math.max(1, now - lastMove);
      velocity = { x: (dx / dt) * 16, y: (dy / dt) * 16 };
      lastMove = now;
      drag.last = p;
      panBy(dx, dy);
    });

    const end = (event) => {
      if (!pointers.has(event.pointerId)) return;
      pointers.delete(event.pointerId);
      if (pointers.size < 2) pinch = null;
      if (drag && pointers.size === 0) {
        const p = local(event);
        if (drag.moved < 5 && performance.now() - drag.time < 500) {
          // 짧게 누르면 "클릭"
          if (this.onMapClick) this.onMapClick({ ...this.screenToLonLat(p.x, p.y), x: p.x, y: p.y });
        } else if (performance.now() - lastMove < 60 && Math.hypot(velocity.x, velocity.y) > 1) {
          // 손을 놓은 뒤에도 조금 미끄러지게 (관성)
          const glide = () => {
            velocity.x *= 0.92;
            velocity.y *= 0.92;
            panBy(velocity.x, velocity.y);
            if (Math.hypot(velocity.x, velocity.y) > 0.3) this.animation = requestAnimationFrame(glide);
            else this.animation = null;
          };
          this.animation = requestAnimationFrame(glide);
        }
        drag = null;
      }
      if (pointers.size === 0) el.classList.remove('dragging');
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);

    el.addEventListener('wheel', (event) => {
      event.preventDefault();
      this.stopAnimation();
      const p = local(event);
      const delta = clamp(-event.deltaY * (event.deltaMode === 1 ? 0.05 : 0.0025), -0.6, 0.6);
      this.applyZoomAround(p.x, p.y, clamp(this.zoom + delta, MIN_ZOOM, MAX_ZOOM));
    }, { passive: false });

    el.addEventListener('dblclick', (event) => {
      if (this.measure) return;
      const p = local(event);
      this.zoomAround(p.x, p.y, event.shiftKey ? -1 : 1, true);
    });

    el.addEventListener('keydown', (event) => {
      if (event.target !== el) return;
      const keys = { ArrowLeft: [80, 0], ArrowRight: [-80, 0], ArrowUp: [0, 80], ArrowDown: [0, -80] };
      if (keys[event.key]) {
        event.preventDefault();
        panBy(...keys[event.key]);
      } else if (event.key === '+' || event.key === '=') this.zoomBy(1);
      else if (event.key === '-' || event.key === '_') this.zoomBy(-1);
    });
  }

  destroy() {
    this.destroyed = true;
    clearTimeout(this.radarTimer);
    clearInterval(this.latestTimer);
    clearInterval(this.retryTimer);
    this.stopAnimation();
    this.stopWind();
    this.resizeObserver.disconnect();
    this.container.innerHTML = '';
  }
}
