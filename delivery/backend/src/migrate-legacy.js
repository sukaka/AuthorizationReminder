require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2/promise');

const DB_HOST = process.env.MYSQL_HOST || '127.0.0.1';
const DB_PORT = Number(process.env.MYSQL_PORT || 3306);
const DB_USER = process.env.MYSQL_MIGRATION_USER || process.env.MYSQL_ADMIN_USER || process.env.MYSQL_USER || 'delivery_user';
const DB_PASSWORD =
  process.env.MYSQL_MIGRATION_PASSWORD !== undefined
    ? process.env.MYSQL_MIGRATION_PASSWORD
    : (process.env.MYSQL_ADMIN_PASSWORD !== undefined ? process.env.MYSQL_ADMIN_PASSWORD : (process.env.MYSQL_PASSWORD || 'delivery_pass'));
const DELIVERY_DB = process.env.MYSQL_DATABASE || 'juxin_delivery';
const TICKETING_DB = process.env.MYSQL_DATABASE_TICKETING || 'juxin_reminder';
const SEC_IMPL_DB = process.env.MYSQL_DATABASE_SEC_IMPL || 'juxin_sec_impl';
const UPLOAD_ROOT = path.resolve(process.env.UPLOAD_ROOT || './uploads/delivery');

const DEFAULT_TICKET_STAGE_SEQUENCE = ['ASSESS', 'IMPLEMENT', 'TUNE', 'TRIAL', 'ACCEPT', 'HANDOVER', 'CLOSED'];

const buildPool = () => mysql.createPool({
  host: DB_HOST,
  port: DB_PORT,
  user: DB_USER,
  password: DB_PASSWORD,
  waitForConnections: true,
  connectionLimit: 4,
  dateStrings: true,
});

const loadTableColumns = async (pool, database, table) => {
  const [rows] = await pool.query(
    `SELECT COLUMN_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
    [database, table]
  );
  return new Set(rows.map((row) => String(row.COLUMN_NAME || '').trim()).filter(Boolean));
};

const buildOptionalColumnSql = (availableColumns, columnName, fallbackSql = 'NULL') => {
  if (availableColumns instanceof Set && availableColumns.has(columnName)) return columnName;
  return `${fallbackSql} AS ${columnName}`;
};

const trimText = (value, fallback = '') => (value === undefined || value === null ? fallback : String(value).trim());
const toNumberOrNull = (value) => {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
};

const parseJsonSafe = (value, fallback = null) => {
  const raw = trimText(value);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch (_err) {
    return fallback;
  }
};

const ensureDir = (dirPath) => {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
};

const sanitizeFilename = (value, fallback = 'attachment') => {
  const normalized = trimText(value || fallback)
    .replace(/[^\w.\-\u4e00-\u9fa5]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || fallback;
};

const writeMigratedBlob = ({ sourceSystem, legacyId, fileName, content }) => {
  const dirPath = ensureDir(path.join(UPLOAD_ROOT, 'migrated', sourceSystem));
  const storedName = `${sourceSystem}-${legacyId}-${Date.now()}-${sanitizeFilename(fileName, 'attachment')}`;
  const filePath = path.join(dirPath, storedName);
  fs.writeFileSync(filePath, content);
  return {
    storedName,
    filePath,
  };
};

const copyMigratedFile = ({ sourceSystem, legacyId, sourcePath, fileName }) => {
  const resolvedSource = path.resolve(String(sourcePath || ''));
  if (!resolvedSource || !fs.existsSync(resolvedSource)) return null;
  const dirPath = ensureDir(path.join(UPLOAD_ROOT, 'migrated', sourceSystem));
  const storedName = `${sourceSystem}-${legacyId}-${Date.now()}-${sanitizeFilename(fileName || path.basename(resolvedSource), 'attachment')}`;
  const targetPath = path.join(dirPath, storedName);
  fs.copyFileSync(resolvedSource, targetPath);
  return {
    storedName,
    filePath: targetPath,
  };
};

const normalizeUserSub = (value) => trimText(value) || '';

const ticketStatusToWorkflow = (row) => {
  const status = trimText(row?.status).toUpperCase();
  const approvalRequired = Number(row?.approval_required || 0) === 1;
  const approvalStatus = trimText(row?.approval_status).toUpperCase();
  if (status === 'CLOSED') return 'CLOSED';
  if (approvalRequired && approvalStatus === 'PENDING') return 'APPROVAL';
  if (status === 'OPEN') return 'INTAKE';
  return 'ACTIVE';
};

const resolveTicketStageCode = (stageName, stageOrder) => {
  const text = trimText(stageName).toUpperCase();
  if (text.includes('评估')) return 'ASSESS';
  if (text.includes('实施') || text.includes('部署')) return 'IMPLEMENT';
  if (text.includes('联调') || text.includes('优化')) return 'TUNE';
  if (text.includes('试运行') || text.includes('试运')) return 'TRIAL';
  if (text.includes('验收')) return 'ACCEPT';
  if (text.includes('移交')) return 'HANDOVER';
  if (text.includes('归档') || text.includes('关闭')) return 'CLOSED';
  const index = Math.max(0, Number(stageOrder || 1) - 1);
  return DEFAULT_TICKET_STAGE_SEQUENCE[index] || 'INIT';
};

const buildTicketWorkflowEvents = (row, userMap) => {
  const events = [];
  const creator = userMap.get(Number(row?.created_by || 0)) || null;
  events.push({
    source_system: 'ticketing',
    legacy_event_id: Number(row?.id || 0) ? Number(row.id) * 100000 + 1 : null,
    action: 'CREATE',
    from_status: null,
    to_status: ticketStatusToWorkflow(row),
    from_phase: null,
    to_phase: 'INIT',
    comment_text: trimText(row?.description || ''),
    operator_sub: normalizeUserSub(creator?.user_sub || creator?.id),
    operator_name: trimText(creator?.username || creator?.name || ''),
    operator_role: trimText(creator?.role || ''),
    created_at: row?.created_at || null,
  });
  if (Number(row?.approval_required || 0) === 1) {
    const approver = userMap.get(Number(row?.approval_by || 0)) || null;
    const approved = trimText(row?.approval_status).toUpperCase();
    if (approved && approved !== 'NOT_REQUIRED') {
      events.push({
        source_system: 'ticketing',
        legacy_event_id: Number(row?.id || 0) ? Number(row.id) * 100000 + 2 : null,
        action: 'APPROVAL',
        from_status: 'APPROVAL',
        to_status: approved === 'APPROVED' ? 'ACTIVE' : 'BLOCKED',
        from_phase: 'INIT',
        to_phase: 'INIT',
        comment_text: trimText(row?.approval_comment || ''),
        operator_sub: normalizeUserSub(approver?.user_sub || approver?.id),
        operator_name: trimText(approver?.username || ''),
        operator_role: trimText(approver?.role || ''),
        created_at: row?.approval_at || row?.updated_at || null,
      });
    }
  }
  return events;
};

const mapTicketProjectToDeliveryProject = (row, owner = null) => ({
  project_code: trimText(row?.code || row?.name || `TICKET-PROJECT-${row?.id || '0'}`).toUpperCase(),
  name: trimText(row?.name || `项目-${row?.id || '0'}`),
  customer_name: trimText(row?.customer_name || ''),
  description: trimText(row?.description || ''),
  owner_sub: normalizeUserSub(owner?.user_sub || owner?.id),
  owner_name: trimText(owner?.username || owner?.name || ''),
  owner_role: trimText(owner?.role || ''),
  legacy_ticket_project_id: toNumberOrNull(row?.id),
  legacy_sec_impl_project_id: null,
  created_at: row?.created_at || null,
  updated_at: row?.updated_at || row?.created_at || null,
});

const mapSecImplProjectToDeliveryProject = (row) => ({
  project_code: trimText(row?.project_code || `SEC-IMPL-${row?.id || '0'}`).toUpperCase(),
  name: trimText(row?.title || row?.project_code || `交付项目-${row?.id || '0'}`),
  customer_name: trimText(row?.customer_name || ''),
  description: trimText(row?.remark || ''),
  owner_sub: normalizeUserSub(row?.received_by_sub),
  owner_name: trimText(row?.received_by_name || ''),
  owner_role: trimText(row?.received_by_role || ''),
  legacy_ticket_project_id: null,
  legacy_sec_impl_project_id: toNumberOrNull(row?.id),
  created_at: row?.created_at || null,
  updated_at: row?.updated_at || row?.created_at || null,
});

const mapTicketRowToDeliveryOrder = (row, project = null, userMap = new Map()) => {
  const creator = userMap.get(Number(row?.created_by || 0)) || null;
  const owner = userMap.get(Number(row?.owner_id || 0)) || null;
  const approvalUser = userMap.get(Number(row?.approval_by || 0)) || null;
  const workflowStatus = ticketStatusToWorkflow(row);

  return {
    job_no: trimText(row?.ticket_no || row?.code || `TICKET-${row?.id || '0'}`).toUpperCase(),
    project_code: trimText(project?.project_code || row?.project_code || row?.department_code || `TICKET-${row?.id || '0'}`).toUpperCase(),
    title: trimText(row?.title || row?.summary || row?.subject || `工单-${row?.id || '0'}`),
    product_type: trimText(row?.service_code || row?.ticket_type || 'SERVICE'),
    customer_name: trimText(row?.customer_name || project?.customer_name || ''),
    sales_order_no: trimText(row?.sales_order_no || ''),
    inbound_tracking_no: trimText(row?.ticket_no || ''),
    outbound_tracking_no: '',
    workflow_status: workflowStatus,
    execution_phase: 'INIT',
    current_stage: 'INIT',
    status: trimText(row?.status || 'OPEN').toUpperCase(),
    source_system: 'ticketing',
    legacy_ticket_id: toNumberOrNull(row?.id),
    legacy_sec_impl_id: null,
    requested_by_sub: normalizeUserSub(creator?.user_sub || creator?.id),
    requested_by_name: trimText(creator?.username || creator?.name || ''),
    requested_by_role: trimText(creator?.role || ''),
    requested_at: row?.created_at || null,
    approved_by_sub: normalizeUserSub(approvalUser?.user_sub || approvalUser?.id),
    approved_by_name: trimText(approvalUser?.username || approvalUser?.name || ''),
    approved_by_role: trimText(approvalUser?.role || ''),
    approved_at: row?.approval_at || null,
    assigned_to_sub: normalizeUserSub(owner?.user_sub || owner?.id),
    assigned_to_name: trimText(owner?.username || owner?.name || ''),
    assigned_to_role: trimText(owner?.role || ''),
    assigned_at: row?.accepted_at || null,
    planned_start_at: row?.response_deadline || null,
    planned_end_at: row?.resolve_deadline || null,
    remark: trimText(row?.description || row?.remark || row?.approval_comment || ''),
    created_by_sub: normalizeUserSub(creator?.user_sub || creator?.id),
    created_by_name: trimText(creator?.username || creator?.name || ''),
    created_by_role: trimText(creator?.role || ''),
    created_at: row?.created_at || null,
    updated_at: row?.updated_at || row?.created_at || null,
  };
};

const mapSecImplRowToDeliveryOrder = (row) => ({
  job_no: trimText(row?.job_no || `SEC-IMPL-${row?.id || '0'}`).toUpperCase(),
  project_code: trimText(row?.project_code || `SEC-IMPL-${row?.id || '0'}`).toUpperCase(),
  title: trimText(row?.title || `${trimText(row?.project_code || '项目')} 交付单`),
  product_type: trimText(row?.product_type || ''),
  customer_name: trimText(row?.customer_name || ''),
  sales_order_no: trimText(row?.sales_order_no || ''),
  inbound_tracking_no: trimText(row?.inbound_tracking_no || ''),
  outbound_tracking_no: trimText(row?.outbound_tracking_no || ''),
  workflow_status: trimText(row?.status || '').toUpperCase() === 'COMPLETED' ? 'CLOSED' : 'ACTIVE',
  execution_phase: trimText(row?.current_stage || 'INIT').toUpperCase(),
  current_stage: trimText(row?.current_stage || 'INIT').toUpperCase(),
  status: trimText(row?.status || 'OPEN').toUpperCase(),
  source_system: 'sec-impl',
  legacy_ticket_id: null,
  legacy_sec_impl_id: toNumberOrNull(row?.id),
  requested_by_sub: normalizeUserSub(row?.received_by_sub),
  requested_by_name: trimText(row?.received_by_name || ''),
  requested_by_role: trimText(row?.received_by_role || ''),
  requested_at: row?.received_at || row?.created_at || null,
  approved_by_sub: normalizeUserSub(row?.approved_by_sub),
  approved_by_name: trimText(row?.approved_by_name || ''),
  approved_by_role: trimText(row?.approved_by_role || ''),
  approved_at: row?.approved_at || null,
  assigned_to_sub: normalizeUserSub(row?.hardware_checked_by_sub || row?.os_installed_by_sub || row?.tested_by_sub),
  assigned_to_name: trimText(row?.hardware_checked_by_name || row?.os_installed_by_name || row?.tested_by_name || ''),
  assigned_to_role: trimText(row?.hardware_checked_by_role || row?.os_installed_by_role || row?.tested_by_role || ''),
  assigned_at: row?.hardware_checked_at || row?.os_installed_at || row?.tested_at || null,
  planned_start_at: row?.received_at || row?.created_at || null,
  planned_end_at: row?.shipped_at || row?.updated_at || null,
  remark: trimText(row?.remark || ''),
  created_by_sub: normalizeUserSub(row?.received_by_sub),
  created_by_name: trimText(row?.received_by_name || ''),
  created_by_role: trimText(row?.received_by_role || ''),
  created_at: row?.created_at || null,
  updated_at: row?.updated_at || row?.created_at || null,
});

const upsertDeliveryProject = async (conn, payload) => {
  await conn.execute(
    `INSERT INTO \`${DELIVERY_DB}\`.delivery_projects
     (project_code, name, customer_name, description, owner_sub, owner_name, owner_role, legacy_ticket_project_id, legacy_sec_impl_project_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, NOW()), COALESCE(?, NOW()))
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       customer_name = VALUES(customer_name),
       description = VALUES(description),
       owner_sub = COALESCE(VALUES(owner_sub), owner_sub),
       owner_name = COALESCE(VALUES(owner_name), owner_name),
       owner_role = COALESCE(VALUES(owner_role), owner_role),
       legacy_ticket_project_id = COALESCE(VALUES(legacy_ticket_project_id), legacy_ticket_project_id),
       legacy_sec_impl_project_id = COALESCE(VALUES(legacy_sec_impl_project_id), legacy_sec_impl_project_id),
       updated_at = COALESCE(VALUES(updated_at), updated_at)`,
    [
      payload.project_code,
      payload.name,
      payload.customer_name,
      payload.description || null,
      payload.owner_sub || null,
      payload.owner_name || null,
      payload.owner_role || null,
      payload.legacy_ticket_project_id,
      payload.legacy_sec_impl_project_id,
      payload.created_at,
      payload.updated_at,
    ]
  );
};

const findProjectId = async (conn, projectCode) => {
  const [rows] = await conn.query(
    `SELECT id FROM \`${DELIVERY_DB}\`.delivery_projects WHERE project_code = ? LIMIT 1`,
    [projectCode]
  );
  return toNumberOrNull(rows[0]?.id);
};

const upsertDeliveryProjectMember = async (conn, payload) => {
  await conn.execute(
    `INSERT INTO \`${DELIVERY_DB}\`.delivery_project_members
     (project_id, user_sub, username, user_role, can_view, can_edit, can_assign, can_close, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, NOW()), COALESCE(?, NOW()))
     ON DUPLICATE KEY UPDATE
       username = VALUES(username),
       user_role = VALUES(user_role),
       can_view = VALUES(can_view),
       can_edit = VALUES(can_edit),
       can_assign = VALUES(can_assign),
       can_close = VALUES(can_close),
       updated_at = COALESCE(VALUES(updated_at), updated_at)`,
    [
      payload.project_id,
      payload.user_sub,
      payload.username || '',
      payload.user_role || '',
      payload.can_view,
      payload.can_edit,
      payload.can_assign,
      payload.can_close,
      payload.created_at || null,
      payload.updated_at || null,
    ]
  );
};

const upsertDeliveryOrder = async (conn, payload, projectId = null) => {
  await conn.execute(
    `INSERT INTO \`${DELIVERY_DB}\`.delivery_orders
     (job_no, project_code, project_id, title, product_type, customer_name, sales_order_no, inbound_tracking_no, outbound_tracking_no,
      workflow_status, execution_phase, current_stage, status, requested_by_sub, requested_by_name, requested_by_role, requested_at,
      approved_by_sub, approved_by_name, approved_by_role, approved_at,
      assigned_to_sub, assigned_to_name, assigned_to_role, assigned_at,
      planned_start_at, planned_end_at, source_system, legacy_ticket_id, legacy_sec_impl_id, remark,
      created_by_sub, created_by_name, created_by_role, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, NOW()), COALESCE(?, NOW()))
     ON DUPLICATE KEY UPDATE
       project_code = VALUES(project_code),
       project_id = COALESCE(VALUES(project_id), project_id),
       title = VALUES(title),
       product_type = VALUES(product_type),
       customer_name = VALUES(customer_name),
       sales_order_no = VALUES(sales_order_no),
       inbound_tracking_no = VALUES(inbound_tracking_no),
       outbound_tracking_no = VALUES(outbound_tracking_no),
       workflow_status = VALUES(workflow_status),
       execution_phase = VALUES(execution_phase),
       current_stage = VALUES(current_stage),
       status = VALUES(status),
       requested_by_sub = COALESCE(VALUES(requested_by_sub), requested_by_sub),
       requested_by_name = COALESCE(VALUES(requested_by_name), requested_by_name),
       requested_by_role = COALESCE(VALUES(requested_by_role), requested_by_role),
       requested_at = COALESCE(VALUES(requested_at), requested_at),
       approved_by_sub = COALESCE(VALUES(approved_by_sub), approved_by_sub),
       approved_by_name = COALESCE(VALUES(approved_by_name), approved_by_name),
       approved_by_role = COALESCE(VALUES(approved_by_role), approved_by_role),
       approved_at = COALESCE(VALUES(approved_at), approved_at),
       assigned_to_sub = COALESCE(VALUES(assigned_to_sub), assigned_to_sub),
       assigned_to_name = COALESCE(VALUES(assigned_to_name), assigned_to_name),
       assigned_to_role = COALESCE(VALUES(assigned_to_role), assigned_to_role),
       assigned_at = COALESCE(VALUES(assigned_at), assigned_at),
       planned_start_at = COALESCE(VALUES(planned_start_at), planned_start_at),
       planned_end_at = COALESCE(VALUES(planned_end_at), planned_end_at),
       source_system = VALUES(source_system),
       legacy_ticket_id = COALESCE(VALUES(legacy_ticket_id), legacy_ticket_id),
       legacy_sec_impl_id = COALESCE(VALUES(legacy_sec_impl_id), legacy_sec_impl_id),
       remark = VALUES(remark),
       created_by_sub = COALESCE(VALUES(created_by_sub), created_by_sub),
       created_by_name = COALESCE(VALUES(created_by_name), created_by_name),
       created_by_role = COALESCE(VALUES(created_by_role), created_by_role),
       updated_at = COALESCE(VALUES(updated_at), updated_at)`,
    [
      payload.job_no,
      payload.project_code,
      projectId,
      payload.title,
      payload.product_type,
      payload.customer_name,
      payload.sales_order_no,
      payload.inbound_tracking_no,
      payload.outbound_tracking_no || '',
      payload.workflow_status,
      payload.execution_phase,
      payload.current_stage,
      payload.status,
      payload.requested_by_sub || null,
      payload.requested_by_name || null,
      payload.requested_by_role || null,
      payload.requested_at || null,
      payload.approved_by_sub || null,
      payload.approved_by_name || null,
      payload.approved_by_role || null,
      payload.approved_at || null,
      payload.assigned_to_sub || null,
      payload.assigned_to_name || null,
      payload.assigned_to_role || null,
      payload.assigned_at || null,
      payload.planned_start_at || null,
      payload.planned_end_at || null,
      payload.source_system,
      payload.legacy_ticket_id,
      payload.legacy_sec_impl_id,
      payload.remark || null,
      payload.created_by_sub || null,
      payload.created_by_name || null,
      payload.created_by_role || null,
      payload.created_at || null,
      payload.updated_at || null,
    ]
  );
};

const findOrderIdByJobNo = async (conn, jobNo) => {
  const [rows] = await conn.query(
    `SELECT id FROM \`${DELIVERY_DB}\`.delivery_orders WHERE job_no = ? LIMIT 1`,
    [jobNo]
  );
  return toNumberOrNull(rows[0]?.id);
};

const findPhaseRunId = async (conn, sourceSystem, legacyPhaseRunId) => {
  if (!legacyPhaseRunId) return null;
  const [rows] = await conn.query(
    `SELECT id FROM \`${DELIVERY_DB}\`.delivery_phase_runs WHERE source_system = ? AND legacy_phase_run_id = ? LIMIT 1`,
    [sourceSystem, legacyPhaseRunId]
  );
  return toNumberOrNull(rows[0]?.id);
};

const upsertWorkflowEvent = async (conn, payload) => {
  await conn.execute(
    `INSERT INTO \`${DELIVERY_DB}\`.delivery_workflow_events
     (order_id, action, source_system, legacy_event_id, from_status, to_status, from_phase, to_phase, comment_text, operator_sub, operator_name, operator_role, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, NOW()))
     ON DUPLICATE KEY UPDATE
       action = VALUES(action),
       from_status = VALUES(from_status),
       to_status = VALUES(to_status),
       from_phase = VALUES(from_phase),
       to_phase = VALUES(to_phase),
       comment_text = VALUES(comment_text),
       operator_sub = COALESCE(VALUES(operator_sub), operator_sub),
       operator_name = COALESCE(VALUES(operator_name), operator_name),
       operator_role = COALESCE(VALUES(operator_role), operator_role),
       created_at = COALESCE(VALUES(created_at), created_at)`,
    [
      payload.order_id,
      payload.action,
      payload.source_system,
      payload.legacy_event_id,
      payload.from_status || null,
      payload.to_status || null,
      payload.from_phase || null,
      payload.to_phase || null,
      payload.comment_text || null,
      payload.operator_sub || null,
      payload.operator_name || null,
      payload.operator_role || null,
      payload.created_at || null,
    ]
  );
};

const upsertPhaseRun = async (conn, payload) => {
  await conn.execute(
    `INSERT INTO \`${DELIVERY_DB}\`.delivery_phase_runs
     (job_id, action, source_system, legacy_phase_run_id, from_stage, to_stage, result, remark, rework_reason, stage_payload,
      operator_sub, operator_name, operator_role, operated_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, NOW()), COALESCE(?, NOW()))
     ON DUPLICATE KEY UPDATE
       action = VALUES(action),
       from_stage = VALUES(from_stage),
       to_stage = VALUES(to_stage),
       result = VALUES(result),
       remark = VALUES(remark),
       rework_reason = VALUES(rework_reason),
       stage_payload = VALUES(stage_payload),
       operator_sub = COALESCE(VALUES(operator_sub), operator_sub),
       operator_name = COALESCE(VALUES(operator_name), operator_name),
       operator_role = COALESCE(VALUES(operator_role), operator_role),
       operated_at = COALESCE(VALUES(operated_at), operated_at),
       created_at = COALESCE(VALUES(created_at), created_at)`,
    [
      payload.job_id,
      payload.action,
      payload.source_system,
      payload.legacy_phase_run_id,
      payload.from_stage,
      payload.to_stage,
      payload.result || 'PASS',
      payload.remark || null,
      payload.rework_reason || null,
      payload.stage_payload ? JSON.stringify(payload.stage_payload) : null,
      payload.operator_sub || null,
      payload.operator_name || null,
      payload.operator_role || null,
      payload.operated_at || null,
      payload.created_at || null,
    ]
  );
};

const upsertComment = async (conn, payload) => {
  await conn.execute(
    `INSERT INTO \`${DELIVERY_DB}\`.delivery_comments
     (order_id, source_system, legacy_comment_id, content, mentions_json, created_by_sub, created_by_name, created_by_role, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, NOW()))
     ON DUPLICATE KEY UPDATE
       content = VALUES(content),
       mentions_json = VALUES(mentions_json),
       created_by_sub = COALESCE(VALUES(created_by_sub), created_by_sub),
       created_by_name = COALESCE(VALUES(created_by_name), created_by_name),
       created_by_role = COALESCE(VALUES(created_by_role), created_by_role),
       created_at = COALESCE(VALUES(created_at), created_at)`,
    [
      payload.order_id,
      payload.source_system,
      payload.legacy_comment_id,
      payload.content,
      payload.mentions_json ? JSON.stringify(payload.mentions_json) : null,
      payload.created_by_sub || null,
      payload.created_by_name || null,
      payload.created_by_role || null,
      payload.created_at || null,
    ]
  );
};

const upsertSchedule = async (conn, payload) => {
  await conn.execute(
    `INSERT INTO \`${DELIVERY_DB}\`.delivery_schedules
     (order_id, source_system, legacy_schedule_id, assignee_sub, assignee_name, assignee_role, start_at, end_at, remark,
      created_by_sub, created_by_name, created_by_role, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, NOW()), COALESCE(?, NOW()))
     ON DUPLICATE KEY UPDATE
       assignee_sub = COALESCE(VALUES(assignee_sub), assignee_sub),
       assignee_name = COALESCE(VALUES(assignee_name), assignee_name),
       assignee_role = COALESCE(VALUES(assignee_role), assignee_role),
       start_at = VALUES(start_at),
       end_at = VALUES(end_at),
       remark = VALUES(remark),
       created_by_sub = COALESCE(VALUES(created_by_sub), created_by_sub),
       created_by_name = COALESCE(VALUES(created_by_name), created_by_name),
       created_by_role = COALESCE(VALUES(created_by_role), created_by_role),
       updated_at = COALESCE(VALUES(updated_at), updated_at)`,
    [
      payload.order_id,
      payload.source_system,
      payload.legacy_schedule_id,
      payload.assignee_sub || null,
      payload.assignee_name || null,
      payload.assignee_role || null,
      payload.start_at,
      payload.end_at,
      payload.remark || null,
      payload.created_by_sub || null,
      payload.created_by_name || null,
      payload.created_by_role || null,
      payload.created_at || null,
      payload.updated_at || null,
    ]
  );
};

const upsertDeliverable = async (conn, payload) => {
  await conn.execute(
    `INSERT INTO \`${DELIVERY_DB}\`.delivery_deliverables
     (job_id, source_system, legacy_deliverable_id, stage_code, name, required_flag, done_flag, done_by_sub, done_by_name, done_by_role, done_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, NOW()), COALESCE(?, NOW()))
     ON DUPLICATE KEY UPDATE
       stage_code = VALUES(stage_code),
       name = VALUES(name),
       required_flag = VALUES(required_flag),
       done_flag = VALUES(done_flag),
       done_by_sub = COALESCE(VALUES(done_by_sub), done_by_sub),
       done_by_name = COALESCE(VALUES(done_by_name), done_by_name),
       done_by_role = COALESCE(VALUES(done_by_role), done_by_role),
       done_at = COALESCE(VALUES(done_at), done_at),
       updated_at = COALESCE(VALUES(updated_at), updated_at)`,
    [
      payload.job_id,
      payload.source_system,
      payload.legacy_deliverable_id,
      payload.stage_code,
      payload.name,
      payload.required_flag,
      payload.done_flag,
      payload.done_by_sub || null,
      payload.done_by_name || null,
      payload.done_by_role || null,
      payload.done_at || null,
      payload.created_at || null,
      payload.updated_at || null,
    ]
  );
};

const upsertAuditLog = async (conn, payload) => {
  await conn.execute(
    `INSERT INTO \`${DELIVERY_DB}\`.delivery_audit_logs
     (job_id, source_system, legacy_audit_id, user_sub, username, user_role, action, entity, entity_id, message,
      before_data, after_data, chain_prev_hash, chain_hash, chain_version, request_ip, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, NOW()))
     ON DUPLICATE KEY UPDATE
       user_sub = COALESCE(VALUES(user_sub), user_sub),
       username = VALUES(username),
       user_role = VALUES(user_role),
       action = VALUES(action),
       entity = VALUES(entity),
       entity_id = VALUES(entity_id),
       message = VALUES(message),
       before_data = VALUES(before_data),
       after_data = VALUES(after_data),
       chain_prev_hash = VALUES(chain_prev_hash),
       chain_hash = VALUES(chain_hash),
       chain_version = VALUES(chain_version),
       request_ip = VALUES(request_ip),
       created_at = COALESCE(VALUES(created_at), created_at)`,
    [
      payload.job_id || null,
      payload.source_system,
      payload.legacy_audit_id,
      payload.user_sub || null,
      payload.username || '',
      payload.user_role || '',
      payload.action,
      payload.entity,
      payload.entity_id === undefined || payload.entity_id === null ? null : String(payload.entity_id),
      payload.message || null,
      payload.before_data === undefined || payload.before_data === null ? null : JSON.stringify(payload.before_data),
      payload.after_data === undefined || payload.after_data === null ? null : JSON.stringify(payload.after_data),
      payload.chain_prev_hash || null,
      payload.chain_hash || null,
      payload.chain_version || 'v1',
      payload.request_ip || null,
      payload.created_at || null,
    ]
  );
};

const upsertAttachment = async (conn, payload) => {
  await conn.execute(
    `INSERT INTO \`${DELIVERY_DB}\`.delivery_evidence_attachments
     (job_id, source_system, legacy_attachment_id, stage_record_id, stage_code, file_name, stored_name, file_path, mime_type, file_size, remark,
      uploaded_by_sub, uploaded_by_name, uploaded_by_role, uploaded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, NOW()))
     ON DUPLICATE KEY UPDATE
       stage_record_id = COALESCE(VALUES(stage_record_id), stage_record_id),
       stage_code = VALUES(stage_code),
       file_name = VALUES(file_name),
       stored_name = VALUES(stored_name),
       file_path = VALUES(file_path),
       mime_type = VALUES(mime_type),
       file_size = VALUES(file_size),
       remark = VALUES(remark),
       uploaded_by_sub = COALESCE(VALUES(uploaded_by_sub), uploaded_by_sub),
       uploaded_by_name = COALESCE(VALUES(uploaded_by_name), uploaded_by_name),
       uploaded_by_role = COALESCE(VALUES(uploaded_by_role), uploaded_by_role),
       uploaded_at = COALESCE(VALUES(uploaded_at), uploaded_at)`,
    [
      payload.job_id,
      payload.source_system,
      payload.legacy_attachment_id,
      payload.stage_record_id,
      payload.stage_code,
      payload.file_name,
      payload.stored_name,
      payload.file_path,
      payload.mime_type || '',
      payload.file_size || 0,
      payload.remark || null,
      payload.uploaded_by_sub || null,
      payload.uploaded_by_name || null,
      payload.uploaded_by_role || null,
      payload.uploaded_at || null,
    ]
  );
};

const upsertSlaRule = async (conn, payload) => {
  await conn.execute(
    `INSERT INTO \`${DELIVERY_DB}\`.delivery_sla_rules
     (stage_code, threshold_hours, remind_interval_minutes, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, COALESCE(?, NOW()), COALESCE(?, NOW()))
     ON DUPLICATE KEY UPDATE
       threshold_hours = VALUES(threshold_hours),
       remind_interval_minutes = VALUES(remind_interval_minutes),
       enabled = VALUES(enabled),
       updated_at = COALESCE(VALUES(updated_at), updated_at)`,
    [
      payload.stage_code,
      payload.threshold_hours,
      payload.remind_interval_minutes,
      payload.enabled,
      payload.created_at || null,
      payload.updated_at || null,
    ]
  );
};

const upsertSlaReminder = async (conn, payload) => {
  await conn.execute(
    `INSERT INTO \`${DELIVERY_DB}\`.delivery_sla_reminders
     (job_id, stage_code, threshold_hours, overdue_hours, message, created_at)
     VALUES (?, ?, ?, ?, ?, COALESCE(?, NOW()))`,
    [
      payload.job_id,
      payload.stage_code,
      payload.threshold_hours,
      payload.overdue_hours,
      payload.message || '',
      payload.created_at || null,
    ]
  );
};

const upsertTemplate = async (conn, payload) => {
  await conn.execute(
    `INSERT INTO \`${DELIVERY_DB}\`.delivery_templates
     (product_code, product_name, enabled, created_at, updated_at)
     VALUES (?, ?, ?, COALESCE(?, NOW()), COALESCE(?, NOW()))
     ON DUPLICATE KEY UPDATE
       product_name = VALUES(product_name),
       enabled = VALUES(enabled),
       updated_at = COALESCE(VALUES(updated_at), updated_at)`,
    [
      payload.product_code,
      payload.product_name,
      payload.enabled,
      payload.created_at || null,
      payload.updated_at || null,
    ]
  );
};

const upsertTemplateRule = async (conn, payload) => {
  await conn.execute(
    `INSERT INTO \`${DELIVERY_DB}\`.delivery_template_phase_rules
     (product_code, stage_code, required_deliverables_json, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, COALESCE(?, NOW()), COALESCE(?, NOW()))
     ON DUPLICATE KEY UPDATE
       required_deliverables_json = VALUES(required_deliverables_json),
       enabled = VALUES(enabled),
       updated_at = COALESCE(VALUES(updated_at), updated_at)`,
    [
      payload.product_code,
      payload.stage_code,
      payload.required_deliverables_json ? JSON.stringify(payload.required_deliverables_json) : null,
      payload.enabled,
      payload.created_at || null,
      payload.updated_at || null,
    ]
  );
};

const runLegacyMigration = async ({ dryRun = true, limit = 0 } = {}) => {
  const pool = buildPool();
  const summary = {
    dryRun,
    ticket_projects: 0,
    ticket_project_members: 0,
    ticket_orders: 0,
    ticket_workflow_events: 0,
    ticket_comments: 0,
    ticket_schedules: 0,
    ticket_deliverables: 0,
    ticket_attachments: 0,
    ticket_audit_logs: 0,
    sec_impl_projects: 0,
    sec_impl_orders: 0,
    sec_impl_phase_runs: 0,
    sec_impl_workflow_events: 0,
    sec_impl_deliverables: 0,
    sec_impl_attachments: 0,
    sec_impl_audit_logs: 0,
    sec_impl_sla_rules: 0,
    sec_impl_sla_reminders: 0,
    sec_impl_templates: 0,
    sec_impl_template_rules: 0,
    missing_attachment_files: 0,
  };

  const limitSql = limit > 0 ? ` LIMIT ${Number(limit)}` : '';

  try {
    const [users] = await pool.query(
      `SELECT id, username, role FROM \`${TICKETING_DB}\`.users ORDER BY id ASC`
    );
    const userMap = new Map(
      users.map((row) => [Number(row.id), {
        id: Number(row.id),
        user_sub: String(row.id),
        username: trimText(row.username || ''),
        role: trimText(row.role || ''),
      }])
    );

    const [ticketProjects] = await pool.query(
      `SELECT id, name, description, created_at
       FROM \`${TICKETING_DB}\`.projects
       ORDER BY id ASC${limitSql}`
    );
    const projectCodeByLegacyId = new Map();
    for (const row of ticketProjects) {
      const mapped = mapTicketProjectToDeliveryProject(row);
      projectCodeByLegacyId.set(Number(row.id), mapped.project_code);
      if (!dryRun) await upsertDeliveryProject(pool, mapped);
      summary.ticket_projects += 1;
    }

    if (!dryRun) {
      for (const row of ticketProjects) {
        const projectCode = projectCodeByLegacyId.get(Number(row.id));
        const projectId = await findProjectId(pool, projectCode);
        if (!projectId) continue;
        const owner = userMap.get(Number(row.created_by || 0));
        if (owner) {
          await upsertDeliveryProjectMember(pool, {
            project_id: projectId,
            user_sub: String(owner.id),
            username: owner.username,
            user_role: owner.role,
            can_view: 1,
            can_edit: 1,
            can_assign: 1,
            can_close: 1,
            created_at: row.created_at || null,
            updated_at: row.created_at || null,
          });
        }
      }
    }

    const [ticketMembers] = await pool.query(
      `SELECT project_id, user_id, can_view, can_edit, can_assign, can_close, created_at, updated_at
       FROM \`${TICKETING_DB}\`.ticket_project_members
       ORDER BY project_id ASC, user_id ASC${limitSql}`
    );
    for (const row of ticketMembers) {
      const projectCode = projectCodeByLegacyId.get(Number(row.project_id));
      if (!projectCode) continue;
      if (!dryRun) {
        const projectId = await findProjectId(pool, projectCode);
        const user = userMap.get(Number(row.user_id || 0));
        if (projectId && user) {
          await upsertDeliveryProjectMember(pool, {
            project_id: projectId,
            user_sub: String(user.id),
            username: user.username,
            user_role: user.role,
            can_view: Number(row.can_view || 0) === 1 ? 1 : 0,
            can_edit: Number(row.can_edit || 0) === 1 ? 1 : 0,
            can_assign: Number(row.can_assign || 0) === 1 ? 1 : 0,
            can_close: Number(row.can_close || 0) === 1 ? 1 : 0,
            created_at: row.created_at || null,
            updated_at: row.updated_at || row.created_at || null,
          });
        }
      }
      summary.ticket_project_members += 1;
    }

    const ticketColumns = await loadTableColumns(pool, TICKETING_DB, 'tickets');
    const [tickets] = await pool.query(
      `SELECT id, title, description, status, service_code, ticket_type, customer_name,
              ${buildOptionalColumnSql(ticketColumns, 'sales_order_no', `''`)},
              ${buildOptionalColumnSql(ticketColumns, 'ticket_no', `''`)},
              project_id, department_code, owner_id, created_by, created_at, updated_at, approval_required,
              approval_status, approval_by, approval_at, approval_comment, response_deadline, resolve_deadline
       FROM \`${TICKETING_DB}\`.tickets
       ORDER BY id ASC${limitSql}`
    );
    const orderIdByTicketId = new Map();
    for (const row of tickets) {
      const projectCode = projectCodeByLegacyId.get(Number(row.project_id || 0)) || trimText(row.department_code || `TICKET-${row.id}`).toUpperCase();
      const project = projectCode ? { project_code: projectCode } : null;
      if (!dryRun && projectCode && !projectCodeByLegacyId.has(Number(row.project_id || 0))) {
        await upsertDeliveryProject(pool, mapTicketProjectToDeliveryProject({
          id: row.project_id || row.id,
          code: projectCode,
          name: projectCode,
          customer_name: row.customer_name,
          description: '',
          created_at: row.created_at,
          updated_at: row.updated_at,
        }));
      }
      const mapped = mapTicketRowToDeliveryOrder(row, project, userMap);
      if (!dryRun) {
        const projectId = await findProjectId(pool, mapped.project_code);
        await upsertDeliveryOrder(pool, mapped, projectId);
        const orderId = await findOrderIdByJobNo(pool, mapped.job_no);
        if (orderId) orderIdByTicketId.set(Number(row.id), orderId);
        const workflowEvents = buildTicketWorkflowEvents(row, userMap);
        for (const event of workflowEvents) {
          if (!orderId) continue;
          await upsertWorkflowEvent(pool, {
            ...event,
            order_id: orderId,
          });
          summary.ticket_workflow_events += 1;
        }
      }
      summary.ticket_orders += 1;
    }

    const [ticketEvents] = await pool.query(
      `SELECT id, ticket_id, event_type, event_desc, before_json, after_json, operator_id, operator_name, created_at
       FROM \`${TICKETING_DB}\`.ticket_events
       ORDER BY id ASC${limitSql}`
    );
    for (const row of ticketEvents) {
      const orderId = dryRun ? 1 : orderIdByTicketId.get(Number(row.ticket_id));
      if (!orderId) continue;
      if (!dryRun) {
        const operator = userMap.get(Number(row.operator_id || 0)) || null;
        await upsertWorkflowEvent(pool, {
          order_id: orderId,
          source_system: 'ticketing',
          legacy_event_id: Number(row.id),
          action: trimText(row.event_type || 'EVENT').toUpperCase(),
          from_status: null,
          to_status: null,
          from_phase: null,
          to_phase: null,
          comment_text: trimText(row.event_desc || ''),
          operator_sub: normalizeUserSub(operator?.user_sub || row.operator_id),
          operator_name: trimText(operator?.username || row.operator_name || ''),
          operator_role: trimText(operator?.role || ''),
          created_at: row.created_at || null,
        });
      }
      summary.ticket_workflow_events += 1;
    }

    const [ticketComments] = await pool.query(
      `SELECT id, ticket_id, content, mentions_json, created_by, created_name, created_at
       FROM \`${TICKETING_DB}\`.ticket_comments
       ORDER BY id ASC${limitSql}`
    );
    for (const row of ticketComments) {
      const orderId = dryRun ? 1 : orderIdByTicketId.get(Number(row.ticket_id));
      if (!orderId) continue;
      if (!dryRun) {
        const author = userMap.get(Number(row.created_by || 0)) || null;
        await upsertComment(pool, {
          order_id: orderId,
          source_system: 'ticketing',
          legacy_comment_id: Number(row.id),
          content: trimText(row.content || ''),
          mentions_json: parseJsonSafe(row.mentions_json, []),
          created_by_sub: normalizeUserSub(author?.user_sub || row.created_by),
          created_by_name: trimText(author?.username || row.created_name || ''),
          created_by_role: trimText(author?.role || ''),
          created_at: row.created_at || null,
        });
      }
      summary.ticket_comments += 1;
    }

    const [ticketSchedules] = await pool.query(
      `SELECT id, engineer_id, ticket_id, start_at, end_at, remark, created_at, updated_at
       FROM \`${TICKETING_DB}\`.schedules
       WHERE ticket_id IS NOT NULL
       ORDER BY id ASC${limitSql}`
    );
    for (const row of ticketSchedules) {
      const orderId = dryRun ? 1 : orderIdByTicketId.get(Number(row.ticket_id));
      if (!orderId) continue;
      if (!dryRun) {
        const engineer = userMap.get(Number(row.engineer_id || 0)) || null;
        await upsertSchedule(pool, {
          order_id: orderId,
          source_system: 'ticketing',
          legacy_schedule_id: Number(row.id),
          assignee_sub: normalizeUserSub(engineer?.user_sub || row.engineer_id),
          assignee_name: trimText(engineer?.username || ''),
          assignee_role: trimText(engineer?.role || ''),
          start_at: row.start_at,
          end_at: row.end_at,
          remark: trimText(row.remark || ''),
          created_by_sub: normalizeUserSub(engineer?.user_sub || row.engineer_id),
          created_by_name: trimText(engineer?.username || ''),
          created_by_role: trimText(engineer?.role || ''),
          created_at: row.created_at || null,
          updated_at: row.updated_at || row.created_at || null,
        });
      }
      summary.ticket_schedules += 1;
    }

    const [ticketDeliverables] = await pool.query(
      `SELECT d.id, d.name, d.required_flag, d.done_flag, d.done_by, d.done_at, d.created_at,
              s.ticket_id, s.name AS stage_name, s.stage_order
       FROM \`${TICKETING_DB}\`.ticket_stage_deliverables d
       JOIN \`${TICKETING_DB}\`.ticket_stages s ON s.id = d.stage_id
       ORDER BY d.id ASC${limitSql}`
    );
    for (const row of ticketDeliverables) {
      const orderId = dryRun ? 1 : orderIdByTicketId.get(Number(row.ticket_id));
      if (!orderId) continue;
      if (!dryRun) {
        const doneBy = userMap.get(Number(row.done_by || 0)) || null;
        await upsertDeliverable(pool, {
          job_id: orderId,
          source_system: 'ticketing',
          legacy_deliverable_id: Number(row.id),
          stage_code: resolveTicketStageCode(row.stage_name, row.stage_order),
          name: trimText(row.name || ''),
          required_flag: Number(row.required_flag || 0) === 1 ? 1 : 0,
          done_flag: Number(row.done_flag || 0) === 1 ? 1 : 0,
          done_by_sub: normalizeUserSub(doneBy?.user_sub || row.done_by),
          done_by_name: trimText(doneBy?.username || ''),
          done_by_role: trimText(doneBy?.role || ''),
          done_at: row.done_at || null,
          created_at: row.created_at || null,
          updated_at: row.done_at || row.created_at || null,
        });
      }
      summary.ticket_deliverables += 1;
    }

    const [ticketAttachments] = await pool.query(
      `SELECT id, ticket_id, filename, mime_type, size_bytes, file_data, created_by, created_name, created_at
       FROM \`${TICKETING_DB}\`.ticket_attachments
       ORDER BY id ASC${limitSql}`
    );
    for (const row of ticketAttachments) {
      const orderId = dryRun ? 1 : orderIdByTicketId.get(Number(row.ticket_id));
      if (!orderId) continue;
      if (!dryRun) {
        const author = userMap.get(Number(row.created_by || 0)) || null;
        const persisted = writeMigratedBlob({
          sourceSystem: 'ticketing',
          legacyId: row.id,
          fileName: row.filename,
          content: Buffer.from(row.file_data || ''),
        });
        await upsertAttachment(pool, {
          job_id: orderId,
          source_system: 'ticketing',
          legacy_attachment_id: Number(row.id),
          stage_record_id: null,
          stage_code: 'INIT',
          file_name: trimText(row.filename || persisted.storedName),
          stored_name: persisted.storedName,
          file_path: persisted.filePath,
          mime_type: trimText(row.mime_type || 'application/octet-stream'),
          file_size: Number(row.size_bytes || 0),
          remark: '从工单系统迁移',
          uploaded_by_sub: normalizeUserSub(author?.user_sub || row.created_by),
          uploaded_by_name: trimText(author?.username || row.created_name || ''),
          uploaded_by_role: trimText(author?.role || ''),
          uploaded_at: row.created_at || null,
        });
      }
      summary.ticket_attachments += 1;
    }

    const [ticketAuditLogs] = await pool.query(
      `SELECT id, user_id, username, log_system, action, entity, entity_id, before_data, after_data, prev_hash, signature, sign_version, request_ip, created_at
       FROM \`${TICKETING_DB}\`.operation_logs
       WHERE log_system = 'ticketing'
       ORDER BY id ASC${limitSql}`
    );
    for (const row of ticketAuditLogs) {
      const orderId = dryRun ? 1 : orderIdByTicketId.get(Number(row.entity_id || 0)) || null;
      if (!dryRun) {
        const author = userMap.get(Number(row.user_id || 0)) || null;
        await upsertAuditLog(pool, {
          job_id: orderId,
          source_system: 'ticketing',
          legacy_audit_id: Number(row.id),
          user_sub: normalizeUserSub(author?.user_sub || row.user_id),
          username: trimText(author?.username || row.username || ''),
          user_role: trimText(author?.role || ''),
          action: trimText(row.action || ''),
          entity: trimText(row.entity || ''),
          entity_id: toNumberOrNull(row.entity_id) || row.entity_id || null,
          message: trimText(row.action || ''),
          before_data: parseJsonSafe(row.before_data, row.before_data ? { raw: row.before_data } : null),
          after_data: parseJsonSafe(row.after_data, row.after_data ? { raw: row.after_data } : null),
          chain_prev_hash: trimText(row.prev_hash || ''),
          chain_hash: trimText(row.signature || ''),
          chain_version: trimText(row.sign_version || 'v1'),
          request_ip: trimText(row.request_ip || ''),
          created_at: row.created_at || null,
        });
      }
      summary.ticket_audit_logs += 1;
    }

    const secImplColumns = await loadTableColumns(pool, SEC_IMPL_DB, 'sec_impl_projects');
    const [secImplOrders] = await pool.query(
      `SELECT id, job_no, project_code, ${buildOptionalColumnSql(secImplColumns, 'title', `''`)}, product_type, customer_name, sales_order_no, inbound_tracking_no, outbound_tracking_no,
              current_stage, status, remark, received_by_sub, received_by_name, received_by_role, received_at,
              hardware_checked_by_sub, hardware_checked_by_name, hardware_checked_by_role, hardware_checked_at,
              os_installed_by_sub, os_installed_by_name, os_installed_by_role, os_installed_at,
              tested_by_sub, tested_by_name, tested_by_role, tested_at,
              approved_by_sub, approved_by_name, approved_by_role, approved_at,
              packed_by_sub, packed_by_name, packed_by_role, packed_at,
              shipped_by_sub, shipped_by_name, shipped_by_role, shipped_at,
              created_at, updated_at
       FROM \`${SEC_IMPL_DB}\`.sec_impl_projects
       ORDER BY id ASC${limitSql}`
    );
    const orderIdBySecImplId = new Map();
    for (const row of secImplOrders) {
      const projectPayload = mapSecImplProjectToDeliveryProject(row);
      const orderPayload = mapSecImplRowToDeliveryOrder(row);
      if (!dryRun) {
        await upsertDeliveryProject(pool, projectPayload);
        const projectId = await findProjectId(pool, projectPayload.project_code);
        await upsertDeliveryOrder(pool, orderPayload, projectId);
        const orderId = await findOrderIdByJobNo(pool, orderPayload.job_no);
        if (orderId) orderIdBySecImplId.set(Number(row.id), orderId);
      }
      summary.sec_impl_projects += 1;
      summary.sec_impl_orders += 1;
    }

    const [secImplPhaseRuns] = await pool.query(
      `SELECT id, job_id, action, from_stage, to_stage, result, remark, rework_reason, stage_payload,
              operator_sub, operator_name, operator_role, operated_at, created_at
       FROM \`${SEC_IMPL_DB}\`.sec_impl_stage_records
       ORDER BY id ASC${limitSql}`
    );
    for (const row of secImplPhaseRuns) {
      const orderId = dryRun ? 1 : orderIdBySecImplId.get(Number(row.job_id));
      if (!orderId) continue;
      if (!dryRun) {
        await upsertPhaseRun(pool, {
          job_id: orderId,
          source_system: 'sec-impl',
          legacy_phase_run_id: Number(row.id),
          action: trimText(row.action || ''),
          from_stage: trimText(row.from_stage || 'INIT').toUpperCase(),
          to_stage: trimText(row.to_stage || 'INIT').toUpperCase(),
          result: trimText(row.result || 'PASS').toUpperCase(),
          remark: trimText(row.remark || ''),
          rework_reason: trimText(row.rework_reason || ''),
          stage_payload: parseJsonSafe(row.stage_payload, row.stage_payload ? { raw: row.stage_payload } : null),
          operator_sub: normalizeUserSub(row.operator_sub),
          operator_name: trimText(row.operator_name || ''),
          operator_role: trimText(row.operator_role || ''),
          operated_at: row.operated_at || null,
          created_at: row.created_at || null,
        });
        await upsertWorkflowEvent(pool, {
          order_id: orderId,
          source_system: 'sec-impl',
          legacy_event_id: Number(row.id),
          action: trimText(row.action || row.to_stage || 'PHASE').toUpperCase(),
          from_status: null,
          to_status: trimText(row.to_stage || '').toUpperCase() === 'CLOSED' ? 'CLOSED' : 'ACTIVE',
          from_phase: trimText(row.from_stage || '').toUpperCase() || null,
          to_phase: trimText(row.to_stage || '').toUpperCase() || null,
          comment_text: trimText(row.remark || row.rework_reason || ''),
          operator_sub: normalizeUserSub(row.operator_sub),
          operator_name: trimText(row.operator_name || ''),
          operator_role: trimText(row.operator_role || ''),
          created_at: row.operated_at || row.created_at || null,
        });
      }
      summary.sec_impl_phase_runs += 1;
      summary.sec_impl_workflow_events += 1;
    }

    const [secImplDeliverables] = await pool.query(
      `SELECT id, job_id, stage_code, name, required_flag, done_flag, done_by_sub, done_by_name, done_by_role, done_at, created_at, updated_at
       FROM \`${SEC_IMPL_DB}\`.sec_impl_deliverables
       ORDER BY id ASC${limitSql}`
    );
    for (const row of secImplDeliverables) {
      const orderId = dryRun ? 1 : orderIdBySecImplId.get(Number(row.job_id));
      if (!orderId) continue;
      if (!dryRun) {
        await upsertDeliverable(pool, {
          job_id: orderId,
          source_system: 'sec-impl',
          legacy_deliverable_id: Number(row.id),
          stage_code: trimText(row.stage_code || 'INIT').toUpperCase(),
          name: trimText(row.name || ''),
          required_flag: Number(row.required_flag || 0) === 1 ? 1 : 0,
          done_flag: Number(row.done_flag || 0) === 1 ? 1 : 0,
          done_by_sub: normalizeUserSub(row.done_by_sub),
          done_by_name: trimText(row.done_by_name || ''),
          done_by_role: trimText(row.done_by_role || ''),
          done_at: row.done_at || null,
          created_at: row.created_at || null,
          updated_at: row.updated_at || row.created_at || null,
        });
      }
      summary.sec_impl_deliverables += 1;
    }

    const [secImplAttachments] = await pool.query(
      `SELECT id, job_id, stage_record_id, stage_code, file_name, stored_name, file_path, mime_type, file_size, remark,
              uploaded_by_sub, uploaded_by_name, uploaded_by_role, uploaded_at
       FROM \`${SEC_IMPL_DB}\`.sec_impl_attachments
       ORDER BY id ASC${limitSql}`
    );
    for (const row of secImplAttachments) {
      const orderId = dryRun ? 1 : orderIdBySecImplId.get(Number(row.job_id));
      if (!orderId) continue;
      if (!dryRun) {
        const copied = copyMigratedFile({
          sourceSystem: 'sec-impl',
          legacyId: row.id,
          sourcePath: row.file_path,
          fileName: row.file_name || row.stored_name,
        });
        if (!copied) {
          summary.missing_attachment_files += 1;
          continue;
        }
        const mappedStageRecordId = await findPhaseRunId(pool, 'sec-impl', Number(row.stage_record_id || 0));
        await upsertAttachment(pool, {
          job_id: orderId,
          source_system: 'sec-impl',
          legacy_attachment_id: Number(row.id),
          stage_record_id: mappedStageRecordId,
          stage_code: trimText(row.stage_code || 'INIT').toUpperCase(),
          file_name: trimText(row.file_name || copied.storedName),
          stored_name: copied.storedName,
          file_path: copied.filePath,
          mime_type: trimText(row.mime_type || 'application/octet-stream'),
          file_size: Number(row.file_size || 0),
          remark: trimText(row.remark || ''),
          uploaded_by_sub: normalizeUserSub(row.uploaded_by_sub),
          uploaded_by_name: trimText(row.uploaded_by_name || ''),
          uploaded_by_role: trimText(row.uploaded_by_role || ''),
          uploaded_at: row.uploaded_at || null,
        });
      }
      summary.sec_impl_attachments += 1;
    }

    const [secImplAuditLogs] = await pool.query(
      `SELECT id, job_id, user_sub, username, user_role, action, entity, entity_id, message, before_data, after_data,
              chain_prev_hash, chain_hash, chain_version, request_ip, created_at
       FROM \`${SEC_IMPL_DB}\`.sec_impl_operation_logs
       ORDER BY id ASC${limitSql}`
    );
    for (const row of secImplAuditLogs) {
      const orderId = dryRun ? 1 : orderIdBySecImplId.get(Number(row.job_id)) || null;
      if (!dryRun) {
        await upsertAuditLog(pool, {
          job_id: orderId,
          source_system: 'sec-impl',
          legacy_audit_id: Number(row.id),
          user_sub: normalizeUserSub(row.user_sub),
          username: trimText(row.username || ''),
          user_role: trimText(row.user_role || ''),
          action: trimText(row.action || ''),
          entity: trimText(row.entity || ''),
          entity_id: trimText(row.entity_id || ''),
          message: trimText(row.message || ''),
          before_data: parseJsonSafe(row.before_data, row.before_data ? { raw: row.before_data } : null),
          after_data: parseJsonSafe(row.after_data, row.after_data ? { raw: row.after_data } : null),
          chain_prev_hash: trimText(row.chain_prev_hash || ''),
          chain_hash: trimText(row.chain_hash || ''),
          chain_version: trimText(row.chain_version || 'v1'),
          request_ip: trimText(row.request_ip || ''),
          created_at: row.created_at || null,
        });
      }
      summary.sec_impl_audit_logs += 1;
    }

    const [secImplSlaRules] = await pool.query(
      `SELECT stage_code, threshold_hours, remind_interval_minutes, enabled, created_at, updated_at
       FROM \`${SEC_IMPL_DB}\`.sec_impl_sla_rules
       ORDER BY id ASC${limitSql}`
    );
    for (const row of secImplSlaRules) {
      if (!dryRun) {
        await upsertSlaRule(pool, {
          stage_code: trimText(row.stage_code || '').toUpperCase(),
          threshold_hours: Number(row.threshold_hours || 0),
          remind_interval_minutes: Number(row.remind_interval_minutes || 0),
          enabled: Number(row.enabled || 0) === 1 ? 1 : 0,
          created_at: row.created_at || null,
          updated_at: row.updated_at || row.created_at || null,
        });
      }
      summary.sec_impl_sla_rules += 1;
    }

    const [secImplSlaReminders] = await pool.query(
      `SELECT id, job_id, stage_code, threshold_hours, overdue_hours, message, created_at
       FROM \`${SEC_IMPL_DB}\`.sec_impl_sla_reminders
       ORDER BY id ASC${limitSql}`
    );
    for (const row of secImplSlaReminders) {
      const orderId = dryRun ? 1 : orderIdBySecImplId.get(Number(row.job_id));
      if (!orderId) continue;
      if (!dryRun) {
        await upsertSlaReminder(pool, {
          job_id: orderId,
          stage_code: trimText(row.stage_code || '').toUpperCase(),
          threshold_hours: Number(row.threshold_hours || 0),
          overdue_hours: Number(row.overdue_hours || 0),
          message: trimText(row.message || ''),
          created_at: row.created_at || null,
        });
      }
      summary.sec_impl_sla_reminders += 1;
    }

    const [secImplTemplates] = await pool.query(
      `SELECT product_code, product_name, enabled, created_at, updated_at
       FROM \`${SEC_IMPL_DB}\`.sec_impl_templates
       ORDER BY id ASC${limitSql}`
    );
    for (const row of secImplTemplates) {
      if (!dryRun) {
        await upsertTemplate(pool, {
          product_code: trimText(row.product_code || '').toUpperCase(),
          product_name: trimText(row.product_name || ''),
          enabled: Number(row.enabled || 0) === 1 ? 1 : 0,
          created_at: row.created_at || null,
          updated_at: row.updated_at || row.created_at || null,
        });
      }
      summary.sec_impl_templates += 1;
    }

    const [secImplTemplateRules] = await pool.query(
      `SELECT product_code, stage_code, required_deliverables_json, enabled, created_at, updated_at
       FROM \`${SEC_IMPL_DB}\`.sec_impl_template_stage_rules
       ORDER BY id ASC${limitSql}`
    );
    for (const row of secImplTemplateRules) {
      if (!dryRun) {
        await upsertTemplateRule(pool, {
          product_code: trimText(row.product_code || '').toUpperCase(),
          stage_code: trimText(row.stage_code || '').toUpperCase(),
          required_deliverables_json: parseJsonSafe(row.required_deliverables_json, []),
          enabled: Number(row.enabled || 0) === 1 ? 1 : 0,
          created_at: row.created_at || null,
          updated_at: row.updated_at || row.created_at || null,
        });
      }
      summary.sec_impl_template_rules += 1;
    }

    return summary;
  } finally {
    await pool.end();
  }
};

if (require.main === module) {
  const dryRun = String(process.env.DELIVERY_MIGRATION_DRY_RUN || 'true').trim().toLowerCase() !== 'false';
  const limit = Number(process.env.DELIVERY_MIGRATION_LIMIT || 0);
  runLegacyMigration({ dryRun, limit })
    .then((summary) => {
      console.log(`[delivery][migrate] ${JSON.stringify(summary)}`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('[delivery][migrate] failed:', err?.message || err);
      process.exit(1);
    });
}

module.exports = {
  buildOptionalColumnSql,
  mapSecImplProjectToDeliveryProject,
  mapSecImplRowToDeliveryOrder,
  mapTicketProjectToDeliveryProject,
  mapTicketRowToDeliveryOrder,
  resolveTicketStageCode,
  runLegacyMigration,
};
