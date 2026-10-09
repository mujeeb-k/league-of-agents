import { useLayoutEffect } from 'react';
import { CommitDialog } from './components/CommitDialog';
import { MapPicker } from './components/MapPicker';
import { ConflictDialog } from './components/ConflictDialog';
import { ExportDialog } from './components/ExportDialog';
import { ConnectDialog } from './components/ConnectDialog';
import { IconSprite } from './components/FileIcon';
import { Inspector } from './components/Inspector';
import { Palette } from './components/Palette';
import { InspectorHandle } from './components/InspectorHandle';
import { Sidebar } from './components/Sidebar';
import { Stage } from './components/Stage';
import { TopBar } from './components/TopBar';
import { Toasts } from './components/Toasts';
import { TooltipProvider } from './components/ui/tooltip';
import { boot } from './state/boot';

/** Children of #app, the four-region grid. Toasts and the dialog portal into <body>. */
export function App() {
  useLayoutEffect(() => {
    boot();
  }, []);
  return (
    <TooltipProvider delayDuration={400}>
      <TopBar />
      <Sidebar />
      <Stage />
      <Inspector />
      <InspectorHandle />
      <IconSprite />
      <ConnectDialog />
      <ConflictDialog />
      <CommitDialog />
      <MapPicker />
      <ExportDialog />
      <Palette />
      <Toasts />
    </TooltipProvider>
  );
}
