import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { addImages, assignImageCategories, createCategory, createProject, listCategories, listImages, placeImagesOnBoard, prepareStashBoard, type LibraryImage } from './libraryStore';
import { planStashAssignments } from './stashPlacement';
import { stashBoardLayout } from './stashBoard';

it('keeps an unvisited child stash near the top when first arranging a large parent', async () => {
  const project = await createProject('Parent layout'), parent = await createCategory(project.id, 'Parent');
  const child = await createCategory(project.id, 'Parent/Child');
  await addImages(project.id, Array.from({ length: 60 }, (_, i) => ({ file: new File(['a'], `${i}.png`, { type: 'image/png' }), path: `${i}.png` })));
  await assignImageCategories(project.id, (await listImages(project.id)).map(image => ({ id: image.id, categoryId: parent.id })));
  await prepareStashBoard(project.id, parent.id, 390);
  const images = await listImages(project.id), [tile] = stashBoardLayout(images, await listCategories(project.id), parent.id, 390, {}, images.map(image => ({ x: image.boardX!, y: image.boardY! })));
  expect(tile.id).toBe(child.id); expect(tile.y).toBeLessThanOrEqual(150);
  expect(images.every(image => !(image.boardX! < tile.x + tile.width && image.boardX! + 172 > tile.x && image.boardY! < tile.y + tile.height && image.boardY! + 172 > tile.y))).toBe(true);
});
it('reserves borrowed board images, named stacks and earlier members during a batch assignment', () => {
  const categories = ['Destination', 'Destination/Child'].map((name, index) => ({ id: String(index), name, projectId: 'p', createdAt: 1 }));
  const source: LibraryImage[] = Array.from({ length: 3002 }, (_, i) => ({ id: String(i), projectId: 'p', path: `${i}.png`, mime: 'image/png', size: 1, addedAt: 1, categoryId: null, placement: 'tray' }));
  source[0] = { ...source[0], placement: 'board', boardScope: '0', boardX: 500, boardY: 120 };
  source[1] = { ...source[1], categoryId: '0', placement: 'board', boardScope: '0', boardX: 700, boardY: 120 };
  const planned = planStashAssignments(source, categories, source.slice(1).map(image => ({ id: image.id, categoryId: '0' })), 390, { '1': { x: 32, y: 150 } });
  expect(planned[0].boardPosition).toBeUndefined();
  const points = planned.slice(1).map(change => change.boardPosition!);
  const [tile] = stashBoardLayout(source, categories, '0', 390, { '1': { x: 32, y: 150 } });
  expect(new Set(points.map(point => `${point.x}:${point.y}`)).size).toBe(3000);
  expect(points.every(point => point.y < 100000 && !(point.x < tile.x + tile.width && point.x + 172 > tile.x && point.y < tile.y + tile.height && point.y + 172 > tile.y))).toBe(true);
  expect(points.every(point => !(point.x < 872 && point.x + 172 > 500 && point.y < 292 && point.y + 172 > 120))).toBe(true);
});
it('keeps borrowed comparison images clear when first arranging a stash', async () => {
  const project = await createProject('Borrowed comparison'), stash = await createCategory(project.id, 'Stash');
  await addImages(project.id, ['member.png', 'reference.png'].map(path => ({ path, file: new File(['a'], path, { type: 'image/png' }) })));
  const images = await listImages(project.id), member = images.find(image => image.path === 'member.png')!, reference = images.find(image => image.path === 'reference.png')!;
  await assignImageCategories(project.id, [{ id: member.id, categoryId: stash.id }]);
  await placeImagesOnBoard(project.id, [{ id: reference.id, x: 32, y: 120, boardScope: stash.id }]);
  await prepareStashBoard(project.id, stash.id, 900);
  const saved = await listImages(project.id), prepared = saved.find(image => image.id === member.id)!;
  expect(saved.find(image => image.id === reference.id)).toMatchObject({ categoryId: null, boardScope: stash.id, boardX: 32, boardY: 120 });
  expect(prepared.boardX! >= 204 || prepared.boardY! >= 292).toBe(true);
});
