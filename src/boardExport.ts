import { BOARD_IMAGE_SIZE, type CategoryBoardGroup, type CategoryBoardMode } from './categoryBoard';
import { categoryColor } from './categoryTree';
import type { CameraView } from './camera';
import type { CardData } from './types';

export type ExportBounds = { x: number; y: number; width: number; height: number };
export type BoardExportScope = 'view' | 'all';
export type BoardSnapshot = {
  cards: CardData[];
  groups: CategoryBoardGroup[];
  mode: CategoryBoardMode;
  view: CameraView;
  scope: BoardExportScope;
  focusedIds?: Set<string>;
  focusedCategoryName?: string;
};

const MAX_EDGE = 8192;
const MAX_PIXELS = 12_000_000;
const BACKGROUND = '#18221e';

/** Use the layout model, so exporting never depends on virtualized DOM cards. */
export function boardExportGeometry({ cards, groups, view, scope }: BoardSnapshot) {
  let bounds: ExportBounds;
  if (scope === 'view' || (!cards.length && !groups.length)) {
    bounds = { x: view.centerX - view.viewportW / view.scale / 2, y: view.centerY - view.viewportH / view.scale / 2,
      width: view.viewportW / view.scale, height: view.viewportH / view.scale };
  } else {
    const boxes = [...cards.map(card => ({ x: card.x, y: card.y, width: BOARD_IMAGE_SIZE, height: BOARD_IMAGE_SIZE })), ...groups];
    const left = Math.min(...boxes.map(box => box.x)) - 32, top = Math.min(...boxes.map(box => box.y)) - 32;
    bounds = { x: left, y: top, width: Math.max(...boxes.map(box => box.x + box.width)) + 32 - left,
      height: Math.max(...boxes.map(box => box.y + box.height)) + 32 - top };
  }
  const requestedScale = scope === 'view' ? view.scale * 2 : 2;
  const scale = Math.min(requestedScale, MAX_EDGE / bounds.width, MAX_EDGE / bounds.height, Math.sqrt(MAX_PIXELS / (bounds.width * bounds.height)));
  return { bounds, scale, width: Math.max(1, Math.floor(bounds.width * scale)), height: Math.max(1, Math.floor(bounds.height * scale)), reduced: scale < requestedScale };
}

export function fittedBoardImage(card: Pick<CardData, 'x' | 'y'>, width: number, height: number): ExportBounds {
  const scale = Math.min(BOARD_IMAGE_SIZE / width, BOARD_IMAGE_SIZE / height);
  const w = width * scale, h = height * scale;
  return { x: card.x + (BOARD_IMAGE_SIZE - w) / 2, y: card.y + (BOARD_IMAGE_SIZE - h) / 2, width: w, height: h };
}

function intersects(a: ExportBounds, b: ExportBounds) {
  return a.x + a.width >= b.x && a.y + a.height >= b.y && a.x <= b.x + b.width && a.y <= b.y + b.height;
}

function rounded(ctx: CanvasRenderingContext2D, box: ExportBounds, radius: number) {
  ctx.beginPath(); ctx.roundRect(box.x, box.y, box.width, box.height, radius);
}

function text(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, maxWidth: number) {
  let result = value;
  while (result.length && ctx.measureText(result).width > maxWidth) result = result.slice(0, -1);
  if (result !== value && result.length > 1) result = `${result.slice(0, -1)}…`;
  ctx.fillText(result, x, y, maxWidth);
}

export type DecodedBoardImage = { source: CanvasImageSource; width: number; height: number; dispose: () => void };

/** Originals and cached previews remain in browser storage. Decode only one at
 * a time and release it after painting, even for a very large arrangement. */
async function loadImage(id: string, signal: AbortSignal): Promise<DecodedBoardImage | undefined> {
  const { getImageBlob, getImageThumbnail } = await import('./libraryStore');
  const blob = await getImageThumbnail(id) || await getImageBlob(id);
  signal.throwIfAborted();
  if (!blob) return;
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob);
      if (signal.aborted) { bitmap.close(); signal.throwIfAborted(); }
      return { source: bitmap, width: bitmap.width, height: bitmap.height, dispose: () => bitmap.close() };
    } catch { signal.throwIfAborted(); /* Safari can require an HTML image. */ }
  }
  const url = URL.createObjectURL(blob);
  const image = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      const abort = () => { image.src = ''; reject(signal.reason); };
      const cleanup = () => signal.removeEventListener('abort', abort);
      image.onload = () => { cleanup(); resolve(); };
      image.onerror = () => { cleanup(); reject(new Error('Preview unavailable')); };
      signal.addEventListener('abort', abort, { once: true });
      image.src = url;
    });
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, dispose: () => { image.src = ''; URL.revokeObjectURL(url); } };
  } catch (error) { image.src = ''; URL.revokeObjectURL(url); throw error; }
}

export async function exportBoardPng(snapshot: BoardSnapshot, signal: AbortSignal, onProgress: (done: number, total: number) => void,
  load: (id: string, signal: AbortSignal) => Promise<DecodedBoardImage | undefined> = loadImage) {
  const geometry = boardExportGeometry(snapshot);
  const { bounds, scale, width, height } = geometry;
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser could not create a board image.');
  let unavailable = 0;
  try {
    signal.throwIfAborted();
    ctx.fillStyle = BACKGROUND; ctx.fillRect(0, 0, width, height);
    ctx.scale(scale, scale); ctx.translate(-bounds.x, -bounds.y);
    // Keep the dotted backdrop bounded even when a huge board is scaled down.
    const dotStep = 24 * Math.max(1, Math.ceil(.5 / scale));
    ctx.fillStyle = '#39463b';
    for (let y = Math.ceil(bounds.y / dotStep) * dotStep; y < bounds.y + bounds.height; y += dotStep) {
      for (let x = Math.ceil(bounds.x / dotStep) * dotStep; x < bounds.x + bounds.width; x += dotStep) {
        ctx.beginPath(); ctx.arc(x, y, Math.max(1, .6 / scale), 0, Math.PI * 2); ctx.fill();
      }
    }
    const groups = snapshot.groups.filter(group => intersects(group, bounds));
    const linkedCards = new Map<string, CardData[]>();
    if (snapshot.mode === 'linked') for (const card of snapshot.cards) {
      const name = card.meta.tags[0]; if (!name) continue;
      const members = linkedCards.get(name) || []; members.push(card); linkedCards.set(name, members);
    }
    if (snapshot.mode === 'linked') for (const group of groups) {
      ctx.strokeStyle = categoryColor(group.name); ctx.globalAlpha = .38; ctx.lineWidth = 1.5; ctx.setLineDash([4, 6]);
      for (const card of linkedCards.get(group.name) || []) {
        ctx.beginPath(); ctx.moveTo(group.x + 100, group.y + 40);
        ctx.bezierCurveTo(group.x + 100, group.y + 104, card.x + 86, card.y - 24, card.x + 86, card.y + 86); ctx.stroke();
      }
    }
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    for (const group of groups) {
      ctx.save();
      const muted = snapshot.focusedCategoryName && group.name !== snapshot.focusedCategoryName && !group.name.toLocaleLowerCase().startsWith(`${snapshot.focusedCategoryName.toLocaleLowerCase()}/`);
      if (muted) ctx.globalAlpha = .35;
      const color = categoryColor(group.name);
      if (snapshot.mode === 'stacks') { rounded(ctx, group, 18); ctx.fillStyle = '#202e26'; ctx.fill(); }
      rounded(ctx, group, 18); ctx.strokeStyle = color; ctx.lineWidth = 1;
      ctx.globalAlpha *= snapshot.mode === 'linked' ? .17 : .32;
      ctx.setLineDash(snapshot.mode === 'linked' ? [5, 5] : []); ctx.stroke(); ctx.setLineDash([]);
      ctx.globalAlpha = muted ? .35 : 1;
      const headerWidth = Math.min(group.width - 14, snapshot.mode === 'linked' ? 360 : group.width - 14);
      rounded(ctx, { x: group.x + 7, y: group.y + 6, width: headerWidth, height: 46 }, 10); ctx.fillStyle = '#14271e'; ctx.fill();
      ctx.fillStyle = color; ctx.font = '600 12px system-ui, sans-serif';
      text(ctx, group.name.split('/').at(-1)!, group.x + 20, group.y + (group.name.includes('/') ? 25 : 34), headerWidth - 58);
      if (group.name.includes('/')) { ctx.font = '9px system-ui, sans-serif'; ctx.fillStyle = '#98b5a2'; text(ctx, group.name.slice(0, group.name.lastIndexOf('/')), group.x + 20, group.y + 40, headerWidth - 58); }
      ctx.font = '600 11px system-ui, sans-serif'; ctx.fillStyle = color; ctx.fillText(String(group.ids.length), group.x + headerWidth - 22, group.y + 34);
      if (snapshot.mode === 'stacks' && !group.expanded && group.ids.length > 3) { ctx.font = '10px system-ui, sans-serif'; ctx.fillText(`+${group.ids.length - 3} more`, group.x + 18, group.y + group.height - 17); }
      ctx.restore();
    }
    const cards = snapshot.cards.filter(card => intersects({ ...card, width: BOARD_IMAGE_SIZE, height: BOARD_IMAGE_SIZE }, bounds)).sort((a, b) => a.z - b.z);
    let lastProgress = performance.now();
    onProgress(0, cards.length);
    for (let index = 0; index < cards.length; index++) {
      signal.throwIfAborted();
      const card = cards[index];
      let image: DecodedBoardImage | undefined;
      try { image = await load(card.id, signal); } catch { signal.throwIfAborted(); }
      try {
        signal.throwIfAborted(); ctx.save();
        if (snapshot.focusedIds && !snapshot.focusedIds.has(card.id)) ctx.globalAlpha = .22;
        const box = image ? fittedBoardImage(card, image.width, image.height) : { x: card.x, y: card.y, width: BOARD_IMAGE_SIZE, height: BOARD_IMAGE_SIZE };
        if (image) {
          ctx.shadowColor = '#0008'; ctx.shadowBlur = 5; ctx.shadowOffsetY = 3;
          ctx.drawImage(image.source, box.x, box.y, box.width, box.height);
          ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
        } else {
          unavailable++; ctx.fillStyle = '#2c4637'; ctx.fillRect(box.x, box.y, box.width, box.height);
          ctx.fillStyle = '#b0c4b7'; ctx.font = '11px system-ui, sans-serif';
          text(ctx, card.meta.name, box.x + 10, box.y + 74, box.width - 20); ctx.fillText('Preview unavailable', box.x + 10, box.y + 98);
        }
        const category = card.meta.tags[0];
        if (category) {
          const color = categoryColor(category);
          ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.strokeRect(box.x - 2, box.y - 2, box.width + 4, box.height + 4);
          if (snapshot.mode !== 'stacks') {
            ctx.font = '750 10px system-ui, sans-serif';
            const labelWidth = Math.min(box.width - 12, ctx.measureText(category).width + 14);
            if (labelWidth > 14 && box.height > 26) {
              rounded(ctx, { x: box.x + 6, y: box.y + box.height - 27, width: labelWidth, height: 21 }, 5); ctx.fillStyle = color; ctx.fill();
              ctx.fillStyle = '#13231a'; text(ctx, category, box.x + 13, box.y + box.height - 13, labelWidth - 14);
            }
          }
        }
        ctx.restore();
      } finally { image?.dispose(); }
      if ((index + 1) % 8 === 0 || index === cards.length - 1) {
        if (index === cards.length - 1 || performance.now() - lastProgress >= 120) {
          onProgress(index + 1, cards.length); lastProgress = performance.now();
        }
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
    }
    signal.throwIfAborted();
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Could not save the board image.')), 'image/png'));
    signal.throwIfAborted();
    return { blob, width, height, reduced: geometry.reduced, unavailable };
  } finally { canvas.width = 0; canvas.height = 0; }
}
