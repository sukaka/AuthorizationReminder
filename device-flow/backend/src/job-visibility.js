const normalizeText = (value) => String(value ?? '').trim();

const normalizeJobAlias = (value) => {
  const alias = normalizeText(value) || 'j';
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) {
    throw new Error('invalid job table alias');
  }
  return alias;
};

const buildJobVisibilityScope = ({ actor, jobAlias = 'j' } = {}) => {
  const role = normalizeText(actor?.role).toLowerCase();
  if (role === 'admin') return { sql: '', params: [] };

  const actorSub = normalizeText(actor?.sub);
  if (!actorSub) throw new Error('authenticated user id is required');
  const alias = normalizeJobAlias(jobAlias);

  return {
    sql: `(${alias}.created_by_sub = ? OR EXISTS (
      SELECT 1
      FROM device_dual_sign_sessions visibility_ds
      WHERE visibility_ds.job_id = ${alias}.id
        AND (
          visibility_ds.expected_second_signer_sub = ?
          OR visibility_ds.second_signer_sub = ?
        )
    ))`,
    params: [actorSub, actorSub, actorSub],
  };
};

module.exports = {
  buildJobVisibilityScope,
};

