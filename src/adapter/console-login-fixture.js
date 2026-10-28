import { createLatestFrames } from './latest-frames.js';
import { validatePointer, validateText, validateKey } from './takeover.js';

export const FIXTURE_QR_IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVR4nGP4+vUrAAXCAuCuRnaIAAAAAElFTkSuQmCC';
const JPEG = [
  '/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsj',
  'HBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgo',
  'KCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAAR',
  'CAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAA',
  'AAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAA',
  'AAAAAAAAAAD/2gAMAwEAAhEDEQA/AKcAB//Z',
].join('');

export function openFixtureTakeover() {
  const frames = createLatestFrames();
  frames.publish({ jpeg: JPEG, width: 1, height: 1 });
  return { frames, dispatchPointer(input) {
    const released = validatePointer(input).some((event) => event.type === 'up');
    return released ? { editable: false, numeric: false } : { editable: null, numeric: null };
  }, insertText: validateText, pressKey: validateKey,
    close: () => frames.close() };
}
