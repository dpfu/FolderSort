import type { LibraryCategory, LibraryImage } from './libraryStore';

export type ExportCategory = {
  name: string;
  path: string;
  imageCount: number;
  totalImageCount: number;
  children: ExportCategory[];
};

/** Export the complete hierarchy, independent of selection, search and collapse. */
export function categorySystem(project: string, categories: LibraryCategory[], images: LibraryImage[]) {
  const roots: ExportCategory[] = [];
  const nodes = new Map<string, ExportCategory>();
  const byId = new Map(categories.map(category => [category.id, category.name.toLocaleLowerCase()]));
  for (const category of categories) {
    let path = '';
    let children = roots;
    for (const name of category.name.split('/')) {
      path = path ? `${path}/${name}` : name;
      const key = path.toLocaleLowerCase();
      let node = nodes.get(key);
      if (!node) {
        node = { name, path, imageCount: 0, totalImageCount: 0, children: [] };
        nodes.set(key, node); children.push(node);
      }
      children = node.children;
    }
  }
  let unassignedImageCount = 0;
  for (const image of images) {
    const path = image.categoryId ? byId.get(image.categoryId) : undefined;
    const node = path ? nodes.get(path) : undefined;
    if (!node) { unassignedImageCount++; continue; }
    node.imageCount++;
    const parts = path!.split('/');
    for (let depth = 1; depth <= parts.length; depth++) nodes.get(parts.slice(0, depth).join('/'))!.totalImageCount++;
  }
  const sort = (children: ExportCategory[]) => {
    children.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    children.forEach(node => sort(node.children));
  };
  sort(roots);
  return { format: 'folder-sort-categories' as const, version: 1, project, imageCount: images.length, unassignedImageCount, categories: roots };
}

function markdownText(value: string) {
  return value.replace(/[\r\n]+/g, ' ').replace(/[\\`*_{}\[\]<>#|.!()+-]/g, '\\$&');
}

export function categoryMarkdown(system: ReturnType<typeof categorySystem>) {
  const lines = [`# ${markdownText(system.project)} — categories`, '',
    `${system.imageCount} images · ${system.unassignedImageCount} unassigned.`, '',
    'Counts show images assigned directly to each category; subcategories have their own counts.', ''];
  const visit = (categories: ExportCategory[], depth: number) => categories.forEach(category => {
    lines.push(`${'  '.repeat(depth)}- ${markdownText(category.name)} — ${category.imageCount} ${category.imageCount === 1 ? 'image' : 'images'}`);
    visit(category.children, depth + 1);
  });
  visit(system.categories, 0);
  if (!system.categories.length) lines.push('No categories yet.');
  return `${lines.join('\n')}\n`;
}
