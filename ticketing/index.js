const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const db = require('../server/db');

const app = express();
const PORT = process.env.PORT || 5182;
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://auth:5180';

const normalizeOrigin = (value) => String(value || '').trim().replace(/\/+$/, '');

const defaultOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
  'http://localhost:8081',
  'http://127.0.0.1:8081',
].map(normalizeOrigin);
const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map(normalizeOrigin)
  .filter(Boolean);

const corsOptions = {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    const requestOrigin = normalizeOrigin(origin);
    const list = allowedOrigins.length ? allowedOrigins : defaultOrigins;
    if (list.includes(requestOrigin)) return cb(null, true);
    return cb(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400,
};

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        frameAncestors: ["'self'"],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);
app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' }));

const authMiddleware = (req, res, next) => {
  if (req.path === '/health') return next();
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: '未登录' });
  }
  fetch(`${AUTH_SERVICE_URL}/api/auth/introspect`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  })
    .then(async (resp) => {
      if (!resp.ok) return res.status(401).json({ error: '登录已过期' });
      const data = await resp.json();
      const apps = Array.isArray(data?.apps) ? data.apps : [];
      if (!apps.includes('ticketing')) {
        return res.status(403).json({ error: '无权限访问工单管理系统' });
      }
      req.user = data?.user || null;
      req.apps = apps;
      return next();
    })
    .catch(() => res.status(401).json({ error: '登录已过期' }));
};

const authorize = async (req, { action, resource = {} }) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return { allow: false, reason: '未登录' };
  try {
    const resp = await fetch(`${AUTH_SERVICE_URL}/api/auth/authorize`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        system: 'ticketing',
        action,
        resource,
      }),
    });
    if (!resp.ok) return { allow: false, reason: '登录已过期' };
    const data = await resp.json();
    return data || { allow: false, reason: '无权限' };
  } catch (err) {
    return { allow: false, reason: '权限服务不可用' };
  }
};

const parseDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const isHalfDayAligned = (date) => {
  if (!date) return false;
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = date.getSeconds();
  return (hours === 0 || hours === 12) && minutes === 0 && seconds === 0;
};

const validateSchedule = (startAt, endAt) => {
  const start = parseDate(startAt);
  const end = parseDate(endAt);
  if (!start || !end) return '开始时间或结束时间不合法';
  if (!isHalfDayAligned(start) || !isHalfDayAligned(end)) {
    return '排期时间需按 0.5 天对齐（00:00 或 12:00）';
  }
  const diffMs = end.getTime() - start.getTime();
  if (diffMs <= 0) return '结束时间必须大于开始时间';
  const diffHours = diffMs / (1000 * 60 * 60);
  if (diffHours < 12 || diffHours % 12 !== 0) {
    return '最小排期为 0.5 天，且必须为 0.5 天的倍数';
  }
  return '';
};

const getTicketAuthResource = async (ticketId) => {
  const id = Number(ticketId);
  if (!Number.isFinite(id)) return { ticket_id: ticketId, ticket_exists: false };
  const ticket = await db.get('SELECT id, created_by FROM tickets WHERE id = ?', [id]);
  return {
    ticket_id: id,
    ticket_exists: !!ticket,
    ticket_created_by: ticket ? Number(ticket.created_by) : null,
  };
};

const getProjectAuthResource = async (projectId, userId, isAdmin) => {
  const id = Number(projectId);
  if (!Number.isFinite(id)) return { project_id: projectId, project_exists: false, project_has_owned_tickets: false };
  const project = await db.get('SELECT id FROM projects WHERE id = ?', [id]);
  if (!project) return { project_id: id, project_exists: false, project_has_owned_tickets: false };
  if (isAdmin) return { project_id: id, project_exists: true, project_has_owned_tickets: true };
  const count = await db.get(
    'SELECT COUNT(*) AS cnt FROM tickets WHERE project_id = ? AND created_by = ?',
    [id, Number(userId)]
  );
  return {
    project_id: id,
    project_exists: true,
    project_has_owned_tickets: Number(count?.cnt || 0) > 0,
  };
};

const formatDateTime = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (num) => String(num).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

app.use('/api', authMiddleware);

app.get('/api/projects', async (req, res) => {
  const rows = await db.query('SELECT * FROM projects ORDER BY id DESC');
  res.json(rows);
});

app.get('/api/templates', async (req, res) => {
  const authz = await authorize(req, { action: 'template:list' });
  if (!authz.allow) return res.status(403).json({ error: authz.reason || '无权限' });
  const rows = await db.query('SELECT * FROM ticket_templates ORDER BY id DESC');
  res.json(rows);
});

app.get('/api/templates/:id', async (req, res) => {
  const { id } = req.params;
  const authz = await authorize(req, { action: 'template:read' });
  if (!authz.allow) return res.status(403).json({ error: authz.reason || '无权限' });
  const template = await db.get('SELECT * FROM ticket_templates WHERE id = ?', [id]);
  if (!template) return res.status(404).json({ error: '模板不存在' });
  const stages = await db.query(
    'SELECT * FROM ticket_template_stages WHERE template_id = ? ORDER BY stage_order ASC',
    [id]
  );
  for (const stage of stages) {
    stage.deliverables = await db.query(
      'SELECT name FROM ticket_template_deliverables WHERE stage_id = ?',
      [stage.id]
    );
    stage.roles = await db.query(
      'SELECT role_name FROM ticket_template_roles WHERE stage_id = ?',
      [stage.id]
    );
    stage.deliverables = stage.deliverables.map((item) => item.name);
    stage.roles = stage.roles.map((item) => item.role_name);
  }
  res.json({ ...template, stages });
});

app.post('/api/templates/import', async (req, res) => {
  const authz = await authorize(req, { action: 'template:import' });
  if (!authz.allow) return res.status(403).json({ error: authz.reason || '无权限' });
  const payload = req.body || {};
  const templates = Array.isArray(payload.templates) ? payload.templates : [];
  if (templates.length === 0) return res.status(400).json({ error: '模板为空' });
  const inserted = [];
  await db.transaction(async (tx) => {
    for (const template of templates) {
      if (!template || !template.code || !template.name) continue;
      const info = await tx.run(
        'INSERT INTO ticket_templates (code, name, description) VALUES (?, ?, ?)',
        [String(template.code), String(template.name), String(template.description || '')]
      );
      const templateId = info.insertId;
      const stages = Array.isArray(template.stages) ? template.stages : [];
      let order = 1;
      for (const stage of stages) {
        if (!stage || !stage.name) continue;
        const stageInfo = await tx.run(
          'INSERT INTO ticket_template_stages (template_id, name, duration_days, stage_order) VALUES (?, ?, ?, ?)',
          [templateId, String(stage.name), Number(stage.duration_days || 0), order]
        );
        const stageId = stageInfo.insertId;
        const deliverables = Array.isArray(stage.deliverables) ? stage.deliverables : [];
        for (const item of deliverables) {
          if (!item) continue;
          await tx.run(
            'INSERT INTO ticket_template_deliverables (stage_id, name) VALUES (?, ?)',
            [stageId, String(item)]
          );
        }
        const roles = Array.isArray(stage.roles) ? stage.roles : [];
        for (const role of roles) {
          if (!role) continue;
          await tx.run(
            'INSERT INTO ticket_template_roles (stage_id, role_name) VALUES (?, ?)',
            [stageId, String(role)]
          );
        }
        order += 1;
      }
      inserted.push({ id: templateId, code: template.code, name: template.name });
    }
  });
  res.json({ ok: true, inserted });
});

app.post('/api/projects', async (req, res) => {
  const authz = await authorize(req, { action: 'project:create' });
  if (!authz.allow) return res.status(403).json({ error: authz.reason || '无权限' });
  const { name, description } = req.body || {};
  if (!name) return res.status(400).json({ error: '项目名称不能为空' });
  const info = await db.run(
    'INSERT INTO projects (name, description) VALUES (?, ?)',
    [String(name), String(description || '')]
  );
  const row = await db.get('SELECT * FROM projects WHERE id = ?', [info.insertId]);
  res.json(row);
});

app.put('/api/projects/:id', async (req, res) => {
  const { id } = req.params;
  const authz = await authorize(req, { action: 'project:update', resource: { project_id: id } });
  if (!authz.allow) return res.status(403).json({ error: authz.reason || '无权限' });
  const { name, description } = req.body || {};
  const project = await db.get('SELECT * FROM projects WHERE id = ?', [id]);
  if (!project) return res.status(404).json({ error: '项目不存在' });
  await db.run(
    'UPDATE projects SET name = ?, description = ? WHERE id = ?',
    [name !== undefined ? String(name) : project.name, description !== undefined ? String(description) : project.description, id]
  );
  const row = await db.get('SELECT * FROM projects WHERE id = ?', [id]);
  res.json(row);
});

app.delete('/api/projects/:id', async (req, res) => {
  const { id } = req.params;
  const authz = await authorize(req, { action: 'project:delete', resource: { project_id: id } });
  if (!authz.allow) return res.status(403).json({ error: authz.reason || '无权限' });
  await db.run('DELETE FROM projects WHERE id = ?', [id]);
  res.json({ ok: true });
});

app.get('/api/tickets', async (req, res) => {
  const authz = await authorize(req, { action: 'ticket:list' });
  if (!authz.allow) return res.status(403).json({ error: authz.reason || '无权限' });
  const { status, search } = req.query;
  const where = [];
  const params = [];
  if (status) {
    where.push('status = ?');
    params.push(status);
  }
  if (req.query.project_id) {
    where.push('project_id = ?');
    params.push(req.query.project_id);
  }
  if (search) {
    where.push('(title LIKE ? OR description LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }
  if (authz.constraints?.ownOnly) {
    where.push('created_by = ?');
    params.push(req.user.id);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = await db.query(
    `SELECT * FROM tickets ${whereSql} ORDER BY id DESC`,
    params
  );
  res.json(rows);
});

app.get('/api/schedules', async (req, res) => {
  const { engineer_id: engineerId, from, to } = req.query;
  const authz = await authorize(req, {
    action: 'schedule:list',
    resource: { engineer_id: engineerId || req.user.id },
  });
  if (!authz.allow) return res.status(403).json({ error: authz.reason || '无权限' });
  if (authz.constraints?.ownOnly) {
    const rows = await db.query(
      `SELECT * FROM schedules
       WHERE engineer_id = ?
         AND NOT (? <= start_at OR ? >= end_at)
       ORDER BY start_at ASC`,
      [req.user.id, to || '9999-12-31 23:59:59', from || '1970-01-01 00:00:00']
    );
    return res.json(rows);
  }
  if (!engineerId) return res.status(400).json({ error: '请指定工程师' });
  const rows = await db.query(
    `SELECT * FROM schedules
     WHERE engineer_id = ?
       AND NOT (? <= start_at OR ? >= end_at)
     ORDER BY start_at ASC`,
    [engineerId, to || '9999-12-31 23:59:59', from || '1970-01-01 00:00:00']
  );
  return res.json(rows);
});

app.get('/api/calendar/month', async (req, res) => {
  const year = Number(req.query.year);
  const month = Number(req.query.month);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return res.status(400).json({ error: 'year/month 参数不合法' });
  }
  const monthStart = new Date(year, month - 1, 1, 0, 0, 0);
  const monthEnd = new Date(year, month, 1, 0, 0, 0);
  const start = formatDateTime(monthStart);
  const end = formatDateTime(monthEnd);
  const params = [end, start];
  let where = 'WHERE NOT (? <= s.start_at OR ? >= s.end_at)';
  if (req.user.role !== 'admin') {
    where += ' AND s.engineer_id = ?';
    params.push(req.user.id);
  }
  const rows = await db.query(
    `SELECT s.id, s.engineer_id, s.ticket_id, s.start_at, s.end_at, u.username AS engineer_name, t.title AS ticket_title
     FROM schedules s
     LEFT JOIN users u ON u.id = s.engineer_id
     LEFT JOIN tickets t ON t.id = s.ticket_id
     ${where}
     ORDER BY s.start_at ASC`,
    params
  );
  const daysInMonth = new Date(year, month, 0).getDate();
  const days = [];
  for (let day = 1; day <= daysInMonth; day += 1) {
    const dayStart = new Date(year, month - 1, day, 0, 0, 0);
    const dayEnd = new Date(year, month - 1, day + 1, 0, 0, 0);
    const list = rows.filter((row) => {
      const s = new Date(row.start_at).getTime();
      const e = new Date(row.end_at).getTime();
      return s < dayEnd.getTime() && e > dayStart.getTime();
    });
    days.push({
      day,
      items: list.map((row) => ({
        schedule_id: row.id,
        engineer_id: row.engineer_id,
        engineer_name: row.engineer_name || `工程师${row.engineer_id}`,
        ticket_id: row.ticket_id,
        ticket_title: row.ticket_title || '-',
        start_at: formatDateTime(row.start_at),
        end_at: formatDateTime(row.end_at),
      })),
    });
  }
  return res.json({ year, month, days });
});

app.get('/api/projects/:id/gantt', async (req, res) => {
  const { id } = req.params;
  const projectResource = await getProjectAuthResource(id, req.user.id, req.user.role === 'admin');
  const authz = await authorize(req, { action: 'project:gantt', resource: projectResource });
  if (!authz.allow) {
    const code = authz.reason === '项目不存在' ? 404 : 403;
    return res.status(code).json({ error: authz.reason || '无权限' });
  }
  const project = await db.get('SELECT * FROM projects WHERE id = ?', [id]);
  if (!project) return res.status(404).json({ error: '项目不存在' });
  const tickets = await db.query(
    `SELECT * FROM tickets
     WHERE project_id = ?
     ${authz.scope?.isAdmin ? '' : 'AND created_by = ?'}
     ORDER BY id DESC`,
    authz.scope?.isAdmin ? [id] : [id, req.user.id]
  );
  const ticketIds = tickets.map((t) => t.id);
  const schedules = ticketIds.length
    ? await db.query(
        `SELECT s.*, u.username AS engineer_name
         FROM schedules s
         LEFT JOIN users u ON u.id = s.engineer_id
         WHERE s.ticket_id IN (${ticketIds.map(() => '?').join(',')})
         ORDER BY s.start_at ASC`,
        ticketIds
      )
    : [];

  const tasks = [];
  const resources = [];
  const resourceMap = new Map();

  const scheduleByTicket = new Map();
  schedules.forEach((row) => {
    if (!scheduleByTicket.has(row.ticket_id)) scheduleByTicket.set(row.ticket_id, []);
    scheduleByTicket.get(row.ticket_id).push(row);
    if (!resourceMap.has(row.engineer_id)) {
      const name = row.engineer_name || `工程师${row.engineer_id}`;
      resourceMap.set(row.engineer_id, { id: row.engineer_id, name });
      resources.push({ id: row.engineer_id, name });
    }
  });

  tickets.forEach((ticket) => {
    const list = scheduleByTicket.get(ticket.id) || [];
    let startAt = null;
    let endAt = null;
    if (list.length) {
      startAt = list.reduce((min, item) => (min && min < item.start_at ? min : item.start_at), null);
      endAt = list.reduce((max, item) => (max && max > item.end_at ? max : item.end_at), null);
    } else {
      startAt = ticket.created_at;
      endAt = ticket.created_at;
    }
    tasks.push({
      id: `T-${ticket.id}`,
      name: `工单：${ticket.title}`,
      start: formatDateTime(startAt),
      end: formatDateTime(endAt),
      progress: ticket.status === 'CLOSED' ? 100 : ticket.status === 'RESOLVED' ? 80 : 40,
      custom_class: 'ticket',
      dependencies: '',
      assignees: list.map((item) => resourceMap.get(item.engineer_id)).filter(Boolean),
    });

    list.forEach((item) => {
      tasks.push({
        id: `S-${item.id}`,
        name: `${resourceMap.get(item.engineer_id)?.name || '工程师'} 排期：${ticket.title}`,
        start: formatDateTime(item.start_at),
        end: formatDateTime(item.end_at),
        progress: 100,
        custom_class: 'schedule',
        dependencies: `T-${ticket.id}`,
        assignees: resourceMap.get(item.engineer_id) ? [resourceMap.get(item.engineer_id)] : [],
      });
    });
  });

  return res.json({
    project_id: Number(id),
    project_name: project.name,
    tasks,
    resources,
  });
});

app.get('/api/users', async (req, res) => {
  const authz = await authorize(req, { action: 'user:list' });
  if (!authz.allow) return res.status(403).json({ error: authz.reason || '无权限' });
  const rows = await db.query('SELECT id, username, role FROM users ORDER BY id DESC');
  res.json(rows);
});

app.post('/api/schedules', async (req, res) => {
  const { engineer_id: engineerId, ticket_id: ticketId, start_at: startAt, end_at: endAt, remark } = req.body || {};
  const error = validateSchedule(startAt, endAt);
  if (error) return res.status(400).json({ error });
  const targetEngineer = engineerId ? Number(engineerId) : Number(req.user.id);
  if (!targetEngineer) return res.status(400).json({ error: '工程师不能为空' });
  const ticketResource = ticketId ? await getTicketAuthResource(ticketId) : {};
  const authz = await authorize(req, {
    action: 'schedule:assign',
    resource: { engineer_id: targetEngineer, ...ticketResource },
  });
  if (!authz.allow) {
    const code = authz.reason === '工单不存在' ? 404 : 403;
    return res.status(code).json({ error: authz.reason || '无权限' });
  }
  const conflict = await db.get(
    `SELECT COUNT(*) AS cnt
     FROM schedules
     WHERE engineer_id = ?
       AND NOT (? <= start_at OR ? >= end_at)`,
    [targetEngineer, endAt, startAt]
  );
  if (conflict?.cnt > 0) return res.status(409).json({ error: '该工程师在此时间段已有排期' });
  const info = await db.run(
    `INSERT INTO schedules (engineer_id, ticket_id, start_at, end_at, remark)
     VALUES (?, ?, ?, ?, ?)`,
    [targetEngineer, ticketId || null, startAt, endAt, remark || null]
  );
  const row = await db.get('SELECT * FROM schedules WHERE id = ?', [info.insertId]);
  return res.json(row);
});

app.post('/api/tickets', async (req, res) => {
  const authz = await authorize(req, { action: 'ticket:create' });
  if (!authz.allow) return res.status(403).json({ error: authz.reason || '无权限' });
  const { title, description, priority, project_id: projectId } = req.body || {};
  if (!title) return res.status(400).json({ error: '标题不能为空' });
  const info = await db.run(
    'INSERT INTO tickets (title, description, status, priority, created_by, project_id) VALUES (?, ?, ?, ?, ?, ?)',
    [
      String(title),
      String(description || ''),
      'OPEN',
      String(priority || 'P2'),
      req.user.id,
      projectId || null,
    ]
  );
  const row = await db.get('SELECT * FROM tickets WHERE id = ?', [info.insertId]);
  res.json(row);
});

app.get('/api/tickets/:id/assignees', async (req, res) => {
  const { id } = req.params;
  const authz = await authorize(req, { action: 'ticket:assignees', resource: { ticket_id: id } });
  if (!authz.allow) return res.status(403).json({ error: authz.reason || '无权限' });
  const rows = await db.query(
    `SELECT u.id, u.username, u.role
     FROM ticket_assignees ta
     JOIN users u ON u.id = ta.user_id
     WHERE ta.ticket_id = ?`,
    [id]
  );
  res.json(rows);
});

app.put('/api/tickets/:id/assignees', async (req, res) => {
  const { id } = req.params;
  const { user_ids: userIds } = req.body || {};
  const authz = await authorize(req, { action: 'ticket:assign', resource: { ticket_id: id } });
  if (!authz.allow) return res.status(403).json({ error: authz.reason || '无权限' });
  const ids = Array.isArray(userIds) ? userIds.map((v) => Number(v)).filter((v) => Number.isFinite(v)) : [];
  await db.transaction(async (tx) => {
    await tx.run('DELETE FROM ticket_assignees WHERE ticket_id = ?', [id]);
    for (const uid of ids) {
      await tx.run('INSERT INTO ticket_assignees (ticket_id, user_id) VALUES (?, ?)', [id, uid]);
    }
  });
  const rows = await db.query(
    `SELECT u.id, u.username, u.role
     FROM ticket_assignees ta
     JOIN users u ON u.id = ta.user_id
     WHERE ta.ticket_id = ?`,
    [id]
  );
  res.json(rows);
});

app.post('/api/tickets/:id/schedule', async (req, res) => {
  const { id } = req.params;
  const { engineer_id: engineerId, start_at: startAt, end_at: endAt, remark } = req.body || {};
  const error = validateSchedule(startAt, endAt);
  if (error) return res.status(400).json({ error });
  const targetEngineer = engineerId ? Number(engineerId) : Number(req.user.id);
  if (!targetEngineer) return res.status(400).json({ error: '工程师不能为空' });
  const ticketResource = await getTicketAuthResource(id);
  const authz = await authorize(req, {
    action: 'schedule:assign',
    resource: { engineer_id: targetEngineer, ...ticketResource },
  });
  if (!authz.allow) {
    const code = authz.reason === '工单不存在' ? 404 : 403;
    return res.status(code).json({ error: authz.reason || '无权限' });
  }
  const conflict = await db.get(
    `SELECT COUNT(*) AS cnt
     FROM schedules
     WHERE engineer_id = ?
       AND NOT (? <= start_at OR ? >= end_at)`,
    [targetEngineer, endAt, startAt]
  );
  if (conflict?.cnt > 0) return res.status(409).json({ error: '该工程师在此时间段已有排期' });
  const info = await db.run(
    `INSERT INTO schedules (engineer_id, ticket_id, start_at, end_at, remark)
     VALUES (?, ?, ?, ?, ?)`,
    [targetEngineer, id, startAt, endAt, remark || null]
  );
  const row = await db.get('SELECT * FROM schedules WHERE id = ?', [info.insertId]);
  return res.json(row);
});

app.get('/api/tickets/:id/stages', async (req, res) => {
  const { id } = req.params;
  const ticketResource = await getTicketAuthResource(id);
  const authz = await authorize(req, { action: 'ticket:stages', resource: ticketResource });
  if (!authz.allow) {
    const code = authz.reason === '工单不存在' ? 404 : 403;
    return res.status(code).json({ error: authz.reason || '无权限' });
  }
  const rows = await db.query(
    'SELECT * FROM ticket_stages WHERE ticket_id = ? ORDER BY stage_order ASC',
    [id]
  );
  res.json(rows);
});

app.put('/api/tickets/:id/stages/:stageId', async (req, res) => {
  const { id, stageId } = req.params;
  const { status } = req.body || {};
  const ticketResource = await getTicketAuthResource(id);
  const authz = await authorize(req, { action: 'ticket:stages', resource: ticketResource });
  if (!authz.allow) {
    const code = authz.reason === '工单不存在' ? 404 : 403;
    return res.status(code).json({ error: authz.reason || '无权限' });
  }
  const stage = await db.get('SELECT * FROM ticket_stages WHERE id = ? AND ticket_id = ?', [
    stageId,
    id,
  ]);
  if (!stage) return res.status(404).json({ error: '阶段不存在' });
  const nextStatus = String(status || '').toUpperCase();
  if (!['PENDING', 'IN_PROGRESS', 'DONE'].includes(nextStatus)) {
    return res.status(400).json({ error: '状态不合法' });
  }
  await db.run('UPDATE ticket_stages SET status = ? WHERE id = ?', [nextStatus, stageId]);
  const updated = await db.get('SELECT * FROM ticket_stages WHERE id = ?', [stageId]);
  res.json(updated);
});

app.post('/api/tickets/:id/stages/from-template', async (req, res) => {
  const { id } = req.params;
  const { template_id: templateId, mode } = req.body || {};
  const ticketResource = await getTicketAuthResource(id);
  const authz = await authorize(req, { action: 'ticket:generate-stages', resource: ticketResource });
  if (!authz.allow) {
    const code = authz.reason === '工单不存在' ? 404 : 403;
    return res.status(code).json({ error: authz.reason || '无权限' });
  }
  if (!templateId) return res.status(400).json({ error: '模板不能为空' });
  const template = await db.get('SELECT * FROM ticket_templates WHERE id = ?', [templateId]);
  if (!template) return res.status(404).json({ error: '模板不存在' });
  const stages = await db.query(
    'SELECT * FROM ticket_template_stages WHERE template_id = ? ORDER BY stage_order ASC',
    [templateId]
  );
  if (stages.length === 0) return res.status(400).json({ error: '模板无阶段' });
  await db.transaction(async (tx) => {
    if ((mode || 'replace') === 'replace') {
      await tx.run('DELETE FROM ticket_stages WHERE ticket_id = ?', [id]);
    }
    for (const stage of stages) {
      await tx.run(
        'INSERT INTO ticket_stages (ticket_id, name, duration_days, stage_order, status) VALUES (?, ?, ?, ?, ?)',
        [id, stage.name, stage.duration_days, stage.stage_order, 'PENDING']
      );
    }
  });
  const rows = await db.query(
    'SELECT * FROM ticket_stages WHERE ticket_id = ? ORDER BY stage_order ASC',
    [id]
  );
  res.json({ ok: true, stages: rows });
});

app.put('/api/tickets/:id', async (req, res) => {
  const { id } = req.params;
  const ticket = await db.get('SELECT * FROM tickets WHERE id = ?', [id]);
  const authz = await authorize(req, {
    action: 'ticket:update',
    resource: {
      ticket_id: Number(id),
      ticket_exists: !!ticket,
      ticket_created_by: ticket ? Number(ticket.created_by) : null,
    },
  });
  if (!authz.allow) {
    const code = authz.reason === '工单不存在' ? 404 : 403;
    return res.status(code).json({ error: authz.reason || '无权限' });
  }
  const { title, description, status, priority, project_id: projectId } = req.body || {};
  if (!ticket) return res.status(404).json({ error: '工单不存在' });
  await db.run(
    'UPDATE tickets SET title = ?, description = ?, status = ?, priority = ?, project_id = ?, updated_at = NOW() WHERE id = ?',
    [
      title !== undefined ? String(title) : ticket.title,
      description !== undefined ? String(description) : ticket.description,
      status || ticket.status,
      priority || ticket.priority,
      projectId !== undefined ? projectId : ticket.project_id,
      id,
    ]
  );
  const row = await db.get('SELECT * FROM tickets WHERE id = ?', [id]);
  res.json(row);
});

app.delete('/api/tickets/:id', async (req, res) => {
  const { id } = req.params;
  const ticketResource = await getTicketAuthResource(id);
  const authz = await authorize(req, { action: 'ticket:delete', resource: ticketResource });
  if (!authz.allow) return res.status(403).json({ error: authz.reason || '无权限' });
  await db.run('DELETE FROM tickets WHERE id = ?', [id]);
  res.json({ ok: true });
});

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

const start = async () => {
  await db.ready;
  app.listen(PORT, () => {
    console.log(`Ticketing server running at http://localhost:${PORT}`);
  });
};

start();
