// The "File > New" template preference (desktop general/newMapTemplate).

import { afterEach, describe, expect, it, vi } from 'vitest';
import { getNewLayoutTemplate, setNewLayoutTemplate, templateContent } from '../newLayoutTemplate';

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('new layout template', () => {
  it('is remembered per user and can be cleared', () => {
    expect(getNewLayoutTemplate()).toBeNull();
    setNewLayoutTemplate({ id: 'abc', title: 'Club base' });
    expect(getNewLayoutTemplate()).toEqual({ id: 'abc', title: 'Club base' });
    setNewLayoutTemplate(null);
    expect(getNewLayoutTemplate()).toBeNull();
    localStorage.setItem('cld:newLayoutTemplate', '{bad');
    expect(getNewLayoutTemplate()).toBeNull();
  });

  it("reads the template's .bbm and sidecar; a missing template is an error", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith('export.bbm') ? new Response('<Map/>') : url.endsWith('export.bbm.bld') ? new Response('{"schemaVersion":1}') : new Response('', { status: 404 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    expect(await templateContent('abc')).toEqual({ bbm: '<Map/>', sidecar: '{"schemaVersion":1}' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
    await expect(templateContent('gone')).rejects.toThrow('no longer available');
  });
});
