// 앱의 시작점: 글꼴과 스타일을 불러오고 App을 화면에 붙입니다
import { createRoot } from 'react-dom/client';
import '@fontsource/nunito-sans/500.css';
import '@fontsource/nunito-sans/700.css';
import '@fontsource/nunito-sans/900.css';
import './styles.css';
import App from './App.jsx';

// 터치 기기인지 표시 (마우스 전용 효과를 끄기 위해)
if (window.matchMedia('(hover: none)').matches) {
  document.body.classList.replace('no-touch', 'touch');
}

createRoot(document.getElementById('root')).render(<App />);
