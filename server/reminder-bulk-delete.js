const pickFilters = (filters = {}) => (filters && typeof filters === 'object' ? filters : {});

const isFilteredMode = (mode) => String(mode || 'filtered') !== 'all';

const appendScopeFilter = ({ scope, where, params, column = 'customers.id' }) => {
  if (!scope || scope.isAdmin) return;
  const ids = Array.isArray(scope.customerIds)
    ? scope.customerIds.map((id) => Number(id)).filter((id) => Number.isFinite(id))
    : [];
  if (!ids.length) {
    where.push('1 = 0');
    return;
  }
  where.push(`${column} IN (${ids.map(() => '?').join(', ')})`);
  params.push(...ids);
};

const finalizeFilter = (where, params) => ({
  whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '',
  params,
});

const normalizeExpiringDays = (value) => {
  const days = Number(value || 30);
  return Number.isFinite(days) && days > 0 ? Math.round(days) : 30;
};

const buildCustomerBulkFilter = ({ mode = 'filtered', filters, scope } = {}) => {
  const source = pickFilters(filters);
  const where = [];
  const params = [];
  if (isFilteredMode(mode) && source.search) {
    where.push('customers.name LIKE ?');
    params.push(`%${source.search}%`);
  }
  appendScopeFilter({ scope, where, params, column: 'customers.id' });
  return finalizeFilter(where, params);
};

const buildContactBulkFilter = ({ mode = 'filtered', filters, scope } = {}) => {
  const source = pickFilters(filters);
  const where = [];
  const params = [];
  if (isFilteredMode(mode)) {
    if (source.customer_id) {
      where.push('cc.customer_id = ?');
      params.push(source.customer_id);
    }
    if (source.is_active === '0' || source.is_active === '1') {
      where.push('contacts.is_active = ?');
      params.push(source.is_active);
    }
    if (source.search) {
      where.push('(contacts.name LIKE ? OR contacts.phone LIKE ? OR contacts.email LIKE ?)');
      params.push(`%${source.search}%`, `%${source.search}%`, `%${source.search}%`);
    }
  }
  appendScopeFilter({ scope, where, params, column: 'customers.id' });
  return finalizeFilter(where, params);
};

const buildLicenseBulkFilter = ({ mode = 'filtered', filters, scope } = {}) => {
  const source = pickFilters(filters);
  const where = [];
  const params = [];
  if (isFilteredMode(mode)) {
    if (source.customer_id) {
      where.push('licenses.customer_id = ?');
      params.push(source.customer_id);
    }
    if (source.status) {
      where.push('licenses.status = ?');
      params.push(source.status);
    }
    if (source.quick === 'expired') {
      where.push('licenses.end_date < CURDATE()');
    }
    if (source.quick === 'expiring') {
      where.push('licenses.end_date >= CURDATE()');
      where.push('licenses.end_date <= DATE_ADD(CURDATE(), INTERVAL ? DAY)');
      params.push(normalizeExpiringDays(source.days));
    }
    if (source.search) {
      where.push('(licenses.name LIKE ? OR customers.name LIKE ?)');
      params.push(`%${source.search}%`, `%${source.search}%`);
    }
    if (source.missing_screenshot === '1') {
      where.push("(licenses.screenshot_url IS NULL OR licenses.screenshot_url = '')");
    }
  }
  appendScopeFilter({ scope, where, params, column: 'customers.id' });
  return finalizeFilter(where, params);
};

const buildSendPlanBulkFilter = ({ mode = 'filtered', filters, scope } = {}) => {
  const source = pickFilters(filters);
  const where = [];
  const params = [];
  if (isFilteredMode(mode)) {
    if (source.enabled === '0' || source.enabled === '1') {
      where.push('send_plans.enabled = ?');
      params.push(source.enabled);
    }
    if (source.customer_id) {
      where.push('customers.id = ?');
      params.push(source.customer_id);
    }
    if (source.search) {
      where.push(`(
        send_plans.name LIKE ?
        OR licenses.name LIKE ?
        OR customers.name LIKE ?
        OR EXISTS (
          SELECT 1
          FROM contacts
          WHERE JSON_CONTAINS(send_plans.contact_ids, JSON_ARRAY(contacts.id), '$')
            AND (
              contacts.name LIKE ?
              OR contacts.phone LIKE ?
              OR contacts.email LIKE ?
              OR contacts.wecom_id LIKE ?
            )
        )
      )`);
      const keyword = `%${source.search}%`;
      params.push(keyword, keyword, keyword, keyword, keyword, keyword, keyword);
    }
  }
  appendScopeFilter({ scope, where, params, column: 'customers.id' });
  return finalizeFilter(where, params);
};

module.exports = {
  buildCustomerBulkFilter,
  buildContactBulkFilter,
  buildLicenseBulkFilter,
  buildSendPlanBulkFilter,
};
