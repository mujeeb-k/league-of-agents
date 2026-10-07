import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';
import { preferredLang, setLang } from './i18n';

// The language first, so everything renders in it from the start.
await setLang(preferredLang());
createRoot(document.getElementById('app')!).render(<App />);
