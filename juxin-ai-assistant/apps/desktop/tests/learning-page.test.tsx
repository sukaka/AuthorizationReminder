import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { expect, it } from 'vitest';

import { LearningPage } from '../src/pages/LearningPage';
import { server } from './setup';

it('shows persisted answer feedback in the learning center', async () => {
  server.use(
    http.get('/api/learning/memories', () => HttpResponse.json({ items: [], total: 0 })),
    http.get('/api/learning/experiences', () => HttpResponse.json({ items: [], total: 0 })),
    http.get('/api/learning/templates', () => HttpResponse.json({ items: [], total: 0 })),
    http.get('/api/learning/failure-cases', () => HttpResponse.json({ items: [], total: 0 })),
    http.get('/api/learning/feedback', () => HttpResponse.json({
      items: [{
        uuid: 'fb-1',
        conversation_id: 'conv-1',
        message_id: 'msg-1',
        feedback_type: 'save_experience',
        comment: '这个回答后续复用',
        saved_as: 'experience',
        created_at: '2026-07-05T08:00:00Z',
      }],
      total: 1,
    })),
  );

  render(<LearningPage />);

  await userEvent.click(await screen.findByRole('button', { name: '反馈记录' }));

  expect(screen.getByText('这个回答后续复用')).toBeInTheDocument();
  expect(screen.getByText('保存为经验')).toBeInTheDocument();
  expect(screen.getByText('已沉淀为经验')).toBeInTheDocument();
  expect(screen.getByText(/conv-1/)).toBeInTheDocument();
});
