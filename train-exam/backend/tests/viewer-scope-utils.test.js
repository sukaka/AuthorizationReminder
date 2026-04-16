const { isBasicViewerApiAllowed } = require('../src/viewer-scope-utils');

describe('viewer scope utils', () => {
  it('allows only course list, paper list, exam start, my results and own result detail routes', () => {
    expect(isBasicViewerApiAllowed({ method: 'GET', path: '/api/train-exam/courses' })).toBe(true);
    expect(isBasicViewerApiAllowed({ method: 'GET', path: '/api/train-exam/courses/12/learning-path' })).toBe(true);
    expect(isBasicViewerApiAllowed({ method: 'GET', path: '/api/train-exam/papers' })).toBe(true);
    expect(isBasicViewerApiAllowed({ method: 'POST', path: '/api/train-exam/papers/9/exam/start' })).toBe(true);
    expect(isBasicViewerApiAllowed({ method: 'GET', path: '/api/train-exam/my/results' })).toBe(true);
    expect(isBasicViewerApiAllowed({ method: 'GET', path: '/api/train-exam/results/18' })).toBe(true);
    expect(isBasicViewerApiAllowed({ method: 'GET', path: '/api/train-exam/results/18/review-detail' })).toBe(true);
  });

  it('rejects retrain, recertification and certificate routes for basic viewers', () => {
    expect(isBasicViewerApiAllowed({ method: 'GET', path: '/api/train-exam/my/wrong-questions' })).toBe(false);
    expect(isBasicViewerApiAllowed({ method: 'GET', path: '/api/train-exam/my/retrain-recommendations' })).toBe(false);
    expect(isBasicViewerApiAllowed({ method: 'GET', path: '/api/train-exam/my/recertification' })).toBe(false);
    expect(isBasicViewerApiAllowed({ method: 'POST', path: '/api/train-exam/recertification/jobs/3/start' })).toBe(false);
    expect(isBasicViewerApiAllowed({ method: 'POST', path: '/api/train-exam/retrain/start' })).toBe(false);
    expect(isBasicViewerApiAllowed({ method: 'POST', path: '/api/train-exam/results/18/certificate/generate' })).toBe(false);
    expect(isBasicViewerApiAllowed({ method: 'GET', path: '/api/train-exam/results/18/certificate/download' })).toBe(false);
  });
});
