import type { HelpReference } from './InfoHint';
import type { PileOrder } from './imageAnalysis';
import { similarityCopy } from './similarityCopy';

export function pileOrderLabel(order: PileOrder, reversed = false): string {
  return {
    random: 'Random',
    similarity: similarityCopy.pattern.order,
    semantic: similarityCopy.clip.order,
    modified: `File modified · ${reversed ? 'newest first' : 'oldest first'}`,
    bytes: `File size · ${reversed ? 'smallest first' : 'largest first'}`,
    resolution: `Pixel count · ${reversed ? 'lowest first' : 'highest first'}`,
    aspect: `Aspect ratio · ${reversed ? 'landscape to portrait' : 'portrait to landscape'}`,
    name: `Filename · ${reversed ? 'Z–A' : 'A–Z'}`,
  }[order];
}

export const pileOrderHelp: Record<PileOrder, { text: string; reference?: HelpReference }> = {
  random: { text: 'Shuffles the browser view. Images stay in their folders.' },
  semantic: { text: similarityCopy.clip.explanation, reference: similarityCopy.clip.reference },
  similarity: { text: similarityCopy.pattern.explanation, reference: similarityCopy.pattern.reference },
  modified: { text: "Uses the original file's last-modified date." },
  bytes: { text: 'Uses the original file size, not the thumbnail size.' },
  resolution: { text: 'Uses image width × height in pixels.' },
  aspect: { text: 'Uses width divided by height: portrait, square or landscape.' },
  name: { text: 'Orders filenames. Original folder names are ignored.' },
};

export function PileOrderOptions({ clipEnabled = true, reversed = false }: { clipEnabled?: boolean; reversed?: boolean }) {
  const orders: PileOrder[] = ['random', 'similarity', ...(clipEnabled ? ['semantic' as const] : []), 'modified', 'bytes', 'resolution', 'aspect', 'name'];
  return <>{orders.map(order => <option key={order} value={order}
    title={order === 'similarity' ? similarityCopy.pattern.explanation : order === 'semantic' ? similarityCopy.clip.explanation : undefined}>
    {pileOrderLabel(order, reversed)}
  </option>)}</>;
}
