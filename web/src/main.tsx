import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';
import { preferredLang, setLang } from './i18n';

// The language first, so everything renders in it from the start. One that can't be loaded (offline, a file gone
// after a deploy) leaves the app in English, not blank.
await setLang(preferredLang()).catch(() => setLang('en'));
createRoot(document.getElementById('app')!).render(<App />);
