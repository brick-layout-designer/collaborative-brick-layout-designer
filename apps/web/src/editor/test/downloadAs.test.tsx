// Download As (F1 save side, F2): the layout in another map format, with
// the desktop's lossy-format warning and its "Don't show this again".

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { BbmMap } from '@cld/model';
import { DownloadAsDialog, warnsOnNonBbmSave } from '../DownloadAsDialog';

const map: BbmMap = {
  version: 9,
  nbItems: 0,
  backgroundColor: { kind: 'known', name: 'White' },
  author: 'Ann',
  lug: '',
  event: '',
  date: { day: 1, month: 1, year: 2026 },
  comment: '',
  exportInfo: { exportPath: '', exportFileType: 1, exportArea: { x: 0, y: 0, width: 0, height: 0 }, exportScale: 0, exportWatermark: false, exportElectricCircuit: false, exportConnectionPoints: false },
  selectedLayerIndex: -1,
  layers: [],
};

let downloads: { name: string; blob: Blob }[];
beforeEach(() => {
  localStorage.clear();
  downloads = [];
  const blobs = new Map<string, Blob>();
  let n = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
    const url = `blob:${n++}`;
    blobs.set(url, b as Blob);
    return url;
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push({ name: this.download, blob: blobs.get(this.getAttribute('href')!)! });
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const open = (props: Partial<Parameters<typeof DownloadAsDialog>[0]> = {}) => {
  const onDownloadBbm = vi.fn();
  const onClose = vi.fn();
  render(<DownloadAsDialog map={map} parts={[]} title="My layout" onDownloadBbm={onDownloadBbm} onClose={onClose} {...props} />);
  return { onDownloadBbm, onClose };
};

describe('Download As', () => {
  it('downloads the .bbm the usual way, without a warning', () => {
    const { onDownloadBbm, onClose } = open();
    expect(screen.queryByText(/can't store everything/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    expect(onDownloadBbm).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('warns before a lossy format and writes the file', async () => {
    const { onDownloadBbm, onClose } = open();
    fireEvent.click(screen.getByLabelText('LDraw multi-part (.mpd)'));
    expect(screen.getByText(/can't store everything in the map/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Download anyway' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onDownloadBbm).not.toHaveBeenCalled();
    expect(downloads.map((d) => d.name)).toEqual(['My layout.mpd']);
    expect(await downloads[0]!.blob.text()).toContain('0 FILE My layout.ldr\r\n0 My layout\r\n0 Name: My layout.mpd\r\n0 Author: Ann');
    // Not ticked: the warning stays.
    expect(warnsOnNonBbmSave()).toBe(true);
  });

  it("stops warning after \"Don't show this again\"", async () => {
    const { onClose } = open();
    fireEvent.click(screen.getByLabelText('TrackDesigner (.tdl)'));
    fireEvent.click(screen.getByLabelText("Don't show this again"));
    fireEvent.click(screen.getByRole('button', { name: 'Download anyway' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(downloads.map((d) => d.name)).toEqual(['My layout.tdl']);
    expect(warnsOnNonBbmSave()).toBe(false);
    cleanup();

    open();
    fireEvent.click(screen.getByLabelText('4DBrix nControl (.ncp)'));
    expect(screen.queryByText(/can't store everything/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    await waitFor(() => expect(downloads).toHaveLength(2));
    expect(downloads[1]!.name).toBe('My layout.ncp');
  });
});
