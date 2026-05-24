const fs = require('fs');
const path = require('path');

const indexSource = fs.readFileSync(path.join(__dirname, '../src/index.js'), 'utf8');

describe('instructor review delete route source', () => {
  it('exposes an admin-only delete route that removes responses and the form', () => {
    expect(indexSource).toMatch(/app\.delete\('\/api\/train-exam\/admin\/instructor-review-forms\/:id', requireAdminOnly/);
    expect(indexSource).toMatch(/DELETE FROM te_instructor_review_responses\s+WHERE form_id = \?/);
    expect(indexSource).toMatch(/DELETE FROM te_instructor_review_forms\s+WHERE id = \?/);
    expect(indexSource).toMatch(/INSTRUCTOR_REVIEW_DELETE/);
  });
});
