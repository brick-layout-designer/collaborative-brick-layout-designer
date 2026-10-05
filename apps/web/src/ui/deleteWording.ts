// What each kind of deletion says, in one place so every list that can
// delete the same thing says the same words (and the desktop app's
// ConfirmDialog copies them: keep both in step).

import type { DeleteWording } from './ConfirmDialog';

export const MODULE_DELETE_WORDING: DeleteWording = {
  removes: 'The module and its versions are deleted, and it leaves any collections it was in.',
  keeps: 'Layouts that already use it don’t change.',
};

export const VENUE_DELETE_WORDING: DeleteWording = {
  removes: 'The venue is deleted from the Venue library.',
  keeps: 'Layouts made from it keep their own copy of the venue.',
};

export const CUSTOM_PART_DELETE_WORDING: DeleteWording = {
  removes: 'The part is deleted from your custom parts.',
  keeps: 'Layouts that use it show a placeholder in its place.',
};
