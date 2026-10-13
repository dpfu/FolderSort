import { test, expect, type Page, type Locator } from '@playwright/test';
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
  await page.getByRole('combobox',{name:'Pile order'}).selectOption('name');
  await page.getByRole('button',{name:'Add up to 3 images here'}).first().click();
  await expect(page.locator('.sorting-workspace__board .card')).toHaveCount(3);
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
  await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:12});
  if(hold)await page.waitForTimeout(hold);
}
async function nameStash(page:Page,name:string){const input=page.getByRole('textbox',{name:'Stash name',exact:true});await input.fill(name);await input.press('Enter');await expect(input).toHaveCount(0);}

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
 await expect(page.getByRole('status',{name:'Release to create stash'})).toBeVisible();expect((await records(page)).stashes).toHaveLength(0);
 await page.screenshot({path:'/tmp/foldersort-stash-hold.png'});await page.mouse.up();
 await expect.poll(async()=> (await records(page)).stashes.length).toBe(1);await expect(page.getByRole('textbox',{name:'Stash name',exact:true})).toBeFocused();
 const saved=await records(page);expect(saved.images.filter(image=>image.categoryId===saved.stashes[0].id)).toHaveLength(2);
 await page.getByRole('button',{name:'Undo create stash'}).click();await expect.poll(async()=> (await records(page)).stashes.length).toBe(0);
 expect((await records(page)).images.map(i=>[i.id,i.categoryId,i.placement,i.boardX,i.boardY,i.boardScope])).toEqual(groupingBefore.map(i=>[i.id,i.categoryId,i.placement,i.boardX,i.boardY,i.boardScope]));
 expect(before.images).toHaveLength(7);
});

test('leaving a prepared target or cancelling a drag prevents grouping',async({page})=>{
 await fixture(page);await dragTo(page,card(page,0),card(page,1),750);await expect(page.getByRole('status',{name:'Release to create stash'})).toBeVisible();
 const b=(await card(page,2).boundingBox())!;await page.mouse.move(b.x+b.width+30,b.y+b.height+50,{steps:4});await page.mouse.up();
 expect((await records(page)).stashes).toHaveLength(0);
 await dragTo(page,card(page,0),card(page,1),750);await card(page,0).dispatchEvent('pointercancel');await page.mouse.up();
 expect((await records(page)).stashes).toHaveLength(0);
 await card(page,1).click();await page.locator('.stash-selection').getByRole('button',{name:'Create stash',exact:true}).click();await nameStash(page,'Target');
 const before=(await records(page)).images.find(i=>i.path==='image-0.png');await dragTo(page,card(page,0),page.getByRole('region',{name:'Stash Target',exact:true}),100);await card(page,0).dispatchEvent('pointercancel');await page.mouse.up();expect((await records(page)).images.find(i=>i.path==='image-0.png')).toMatchObject({ id:before.id,categoryId:before.categoryId,placement:before.placement,boardX:before.boardX,boardY:before.boardY,boardScope:before.boardScope });
});

test('creates two stashes, drops into one, navigates hierarchy, moves an image, clears and restores, reloads and exports',async({page})=>{
 await fixture(page);
 await dragTo(page,card(page,0),card(page,1),750);await page.mouse.up();await nameStash(page,'First');
 const firstTile=page.getByRole('region',{name:'Stash First',exact:true});await expect(firstTile).toContainText('2 images here');
 await dragTo(page,card(page,2),firstTile);await page.mouse.up();await expect(firstTile).toContainText('3 images here');
 await page.getByRole('button',{name:'Open stash First',exact:true}).click();await expect(page.getByRole('navigation',{name:'Stash navigation'})).toContainText('First');await expect(page.locator('.sorting-workspace__board .card')).toHaveCount(3);
 await dragTo(page,card(page,0),card(page,1),750);await page.mouse.up();await nameStash(page,'Child');
 await expect(page.getByRole('region',{name:'Stash First/Child',exact:true})).toContainText('2 images here');
 await page.getByRole('button',{name:'Back to overview',exact:true}).click();await expect(firstTile).toContainText('1 image here');await expect(firstTile).toContainText('3 including 1 sub-stash');
 await page.getByRole('button',{name:'Create stash',exact:true}).click();await nameStash(page,'Second');
 await page.getByRole('button',{name:'Open stash First/Child'}).count().then(count=>expect(count).toBe(0));
 await page.getByRole('button',{name:'Open stash First',exact:true}).click();await page.getByRole('button',{name:'Open stash First/Child',exact:true}).click();
 await card(page,0).click();await page.getByRole('button',{name:'Move to stash…',exact:true}).click();const chooser=page.getByRole('dialog',{name:'Move to stash',exact:true});await chooser.getByRole('searchbox',{name:'Find stashes'}).fill('Second');await chooser.getByRole('button',{name:'Move image-0.png to Second',exact:true}).click();
 await page.getByRole('navigation',{name:'Stash navigation'}).getByRole('button',{name:'Overview',exact:true}).click();await page.getByRole('button',{name:'Open stash Second',exact:true}).click();await expect(card(page,0)).toBeVisible();
 const before=(await records(page)).images.find(i=>i.path==='image-0.png');
 await page.locator('.board-tools summary').click();await page.getByRole('button',{name:'Clear board',exact:true}).click();await expect(card(page,0)).toHaveCount(0);
 expect((await records(page)).images.find(i=>i.path==='image-0.png').categoryId).toBe(before.categoryId);
 await page.getByRole('button',{name:'Undo clear'}).click();await expect(card(page,0)).toBeVisible();
 expect((await records(page)).images.find(i=>i.path==='image-0.png')).toMatchObject({boardX:before.boardX,boardY:before.boardY,boardScope:before.boardScope});
 await page.screenshot({path:'/tmp/foldersort-stash-open.png'});
 await page.reload();await page.getByRole('button',{name:'Open sorting workspace'}).click();await expect(page.getByRole('navigation',{name:'Stash navigation'})).toContainText('Second');await expect(card(page,0)).toBeVisible();
 const download=page.waitForEvent('download');await page.locator('.sorting-workspace__utilities > .export-menu').first().locator('summary').click();await page.getByRole('button',{name:'Export sorted ZIP'}).click();const zip=await JSZip.loadAsync(await fs.readFile(await (await download).path()));expect(Object.keys(zip.files).some(name=>name.endsWith('Second/image-0.png'))).toBe(true);
 const pngDownload=page.waitForEvent('download');await page.locator('.sorting-workspace__utilities > .export-menu').first().locator('summary').click();await page.getByRole('button',{name:'Save visible board'}).click();expect((await pngDownload).suggestedFilename()).toMatch(/\.png$/);
});

test('mobile selection creates and moves stashes without dragging, with reachable undo and back navigation',async({page})=>{
 await page.setViewportSize({width:390,height:844});await fixture(page);
 await page.getByRole('button',{name:'Select multiple images'}).click();await card(page,0).click();await card(page,1).click();
 await page.locator('.stash-selection').getByRole('button',{name:'Create stash',exact:true}).click();await nameStash(page,'Mobile');
 await expect(page.getByRole('button',{name:'Undo create stash'})).toBeInViewport({ratio:1});await page.getByRole('button',{name:'Open stash Mobile',exact:true}).click();
 await expect(page.getByRole('button',{name:'Back to overview'})).toBeInViewport();await card(page,0).click();await page.getByRole('button',{name:'Move to stash…'}).click();
 const chooser=page.getByRole('dialog',{name:'Move to stash',exact:true});await expect(chooser.getByRole('searchbox',{name:'Find stashes'})).toBeFocused();await page.keyboard.press('Escape');await expect(chooser).toHaveCount(0);await page.getByRole('button',{name:'Move to stash…'}).click();await chooser.getByRole('button',{name:/Unsorted/}).click();await expect(page.getByRole('button',{name:'Undo removal'})).toBeInViewport({ratio:1});await page.getByRole('button',{name:'Undo removal'}).click();
 await page.screenshot({path:'/tmp/foldersort-stash-mobile.png'});
});

test('a selected batch groups together and the stash handle moves only its overview tile',async({page})=>{
 await fixture(page);await card(page,0).click();await card(page,1).click({modifiers:['Shift']});
 await dragTo(page,card(page,0),card(page,2),750);await expect(page.getByRole('status',{name:'Release to create stash'})).toContainText('3 images');await page.mouse.up();await nameStash(page,'Batch');
 const tile=page.getByRole('region',{name:'Stash Batch',exact:true});await expect(tile).toContainText('3 images here');const images=(await records(page)).images;
 const handle=page.getByRole('button',{name:'Move stash Batch',exact:true});await handle.focus();const before=(await tile.boundingBox())!;await page.keyboard.press('ArrowRight');await expect.poll(async()=> (await tile.boundingBox())!.x).toBeCloseTo(before.x+16,0);
 expect((await records(page)).images).toEqual(images);await page.getByRole('button',{name:'Open stash Batch'}).click();await expect(page.locator('.sorting-workspace__board .card')).toHaveCount(3);
 await page.getByRole('button',{name:'Back to overview'}).click();await expect.poll(async()=> (await tile.boundingBox())!.x).toBeCloseTo(before.x+16,0);
});

test('touch dragging can hold to group images without a mouse hover',async({browser,baseURL,browserName})=>{
 test.skip(browserName !== 'chromium', 'CDP is used to exercise a real touch drag; other engines run the selection and pointer tests.');
 const context=await browser.newContext({baseURL,viewport:{width:390,height:844},hasTouch:true,isMobile:true});const page=await context.newPage();
 try{
  await fixture(page);await settle(card(page,0));await settle(card(page,1));const a=(await card(page,0).boundingBox())!,b=(await card(page,1).boundingBox())!;
  const session=await context.newCDPSession(page);const from={x:a.x+a.width/2,y:a.y+a.height/2},to={x:b.x+b.width/2,y:b.y+b.height/2};
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...from,id:1}]});
  for(let i=1;i<=12;i++)await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:from.x+(to.x-from.x)*i/12,y:from.y+(to.y-from.y)*i/12,id:1}]});
  await expect(page.getByRole('status',{name:'Release to create stash'})).toBeVisible();expect((await records(page)).stashes).toHaveLength(0);
  await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await expect.poll(async()=> (await records(page)).stashes.length).toBe(1);await nameStash(page,'Touch');
  await expect(page.getByRole('button',{name:'Undo create stash'})).toBeInViewport({ratio:1});await page.screenshot({path:'/tmp/foldersort-stash-touch.png'});
 }finally{await context.close()}
});

test('legacy Linked preferences preserve existing assignments and positions while opening the stash-only board',async({page})=>{
 await fixture(page);await card(page,0).click();await card(page,1).click({modifiers:['Shift']});await page.locator('.stash-selection').getByRole('button',{name:'Create stash',exact:true}).click();await nameStash(page,'Existing');
 const before=await records(page);const id=before.images[0].projectId;
 await page.evaluate(({id,stash})=>localStorage.setItem(`folder-sort-board:${id}`,JSON.stringify({mode:'linked',anchors:{[stash]:{x:280,y:170}},expanded:[stash],autoNext:true})),{id,stash:before.stashes[0].id});
 await page.reload();await page.getByRole('button',{name:'Open sorting workspace'}).click();await expect(page.getByRole('button',{name:'Linked board view'})).toHaveCount(0);await expect(page.locator('.category-board__connections')).toHaveCount(0);await expect(page.getByRole('complementary',{name:'Categories'})).toHaveCount(0);
 expect((await records(page)).images).toEqual(before.images);await page.getByRole('button',{name:'Open stash Existing'}).click();await expect(page.locator('.sorting-workspace__board .card')).toHaveCount(2);
});

test('outside images are comparison candidates until explicitly moved into the open stash',async({page})=>{
 await fixture(page);await card(page,0).click();await page.locator('.stash-selection').getByRole('button',{name:'Create stash',exact:true}).click();await nameStash(page,'Compare');await page.getByRole('button',{name:'Open stash Compare'}).click();
 await page.getByRole('button',{name:'Browse project'}).click();const overview=page.getByRole('dialog',{name:'Explore image pile',exact:true});await overview.getByRole('checkbox',{name:'Select image-1.png',exact:true}).click();await overview.getByRole('button',{name:'Add 1 to board',exact:true}).click();
 const stash=(await records(page)).stashes[0];const candidate=(await records(page)).images.find(i=>i.path==='image-1.png');expect(candidate.categoryId).toBeNull();expect(candidate.boardScope).toBe(stash.id);await card(page,1).click();await expect(page.locator('.stash-selection')).toContainText('From Unsorted');
 await page.getByRole('button',{name:'Return selected images to pile'}).click();await expect(card(page,1)).toHaveCount(0);expect((await records(page)).images.find(i=>i.path==='image-1.png').categoryId).toBeNull();await page.getByRole('button',{name:'Undo clear'}).click();await expect(card(page,1)).toBeVisible();
 await card(page,1).click();await page.getByRole('button',{name:'Move into this stash'}).click();await expect.poll(async()=> (await records(page)).images.find(i=>i.path==='image-1.png').categoryId).toBe(stash.id);
 await page.getByRole('button',{name:'Undo stash move'}).click();expect((await records(page)).images.find(i=>i.path==='image-1.png').categoryId).toBeNull();await expect(card(page,1)).toBeVisible();
 const beforeSimilar=(await records(page)).images;await page.getByRole('button',{name:'1 image per add'}).click();await card(page,0).click();await page.getByRole('button',{name:'Add similar to selected image'}).hover();await page.getByRole('button',{name:'Add similar images by color'}).click();await expect(page.locator('.sorting-workspace__board .card')).toHaveCount(3);expect((await records(page)).images.map(i=>i.categoryId)).toEqual(beforeSimilar.map(i=>i.categoryId));
});

test('undoing a sub-stash from inside it returns to the parent and restores its images',async({page})=>{
 await fixture(page);await card(page,0).click();await card(page,1).click({modifiers:['Shift']});await page.locator('.stash-selection').getByRole('button',{name:'Create stash',exact:true}).click();await nameStash(page,'Parent');await page.getByRole('button',{name:'Open stash Parent'}).click();
 await dragTo(page,card(page,0),card(page,1),750);await page.mouse.up();await nameStash(page,'Child');await page.getByRole('button',{name:'Open stash Parent/Child'}).click();await page.getByRole('button',{name:'Undo create stash'}).click();
 await expect(page.getByRole('navigation',{name:'Stash navigation'}).getByRole('button',{name:'Parent',exact:true})).toHaveAttribute('aria-current','page');await expect(page.locator('.sorting-workspace__board .card')).toHaveCount(2);expect((await records(page)).stashes.map(s=>s.name)).toEqual(['Parent']);
});

test('opening a new stash finds images from a distant part of the board without rearranging them',async({page})=>{
 await fixture(page);const data=await records(page);const projectId=data.images[0].projectId;
 await page.evaluate(async({projectId})=>{
  const db=await new Promise<IDBDatabase>(resolve=>{const request=indexedDB.open('sortboard-image-library-minimal',2);request.onsuccess=()=>resolve(request.result)});
  const transaction=db.transaction('images','readwrite'),store=transaction.objectStore('images');const request=store.getAll();request.onsuccess=()=>{for(const image of request.result){if(image.path==='image-0.png'||image.path==='image-1.png')store.put({...image,boardX:image.path==='image-0.png'?3200:3420,boardY:2400},image.id)}};
  await new Promise<void>(resolve=>{transaction.oncomplete=()=>resolve()});db.close();localStorage.setItem(`folder-sort-stash-view:${projectId}`,JSON.stringify({active:null,cameras:{root:{x:3400,y:2450,zoom:1}}}));
 },{projectId});
 await page.reload();await page.getByRole('button',{name:'Open sorting workspace'}).click();await dragTo(page,card(page,0),card(page,1),750);await page.mouse.up();await nameStash(page,'Distant');await page.getByRole('button',{name:'Open stash Distant'}).click();
 await expect(card(page,0)).toBeInViewport({ratio:.999});await expect(card(page,1)).toBeInViewport({ratio:.999});expect((await records(page)).images.find(i=>i.path==='image-0.png')).toMatchObject({boardX:3200,boardY:2400});expect((await records(page)).images.find(i=>i.path==='image-1.png')).toMatchObject({boardX:3420,boardY:2400});
});
