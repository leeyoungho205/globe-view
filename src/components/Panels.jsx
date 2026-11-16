// 지도 위에 열리는 창(패널)들
import { useEffect, useRef, useState } from 'react';
import { Icon, LogoMark, WeatherIcon } from './Icons.jsx';
import { searchPlaces } from '../data/places.js';
import { STAGES } from '../data/storms.js';
import { loadForecast, offsetLabel } from '../data/weather.js';
import { clockParts, formatNumber } from '../utils/format.js';

// 패널 오른쪽 위의 닫기(X) 버튼
function CloseButton({ onClick }) {
  return (
    <button type="button" className="close" aria-label="닫기" onClick={onClick}>
      <span><Icon name="close" size={16} /></span>
    </button>
  );
}

// ── 환영 창 ───────────────────────────────────────────
export function WelcomeDialog({ onClose, onLocate, onSearch, locating }) {
  return (
    <aside className="panel dialog welcome">
      <CloseButton onClick={onClose} />
      <div className="title-logo">
        <span className="logo-wrap"><LogoMark size={76} /></span>
        <div className="title-logo-text">
          <strong>GLOBE</strong>
          <span>VIEW</span>
        </div>
      </div>
      <p>환영합니다! 먼저 지도에서 현재 위치를 찾아보세요.</p>
      <button type="button" className="dialog accent" onClick={onLocate}>
        <span className="btn-icon"><Icon name="locate" size={20} /></span>
        <span className="text">{locating ? '찾는 중…' : '현재 위치 표시'}</span>
      </button>
      <button type="button" className="dialog" onClick={onSearch}>
        <span className="btn-icon"><Icon name="search" size={22} /></span>
        <span className="text">검색…</span>
      </button>
    </aside>
  );
}

// ── 지도 종류 고르기 (위성, 레이더, 예보 지도) ─────────
const LIVE = [
  { id: 'satellite', label: '위성', icon: 'satellite', sub: [['satellite', '실시간'], ['satellite-hd', '고화질']] },
  { id: 'radar', label: '레이더', icon: 'radar' },
];
const FORECAST = [
  { id: 'precipitation', label: '강수량', icon: 'precipitation' },
  { id: 'wind', label: '바람', icon: 'wind', sub: [['wind-speed', '풍속'], ['wind-gusts', '돌풍']] },
  { id: 'temperature', label: '기온', icon: 'temperature', sub: [['temperature', '실제'], ['temperature-feel', '체감']] },
  { id: 'humidity', label: '습도', icon: 'humidity', sub: [['humidity', '상대 습도'], ['dew-point', '이슬점'], ['temperature-wet-bulb', '습구']] },
  { id: 'pressure', label: '기압', icon: 'pressure' },
];

export const categoryOf = (layer) =>
  [...LIVE, ...FORECAST].find((c) => c.id === layer || (c.sub && c.sub.some(([id]) => id === layer))) || LIVE[0];

export function LayersPanel({ layer, onSelect, onCollapse }) {
  const current = categoryOf(layer);
  const renderGroup = (list) =>
    list.map((category) => {
      const selected = category.id === current.id;
      return (
        <div key={category.id} className="category-wrap">
          <button
            type="button"
            className={`menu-item category${selected ? ' selected' : ''}`}
            onClick={() => onSelect(category.sub ? (selected ? layer : category.sub[0][0]) : category.id)}
          >
            <span className="menu-icon"><Icon name={category.icon} /></span>
            <span className="text">{category.label}</span>
          </button>
          {category.sub && (
            // 고르지 않은 종류의 세부 항목은 접어 둡니다 (높이 0)
            <section className={`sub-items ${category.id}${selected ? ' open' : ''}`} aria-hidden={!selected}>
              {category.sub.map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  tabIndex={selected ? 0 : -1}
                  className={`menu-item layer${id === layer ? ' selected' : ''}`}
                  onClick={() => onSelect(id)}
                >
                  <span className="menu-icon">{id === layer && <Icon name="check" size={20} />}</span>
                  <span className="text">{label}</span>
                </button>
              ))}
            </section>
          )}
        </div>
      );
    });
  return (
    <nav className="panel layers" aria-label="실시간 지도, 예보 지도">
      <div className="live">
        <h4>
          실시간 지도
          <button type="button" className="collapse" aria-label="접기" onClick={onCollapse}>
            <Icon name="chevronUp" size={16} />
          </button>
        </h4>
        {renderGroup(LIVE)}
      </div>
      <div className="forecast">
        <h4>예보 지도</h4>
        {renderGroup(FORECAST)}
      </div>
    </nav>
  );
}

// 중간 폭 화면에서 쓰는 "위성 ▾" 버튼
export function LayersDropdown({ layer, onClick }) {
  const category = categoryOf(layer);
  return (
    <button type="button" className="layers-dropdown" aria-label="실시간 지도, 예보 지도" onClick={onClick}>
      <span className="menu-icon"><Icon name={category.icon} /></span>
      <span className="text">{category.label}</span>
      <span className="arrow"><Icon name="chevronDown" size={14} /></span>
    </button>
  );
}

// ── 시계 (위성 사진 시각) ──────────────────────────────
export function ClockPanel({ time, settings, playing, onPlay, onStep, isLatest }) {
  const parts = clockParts(time, { utc: settings.timeZone === 'utc', hour12: settings.timeFormat === 'hour12' });
  const Arrow = ({ dir, unit }) => (
    <button
      type="button"
      className={dir}
      aria-label={dir === 'up' ? '다음' : '이전'}
      disabled={dir === 'up' && isLatest}
      onClick={() => onStep(unit * (dir === 'up' ? 1 : -1))}
    >
      <span><Icon name={dir === 'up' ? 'chevronUp' : 'chevronDown'} size={14} /></span>
    </button>
  );
  return (
    <div className={`panel clock${settings.timeFormat === 'hour12' ? ' hour12' : ''}`}>
      <button type="button" className="play" aria-label={playing ? '애니메이션 일시 중지' : '애니메이션 재생'} onClick={onPlay}>
        <span><Icon name={playing ? 'pause' : 'play'} size={22} /></span>
      </button>
      <div className="date">
        <Arrow dir="up" unit={1440} />
        <div className="text">{parts.month} <b>{parts.day}</b></div>
        <Arrow dir="down" unit={1440} />
      </div>
      <div className="hour">
        <Arrow dir="up" unit={60} />
        <div className="text">{parts.hour}</div>
        <Arrow dir="down" unit={60} />
      </div>
      <div className={`text colon${isLatest && !playing ? ' blink' : ''}`}>:</div>
      <div className="minute">
        <Arrow dir="up" unit={10} />
        <div className="text">{parts.minute}</div>
        <Arrow dir="down" unit={10} />
      </div>
      {parts.ampm && <div className="text ampm">{parts.ampm}</div>}
      <button type="button" className="recent" aria-label="최근 시간" disabled={isLatest} onClick={() => onStep(0)}>
        <span><Icon name="recent" size={18} /></span>
      </button>
    </div>
  );
}

// ── 검색 ───────────────────────────────────────────────
export function SearchPanel({ onClose, onPick, onPickStorm, onLocate, locating, storms = [], stormStatus, savedPlaces = [] }) {
  const [query, setQuery] = useState('');
  const inputRef = useRef(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  const results = searchPlaces(query);
  const q = query.trim().toLowerCase();
  const activeStorms = storms.filter((s) => !q || s.name.toLowerCase().includes(q));
  return (
    <aside className="panel side search">
      <header>
        <h3>검색</h3>
        <CloseButton onClick={onClose} />
      </header>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (results[0]) onPick(results[0]);
        }}
      >
        <span className="input-icon"><Icon name="search" size={18} /></span>
        <input
          ref={inputRef}
          name="q"
          type="search"
          placeholder="장소나 폭풍 찾기…"
          aria-label="검색"
          maxLength={255}
          autoComplete="off"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </form>
      <button type="button" className="dialog geolocation-search" onClick={onLocate}>
        <span className="btn-icon"><Icon name="locate" size={18} /></span>
        <span className="text">{locating ? '찾는 중…' : '현재 위치 표시'}</span>
      </button>
      <div className="results">
        {!query && savedPlaces.length > 0 && (
          <>
            <h4>저장한 장소</h4>
            <ul>
              {savedPlaces.map((place) => (
                <li key={place.path}>
                  <button type="button" onClick={() => onPick(place)}>
                    <span className="saved-star"><Icon name="star" size={16} /></span>
                    <span className="result-name">{place.name}</span>
                    <span className="result-sub">{place.en}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        {query && results.length === 0 && <p className="empty">일치하는 장소가 없습니다</p>}
        {results.length > 0 && (
          <>
            <h4>장소</h4>
            <ul>
              {results.map((place) => (
                <li key={place.path}>
                  <button type="button" onClick={() => onPick(place)}>
                    <span className="result-name">{place.name}</span>
                    <span className="result-sub">{place.en}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        {!query && activeStorms.length === 0 && (
          <>
            <h4>열대 시스템</h4>
            <p className="empty">
              {stormStatus === 'loading' && '진행 중인 열대 저기압을 확인하는 중…'}
              {stormStatus === 'ok' && '지금 진행 중인 열대 저기압이 없습니다'}
              {stormStatus === 'error' && '열대 저기압 정보를 받지 못했습니다'}
            </p>
          </>
        )}
        {activeStorms.length > 0 && (
          <>
            <h4>열대 시스템</h4>
            <ul>
              {activeStorms.map((storm) => (
                <li key={storm.id}>
                  <button type="button" onClick={() => onPickStorm(storm)}>
                    <span className={`mini-storm rank${Math.max(0, storm.rank)}`} />
                    <span className="result-name">{storm.name}</span>
                    <span className="result-sub">{storm.wind}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </aside>
  );
}

// ── 설정 ───────────────────────────────────────────────
function Segmented({ name, value, options, onChange }) {
  return (
    <div className="segmented" role="radiogroup">
      {options.map(([id, label]) => (
        <label key={id} className={value === id ? 'checked' : ''}>
          <input type="radio" name={name} value={id} checked={value === id} onChange={() => onChange(id)} />
          {label}
        </label>
      ))}
    </div>
  );
}

export function SettingsPanel({ settings, onChange, onClose }) {
  const row = (key, label, options) => (
    <div className="bar2">
      <p>{label}</p>
      <Segmented name={key} value={settings[key]} options={options} onChange={(v) => onChange({ [key]: v })} />
    </div>
  );
  return (
    <aside className="panel side settings">
      <header>
        <span className="header-icon"><Icon name="settings" size={22} /></span>
        <h3>설정</h3>
        <CloseButton onClick={onClose} />
      </header>
      <div className="scroll">
        <h4>시각</h4>
        <section className="bubble">
          {row('timeZone', '시간대', [['local', '현지'], ['utc', 'UTC']])}
          {row('timeFormat', '시간 형식', [['hour12', '12시간'], ['hour24', '24시간']])}
          {row('summary', '예측 요약', [['daily', '일별'], ['hourly', '시간별']])}
        </section>
        <h4>화면</h4>
        <section className="bubble">
          {row('appearance', '외관', [['translucent', '반투명'], ['opaque', '불투명']])}
          {row('units', '단위', [['metric', '°C · km'], ['imperial', '°F · mi']])}
          {row('tooltips', '도움말', [['enabled', '켜짐'], ['disabled', '꺼짐']])}
        </section>
      </div>
    </aside>
  );
}

// ── 정보 ───────────────────────────────────────────────
export function AboutPanel({ onClose }) {
  return (
    <aside className="panel side about">
      <header>
        <span className="header-icon"><Icon name="about" size={22} /></span>
        <h3>정보</h3>
        <CloseButton onClick={onClose} />
      </header>
      <div className="scroll">
        <div className="about-logo">
          <LogoMark size={56} />
          <div className="title-logo-text small">
            <strong>GLOBE</strong>
            <span>VIEW</span>
          </div>
        </div>
        <p>지구 전체의 구름, 비, 바람, 기온을 한눈에 볼 수 있는 인터랙티브 날씨 지도입니다.</p>
        <p>지도를 끌어서 움직이고, 마우스 휠이나 두 손가락으로 확대해 보세요. 도시 이름을 누르면 5일 예보가 열립니다.</p>
        <p className="note">
          자료 출처: 위성 구름 NASA GIBS (Himawari·GOES·VIIRS), 바닥 지구 사진 NASA Blue Marble,
          레이더 RainViewer, 예보·기온·바람 Open-Meteo, 열대 저기압 GDACS, 고온 지점 NASA VIIRS.
          인터넷에 연결할 수 없을 때만 직접 만든 예시 구름을 보여 줍니다.
        </p>
      </div>
    </aside>
  );
}

// ── 지도 오버레이 목록 ────────────────────────────────
const OVERLAY_ITEMS = [
  ['radar', '레이더', 'radar', 'R'],
  ['clouds', '구름', 'precipitation', 'O'],
  ['wind', '바람 애니메이션', 'wind', 'W'],
  ['heat', '고온 지점', 'heat', 'H'],
  ['storms', '열대 시스템', 'pressure', 'S'],
  ['labels', '지도 라벨', 'search', 'L'],
  ['lines', '경계선', 'distance', 'K'],
  ['graticule', '위도/경도 격자', 'area', 'G'],
  ['crosshair', '십자선', 'plus', 'X'],
];

export function OverlaysPanel({ overlays, onToggle }) {
  return (
    <nav className="panel overlays-panel" aria-label="지도 오버레이">
      <h4>지도 오버레이</h4>
      {OVERLAY_ITEMS.map(([key, label, icon, hotkey]) => (
        <label key={key} className={`menu-item check${overlays[key] ? ' on' : ''}`}>
          <input type="checkbox" checked={!!overlays[key]} onChange={() => onToggle(key)} />
          <span className="menu-icon"><Icon name={icon} /></span>
          <span className="text">{label}</span>
          <kbd className="hotkey">{hotkey}</kbd>
        </label>
      ))}
    </nav>
  );
}

// ── 로고를 눌렀을 때 나오는 메뉴 ───────────────────────
export function TitleMenu({ onSelect }) {
  const items = [
    ['settings', '설정', 'settings'],
    ['about', '정보', 'about'],
    ['share', '공유', 'share'],
    ['distance', '거리 측정', 'distance'],
    ['area', '지역 측정', 'area'],
  ];
  return (
    <nav className="panel title-menu">
      <h1>Globe View</h1>
      {items.map(([key, label, icon]) => (
        <button key={key} type="button" className="menu-item" onClick={() => onSelect(key)}>
          <span className="menu-icon"><Icon name={icon} size={20} /></span>
          <span className="text">{label}</span>
        </button>
      ))}
    </nav>
  );
}

// ── 도시 날씨 ──────────────────────────────────────────
export function WeatherPanel({ place, units, onClose, saved, onToggleSave }) {
  // 실제 예보 받아 오기 (도시가 바뀌면 다시)
  const [state, setState] = useState({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    setState({ status: 'loading' });
    loadForecast(place)
      .then((value) => alive && setState({ status: 'ok', ...value }))
      .catch(() => alive && setState({ status: 'error' }));
    return () => {
      alive = false;
    };
  }, [place, attempt]);
  const days = state.days || [];
  const toUnit = (c) => (units === 'imperial' ? Math.round((c * 9) / 5 + 32) : c);
  const lo = Math.min(...days.map((d) => d.min));
  const hi = Math.max(...days.map((d) => d.max));
  const fmt = (v) => `${toUnit(v) < 0 ? '−' : ''}${Math.abs(toUnit(v))}°`;
  return (
    <aside className="panel weather">
      <header>
        <button type="button" className={`save${saved ? ' saved' : ''}`} aria-label="즐겨찾기" onClick={onToggleSave}>
          <Icon name="star" size={22} />
        </button>
        <h2>{place.name}</h2>
        <CloseButton onClick={onClose} />
      </header>
      <table>
        <thead>
          <tr>
            <th className="day">날</th>
            <th />
            <th className="num">최저</th>
            <th className="bar-head">기온</th>
            <th className="num">최고</th>
          </tr>
          <tr className="sub">
            <th className="day">{state.status === 'ok' ? offsetLabel(state.offset) : ''}</th>
            <th />
            <th />
            <th />
            <th className="num">{units === 'imperial' ? '°F' : '°C'}</th>
          </tr>
        </thead>
        <tbody>
          {days.map((day) => {
            const left = ((day.min - lo) / Math.max(1, hi - lo)) * 100;
            const width = ((day.max - day.min) / Math.max(1, hi - lo)) * 100;
            return (
              <tr key={day.label}>
                <td className="day">{day.label}</td>
                <td className="cond"><WeatherIcon kind={day.kind} /></td>
                <td className="num min">{fmt(day.min)}</td>
                <td className="bar">
                  <div className="track"><div className="range" style={{ left: `${left}%`, width: `${width}%` }} /></div>
                </td>
                <td className="num max">{fmt(day.max)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {state.status === 'loading' && <p className="note">예보를 받아 오는 중…</p>}
      {state.status === 'error' && (
        <p className="note">
          예보를 받지 못했습니다. 인터넷 연결을 확인해 주세요.{' '}
          <button type="button" className="link" onClick={() => setAttempt((n) => n + 1)}>다시 시도</button>
        </p>
      )}
      {state.status === 'ok' && <p className="note source">예보: Open-Meteo</p>}
    </aside>
  );
}

// ── 태풍 정보 ──────────────────────────────────────────
export function StormPanel({ storm, onClose }) {
  const updated = storm.updated && !Number.isNaN(storm.updated.getTime())
    ? storm.updated.toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : '—';
  return (
    <aside className="panel weather storm">
      <header>
        <span className={`mini-storm rank${Math.max(0, storm.rank)}`} />
        <h2>{storm.name}</h2>
        <CloseButton onClick={onClose} />
      </header>
      <dl>
        <dt>지금 등급</dt>
        <dd>{storm.category}</dd>
        <dt>가장 강했을 때 풍속</dt>
        <dd>{storm.wind}</dd>
        <dt>마지막 관측</dt>
        <dd>{updated}</dd>
      </dl>
      <div className="track-legend">
        {Object.entries(STAGES).map(([key, stage]) => (
          <span key={key}><i style={{ backgroundColor: stage.color }} />{stage.label}</span>
        ))}
      </div>
      <p className="note">
        출처: GDACS (JTWC·NOAA 등의 공식 예보). 실선은 지나온 길, 점선은 예상 진로, 회색 영역은 예상 진로의 범위입니다.
        {storm.report && (
          <>
            {' '}
            <a href={storm.report} target="_blank" rel="noreferrer">자세한 보고서</a>
          </>
        )}
      </p>
    </aside>
  );
}

// ── 고온 지점(화재) 안내 ───────────────────────────────
// 원본처럼 처음 켤 때 한 번 설명을 보여 주고 동의하면 켭니다
export function HeatConsent({ open, onAccept, onCancel }) {
  return (
    <aside className="panel heat-consent" style={{ display: open ? 'block' : 'none' }}>
      <h3>고온 지점</h3>
      <p>위성이 감지한 뜨거운 지점을 보여 줍니다. 산불, 공장, 화산일 수 있으며 실제 화재가 아닐 수도 있어요.</p>
      <button type="button" className="dialog" onClick={onAccept}>
        <span className="text">고온 지점 보기</span>
      </button>
      <button type="button" className="dialog later" onClick={onCancel}>
        <span className="text">취소</span>
      </button>
    </aside>
  );
}

// ── 거리/넓이 측정 ─────────────────────────────────────
export function MeasurePanel({ mode, value, count, onCancel, onUndo, onDone }) {
  return (
    <div className="panel measure">
      <h4>{mode === 'area' ? '지역 측정' : '거리 측정'}</h4>
      <p>
        {count === 0
          ? '포인트를 추가하려면 지도를 클릭하세요.'
          : mode === 'area'
            ? `${formatNumber(value)} km²`
            : `${value < 10 ? value.toFixed(2) : formatNumber(value)} km`}
      </p>
      <div className="actions">
        <button type="button" className="dialog" onClick={onCancel}><span className="text">취소</span></button>
        <button type="button" className="dialog" onClick={onUndo} disabled={!count}><span className="text">실행 취소</span></button>
        <button type="button" className="dialog accent" onClick={onDone}><span className="text">완료</span></button>
      </div>
    </div>
  );
}

// ── 예보 지도 색 막대 (기온, 바람 등) ─────────────────
const LEGENDS = {
  temperature: ['linear-gradient(90deg, #7828a0, #3c46c8, #3ca0e6, #46c8aa, #8cd250, #f0d23c, #f58228, #c82832)', ['−40°', '0°', '20°', '40°C']],
  wind: ['linear-gradient(90deg, #283c8c, #2882be, #3cbe96, #c8d246, #f07828, #c82878)', ['0', '20', '50', '80 km/h']],
  humidity: ['linear-gradient(90deg, #966432, #beaa5a, #6ebe78, #3c96c8, #2846b4)', ['0%', '50%', '100%']],
  pressure: ['linear-gradient(90deg, #8c28a0, #3c64d2, #46b4c8, #8cc86e, #e6be50, #dc643c)', ['980', '1010', '1035 hPa']],
  precipitation: ['linear-gradient(90deg, #3c8ce6, #28c878, #f0dc3c, #f57828, #dc2850)', ['약함', '보통', '강함']],
};

export function Legend({ category }) {
  const legend = LEGENDS[category];
  if (!legend) return <div className="legend none" />;
  return (
    <div className="legend" style={{ backgroundImage: legend[0] }}>
      {legend[1].map((label) => (
        <span key={label}>{label}</span>
      ))}
    </div>
  );
}
