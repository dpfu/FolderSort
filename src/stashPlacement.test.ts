import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import {
  addImages,
  assignImageCategories,
  createCategory,
  createProject,
  listCategories,
  listImages,
  placeImagesOnBoard,
  prepareStashBoard,
  type LibraryImage,
} from './libraryStore';
import { placeCreatedFolder, planStashAssignments } from './stashPlacement';
import { stashBoardLayout } from './stashBoard';

it('keeps an explicit grouping drop even when crowded and only reveals the new folder', () => {
  const cards = [{ id: 'existing', x: 750, y: 450 }];
  const original = structuredClone(cards);
  const result = placeCreatedFolder({
    folderId: 'new',
    anchor: { x: 750, y: 450 },
    explicitPoint: true,
    fromBrowser: false,
    viewport: { x: 0, y: 0, width: 800, height: 600 },
    cards,
    selectedIds: [],
    groups: [],
  });
  expect(result.position).toEqual({ x: 750, y: 450 });
  expect(result.cameraCenter).toEqual({ x: 550, y: 332 });
  expect(cards).toEqual(original);
});

it('reuses selected image positions and fits an offscreen browser-created folder without moving images', () => {
  const cards = [
    { id: 'selected', x: 80, y: 100 },
    { id: 'existing', x: 1000, y: 1000 },
  ];
  const viewport = { x: 0, y: 0, width: 800, height: 600 };
  const options = {
    folderId: 'new',
    anchor: { x: 80, y: 100 },
    explicitPoint: false,
    fromBrowser: false,
    viewport,
    cards,
    selectedIds: ['selected'],
    groups: [],
  };
  expect(placeCreatedFolder(options)).toEqual({
    position: { x: 80, y: 100 },
    cameraCenter: undefined,
  });
  const fromBrowser = placeCreatedFolder({
    ...options,
    fromBrowser: true,
    anchor: { x: 1000, y: 1000 },
  });
  expect(fromBrowser.position.x).toBeGreaterThanOrEqual(8);
  expect(fromBrowser.position.x + 200).toBeLessThanOrEqual(viewport.width);
  expect(fromBrowser.position.y).toBeGreaterThanOrEqual(48);
  expect(fromBrowser.position.y + 182).toBeLessThanOrEqual(viewport.height);
  expect(cards[1]).toEqual({ id: 'existing', x: 1000, y: 1000 });
});

it('keeps an unvisited child stash near the top when first arranging a large parent', async () => {
  const project = await createProject('Parent layout'),
    parent = await createCategory(project.id, 'Parent');
  const child = await createCategory(project.id, 'Parent/Child');
  await addImages(
    project.id,
    Array.from({ length: 60 }, (_, i) => ({
      file: new File(['a'], `${i}.png`, { type: 'image/png' }),
      path: `${i}.png`,
    })),
  );
  await assignImageCategories(
    project.id,
    (await listImages(project.id)).map((image) => ({ id: image.id, categoryId: parent.id })),
  );
  await prepareStashBoard(project.id, parent.id, 390);
  const images = await listImages(project.id),
    [tile] = stashBoardLayout(
      images,
      await listCategories(project.id),
      parent.id,
      390,
      {},
      images.map((image) => ({ x: image.boardX!, y: image.boardY! })),
    );
  expect(tile.id).toBe(child.id);
  expect(tile.y).toBeLessThanOrEqual(150);
  expect(
    images.every(
      (image) =>
        !(
          image.boardX! < tile.x + tile.width &&
          image.boardX! + 172 > tile.x &&
          image.boardY! < tile.y + tile.height &&
          image.boardY! + 172 > tile.y
        ),
    ),
  ).toBe(true);
});
it('reserves folder members, named stacks and earlier members during a batch assignment', () => {
  const categories = ['Destination', 'Destination/Child'].map((name, index) => ({
    id: String(index),
    name,
    projectId: 'p',
    createdAt: 1,
  }));
  const source: LibraryImage[] = Array.from({ length: 3002 }, (_, i) => ({
    id: String(i),
    projectId: 'p',
    path: `${i}.png`,
    mime: 'image/png',
    size: 1,
    addedAt: 1,
    categoryId: null,
    placement: 'tray',
  }));
  source[0] = {
    ...source[0],
    categoryId: '0',
    placement: 'board',
    boardScope: '0',
    boardX: 500,
    boardY: 120,
  };
  source[1] = {
    ...source[1],
    categoryId: '0',
    placement: 'board',
    boardScope: '0',
    boardX: 700,
    boardY: 120,
  };
  const planned = planStashAssignments(
    source,
    categories,
    source.slice(1).map((image) => ({ id: image.id, categoryId: '0' })),
    390,
    { '1': { x: 32, y: 150 } },
  );
  expect(planned[0].boardPosition).toBeUndefined();
  const points = planned.slice(1).map((change) => change.boardPosition!);
  const [tile] = stashBoardLayout(source, categories, '0', 390, { '1': { x: 32, y: 150 } });
  expect(new Set(points.map((point) => `${point.x}:${point.y}`)).size).toBe(3000);
  expect(
    points.every(
      (point) =>
        point.y < 100000 &&
        !(
          point.x < tile.x + tile.width &&
          point.x + 172 > tile.x &&
          point.y < tile.y + tile.height &&
          point.y + 172 > tile.y
        ),
    ),
  ).toBe(true);
  expect(
    points.every(
      (point) => !(point.x < 872 && point.x + 172 > 500 && point.y < 292 && point.y + 172 > 120),
    ),
  ).toBe(true);
});
it('treats a dropped reference as a member and preserves its explicit position', async () => {
  const project = await createProject('Borrowed comparison'),
    stash = await createCategory(project.id, 'Stash');
  await addImages(
    project.id,
    ['member.png', 'reference.png'].map((path) => ({
      path,
      file: new File(['a'], path, { type: 'image/png' }),
    })),
  );
  const images = await listImages(project.id),
    member = images.find((image) => image.path === 'member.png')!,
    reference = images.find((image) => image.path === 'reference.png')!;
  await assignImageCategories(project.id, [{ id: member.id, categoryId: stash.id }]);
  await placeImagesOnBoard(project.id, [{ id: reference.id, x: 32, y: 120, boardScope: stash.id }]);
  await prepareStashBoard(project.id, stash.id, 900);
  const saved = await listImages(project.id),
    prepared = saved.find((image) => image.id === member.id)!;
  expect(saved.find((image) => image.id === reference.id)).toMatchObject({
    categoryId: stash.id,
    boardScope: stash.id,
    boardX: 32,
    boardY: 120,
  });
  expect(prepared.boardX! >= 204 || prepared.boardY! >= 292).toBe(true);
});
