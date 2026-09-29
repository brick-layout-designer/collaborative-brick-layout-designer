// Desktop defaults for a first run (nothing saved yet): R2-R6.

import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('editor defaults match desktop', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it('connection points off, snap off, opaque green paint, module names and frames on at 5 px', async () => {
    const { useEditorStore } = await import('../editorStore');
    const s = useEditorStore.getState();
    // view/connectionPoints false (MainWindowMenus.cpp:553): only selected bricks show dots.
    expect(s.showConnectionPoints).toBe(false);
    expect(s.alwaysShowConnections).toBe(false);
    // snapStepStuds 0.0 (PreferencesDialog.cpp:137).
    expect(s.snapStepStuds).toBe(0);
    // paintColor QColor(0, 128, 0) (PreferencesDialog.cpp:152).
    expect(s.paintColor.toLowerCase()).toBe('ff008000');
    // view/moduleNames true drives names and frames (SceneBuilderSidecar.cpp:233-236).
    expect(s.showModuleNames).toBe(true);
    expect('showModuleFrames' in s).toBe(false);
    // view/moduleFrameThickness 5.0 (PreferencesDialog.cpp:200-207).
    expect(s.moduleFrameThickness).toBe(5);
  });

  it('saved choices still win', async () => {
    localStorage.setItem('cld:showConnectionPoints', 'true');
    localStorage.setItem('cld:snapStepStuds', '8');
    localStorage.setItem('cld:showModuleNames', 'false');
    localStorage.setItem('cld:moduleFrameThickness', '2');
    const { useEditorStore } = await import('../editorStore');
    const s = useEditorStore.getState();
    expect([s.showConnectionPoints, s.snapStepStuds, s.showModuleNames, s.moduleFrameThickness]).toEqual([true, 8, false, 2]);
  });
});
