import { describe, expect, it } from 'vitest';

import opsCenter from '../src/ops-center.js';

const {
  buildRiskProjectRow,
  buildRiskCenterOverview,
  sanitizeExportRecordRow,
  buildExportCenterOverview,
  buildTemplateReferenceConflictMessage,
} = opsCenter;

describe('ops center helpers', () => {
  it('builds a high-risk project row from materials pending, check issues, and export failure', () => {
    const row = buildRiskProjectRow({
      bid: {
        id: 11,
        bid_no: 'TB-20260308-0001',
        title: '网络安全服务标书',
        project_name: '政务云安全运营项目',
        status: 'MATERIALS_PENDING',
        updated_at: '2026-03-08 10:00:00',
      },
      latestParseJob: {
        id: 31,
        status: 'SUCCESS',
        warning_text: '评分项提取存在 2 条待人工复核提示',
        updated_at: '2026-03-08 09:30:00',
      },
      latestDraftCheckRun: {
        id: 41,
        summary_json: JSON.stringify({
          issue_count: 4,
          fatal_count: 1,
          warn_count: 3,
        }),
        created_at: '2026-03-08 09:50:00',
      },
      latestExportRecord: {
        id: 51,
        export_type: 'PDF',
        status: 'FAILED',
        created_at: '2026-03-08 09:55:00',
      },
    });

    expect(row.bid_id).toBe(11);
    expect(row.risk_level).toBe('HIGH');
    expect(row.risk_label).toBe('高');
    expect(row.fatal_count).toBe(1);
    expect(row.warn_count).toBe(3);
    expect(row.risk_sources).toContain('待补资料');
    expect(row.risk_sources).toContain('成稿校验');
    expect(row.risk_sources).toContain('导出失败');
    expect(row.recommended_action).toBe('补齐资料并先处理致命校验问题');
  });

  it('aggregates risk center overview counts from project rows', () => {
    const overview = buildRiskCenterOverview([
      {
        bid_id: 1,
        status: 'MATERIALS_PENDING',
        risk_level: 'HIGH',
        latest_export_status: 'FAILED',
      },
      {
        bid_id: 2,
        status: 'COMPILE_REVIEW_PENDING',
        risk_level: 'MEDIUM',
        latest_export_status: 'SUCCESS',
      },
      {
        bid_id: 3,
        status: 'EXPORT_READY',
        risk_level: 'LOW',
        latest_export_status: '',
      },
    ]);

    expect(overview.total_projects).toBe(3);
    expect(overview.high_risk_projects).toBe(1);
    expect(overview.medium_risk_projects).toBe(1);
    expect(overview.materials_pending_projects).toBe(1);
    expect(overview.review_pending_projects).toBe(1);
    expect(overview.export_failed_records).toBe(1);
  });

  it('normalizes export record rows with stable type, status and payload shape', () => {
    const row = sanitizeExportRecordRow({
      id: 91,
      bid_id: 19,
      version_id: 7,
      draft_id: 5,
      export_type: 'package',
      status: 'success',
      file_name: '政务云安全运营项目-导出包.zip',
      mime_type: 'application/zip',
      file_size: '2048',
      payload_json: '{"format":"PACKAGE","includeRiskReport":true}',
      created_by_name: 'admin',
      created_at: '2026-03-08 11:00:00',
    });

    expect(row.export_type).toBe('PACKAGE');
    expect(row.status).toBe('SUCCESS');
    expect(row.file_size).toBe(2048);
    expect(row.payload.format).toBe('PACKAGE');
    expect(row.payload.includeRiskReport).toBe(true);
  });

  it('builds export center overview from project and record lists', () => {
    const overview = buildExportCenterOverview({
      projectRows: [
        { bid_id: 1, status: 'EXPORT_READY' },
        { bid_id: 2, status: 'EXPORTED' },
        { bid_id: 3, status: 'ARCHIVED' },
      ],
      exportRecords: [
        { id: 1, status: 'SUCCESS', created_at: '2026-03-08 11:00:00' },
        { id: 2, status: 'FAILED', created_at: '2026-03-08 12:00:00' },
        { id: 3, status: 'SUCCESS', created_at: '2026-03-01 12:00:00' },
      ],
      now: '2026-03-08T12:30:00.000Z',
    });

    expect(overview.ready_projects).toBe(1);
    expect(overview.exported_projects).toBe(2);
    expect(overview.recent_success_records).toBe(1);
    expect(overview.recent_failed_records).toBe(1);
  });

  it('builds template reference conflict messages for delete protection', () => {
    expect(
      buildTemplateReferenceConflictMessage({
        entityLabel: '模板字段',
        entityCode: 'PROJECT_NAME',
        bundles: [
          { bundle_code: 'SERVICE_STD', name: '服务类标准模板包' },
          { bundle_code: 'SAFE_STD', name: '安全类模板包' },
        ],
      })
    ).toBe('模板字段 PROJECT_NAME 已被模板包引用：服务类标准模板包、安全类模板包');

    expect(
      buildTemplateReferenceConflictMessage({
        entityLabel: '模板片段',
        entityCode: 'IMPLEMENT_PLAN',
        bundles: [
          { bundle_code: 'A' },
          { bundle_code: 'B' },
          { bundle_code: 'C' },
          { bundle_code: 'D' },
        ],
      })
    ).toBe('模板片段 IMPLEMENT_PLAN 已被 4 个模板包引用，请先解除关联后再删除');
  });
});
