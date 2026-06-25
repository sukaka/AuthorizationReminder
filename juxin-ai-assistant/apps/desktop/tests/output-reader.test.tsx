import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';

import { OutputReader, plainBusinessText } from '../src/components/OutputReader';

it('renders markdown-looking model output as clean business text', () => {
  render(
    <OutputReader
      emptyText="暂无内容"
      text={[
        '**75分（满分100分）**',
        '',
        '**8. 评分依据**',
        '',
        '* **行业匹配度（20/20）**：网络安全行业，客户群匹配。',
        '* **预算可行性（10/20）**：预算紧张，需要引导高性价比方案。',
        '',
        '---',
        '',
        '## 9. 建议跟进级别',
        '',
        '**A级（重点跟进）**',
      ].join('\n')}
    />,
  );

  expect(screen.getByText('75分（满分100分）')).toBeInTheDocument();
  expect(screen.getByText('8. 评分依据')).toBeInTheDocument();
  expect(screen.getByText('行业匹配度（20/20）：网络安全行业，客户群匹配。')).toBeInTheDocument();
  expect(screen.getByText('预算可行性（10/20）：预算紧张，需要引导高性价比方案。')).toBeInTheDocument();
  expect(screen.getByText('9. 建议跟进级别')).toBeInTheDocument();
  expect(screen.getByText('A级（重点跟进）')).toBeInTheDocument();
  expect(screen.queryByText(/\*\*/)).not.toBeInTheDocument();
  expect(screen.queryByText(/^---$/)).not.toBeInTheDocument();
});

it('returns plain copy-friendly business text without markdown markers', () => {
  expect(plainBusinessText('## 标题\n\n* **动作**：马上跟进')).toBe('标题\n\n动作：马上跟进');
});
