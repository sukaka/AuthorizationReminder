import { describe, expect, it } from 'vitest';

import governance from '../src/governance.js';

const {
  buildPermissionSummary,
  buildGovernancePayload,
  buildFailurePayload,
} = governance;

describe('governance helpers', () => {
  it('builds permission and governance payloads with menu page and button scopes', () => {
    const summary = buildPermissionSummary({ id: 2, username: 'editor', role: 'editor' });
    expect(summary.can_read).toBe(true);
    expect(summary.can_write).toBe(true);
    expect(summary.can_config_manage).toBe(false);
    expect(summary.menu_permissions).toContain('bids');
    expect(summary.page_permissions).toContain('bid.parse.workspace');
    expect(summary.button_permissions).toContain('parse.start');
    expect(summary.button_permissions).not.toContain('config.save');

    const payload = buildGovernancePayload({ id: 2, username: 'editor', role: 'editor' });
    expect(payload.current_role).toBe('editor');
    expect(payload.data_scope.mode).toBe('OWNED_OR_ASSIGNED');
    expect(payload.menu_permissions).toContain('risk-center');
    expect(payload.button_permissions).toContain('bid.member.assign');
    expect(payload.permission_matrix.admin.page_permissions).toContain('config.center');
    expect(payload.permission_matrix.auditor.menu_permissions).toEqual(['audit']);
  });

  it('builds structured failure payload and failure log summary for retryable upstream errors', () => {
    const err = Object.assign(new Error('模型调用超时'), {
      code: 'TENDER_AI_UPSTREAM_TIMEOUT',
      retryable: true,
      manual_takeover: {
        action: '请稍后重试或切换备用模型',
        target: 'ai_model',
      },
      details: {
        upstream_status: 504,
      },
    });

    const result = buildFailurePayload({
      err,
      path: '/api/tender/bids/18/generate',
      method: 'POST',
    });

    expect(result.status).toBe(500);
    expect(result.payload.code).toBe('TENDER_AI_UPSTREAM_TIMEOUT');
    expect(result.payload.category).toBe('GENERATE');
    expect(result.payload.retryable).toBe(true);
    expect(result.payload.manual_takeover?.target).toBe('ai_model');
    expect(result.payload.details?.upstream_status).toBe(504);
    expect(result.failure_log.action).toBe('REQUEST_FAIL');
    expect(result.failure_log.entity).toBe('POST /api/tender/bids/18/generate');
    expect(result.failure_log.afterData.code).toBe('TENDER_AI_UPSTREAM_TIMEOUT');
    expect(result.failure_log.afterData.retryable).toBe(true);
  });
});
