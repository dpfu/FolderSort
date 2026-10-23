import { fitBoard, openBoardActions, openWorkspaceExport, createBoardStash, navigateOverview } from './menuBar';
import { addBrowserImages, choosePileOrder, openPileOptions } from './pileDock';
import type { Page, Locator } from '@playwright/test';
import { test, expect } from './fixtures';
import JSZip from 'jszip';
import fs from 'node:fs/promises';

async function fixture(page: Page, count = 7) {
  await page.goto('/');
  await page.locator('input[accept="image/*"]').evaluate((input: HTMLInputElement, count) => {
    const transfer = new DataTransfer();
    for (let i=0;i<count;i++) {
      const canvas=document.createElement('canvas');canvas.width=i%2?240:320;canvas.height=i%2?320:200;
      const ctx=canvas.getContext('2d')!;ctx.fillStyle=['#cd8c77','#789ec7','#c1c56d','#81b197'][i%4];ctx.fillRect(0,0,canvas.width,canvas.height);
      const bytes=Uint8Array.from(atob(canvas.toDataURL('image/png').split(',')[1]),c=>c.charCodeAt(0));
      transfer.items.add(new File([bytes],`image-${i}.png`,{type:'image/png'}));
    }
    input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
  },count);
  await expect(page.getByRole('main',{name:'Sorting workspace'})).toBeVisible();
  await choosePileOrder(page, 'name');
  await addBrowserImages(page, 3);
  await expect.poll(() => page.locator('.sorting-workspace__board .card').count()).toBeGreaterThan(0);
  await expect(page.locator('.sorting-workspace__save-state')).toHaveText('Saved');
}
async function records(page: Page) {
  return page.evaluate(async()=>{
    const db=await new Promise<IDBDatabase>(resolve=>{const req=indexedDB.open('sortboard-image-library-minimal',2);req.onsuccess=()=>resolve(req.result)});
    const tx=db.transaction(['images','categories']);
    const images=await new Promise<any[]>(resolve=>{const r=tx.objectStore('images').getAll();r.onsuccess=()=>resolve(r.result)});
    const stashes=await new Promise<any[]>(resolve=>{const r=tx.objectStore('categories').getAll();r.onsuccess=()=>resolve(r.result)});
    db.close();return{images,stashes};
  });
}
const card=(page:Page,i:number)=>page.locator('.sorting-workspace__board').getByRole('group',{name:`Card: image-${i}.png`,exact:true});
async function settle(locator: Locator) {
  await locator.evaluate(async element=>{let previous=element.getBoundingClientRect(),stable=0;for(let f=0;f<120&&stable<4;f++){await new Promise(requestAnimationFrame);const rect=element.getBoundingClientRect();stable=Math.abs(rect.x-previous.x)+Math.abs(rect.y-previous.y)<.1?stable+1:0;previous=rect;}});
}
async function dragTo(page: Page, source: Locator, target: Locator, hold=0) {
  await settle(source);await settle(target);
  const a=(await source.boundingBox())!,b=(await target.boundingBox())!;
  await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();
  await page.mouse.move(a.x+a.width/2+6,a.y+a.height/2);
  await expect(source).toHaveClass(/isDragging|is-taking-out/);
  await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:12});
  if(hold)await page.waitForTimeout(hold);
}
async function nameStash(page:Page,name:string){const input=page.getByRole('textbox',{name:'Stash name',exact:true});await input.fill(name);await input.press('Enter');await expect(input).toHaveCount(0);}

async function dragOutToPoint(page: Page, source: Locator, point: { x: number; y: number }, anchor = { x: .5, y: .5 }) {
 await settle(source); const box = (await source.boundingBox())!;
 await page.mouse.move(box.x + box.width * anchor.x, box.y + box.height * anchor.y); await page.mouse.down(); await page.mouse.move(point.x, point.y, { steps: 14 }); await page.mouse.up();
}
const top = (page: Page, stash: string, image: number) => page.getByRole('button', { name: `Top image image-${image}.png in stash ${stash}`, exact: true });

test('the compact Create stash capsule fills for the hold, keeps its label and creates only on release', async ({ page }) => {
 await fixture(page); await dragTo(page, card(page, 0), card(page, 1));
 const cue = page.getByRole('status', { name: 'Create stash', exact: true }), fill = cue.locator('.stash-group-preview__fill');
 await expect(cue).toBeVisible(); await expect(cue.locator('strong')).toHaveText('Create stash');
 await expect(fill).toHaveCSS('animation-duration', '0.6s');
 const pending = (await cue.boundingBox())!;
 expect(pending.width).toBe(168); expect(pending.height).toBe(44);
 await expect.poll(() => fill.evaluate(node => getComputedStyle(node).clipPath)).not.toBe('inset(0px 100% 0px 0px)');
 await expect(cue).toHaveClass(/is-ready/);
 await expect(fill).toHaveCSS('clip-path', 'inset(0px)');
 await expect(cue.locator('strong')).toHaveText('Create stash');
 const ready = (await cue.boundingBox())!; expect(ready.width).toBe(pending.width); expect(ready.height).toBe(pending.height); expect(ready.x).toBeCloseTo(pending.x, 0); expect(ready.y).toBeCloseTo(pending.y, 0);
 expect((await records(page)).stashes).toHaveLength(0);
 await page.screenshot({ path: 'output/production-stash-capsule.png' });
 await page.mouse.up(); await nameStash(page, 'Capsule');
 await expect(page.getByRole('region', { name: 'Stash Capsule', exact: true }).locator('.stash-tile__open')).toContainText('2 images');
});

test('taking the last image out reveals empty-stash deletion; undo restores its name and position and deletion survives reload', async ({ page }) => {
 await fixture(page); await card(page, 0).click(); await createBoardStash(page); await nameStash(page, 'Empty soon');
 const tile = page.getByRole('region', { name: 'Stash Empty soon', exact: true });
 await expect(tile.getByRole('button', { name: 'Delete empty stash Empty soon', exact: true })).toHaveCount(0);
 const board = (await page.getByRole('region', { name: 'Sorting board area' }).boundingBox())!;
 await dragOutToPoint(page, top(page, 'Empty soon', 0), { x: board.x + board.width * .85, y: board.y + board.height * .75 });
 await expect(card(page, 0)).toBeVisible();
 const remove = tile.getByRole('button', { name: 'Delete empty stash Empty soon', exact: true }); await expect(remove).toBeVisible();
 const before = (await tile.boundingBox())!, images = (await records(page)).images;
 await remove.click(); await expect(tile).toHaveCount(0); await expect(page.getByRole('button', { name: 'Undo delete stash', exact: true })).toBeEnabled();
 await page.keyboard.press('ControlOrMeta+z'); await expect(tile).toBeVisible();
 const restored = (await tile.boundingBox())!; expect(restored.x).toBeCloseTo(before.x, 0); expect(restored.y).toBeCloseTo(before.y, 0);
 await expect(remove).toBeVisible(); await remove.click(); await expect(tile).toHaveCount(0);
 await page.reload(); await page.getByRole('button', { name: 'Open sorting workspace' }).click(); await expect(tile).toHaveCount(0);
 expect((await records(page)).images.map(image => [image.id, image.categoryId, image.boardX, image.boardY])).toEqual(images.map(image => [image.id, image.categoryId, image.boardX, image.boardY]));
});

test('empty-stash deletion commits an inline name once and never offers to delete a parent with a sub-stash', async ({ page }) => {
 await fixture(page); await createBoardStash(page);
 await page.getByRole('textbox', { name: 'Stash name', exact: true }).fill('Typed name');
 await page.getByRole('button', { name: 'Delete empty stash New stash', exact: true }).click();
 await expect(page.locator('.stash-tile')).toHaveCount(0);
 await page.getByRole('button', { name: 'Undo delete stash', exact: true }).click();
 const parent = page.getByRole('region', { name: 'Stash Typed name', exact: true }); await expect(parent).toBeVisible();
 await page.getByRole('button', { name: 'Open stash Typed name', exact: true }).click();
 await createBoardStash(page); await nameStash(page, 'Child'); await navigateOverview(page);
 await expect(parent.getByRole('button', { name: 'Delete empty stash Typed name', exact: true })).toHaveCount(0);
 await expect(parent.locator('.stash-tile__open')).toContainText('0 images');
 await expect(parent.locator('.stash-tile__open')).toContainText('1 sub-stash');
 await parent.getByRole('button', { name: 'Browse stash Typed name', exact: true }).click();
 await expect(page.locator('[data-current-location]')).toHaveText('Typed name');
 await expect(page.getByRole('region', { name: 'Stash Typed name/Child', exact: true })).toBeVisible();
});

test('phone taps can delete a newly named empty stash and undo it without another tap', async ({ browser, baseURL, browserName }) => {
 test.skip(browserName === 'firefox', 'Mobile contexts are checked in Chromium and WebKit.');
 const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
 await context.route(/https:\/\/(huggingface\.co|cdn\.jsdelivr\.net)\//, route => route.abort());
 const page = await context.newPage();
 try {
  await fixture(page); await createBoardStash(page);
  await page.getByRole('textbox', { name: 'Stash name', exact: true }).fill('Phone empty');
  await page.getByRole('button', { name: 'Delete empty stash New stash', exact: true }).tap();
  await expect(page.locator('.stash-tile')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo delete stash', exact: true }).tap();
  const tile = page.getByRole('region', { name: 'Stash Phone empty', exact: true }); await expect(tile).toBeVisible();
  await expect(tile.getByRole('button', { name: 'Delete empty stash Phone empty', exact: true })).toBeVisible();
  await page.screenshot({ path: 'output/production-empty-stash-mobile.png' });
 } finally { await context.close(); }
});

test('newest images stay on top and drag out of closed stashes into the board, other stashes and pile with undo', async ({ page }) => {
 await fixture(page); await dragTo(page, card(page, 0), card(page, 1), 750); await page.mouse.up(); await nameStash(page, 'First');
 await expect(top(page, 'First', 0)).toBeVisible();
 const first = page.getByRole('region', { name: 'Stash First', exact: true }); await dragTo(page, card(page, 2), first); await page.mouse.up(); await expect(top(page, 'First', 2)).toBeVisible();
 const board = (await page.getByRole('region', { name: 'Sorting board area' }).boundingBox())!;
 const destination = { x: board.x + board.width * .78, y: board.y + board.height * .72 };
 await expect(top(page, 'First', 2).locator('img')).toBeVisible();
 await dragOutToPoint(page, top(page, 'First', 2), destination, { x: .2, y: .3 });
 await expect(card(page, 2)).toBeVisible(); await expect(first.locator('.stash-tile__open')).toContainText('2 images');
 await expect.poll(async () => { const box = (await card(page, 2).boundingBox())!; return Math.max(Math.abs(box.x + box.width * .2 - destination.x), Math.abs(box.y + box.height * .375 - destination.y)); }).toBeLessThan(3);
 expect((await records(page)).images.find(image => image.path === 'image-2.png')).toMatchObject({ categoryId: null, boardScope: null, placement: 'board' });
 await page.getByRole('button', { name: 'Undo removal' }).click(); await expect(top(page, 'First', 2)).toBeVisible();
 await createBoardStash(page); await nameStash(page, 'Second');
 const second = page.getByRole('region', { name: 'Stash Second', exact: true }); await dragTo(page, top(page, 'First', 2), second); await page.mouse.up(); await expect(top(page, 'Second', 2)).toBeVisible();
 await page.getByRole('button', { name: 'Undo stash move' }).click(); await expect(top(page, 'First', 2)).toBeVisible();
 const pile = (await page.getByRole('region', { name: 'Image browser', exact: true }).boundingBox())!;
 await dragOutToPoint(page, top(page, 'First', 2), { x: pile.x + 170, y: pile.y + pile.height - 40 });
 await expect(page.locator('.image-browser').getByRole('group', { name: /^Card: image-2\.png/ })).toBeVisible();
 expect((await records(page)).images.find(image => image.path === 'image-2.png')).toMatchObject({ categoryId: (await records(page)).stashes.find(stash => stash.name === 'First').id, placement: 'board' });
 await expect(top(page, 'First', 2)).toBeVisible();
 await page.reload(); await page.getByRole('button', { name: 'Open sorting workspace' }).click(); await expect(top(page, 'First', 2).locator('img')).toBeVisible();
 await page.screenshot({ path: '/tmp/foldersort-stash-top.png' });
});

test('nested stash images drag to their parent and Back takes opened contents out; layout remains after reload', async ({ page }) => {
 await fixture(page);
 for (const index of [0, 1, 2]) {
   await card(page, index).click(index ? { modifiers: ['Shift'] } : {});
   await expect(page.locator('.sorting-workspace__board .card.isSelected')).toHaveCount(index + 1);
 }
 await createBoardStash(page); await nameStash(page, 'Parent');
 await expect(page.getByRole('region', { name: 'Stash Parent', exact: true }).locator('.stash-tile__open')).toContainText('3 images');
 await page.getByRole('button', { name: 'Open stash Parent', exact: true }).click();
 const initial = await records(page); const prepared = initial.images.filter(image => image.categoryId === initial.stashes.find(stash => stash.name === 'Parent').id);
 expect(new Set(prepared.map(image => `${image.boardX}:${image.boardY}`)).size).toBe(3); expect(prepared.every(image => image.boardY === 120)).toBe(true);
 await dragTo(page, card(page, 0), card(page, 1), 750); await page.mouse.up(); await nameStash(page, 'Child');
 await expect(top(page, 'Parent/Child', 0)).toBeVisible(); const board = (await page.getByRole('region', { name: 'Sorting board area' }).boundingBox())!;
 await dragOutToPoint(page, top(page, 'Parent/Child', 0), { x: board.x + board.width * .8, y: board.y + board.height * .72 }); await expect(card(page, 0)).toBeVisible();
 const data = await records(page), parent = data.stashes.find(stash => stash.name === 'Parent'); expect(data.images.find(image => image.path === 'image-0.png').categoryId).toBe(parent.id);
 await page.getByRole('button', { name: 'Open stash Parent/Child', exact: true }).click();
 await dragTo(page, card(page, 1), page.getByRole('button', { name: 'Back to Parent', exact: true })); await expect(page.getByRole('button', { name: 'Back to Parent' })).toHaveClass(/is-stash-exit-target/); await page.mouse.up();
 await expect(page.locator('[data-current-location]')).toHaveText('Parent'); await expect(card(page, 1)).toBeInViewport({ ratio: .99 });
 expect((await records(page)).images.find(image => image.path === 'image-1.png').categoryId).toBe(parent.id);
 const before = (await records(page)).images.filter(image => image.categoryId === parent.id);
 await page.reload(); await page.getByRole('button', { name: 'Open sorting workspace' }).click(); await expect(page.locator('[data-current-location]')).toHaveText('Parent');
 expect((await records(page)).images.filter(image => image.categoryId === parent.id)).toEqual(before);
 await page.screenshot({ path: '/tmp/foldersort-stash-grid.png' });
});

test('cancelled and same-stash drops keep membership and top order; top click opens the stash', async ({ page }) => {
 await fixture(page); await card(page, 0).click(); await card(page, 1).click({ modifiers: ['Shift'] }); await createBoardStash(page); await nameStash(page, 'Keep');
 const before = (await records(page)).images; const preview = top(page, 'Keep', 1), box = (await preview.boundingBox())!;
 await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 15, box.y + box.height / 2 + 10, { steps: 5 }); await page.mouse.up();
 expect((await records(page)).images).toEqual(before);
 await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width + 120, box.y + 60, { steps: 10 });
 await preview.dispatchEvent('pointercancel', { pointerId: 1 }); await page.mouse.up(); expect((await records(page)).images).toEqual(before);
 await preview.evaluate(button => button.dispatchEvent(new PointerEvent('click', { pointerType: 'touch', detail: 0, bubbles: true }))); await expect(page.locator('[data-current-location]')).toHaveText('Root');
 await preview.click(); await expect(page.locator('[data-current-location]')).toHaveText('Keep'); await expect(page.locator('.sorting-workspace__board .card')).toHaveCount(2);
});

test('touch can take the top image directly out of a stash on a phone', async ({ browser, baseURL, browserName }) => {
 test.skip(browserName !== 'chromium', 'CDP exercises the native touch gesture.');
 const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
 await context.route(/https:\/\/(huggingface\.co|cdn\.jsdelivr\.net)\//, route => route.abort());
  const page = await context.newPage();
 await page.addInitScript(() => {
  const events: unknown[] = []; (window as any).__touchEvents = events;
  for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'touchstart', 'touchend', 'click']) document.addEventListener(type, event => {
   const target = event.target instanceof Element ? event.target.closest('button,[role=group]') : null;
   events.push({ type, label: target?.getAttribute('aria-label'), disabled: target instanceof HTMLButtonElement ? target.disabled : undefined, pointerType: (event as PointerEvent).pointerType, pointerId: (event as PointerEvent).pointerId, detail: (event as MouseEvent).detail, prevented: event.defaultPrevented });
   if (events.length > 50) events.shift();
  }, true);
 });
 try {
  await fixture(page); await page.getByRole('button', { name: 'Select multiple images' }).click(); await card(page, 0).tap(); await card(page, 1).tap(); await createBoardStash(page); await nameStash(page, 'Touch pop');
  const original = (await records(page)).images.find(image => image.path === 'image-1.png');
  const source = top(page, 'Touch pop', 1); await expect(source.locator('img')).toBeVisible(); await settle(source); const box = (await source.boundingBox())!;
  const destination = await page.getByRole('region', { name: 'Sorting board area' }).evaluate(pane => {
   const rect = pane.getBoundingClientRect();
   for (let y = rect.bottom - 30; y > rect.top + 30; y -= 40) for (let x = rect.right - 25; x > rect.left + 25; x -= 40) {
    if (!document.elementsFromPoint(x, y).some(element => element.closest('[data-stash-drop-id], .card, button'))) return { x, y };
   }
   throw new Error('No free board space');
  });
  const session = await context.newCDPSession(page), from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...from, id: 1 }] });
  for (let index = 1; index <= 14; index++) {
   await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (destination.x - from.x) * index / 14, y: from.y + (destination.y - from.y) * index / 14, id: 1 }] });
   await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
  }
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(card(page, 1)).toBeVisible(); expect((await records(page)).images.find(image => image.path === 'image-1.png').categoryId).toBeNull();
  await expect(page.locator('[data-current-location]')).toHaveText('Root');
  const undo = page.getByRole('button', { name: 'Undo removal' });
  await expect(undo).toBeInViewport(); await expect(undo).toBeEnabled();
  const undoBox = (await undo.boundingBox())!;
  // Keep the drag and following tap in the same native CDP touch stream.
  await session.send('Input.synthesizeTapGesture', { x: undoBox.x + undoBox.width / 2, y: undoBox.y + undoBox.height / 2, duration: 60, gestureSourceType: 'touch' });
  await expect.poll(async () => (await records(page)).images.find(image => image.path === 'image-1.png')).toMatchObject({ categoryId: original.categoryId, stashOrder: original.stashOrder, boardScope: original.boardScope });
  await expect(page.locator('[data-current-location]')).toHaveText('Root'); await expect(top(page, 'Touch pop', 1)).toBeVisible();
  await page.screenshot({ path: '/tmp/foldersort-stash-touch-pop.png' });
 } catch (cause) {
  console.log('Native touch failure', await page.evaluate(() => ({ events: (window as any).__touchEvents, location: document.querySelector('[data-current-location]')?.textContent, undo: document.querySelector('[data-action=undo]')?.outerHTML })));
  throw cause;
 } finally { await context.close(); }
});

test('quick overlap stays free; hold previews a stash and commits only on release; undo restores exact layout',async({page})=>{
 await fixture(page);const before=await records(page);
 await expect(page.getByRole('complementary',{name:'Categories'})).toHaveCount(0);await expect(page.getByRole('button',{name:'Linked board view'})).toHaveCount(0);
 await dragTo(page,card(page,0),card(page,1));await page.waitForTimeout(100);await page.mouse.up();
 await expect.poll(async()=> (await records(page)).stashes.length).toBe(0);
 expect((await records(page)).images.every(image=>image.categoryId===null)).toBe(true);
 // Separate the overlapping source again, then group it deliberately.
 await card(page,0).focus();await page.keyboard.press('Shift+ArrowLeft');await page.keyboard.press('Shift+ArrowLeft');await page.keyboard.press('Shift+ArrowLeft');await page.keyboard.press('Shift+ArrowLeft');await page.keyboard.press('Shift+ArrowLeft');
 await expect(page.locator('.sorting-workspace__save-state')).toHaveText('Saved');
 const groupingBefore=(await records(page)).images;
 await dragTo(page,card(page,0),card(page,1),750);
 await expect(page.locator('.stash-group-preview.is-ready')).toBeVisible();expect((await records(page)).stashes).toHaveLength(0);
 await page.screenshot({path:'/tmp/foldersort-stash-hold.png'});await page.mouse.up();
 await expect.poll(async()=> (await records(page)).stashes.length).toBe(1);await expect(page.getByRole('textbox',{name:'Stash name',exact:true})).toBeFocused();
 const saved=await records(page);expect(saved.images.filter(image=>image.categoryId===saved.stashes[0].id)).toHaveLength(2);
 await page.getByRole('button',{name:'Undo create stash'}).click();await expect.poll(async()=> (await records(page)).stashes.length).toBe(0);
 expect((await records(page)).images.map(i=>[i.id,i.categoryId,i.placement,i.boardX,i.boardY,i.boardScope])).toEqual(groupingBefore.map(i=>[i.id,i.categoryId,i.placement,i.boardX,i.boardY,i.boardScope]));
 expect(before.images).toHaveLength(7);
});

test('leaving a prepared target or cancelling a drag prevents grouping',async({page})=>{
 await fixture(page);await dragTo(page,card(page,0),card(page,1),750);await expect(page.locator('.stash-group-preview.is-ready')).toBeVisible();
 const b=(await card(page,2).boundingBox())!;await page.mouse.move(b.x+b.width+30,b.y+b.height+50,{steps:4});await page.mouse.up();
 expect((await records(page)).stashes).toHaveLength(0);
 await dragTo(page,card(page,0),card(page,1),750);await card(page,0).dispatchEvent('pointercancel');await page.mouse.up();
 expect((await records(page)).stashes).toHaveLength(0);
 await card(page,1).click();await createBoardStash(page);await nameStash(page,'Target');
 await fitBoard(page);
 const before=(await records(page)).images.find(i=>i.path==='image-0.png');await dragTo(page,card(page,0),page.getByRole('region',{name:'Stash Target',exact:true}),100);await card(page,0).dispatchEvent('pointercancel');await page.mouse.up();expect((await records(page)).images.find(i=>i.path==='image-0.png')).toMatchObject({ id:before.id,categoryId:before.categoryId,placement:before.placement,boardX:before.boardX,boardY:before.boardY,boardScope:before.boardScope });
});

test('creates two stashes, drops into one, navigates hierarchy, moves to Root and undoes, reloads and exports',async({page})=>{
 await fixture(page);
 await dragTo(page,card(page,0),card(page,1),750);await page.mouse.up();await nameStash(page,'First');
 const firstTile=page.getByRole('region',{name:'Stash First',exact:true});await expect(firstTile.locator('.stash-tile__open')).toContainText('2 images');
 await dragTo(page,card(page,2),firstTile);await page.mouse.up();await expect(firstTile.locator('.stash-tile__open')).toContainText('3 images');
 await page.getByRole('button',{name:'Open stash First',exact:true}).click();await expect(page.getByRole('navigation',{name:'Stash navigation'})).toContainText('First');await expect(page.locator('.sorting-workspace__board .card')).toHaveCount(3);
 await dragTo(page,card(page,0),card(page,1),750);await page.mouse.up();await nameStash(page,'Child');
 await expect(page.getByRole('region',{name:'Stash First/Child',exact:true}).locator('.stash-tile__open')).toContainText('2 images');
 await page.getByRole('button',{name:'Back to overview',exact:true}).click();await expect(firstTile.locator('.stash-tile__open')).toContainText('1 image');await expect(firstTile.locator('.stash-tile__open')).toContainText('1 sub-stash');
 await firstTile.getByRole('button', { name: 'Stash actions for First', exact: true }).click();
 await expect(firstTile.locator('.action-menu__panel')).toContainText('3 including sub-stashes'); await page.keyboard.press('Escape');
 await createBoardStash(page);await nameStash(page,'Second');
 await page.getByRole('button',{name:'Open stash First/Child'}).count().then(count=>expect(count).toBe(0));
 await page.getByRole('button',{name:'Open stash First',exact:true}).click();await page.getByRole('button',{name:'Open stash First/Child',exact:true}).click();
 await card(page,0).click();await page.getByRole('button',{name:'Move to stash…',exact:true}).click();const chooser=page.getByRole('dialog',{name:'Move to stash',exact:true});await chooser.getByRole('searchbox',{name:'Find stashes'}).fill('Second');await chooser.getByRole('button',{name:'Move image-0.png to Second',exact:true}).click();
 await navigateOverview(page);await page.getByRole('button',{name:'Open stash Second',exact:true}).click();await expect(card(page,0)).toBeVisible();
 const before=(await records(page)).images.find(i=>i.path==='image-0.png');
 await card(page,0).click();await page.getByRole('button',{name:'Move to stash…',exact:true}).click();await page.getByRole('dialog',{name:'Move to stash',exact:true}).getByRole('button',{name:/Unsorted/}).click();await expect(card(page,0)).toHaveCount(0);
 expect((await records(page)).images.find(i=>i.path==='image-0.png').categoryId).toBeNull();
 await page.getByRole('button',{name:'Undo removal'}).click();await expect(card(page,0)).toBeVisible();
 expect((await records(page)).images.find(i=>i.path==='image-0.png')).toMatchObject({boardX:before.boardX,boardY:before.boardY,boardScope:before.boardScope});
 await page.screenshot({path:'/tmp/foldersort-stash-open.png'});
 await page.reload();await page.getByRole('button',{name:'Open sorting workspace'}).click();await expect(page.getByRole('navigation',{name:'Stash navigation'})).toContainText('Second');await expect(card(page,0)).toBeVisible();
 const download=page.waitForEvent('download');await openWorkspaceExport(page);await page.getByRole('button',{name:'Export sorted ZIP'}).click();const zip=await JSZip.loadAsync(await fs.readFile(await (await download).path()));expect(Object.keys(zip.files).some(name=>name.endsWith('Second/image-0.png'))).toBe(true);
 const pngDownload=page.waitForEvent('download');await openWorkspaceExport(page);await page.getByRole('button',{name:'Save visible board'}).click();expect((await pngDownload).suggestedFilename()).toMatch(/\.png$/);
});

test('mobile selection creates and moves stashes without dragging, with reachable undo and back navigation',async({page})=>{
 await page.setViewportSize({width:390,height:844});await fixture(page);
 await page.getByRole('button',{name:'Select multiple images'}).click();await card(page,0).click();await card(page,1).click();
 await createBoardStash(page);await nameStash(page,'Mobile');
 await expect(page.getByRole('button',{name:'Undo create stash'})).toBeInViewport({ratio:1});await page.getByRole('button',{name:'Open stash Mobile',exact:true}).click();
 await expect(page.getByRole('button',{name:'Back to overview'})).toBeInViewport();await card(page,0).click();await page.getByRole('button',{name:'Move to stash…'}).click();
 const chooser=page.getByRole('dialog',{name:'Move to stash',exact:true});await expect(chooser.getByRole('searchbox',{name:'Find stashes'})).toBeFocused();await page.keyboard.press('Escape');await expect(chooser).toHaveCount(0);await page.getByRole('button',{name:'Move to stash…'}).click();await chooser.getByRole('button',{name:/Unsorted/}).click();await expect(page.getByRole('button',{name:'Undo removal'})).toBeInViewport({ratio:1});await page.getByRole('button',{name:'Undo removal'}).click();
 await page.screenshot({path:'/tmp/foldersort-stash-mobile.png'});
});

test('a selected batch groups together and the stash handle moves only its overview tile',async({page})=>{
 await fixture(page);await card(page,0).click();await expect(page.locator('.sorting-workspace__board .card.isSelected')).toHaveCount(1);await card(page,1).click({modifiers:['Shift']});await expect(page.locator('.sorting-workspace__board .card.isSelected')).toHaveCount(2);
 await dragTo(page,card(page,0),card(page,2),750);
 await expect(page.locator('.stash-group-preview.is-ready')).toContainText('3 images');
 await page.mouse.up();await nameStash(page,'Batch');
 const tile=page.getByRole('region',{name:'Stash Batch',exact:true});await expect(tile.locator('.stash-tile__open')).toContainText('3 images');const images=(await records(page)).images;
 const handle=page.getByRole('button',{name:'Move stash Batch',exact:true});await handle.focus();const before=(await tile.boundingBox())!;await page.keyboard.press('ArrowRight');await expect.poll(async()=> (await tile.boundingBox())!.x).toBeCloseTo(before.x+16,0);
 expect((await records(page)).images).toEqual(images);await page.getByRole('button',{name:'Open stash Batch'}).click();await expect(page.locator('.sorting-workspace__board .card')).toHaveCount(3);
 await page.getByRole('button',{name:'Back to overview'}).click();await expect.poll(async()=> (await tile.boundingBox())!.x).toBeCloseTo(before.x+16,0);
});

test('touch dragging can hold to group images without a mouse hover',async({browser,baseURL,browserName})=>{
 test.skip(browserName !== 'chromium', 'CDP is used to exercise a real touch drag; other engines run the selection and pointer tests.');
 const context=await browser.newContext({baseURL,viewport:{width:390,height:844},hasTouch:true,isMobile:true});const page=await context.newPage();
 try{
  await context.route(/https:\/\/(huggingface\.co|cdn\.jsdelivr\.net)\//, route => route.abort());
  await fixture(page);await settle(card(page,0));await settle(card(page,1));const a=(await card(page,0).boundingBox())!,b=(await card(page,1).boundingBox())!;
  const session=await context.newCDPSession(page);const from={x:a.x+a.width/2,y:a.y+a.height/2},to={x:b.x+b.width/2,y:b.y+b.height/2};
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...from,id:1}]});
  for(let i=1;i<=12;i++)await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:from.x+(to.x-from.x)*i/12,y:from.y+(to.y-from.y)*i/12,id:1}]});
  await expect(page.locator('.stash-group-preview.is-ready')).toBeVisible();expect((await records(page)).stashes).toHaveLength(0);
  const cue = (await page.locator('.stash-group-preview').boundingBox())!, pane = (await page.getByRole('region', { name: 'Sorting board area' }).boundingBox())!;
  expect(cue.x).toBeGreaterThanOrEqual(8); expect(cue.x + cue.width).toBeLessThanOrEqual(382);
  expect(cue.y + cue.height).toBeLessThanOrEqual(pane.y + pane.height - 7);
  const fingerOverlap = Math.max(0, Math.min(cue.x + cue.width, to.x + 36) - Math.max(cue.x, to.x - 36)) * Math.max(0, Math.min(cue.y + cue.height, to.y + 64) - Math.max(cue.y, to.y - 42));
  expect(fingerOverlap).toBe(0);
  expect(cue.y).toBeGreaterThanOrEqual(8);
  if (to.y - 56 - cue.height >= 8) expect(cue.y + cue.height).toBeLessThanOrEqual(to.y - 55);
  await page.screenshot({ path: '/tmp/foldersort-stash-touch-cue.png' });
  await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await expect.poll(async()=> (await records(page)).stashes.length).toBe(1);await nameStash(page,'Touch');
  await expect(page.getByRole('button',{name:'Undo create stash'})).toBeInViewport({ratio:1});await page.screenshot({path:'/tmp/foldersort-stash-touch.png'});
 }finally{await context.close()}
});

test('legacy Linked preferences preserve existing assignments and positions while opening the stash-only board',async({page})=>{
 await fixture(page);await card(page,0).click();await card(page,1).click({modifiers:['Shift']});await createBoardStash(page);await nameStash(page,'Existing');
 const before=await records(page);const id=before.images[0].projectId;
 await page.evaluate(({id,stash})=>localStorage.setItem(`folder-sort-board:${id}`,JSON.stringify({mode:'linked',anchors:{[stash]:{x:280,y:170}},expanded:[stash],autoNext:true})),{id,stash:before.stashes[0].id});
 await page.reload();await page.getByRole('button',{name:'Open sorting workspace'}).click();await expect(page.getByRole('button',{name:'Linked board view'})).toHaveCount(0);await expect(page.locator('.category-board__connections')).toHaveCount(0);await expect(page.getByRole('complementary',{name:'Categories'})).toHaveCount(0);
 expect((await records(page)).images).toEqual(before.images);await fitBoard(page);await page.getByRole('button',{name:'Open stash Existing'}).click();await expect(page.locator('.sorting-workspace__board .card')).toHaveCount(2);
});

test('outside images move into the open stash through intake and similarity, with membership undo',async({page})=>{
 await fixture(page);await card(page,0).click();await createBoardStash(page);await nameStash(page,'Destination');await page.getByRole('button',{name:'Open stash Destination'}).click();
 await page.locator('.image-browser').getByRole('group',{name:/^Card: image-1\.png/}).click();await page.locator('.image-browser').getByRole('button',{name:'Move here',exact:true}).click();
 const stash=(await records(page)).stashes[0];expect((await records(page)).images.find(i=>i.path==='image-1.png').categoryId).toBe(stash.id);await expect(card(page,1)).toBeVisible();
 await page.getByRole('button',{name:'Undo stash move'}).click();expect((await records(page)).images.find(i=>i.path==='image-1.png').categoryId).toBeNull();await expect(card(page,1)).toHaveCount(0);
 await card(page,0).click();await page.getByRole('button',{name:'Add similar to selected image'}).hover();await page.getByRole('button',{name:'Add similar images by color'}).click();
 await expect.poll(async()=>(await records(page)).images.filter(i=>i.categoryId===stash.id).length).toBe(4);
});

test('undoing a sub-stash from inside it returns to the parent and restores its images',async({page})=>{
 await fixture(page);await card(page,0).click();await card(page,1).click({modifiers:['Shift']});await createBoardStash(page);await nameStash(page,'Parent');await page.getByRole('button',{name:'Open stash Parent'}).click();
 await dragTo(page,card(page,0),card(page,1),750);await page.mouse.up();await nameStash(page,'Child');await page.getByRole('button',{name:'Open stash Parent/Child'}).click();await page.getByRole('button',{name:'Undo create stash'}).click();
 await expect(page.locator('[data-current-location]')).toHaveText('Parent');await expect(page.locator('.sorting-workspace__board .card')).toHaveCount(2);expect((await records(page)).stashes.map(s=>s.name)).toEqual(['Parent']);
});

test('opening a new stash puts distant images into its default arrangement',async({page})=>{
 await fixture(page);const data=await records(page);const projectId=data.images[0].projectId;
 await page.evaluate(async({projectId})=>{
  const db=await new Promise<IDBDatabase>(resolve=>{const request=indexedDB.open('sortboard-image-library-minimal',2);request.onsuccess=()=>resolve(request.result)});
  const transaction=db.transaction('images','readwrite'),store=transaction.objectStore('images');const request=store.getAll();request.onsuccess=()=>{for(const image of request.result){if(image.path==='image-0.png'||image.path==='image-1.png')store.put({...image,boardX:image.path==='image-0.png'?3200:3420,boardY:2400},image.id)}};
  await new Promise<void>(resolve=>{transaction.oncomplete=()=>resolve()});db.close();localStorage.setItem(`folder-sort-stash-view:${projectId}`,JSON.stringify({active:null,cameras:{root:{x:3400,y:2450,zoom:1}}}));
 },{projectId});
 await page.reload();await page.getByRole('button',{name:'Open sorting workspace'}).click();await dragTo(page,card(page,0),card(page,1),750);await page.mouse.up();await nameStash(page,'Distant');await page.getByRole('button',{name:'Open stash Distant'}).click();
 await expect(card(page,0)).toBeInViewport({ratio:.999});await expect(card(page,1)).toBeInViewport({ratio:.999});expect((await records(page)).images.filter(i=>i.path==='image-0.png'||i.path==='image-1.png').every(image=>image.boardY===120 && image.boardX<500)).toBe(true);
});

test('picking up a partly visible image keeps the board camera steady', async ({ page }) => {
 await fixture(page);
 await settle(card(page, 0));
 const point = await card(page, 0).evaluate(element => {
  const board = element.closest<HTMLElement>('[data-testid="board-root"]')!;
  const before = element.getBoundingClientRect(), pane = board.getBoundingClientRect();
  board.scrollLeft += before.left - pane.left + before.width * .75;
  (document.activeElement as HTMLElement)?.blur();
  const box = element.getBoundingClientRect();
  return { x: pane.left + 15, y: box.top + box.height / 2 };
 });
 const before = await page.getByTestId('board-root').evaluate(board => [board.scrollLeft, board.scrollTop]);
 await page.mouse.move(point.x, point.y); await page.mouse.down();
 await expect(card(page, 0)).toBeFocused();
 expect(await page.getByTestId('board-root').evaluate(board => [board.scrollLeft, board.scrollTop])).toEqual(before);
 await page.mouse.move(point.x + 20, point.y + 15); await page.mouse.up();
 expect(await page.getByTestId('board-root').evaluate(board => [board.scrollLeft, board.scrollTop])).toEqual(before);
});
