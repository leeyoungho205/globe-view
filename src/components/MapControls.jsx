// 지도 위에 떠 있는 버튼들 (오른쪽 버튼, 확대/축소, 왼쪽 위 로고 버튼, 아래쪽 정보)
import { Icon, LogoMark } from './Icons.jsx';
import { formatLat, formatLon, scaleBar } from '../utils/format.js';

// 둥근 버튼 하나
export function RoundButton({ className, label, icon, onClick, active = false, state }) {
  return (
    <button
      type="button"
      className={`round ${className}${active ? ' active' : ''}`}
      aria-label={label}
      title={label}
      data-state={state}
      onClick={onClick}
    >
      <span className="icon">
        <Icon name={active ? 'close' : icon} />
      </span>
    </button>
  );
}

// 오른쪽 위: 검색, 설정, 정보, 측정, 현재 위치
export function TopRightButtons({ panel, measure, onToggle, onMeasure, onLocate, locating }) {
  return (
    <>
      <RoundButton className="search" label="검색" icon="search" active={panel === 'search'} onClick={() => onToggle('search')} />
      <RoundButton className="settings" label="설정" icon="settings" active={panel === 'settings'} onClick={() => onToggle('settings')} />
      <RoundButton className="about" label="정보" icon="about" active={panel === 'about'} onClick={() => onToggle('about')} />
      <div className="group measure">
        <RoundButton className="distance" label="거리 측정" icon="distance" active={measure === 'distance'} onClick={() => onMeasure('distance')} />
        <RoundButton className="area" label="지역 측정" icon="area" active={measure === 'area'} onClick={() => onMeasure('area')} />
      </div>
      <button type="button" className={`round geolocation${locating ? ' locating' : ''}`} aria-label="현재 위치 표시" title="현재 위치 표시" onClick={onLocate}>
        <span className="icon"><Icon name="locate" size={22} /></span>
      </button>
    </>
  );
}

// 오른쪽 아래: 레이더 / 바람 애니메이션 / 고온 지점 / 더 보기
export function OverlayButtons({ overlays, panel, onToggleOverlay, onToggleMore }) {
  const items = [
    ['radar', '레이더로 감지된 비와 눈', 'radar'],
    ['wind', '바람 애니메이션', 'wind'],
    ['heat', '화재 및 고온 지점', 'heat'],
  ];
  const moreOpen = panel === 'overlays';
  return (
    <div className={`group overlays${moreOpen ? ' open' : ''}`}>
      {!moreOpen &&
        items.map(([key, label, icon]) => (
          <button
            key={key}
            type="button"
            className={key}
            aria-label={label}
            title={label}
            data-state={overlays[key] ? 'on' : 'off'}
            onClick={() => onToggleOverlay(key)}
          >
            <span className="icon"><Icon name={icon} /></span>
          </button>
        ))}
      <button type="button" className="more" aria-label="더 많은 오버레이…" title="더 많은 오버레이…" onClick={onToggleMore}>
        <span className="icon"><Icon name={moreOpen ? 'close' : 'more'} /></span>
      </button>
    </div>
  );
}

export function ZoomButtons({ onZoom }) {
  return (
    <div className="group zoom">
      <button type="button" className="in" aria-label="확대" title="확대" onClick={() => onZoom(1)}>
        <span className="icon"><Icon name="plus" /></span>
      </button>
      <button type="button" className="out" aria-label="축소" title="축소" onClick={() => onZoom(-1)}>
        <span className="icon"><Icon name="minus" /></span>
      </button>
    </div>
  );
}

// 왼쪽 위 로고 버튼 (누르면 메뉴가 열립니다)
export function TitleButton({ onClick }) {
  return (
    <button type="button" className="title" aria-label="Globe View 메뉴" onClick={onClick}>
      <span className="title-icon"><LogoMark size={38} /></span>
      <span className="title-text">
        <strong>GLOBE</strong>
        <span>VIEW</span>
      </span>
    </button>
  );
}

// 아래쪽: 좌표, 축척, 출처
export function Footer({ view, metersPerPixel, decimal, miles, realImagery, onToggleDecimal, onToggleMiles }) {
  const scale = scaleBar(metersPerPixel, miles);
  return (
    <>
      <div className="footer-coordinate" onClick={onToggleDecimal} role="button" tabIndex={-1}>
        <div className="lat">{formatLat(view.lat, decimal)}</div>{' '}
        <div className="lon">{formatLon(view.lon, decimal)}</div>
      </div>
      <div className="scale-line" onClick={onToggleMiles} role="button" tabIndex={-1}>
        <div style={{ width: `${scale.width}px` }}>{scale.label}</div>
      </div>
      <footer className="attribution">
        {/* 실제 자료를 쓸 때는 출처를 꼭 밝힙니다 */}
        {realImagery
          ? '© Globe View, NASA GIBS (Himawari·GOES·VIIRS), RainViewer, Open-Meteo, GDACS'
          : '© Globe View, 합성 위성 이미지 (예시)'}
      </footer>
    </>
  );
}

// 인터넷이 끊겼거나 위성 서버에 연결하지 못했을 때 위쪽에 뜨는 안내
export function NetworkNotice({ online, realImagery, onRetry }) {
  if (online && realImagery) return null;
  return (
    <div className="network-notice" role="status">
      {!online ? (
        <span>인터넷 연결이 끊겼어요. 연결되면 실제 자료를 자동으로 다시 불러와요.</span>
      ) : (
        <>
          <span>위성 사진 서버에 연결하지 못해 예시 구름을 보여 주고 있어요.</span>
          <button type="button" onClick={onRetry}>다시 시도</button>
        </>
      )}
    </div>
  );
}
