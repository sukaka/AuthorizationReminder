const fs = require('node:fs');
const path = require('node:path');

describe('admin result paper overview source', () => {
  const indexSource = fs.readFileSync(path.join(__dirname, '../src/index.js'), 'utf8');

  it('builds rating distribution from final result scores only', () => {
    expect(indexSource).toMatch(/SUM\(CASE WHEN r\.is_final = 1 AND r\.total_score > 0 AND \(r\.score \/ r\.total_score\) >= 0\.9 THEN 1 ELSE 0 END\) AS rating_a_count/);
    expect(indexSource).toMatch(/SUM\(CASE WHEN r\.is_final = 1 AND r\.total_score > 0 AND \(r\.score \/ r\.total_score\) >= 0\.8 AND \(r\.score \/ r\.total_score\) < 0\.9 THEN 1 ELSE 0 END\) AS rating_b_count/);
    expect(indexSource).toMatch(/SUM\(CASE WHEN r\.is_final = 1 AND r\.total_score > 0 AND \(r\.score \/ r\.total_score\) >= 0\.6 AND \(r\.score \/ r\.total_score\) < 0\.8 THEN 1 ELSE 0 END\) AS rating_c_count/);
    expect(indexSource).toMatch(/SUM\(CASE WHEN r\.is_final = 1 AND r\.id IS NOT NULL AND \(r\.total_score <= 0 OR \(r\.total_score > 0 AND \(r\.score \/ r\.total_score\) < 0\.6\)\) THEN 1 ELSE 0 END\) AS rating_d_count/);
  });
});
