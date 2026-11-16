// 앱 전체: 지도 + 버튼 + 창(패널)들을 연결합니다
import { useCallback, useEffect, useRef, useState } from 'react';
import landUrl from 'world-atlas/land-50m.json?url';
import countriesUrl from 'world-atlas/countries-50m.json?url';
import { MapView } from './map/MapView.js';
import { cities, findPlaceByPath } from './data/places.js';
import { loadStorms } from './data/storms.js';
import { distanceKm, areaKm2, latestImageTime } from './utils/format.js';
import { TopRightButtons, OverlayButtons, ZoomButtons, TitleButton, Footer, NetworkNotice } from './components/MapControls.jsx';
import { Icon } from './components/Icons.jsx';
import {
  WelcomeDialog, LayersPanel, LayersDropdown, ClockPanel, SearchPanel, SettingsPanel, AboutPanel,
  OverlaysPanel, TitleMenu, WeatherPanel, StormPanel, MeasurePanel, Legend, HeatConsent, categoryOf,
} from './components/Panels.jsx';

// ── 즐겨찾기 저장 (localStorage) ──
// 개인 정보 보호 모드 등에서는 저장소를 못 쓸 수 있으므로 항상 try/catch로 감쌉니다
const SAVED_KEY = 'globe-view:saved-places';
function readSavedPlaces() {
  try {
    const list = JSON.parse(window.localStorage.getItem(SAVED_KEY) || '[]');
    // 지금 도시 목록에 있는 주소만 남깁니다 (예전 주소가 남아 있어도 문제없게)
    return Array.isArray(list) ? list.filter((path) => findPlaceByPath(path)) : [];
  } catch {
    return [];
  }
}
function writeSavedPlaces(list) {
  try {
    window.localStorage.setItem(SAVED_KEY, JSON.stringify(list));
  } catch {
    // 저장할 수 없으면 이번 방문 동안만 기억합니다
  }
}

// 처음 보이는 지도 위치 (한반도 중부)
const HOME_VIEW = { lon: 127.8333, lat: 36.3833, zoom: 5 };
const PLACE_ZOOM = 7;

const DEFAULT_SETTINGS = {
  timeZone: 'local',
  timeFormat: 'hour24',
  summary: 'daily',
  appearance: 'translucent',
  units: 'metric',
  tooltips: 'enabled',
};

// 배포 주소의 앞부분 (예: GitHub Pages에서는 '/globe-view/', 내 컴퓨터에서는 '/')
const BASE = import.meta.env.BASE_URL;
// 브라우저 주소 → 앱 안의 주소 ('/globe-view/places/kr/seoul/' → '/places/kr/seoul/')
const currentAppPath = () => {
  const { pathname } = window.location;
  return pathname.startsWith(BASE) ? `/${pathname.slice(BASE.length)}` : '/';
};
// 앱 안의 주소 → 브라우저 주소
const toBrowserPath = (path) => `${BASE}${path.slice(1)}`;

export default function App() {
  const mapBox = useRef(null);
  const mapRef = useRef(null);
  const initialPlace = useRef(findPlaceByPath(currentAppPath())).current;

  const [view, setView] = useState(HOME_VIEW);
  const [metersPerPixel, setMetersPerPixel] = useState(3920);
  const [welcome, setWelcome] = useState(!initialPlace);
  const [panel, setPanel] = useState(null); // search | settings | about | overlays | title
  const [layersOpen, setLayersOpen] = useState(() => window.innerWidth >= 680);
  const [layer, setLayer] = useState('satellite');
  const [overlays, setOverlays] = useState({
    radar: false, wind: false, heat: false, clouds: true, storms: true, labels: true,
    lines: true, graticule: false, crosshair: false,
  });
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [place, setPlace] = useState(initialPlace);
  const [storm, setStorm] = useState(null);
  const [storms, setStorms] = useState([]); // 지금 진행 중인 실제 열대 저기압
  const [stormStatus, setStormStatus] = useState('loading'); // loading | ok | error
  // 즐겨찾기(별표)한 장소: 브라우저에 저장해 두어 새로고침해도 남아 있습니다
  const [saved, setSaved] = useState(readSavedPlaces);
  const [measure, setMeasure] = useState(null); // { mode, points }
  const [locating, setLocating] = useState(false);
  const [decimal, setDecimal] = useState(false);
  const [miles, setMiles] = useState(false);
  const [latest, setLatest] = useState(() => latestImageTime());
  const [realImagery, setRealImagery] = useState(true); // 실제 위성 구름 사용 (안 되면 false)
  const [online, setOnline] = useState(() => navigator.onLine !== false); // 인터넷 연결 상태
  const [frameOffset, setFrameOffset] = useState(0); // 최신 사진보다 몇 분 전인지
  const [playing, setPlaying] = useState(false);

  // ── 지도 만들기 (한 번만) ──
  useEffect(() => {
    const start = initialPlace ? { lon: initialPlace.lon, lat: initialPlace.lat, zoom: PLACE_ZOOM } : HOME_VIEW;
    const map = new MapView(mapBox.current, {
      ...start,
      onChange: (v, mpp) => {
        setView(v);
        setMetersPerPixel(mpp);
      },
      onMapClick: (point) => mapClickRef.current(point),
      onPlaceClick: (p) => openPlaceRef.current(p),
      onStormClick: (s) => openStormRef.current(s),
      // 가장 최근 위성 사진의 시각을 알게 되면 시계에 반영
      onLatestTime: (time) => setLatest(time),
      // 위성 사진을 받을 수 없으면 직접 만든 구름으로
      onSatelliteFail: () => setRealImagery(false),
    });
    mapRef.current = map;
    map.loadGeo(landUrl, countriesUrl);
    return () => map.destroy();
  }, []);

  // ── 인터넷 연결이 끊기거나 위성 서버에 못 닿을 때 ──
  // 다시 연결되면 실패했던 사진을 모두 다시 받고, 서버 문제라면 2분마다 조용히 다시 시도합니다
  const retryNetwork = useCallback(() => {
    setRealImagery(true);
    mapRef.current?.retryNetwork();
  }, []);
  useEffect(() => {
    const goOnline = () => {
      setOnline(true);
      retryNetwork();
    };
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, [retryNetwork]);
  useEffect(() => {
    if (realImagery || !online) return undefined;
    const timer = setInterval(retryNetwork, 2 * 60000);
    return () => clearInterval(timer);
  }, [realImagery, online, retryNetwork]);

  // 즐겨찾기가 바뀔 때마다 저장
  useEffect(() => {
    writeSavedPlaces(saved);
  }, [saved]);

  // ── 실제 열대 저기압 받아 오기 (30분마다 새로 고침) ──
  useEffect(() => {
    let alive = true;
    const refresh = () =>
      loadStorms()
        .then((list) => {
          if (!alive) return;
          setStorms(list);
          setStormStatus('ok');
          mapRef.current?.setStorms(list);
          // 열려 있는 태풍 창도 새 정보로 바꿉니다 (없어진 태풍이면 닫기)
          setStorm((open) => (open ? list.find((s) => s.id === open.id) || null : open));
        })
        .catch(() => alive && setStormStatus((old) => (old === 'ok' ? 'ok' : 'error')));
    refresh();
    const timer = setInterval(refresh, 30 * 60000);
    window.addEventListener('online', refresh);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener('online', refresh);
    };
  }, []);

  // ── 주소(URL) 바꾸기 ──
  const openPlace = useCallback((p, fly = true) => {
    setPlace(p);
    setStorm(null);
    setPanel(null);
    setWelcome(false);
    if (fly) mapRef.current?.flyTo({ lon: p.lon, lat: p.lat, zoom: Math.max(PLACE_ZOOM, mapRef.current.zoom) });
    if (currentAppPath() !== p.path) window.history.pushState({}, '', toBrowserPath(p.path));
    document.title = `${p.name} 날씨 | Globe View`;
  }, []);

  const closePlace = useCallback(() => {
    setPlace(null);
    if (currentAppPath() !== '/') window.history.pushState({}, '', BASE);
    document.title = 'Globe View | 실시간 기상 지도, 폭풍 추적기';
  }, []);

  const openStorm = useCallback((s) => {
    setStorm(s);
    setPlace(null);
    setPanel(null);
    setWelcome(false);
    mapRef.current?.flyTo({ lon: s.position.lon, lat: s.position.lat, zoom: Math.max(5, mapRef.current.zoom) });
  }, []);

  // 브라우저의 뒤로/앞으로 버튼
  useEffect(() => {
    const onPop = () => {
      const p = findPlaceByPath(currentAppPath());
      setPlace(p);
      if (p) mapRef.current?.flyTo({ lon: p.lon, lat: p.lat, zoom: PLACE_ZOOM });
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // ── 지도 클릭 (측정 중이면 점 추가) ──
  const onMapClick = useCallback(
    (point) => {
      if (measure) {
        setMeasure((m) => ({ ...m, points: [...m.points, { lat: point.lat, lon: point.lon }] }));
        return;
      }
      if (panel === 'title' || panel === 'overlays') setPanel(null);
    },
    [measure, panel],
  );

  // 지도 클래스가 항상 최신 함수를 부르도록 ref에 담아 둡니다
  const mapClickRef = useRef(onMapClick);
  const openPlaceRef = useRef(openPlace);
  const openStormRef = useRef(openStorm);
  mapClickRef.current = onMapClick;
  openPlaceRef.current = openPlace;
  openStormRef.current = openStorm;

  // ── 지도 설정 반영 ──
  useEffect(() => {
    mapRef.current?.setLayer(layer);
  }, [layer]);
  useEffect(() => {
    mapRef.current?.setOptions(overlays);
  }, [overlays]);
  useEffect(() => {
    mapRef.current?.setMeasure(measure);
  }, [measure]);

  // ── 시간 애니메이션: 재생하면 지난 시간의 구름이 차례로 지나갑니다 ──
  useEffect(() => {
    if (!playing) return undefined;
    // 실제 사진은 1시간(10분 간격 7장), 직접 만든 구름은 3시간을 빠르게 보여 줍니다
    const range = realImagery ? 60 : 180;
    let offset = -range;
    setFrameOffset(offset);
    const timer = setInterval(() => {
      offset += 10;
      if (offset > 0) offset = -range;
      setFrameOffset(offset);
    }, realImagery ? 700 : 280);
    return () => clearInterval(timer);
  }, [playing, realImagery]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (realImagery) {
      // 0이면 '가장 최근 사진', 아니면 그만큼 지난 시각의 사진
      map.setSatelliteTime(frameOffset === 0 ? null : new Date(latest.getTime() + frameOffset * 60000));
    } else {
      map.setSatelliteTime(false);
      // 직접 만든 구름은 10분마다 동쪽으로 조금씩(0.06도) 이동하는 것으로 표현
      map.setCloudShift((frameOffset / 10) * 0.06);
    }
  }, [frameOffset, realImagery, latest]);

  const stepTime = (minutes) => {
    setPlaying(false);
    if (minutes === 0) setFrameOffset(0);
    else setFrameOffset((o) => Math.min(0, Math.max(-7 * 1440, o + minutes)));
  };

  // ── 현재 위치 ──
  const locate = () => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        setWelcome(false);
        setPanel(null);
        const point = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        mapRef.current?.setMarker(point);
        mapRef.current?.flyTo({ ...point, zoom: 8 });
      },
      () => setLocating(false),
      { timeout: 10000 },
    );
  };

  // 오버레이 켜고 끄기 (고온 지점은 처음 켤 때 안내 창을 먼저 보여 줍니다)
  const [heatAsk, setHeatAsk] = useState(false);
  const heatAccepted = useRef(false);
  const toggleOverlay = (key) => {
    if (key === 'heat' && !overlaysRef.current.heat && !heatAccepted.current) {
      setHeatAsk(true);
      return;
    }
    setOverlays((o) => ({ ...o, [key]: !o[key] }));
  };
  const overlaysRef = useRef(overlays);
  overlaysRef.current = overlays;
  const toggleOverlayRef = useRef(toggleOverlay);
  toggleOverlayRef.current = toggleOverlay;

  const togglePanel = (name) => {
    setWelcome(false);
    setPanel((current) => (current === name ? null : name));
  };

  const startMeasure = (mode) => {
    setPanel(null);
    setMeasure((m) => (m && m.mode === mode ? null : { mode, points: [] }));
  };

  const onTitleMenu = (key) => {
    if (key === 'distance' || key === 'area') startMeasure(key);
    else if (key === 'share') {
      navigator.clipboard?.writeText(window.location.href);
      setPanel(null);
    } else setPanel(key);
  };

  // ── 키보드 단축키 (원본처럼 한 글자 키로 오버레이 켜고 끄기) ──
  useEffect(() => {
    const keys = { r: 'radar', o: 'clouds', w: 'wind', h: 'heat', s: 'storms', l: 'labels', k: 'lines', g: 'graticule', x: 'crosshair' };
    const onKey = (event) => {
      if (event.target.closest && event.target.closest('input, textarea')) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (event.key === 'Escape') {
        setPanel(null);
        setWelcome(false);
        setMeasure(null);
      } else if (event.key === '/') {
        event.preventDefault();
        togglePanel('search');
      } else if (keys[key]) {
        toggleOverlayRef.current(keys[key]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ── 측정 값 ──
  let measureValue = 0;
  if (measure) {
    if (measure.mode === 'area') measureValue = areaKm2(measure.points);
    else for (let i = 1; i < measure.points.length; i++) measureValue += distanceKm(measure.points[i - 1], measure.points[i]);
  }

  // ── <main>에 붙이는 상태 이름: CSS가 이것을 보고 무엇을 보여 줄지 정합니다 ──
  const category = categoryOf(layer);
  const sidePanel = panel === 'search' || panel === 'settings' || panel === 'about';
  const classes = [
    `layer-${category.id}`,
    settings.appearance === 'translucent' ? 'ui-blur ui-blur-dark' : 'ui-opaque',
    'ui-clock',
    welcome && 'ui-dialog-welcome',
    panel && `ui-${panel}`,
    sidePanel && 'ui-side',
    layersOpen && 'ui-layers',
    place && 'ui-weather',
    storm && 'ui-storm',
    measure && 'ui-measure',
    playing && 'ui-playing',
  ]
    .filter(Boolean)
    .join(' ');

  const imageTime = new Date(latest.getTime() + frameOffset * 60000);

  return (
    <main className={classes}>
      <section id="map" ref={mapBox} tabIndex={0} aria-label="지도" />

      <TitleButton onClick={() => togglePanel('title')} />
      <TitleMenu onSelect={onTitleMenu} />

      <LayersDropdown layer={layer} onClick={() => setLayersOpen((o) => !o)} />
      <button type="button" className="round layers-fab" aria-label="실시간 지도, 예보 지도" onClick={() => setLayersOpen((o) => !o)}>
        <span className="icon"><Icon name={layersOpen ? 'close' : 'layers'} /></span>
      </button>
      <LayersPanel layer={layer} onSelect={setLayer} onCollapse={() => setLayersOpen(false)} />

      <TopRightButtons
        panel={panel}
        measure={measure?.mode}
        onToggle={togglePanel}
        onMeasure={startMeasure}
        onLocate={locate}
        locating={locating}
      />
      <OverlayButtons
        overlays={overlays}
        panel={panel}
        onToggleOverlay={toggleOverlay}
        onToggleMore={() => togglePanel('overlays')}
      />
      {panel === 'overlays' && (
        <OverlaysPanel overlays={overlays} onToggle={toggleOverlay} />
      )}
      <Legend category={category.id} />
      <ZoomButtons onZoom={(d) => mapRef.current?.zoomBy(d)} />

      <ClockPanel
        time={imageTime}
        settings={settings}
        playing={playing}
        isLatest={frameOffset === 0}
        onPlay={() => setPlaying((p) => !p)}
        onStep={stepTime}
      />

      <NetworkNotice online={online} realImagery={realImagery} onRetry={retryNetwork} />

      <Footer
        view={view}
        metersPerPixel={metersPerPixel}
        decimal={decimal}
        miles={miles || settings.units === 'imperial'}
        realImagery={realImagery}
        onToggleDecimal={() => setDecimal((d) => !d)}
        onToggleMiles={() => setMiles((m) => !m)}
      />

      {place && (
        <WeatherPanel
          place={place}
          units={settings.units}
          onClose={closePlace}
          saved={saved.includes(place.path)}
          onToggleSave={() =>
            setSaved((list) => (list.includes(place.path) ? list.filter((p) => p !== place.path) : [...list, place.path]))
          }
        />
      )}
      {storm && <StormPanel storm={storm} onClose={() => setStorm(null)} />}

      {measure && (
        <MeasurePanel
          mode={measure.mode}
          value={measureValue}
          count={measure.points.length}
          onCancel={() => setMeasure(null)}
          onUndo={() => setMeasure((m) => ({ ...m, points: m.points.slice(0, -1) }))}
          onDone={() => setMeasure(null)}
        />
      )}

      {panel === 'search' && (
        <SearchPanel
          onClose={() => setPanel(null)}
          onPick={(p) => openPlace(p)}
          onPickStorm={openStorm}
          storms={storms}
          stormStatus={stormStatus}
          savedPlaces={saved.map(findPlaceByPath).filter(Boolean)}
          onLocate={locate}
          locating={locating}
        />
      )}
      {panel === 'settings' && (
        <SettingsPanel settings={settings} onChange={(s) => setSettings((old) => ({ ...old, ...s }))} onClose={() => setPanel(null)} />
      )}
      {panel === 'about' && <AboutPanel onClose={() => setPanel(null)} />}

      <HeatConsent
        open={heatAsk}
        onAccept={() => {
          heatAccepted.current = true;
          setHeatAsk(false);
          setOverlays((o) => ({ ...o, heat: true }));
        }}
        onCancel={() => setHeatAsk(false)}
      />

      {welcome && !panel && (
        <WelcomeDialog
          onClose={() => setWelcome(false)}
          onLocate={locate}
          onSearch={() => {
            setWelcome(false);
            setPanel('search');
          }}
          locating={locating}
        />
      )}
    </main>
  );
}

// 다른 파일에서 도시 목록이 필요할 때를 위해 내보냅니다
export { cities };
