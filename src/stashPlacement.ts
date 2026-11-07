import type { CategoryAssignment, LibraryImage, LibraryCategory } from './libraryStore';
import type { BoardPoint } from './categoryBoard';
import { imageOnScopeBoard } from './stashBoard';
import { stashTileGeometry } from './stashGeometry';
import { stashGrid } from './stashLayout';
import { arrangeVisibleBatch, type BoardBounds } from './pileLayout';

type FolderPlacement = {
  folderId: string;
  anchor: BoardPoint;
  explicitPoint: boolean;
  fromBrowser: boolean;
  viewport?: BoardBounds;
  cards: Array<BoardPoint & { id: string }>;
  selectedIds: string[];
  groups: BoardBounds[];
};

/** Plan only the new folder tile and optional camera reveal. Existing images never move. */
export function placeCreatedFolder({
  folderId,
  anchor,
  explicitPoint,
  fromBrowser,
  viewport,
  cards,
  selectedIds,
  groups,
}: FolderPlacement) {
  const width = 200,
    height = 182,
    collisionHeight = 196,
    cardWidth = 172;
  if (!explicitPoint) {
    const selected = new Set(selectedIds);
    const occupied = [
      ...groups.map((group) => ({ ...group, protected: true })),
      ...cards
        .filter((card) => !selected.has(card.id))
        .map((card) => ({ ...card, width: cardWidth, height: cardWidth })),
    ];
    const overlaps = occupied.some(
      (other) =>
        anchor.x < other.x + other.width + 12 &&
        anchor.x + width + 12 > other.x &&
        anchor.y < other.y + other.height + 12 &&
        anchor.y + collisionHeight + 12 > other.y,
    );
    const outside =
      viewport &&
      (anchor.x < viewport.x ||
        anchor.y < viewport.y ||
        anchor.x + width > viewport.x + viewport.width ||
        anchor.y + height > viewport.y + viewport.height);
    if (viewport && (fromBrowser || overlaps || outside)) {
      [anchor] = arrangeVisibleBatch([folderId], occupied, viewport, width);
    }
  }
  const position = { x: Math.max(8, anchor.x), y: Math.max(48, anchor.y) };
  let cameraCenter: BoardPoint | undefined;
  if (viewport) {
    const center = { x: viewport.x + viewport.width / 2, y: viewport.y + viewport.height / 2 };
    const x = Math.max(
      position.x + width - viewport.width / 2,
      Math.min(center.x, position.x + viewport.width / 2),
    );
    const y = Math.max(
      position.y + height - viewport.height / 2,
      Math.min(center.y, position.y + viewport.height / 2),
    );
    if (Math.abs(x - center.x) > 1 || Math.abs(y - center.y) > 1) cameraCenter = { x, y };
  }
  return { position, cameraCenter };
}

/** One occupancy pass per destination, even when moving thousands of images. */
export function planStashAssignments(
  images: LibraryImage[],
  categories: LibraryCategory[],
  assignments: CategoryAssignment[],
  width: number,
  anchors: Record<string, BoardPoint>,
  arrangeUnsorted = true,
): CategoryAssignment[] {
  const byId = new Map(images.map((image) => [image.id, image]));
  const destinations = new Map<string | null, string[]>();
  for (const assignment of assignments) {
    const image = byId.get(assignment.id),
      scope = assignment.categoryId;
    if (
      !image ||
      (!scope && !arrangeUnsorted) ||
      assignment.boardPosition ||
      (imageOnScopeBoard(image, scope) && image.boardX !== undefined && image.boardY !== undefined)
    )
      continue;
    const ids = destinations.get(scope) || [];
    ids.push(image.id);
    destinations.set(scope, ids);
  }
  const positions = new Map<string, BoardPoint>();
  for (const [scope, ids] of destinations) {
    const moving = new Set(ids);
    const occupied = images
      .filter((image) => !moving.has(image.id) && imageOnScopeBoard(image, scope))
      .map((image) => ({ x: image.boardX ?? 0, y: image.boardY ?? 0 }));
    const tiles = stashTileGeometry(categories, scope, width, anchors, occupied);
    for (const move of stashGrid(ids, width, [...occupied, ...tiles])) positions.set(move.id, move);
  }
  return assignments.map((assignment) =>
    positions.has(assignment.id)
      ? { ...assignment, boardPosition: positions.get(assignment.id)! }
      : assignment,
  );
}
