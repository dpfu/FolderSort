import type { CategoryAssignment, LibraryImage, LibraryCategory } from './libraryStore';
import type { BoardPoint } from './categoryBoard';
import { imageOnScopeBoard } from './stashBoard';
import { stashTileGeometry } from './stashGeometry';
import { stashGrid } from './stashLayout';

/** One occupancy pass per destination, even when moving thousands of images. */
export function planStashAssignments(images: LibraryImage[], categories: LibraryCategory[], assignments: CategoryAssignment[],
  width: number, anchors: Record<string, BoardPoint>, arrangeUnsorted = false): CategoryAssignment[] {
  const byId = new Map(images.map(image => [image.id, image]));
  const destinations = new Map<string | null, string[]>();
  for (const assignment of assignments) {
    const image = byId.get(assignment.id), scope = assignment.boardScope === undefined ? assignment.categoryId : assignment.boardScope;
    if (!image || (!scope && !arrangeUnsorted) || assignment.boardPosition || assignment.placement || imageOnScopeBoard(image, scope)) continue;
    const ids = destinations.get(scope) || []; ids.push(image.id); destinations.set(scope, ids);
  }
  const positions = new Map<string, BoardPoint>();
  for (const [scope, ids] of destinations) {
    const moving = new Set(ids);
    const occupied = images.filter(image => !moving.has(image.id) && imageOnScopeBoard(image, scope))
      .map(image => ({ x: image.boardX ?? 0, y: image.boardY ?? 0 }));
    const tiles = stashTileGeometry(categories, scope, width, anchors, occupied);
    for (const move of stashGrid(ids, width, [...occupied, ...tiles])) positions.set(move.id, move);
  }
  return assignments.map(assignment => positions.has(assignment.id) ? { ...assignment, boardPosition: positions.get(assignment.id)! } : assignment);
}
