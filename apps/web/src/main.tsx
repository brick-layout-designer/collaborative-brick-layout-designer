import { lazy, StrictMode, Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { App } from './App';
import { LoginPage } from './auth/LoginPage';
import { ProfilePage } from './auth/ProfilePage';
import { LinkPage } from './auth/LinkPage';
import { InvitePage } from './auth/InvitePage';
import { VerifyEmailPage } from './auth/VerifyEmailPage';
import { DevicePage } from './auth/DevicePage';
import { OrgsPage } from './orgs/OrgsPage';
import { OrgDetailPage } from './orgs/OrgDetailPage';
import { OrgInvitePage } from './orgs/OrgInvitePage';
import { TransferPage } from './layouts/TransferPage';
import { AboutPage } from './AboutPage';
import { SettingsPage } from './settings/SettingsPage';
import { PrefsProvider } from './theme/PrefsProvider';
import { api } from './api';
import { layoutsFromFiles, type DroppedLayout } from './bbmFiles';
import { takeLayoutParts, type PartChoice, type PartDifference } from './layoutParts';
import { PartDifferencesDialog } from './layouts/PartDifferencesDialog';
import { catalogMapConverter, MAP_FORMAT_FILE, type OpenedMapState } from './mapFormats';
import './styles.css';

// Heavy routes are code-split so the landing / auth pages don't download
// the editor (Konva, Yjs, parts rendering) or the admin console.
const EditorPage = lazy(() => import('./editor/EditorPage').then((m) => ({ default: m.EditorPage })));
const AdminPage = lazy(() => import('./admin/AdminPage').then((m) => ({ default: m.AdminPage })));
const LibraryPage = lazy(() => import('./library/LibraryPage').then((m) => ({ default: m.LibraryPage })));
const OrgAdminPage = lazy(() => import('./orgs/OrgAdminPage').then((m) => ({ default: m.OrgAdminPage })));
const NewVenuePage = lazy(() => import('./venues/designer/VenueDesignerPage').then((m) => ({ default: m.NewVenuePage })));
const VenueDesignPage = lazy(() => import('./venues/designer/VenueDesignerPage').then((m) => ({ default: m.VenueDesignPage })));
const PublicLayoutPage = lazy(() => import('./layouts/PublicLayoutPage').then((m) => ({ default: m.PublicLayoutPage })));

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

/**
 * Window-level layout drop — opens any .bbm dropped onto any page, with the
 * `.bbm.bld` sidecar dropped alongside it (or both inside a .zip, as the
 * editor's Download .bbm writes them), like desktop's open
 * (MainWindowFileIO.cpp:84-94). LDraw, TrackDesigner and 4DBrix maps are
 * converted first; what the conversion skipped shows in the editor's
 * status bar, as on desktop.
 */
function GlobalBbmDrop() {
  const navigate = useNavigate();
  // Parts the dropped layout defines differently from the server, waiting on the user.
  const [asking, setAsking] = useState<{ differing: PartDifference[]; answer: (c: PartChoice[] | null) => void } | null>(null);
  useEffect(() => {
    const ask = (differing: PartDifference[]) =>
      new Promise<PartChoice[] | null>((answer) => setAsking({ differing, answer }));
    function onDragOver(e: DragEvent) {
      const hasFile = Array.from(e.dataTransfer?.items ?? []).some((i) => i.kind === 'file');
      if (!hasFile) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    }
    async function onDrop(e: DragEvent) {
      const files = Array.from(e.dataTransfer?.files ?? []).filter(
        (f) => /\.(bld-layout|bbm|bbm\.bld|bbm\.cld|zip)$/i.test(f.name) || MAP_FORMAT_FILE.test(f.name),
      );
      if (!files.some((f) => /\.(bld-layout|bbm|zip)$/i.test(f.name) || MAP_FORMAT_FILE.test(f.name))) return;
      e.preventDefault();
      let layouts: DroppedLayout[] = [];
      try {
        const convert = catalogMapConverter(
          async () => (await queryClient.fetchQuery({ queryKey: ['parts-catalog'], queryFn: api.parts.catalog, staleTime: 5 * 60 * 1000 })).parts,
        );
        layouts = await layoutsFromFiles(files, convert);
      } catch (err) {
        // An unreadable zip has nothing to open; say why a map or layout file didn't.
        if (files.some((f) => MAP_FORMAT_FILE.test(f.name) || /\.bld-layout$/i.test(f.name))) window.alert(`Open failed: ${(err as Error).message}`);
        return;
      }
      const loadCatalog = async () =>
        (await queryClient.fetchQuery({ queryKey: ['parts-catalog'], queryFn: api.parts.catalog, staleTime: 5 * 60 * 1000 })).parts;
      for (const l of layouts) {
        try {
          // The parts a .bld-layout carries that this server lacks become the user's custom parts;
          // the ones it defines differently are asked about first.
          const parts = await takeLayoutParts(l.parts, l.bbm, loadCatalog, ask);
          // The browser keeps the catalog for 60 s: fetch past that so the editor sees the new parts.
          if (parts.changed) await queryClient.fetchQuery({ queryKey: ['parts-catalog'], queryFn: api.parts.catalogFresh, staleTime: 0 });
          const warnings = [...(l.warnings ?? []), ...parts.notes];
          const created = await api.layouts.create({
            bbm: parts.bbm,
            ...(l.sidecar !== undefined ? { sidecar: l.sidecar } : {}),
            ...(l.background ? { backgroundImage: l.background } : {}),
          });
          const state: OpenedMapState | undefined = warnings.length ? { openWarnings: warnings } : undefined;
          navigate(`/editor/${created.id}`, state ? { state } : undefined);
        } catch {
          // silently ignore — editor page shows its own error
        }
      }
    }
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [navigate]);
  if (!asking) return null;
  return (
    <PartDifferencesDialog
      differences={asking.differing}
      onDone={(choices) => {
        setAsking(null);
        asking.answer(choices);
      }}
    />
  );
}

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <PrefsProvider>
      <BrowserRouter>
        <GlobalBbmDrop />
        <Suspense fallback={null}>
        <Routes>
          <Route path="/" element={<App />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/link" element={<LinkPage />} />
          <Route path="/device" element={<DevicePage />} />
          <Route path="/invite/:token" element={<InvitePage />} />
          <Route path="/verify-email/:token" element={<VerifyEmailPage />} />
          <Route path="/transfer/:token" element={<TransferPage />} />
          <Route path="/org-invite/:token" element={<OrgInvitePage />} />
          <Route path="/orgs" element={<OrgsPage />} />
          <Route path="/orgs/:slug" element={<OrgDetailPage />} />
          <Route path="/orgs/:slug/admin" element={<OrgAdminPage />} />
          <Route path="/library" element={<LibraryPage />} />
          <Route path="/editor/:id" element={<EditorPage />} />
          <Route path="/venues/new" element={<NewVenuePage />} />
          <Route path="/venues/:id/design" element={<VenueDesignPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/p/:token" element={<PublicLayoutPage />} />
        </Routes>
        </Suspense>
      </BrowserRouter>
      </PrefsProvider>
    </QueryClientProvider>
  </StrictMode>,
);
