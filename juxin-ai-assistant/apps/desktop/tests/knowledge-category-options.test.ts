import { describe, expect, it } from 'vitest';

import type { KnowledgeCategoryPayload } from '../src/api/chat';
import {
  buildKnowledgeCategoryOptions,
  getKnowledgeCategoryPath,
} from '../src/components/knowledgeCategoryOptions';

function category(
  categoryId: string,
  name: string,
  options: Partial<KnowledgeCategoryPayload> = {},
): KnowledgeCategoryPayload {
  return {
    category_id: categoryId,
    name,
    parent_category_id: '',
    parent_name: '',
    scope: 'company',
    sort_order: 10,
    status: 'ACTIVE',
    file_count: 0,
    created_at: '',
    updated_at: '',
    ...options,
  };
}

describe('knowledge category options', () => {
  it('orders parents before children and preserves child values', () => {
    const options = buildKnowledgeCategoryOptions([
      category('child', 'WDSP', {
        parent_category_id: 'parent',
        parent_name: '产品资料',
        sort_order: 20,
      }),
      category('other', '公司制度', { sort_order: 5 }),
      category('parent', '产品资料', { sort_order: 10 }),
    ]);

    expect(options).toEqual([
      expect.objectContaining({ label: '公司制度', value: '公司制度', level: 0 }),
      expect.objectContaining({ label: '产品资料', value: '产品资料', level: 0 }),
      expect.objectContaining({ label: '　└ WDSP', value: 'WDSP', level: 1 }),
    ]);
  });

  it('excludes disabled categories and includes a selected legacy value once', () => {
    const options = buildKnowledgeCategoryOptions([
      category('active', '产品资料'),
      category('disabled', '旧资料', { status: 'DISABLED' }),
    ], '历史分类');

    expect(options.map((item) => item.value)).toEqual(['历史分类', '产品资料']);
  });

  it('returns the complete parent path for a selected child', () => {
    const categories = [
      category('parent', '产品资料'),
      category('child', 'WDSP', {
        parent_category_id: 'parent',
        parent_name: '产品资料',
      }),
    ];

    expect(getKnowledgeCategoryPath(categories, 'WDSP')).toBe('产品资料 / WDSP');
    expect(getKnowledgeCategoryPath(categories, '产品资料')).toBe('产品资料');
  });
});
