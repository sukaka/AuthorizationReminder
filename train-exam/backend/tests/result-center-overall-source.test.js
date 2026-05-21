const fs = require('node:fs');
const path = require('node:path');

describe('result center overall evaluation route source', () => {
  const indexSource = fs.readFileSync(path.join(process.cwd(), 'src', 'index.js'), 'utf8');

  it('returns overall evaluation in candidate result history payload', () => {
    expect(indexSource).toMatch(/buildOverallEvaluation/);
    expect(indexSource).toMatch(/overall_evaluation:\s*buildOverallEvaluation\(\{\s*resultRows:\s*summaryRows/s);
  });
});
