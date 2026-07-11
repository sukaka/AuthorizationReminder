import type { KnowledgeCategoryPayload } from '../api/chat';

export type KnowledgeCategoryOption = {
  label: string;
  value: string;
  level: number;
  path: string;
};

function sortCategories(categories: KnowledgeCategoryPayload[]): KnowledgeCategoryPayload[] {
  return [...categories].sort((first, second) => (
    first.sort_order - second.sort_order || first.name.localeCompare(second.name, 'zh-Hans-CN')
  ));
}

function optionLabel(name: string, level: number): string {
  return level > 0 ? `${'　'.repeat(level)}└ ${name}` : name;
}

export function buildKnowledgeCategoryOptions(
  categories: KnowledgeCategoryPayload[],
  currentValue = '',
  fallbackNames: string[] = [],
): KnowledgeCategoryOption[] {
  const activeCategories = sortCategories(
    categories.filter((category) => category.status === 'ACTIVE'),
  );
  const categoryIds = new Set(activeCategories.map((category) => category.category_id));
  const childrenByParent = new Map<string, KnowledgeCategoryPayload[]>();
  activeCategories.forEach((category) => {
    if (!category.parent_category_id || !categoryIds.has(category.parent_category_id)) return;
    const children = childrenByParent.get(category.parent_category_id) || [];
    children.push(category);
    childrenByParent.set(category.parent_category_id, children);
  });
  childrenByParent.forEach((children, parentId) => {
    childrenByParent.set(parentId, sortCategories(children));
  });

  const options: KnowledgeCategoryOption[] = [];
  const visited = new Set<string>();
  const append = (category: KnowledgeCategoryPayload, level: number, parentPath: string[]) => {
    if (visited.has(category.category_id)) return;
    visited.add(category.category_id);
    const path = [...parentPath, category.name];
    options.push({
      label: optionLabel(category.name, level),
      value: category.name,
      level,
      path: path.join(' / '),
    });
    (childrenByParent.get(category.category_id) || []).forEach((child) => {
      append(child, level + 1, path);
    });
  };

  activeCategories
    .filter((category) => !category.parent_category_id || !categoryIds.has(category.parent_category_id))
    .forEach((category) => append(category, 0, []));
  activeCategories.forEach((category) => append(category, 0, []));

  if (!options.length) {
    fallbackNames.forEach((name) => {
      if (!name || options.some((option) => option.value === name)) return;
      options.push({ label: name, value: name, level: 0, path: name });
    });
  }
  if (currentValue && !options.some((option) => option.value === currentValue)) {
    options.unshift({ label: currentValue, value: currentValue, level: 0, path: currentValue });
  }
  return options;
}

export function getKnowledgeCategoryPath(
  categories: KnowledgeCategoryPayload[],
  selectedName: string,
): string {
  if (!selectedName) return '';
  return buildKnowledgeCategoryOptions(categories).find((option) => option.value === selectedName)?.path
    || selectedName;
}
