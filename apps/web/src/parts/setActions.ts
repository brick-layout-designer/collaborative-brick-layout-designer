// Renaming a set you made: its name in the lists and the English name in
// its XML change together. Its part number stays, so layouts that placed
// it keep working (the desktop's parts browser renames a set the same way).

import { api, toBase64, type CustomPartSummary } from '../api';
import { renameSetXml } from '../editor/setXml';

export async function renameSet(set: Pick<CustomPartSummary, 'id' | 'partNumber'>, name: string): Promise<void> {
  const res = await fetch(api.customParts.xmlUrl(set.id), { credentials: 'include' });
  if (!res.ok) throw new Error('Could not read the set.');
  const xml = renameSetXml(await res.text(), name);
  await api.customParts.replace(set.id, {
    partNumber: set.partNumber,
    displayName: name,
    xmlBase64: toBase64(new TextEncoder().encode(xml)),
  });
}
