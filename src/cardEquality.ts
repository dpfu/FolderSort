import type { CardData } from './types';

/** Presentation objects are rebuilt as visibility and z-order change. Compare
 * every field so unchanged photos can skip Motion's layout measurements. */
export function sameCard(left: CardData, right: CardData): boolean {
  if (left === right) return true;
  const keys = Object.keys(left) as Array<keyof CardData>;
  if (keys.length !== Object.keys(right).length) return false;
  for (const key of keys) {
    if (key !== 'meta' && !Object.is(left[key], right[key])) return false;
  }
  const metaKeys = Object.keys(left.meta) as Array<keyof CardData['meta']>;
  if (metaKeys.length !== Object.keys(right.meta).length) return false;
  return metaKeys.every(key => key === 'tags'
    ? left.meta.tags.length === right.meta.tags.length && left.meta.tags.every((tag, index) => tag === right.meta.tags[index])
    : Object.is(left.meta[key], right.meta[key]));
}
