const {
  getApiBase,
  getAuthBase,
  request,
  ensureStatus,
  ensureJsonField,
  uniqueCode,
  loginByPassword,
} = require('./helpers/api');

const LEGACY_BUILTIN_PASSWORD = 'Dm1vbnqsILIVjUa5sWixBFos60bKdEKC';

const normalizeText = (value) => String(value || '').trim();
const uniqueNonEmpty = (items = []) => Array.from(new Set(items.map((item) => normalizeText(item)).filter(Boolean)));

const resolveAdminToken = async ({ authBase }) => {
  const direct = normalizeText(process.env.AUTH_TOKEN || process.env.ADMIN_TOKEN);
  if (direct) return direct;

  const usernames = uniqueNonEmpty([process.env.ADMIN_LOGIN, process.env.ADMIN_USERNAME, 'admin']);
  const passwords = uniqueNonEmpty([
    process.env.ADMIN_PASSWORD,
    process.env.BUILTIN_ACCOUNT_DEFAULT_PASSWORD,
    process.env.BUILTIN_PASSWORD,
    '123456',
    LEGACY_BUILTIN_PASSWORD,
  ]);

  for (const username of usernames) {
    for (const password of passwords) {
      try {
        const token = await loginByPassword({ authBase, loginId: username, password });
        if (token) return token;
      } catch {
        // continue
      }
    }
  }

  return '';
};

describe('train-exam smoke e2e', () => {
  const apiBase = getApiBase();
  const authBase = getAuthBase();

  it('should complete core flow: course -> question -> paper -> exam -> certificate', async () => {
    const token = await resolveAdminToken({ authBase });
    if (!token) {
      console.warn('[train-exam smoke] skip: no admin token could be resolved');
      return;
    }

    const meResp = await request({
      base: apiBase,
      path: '/api/auth/me',
      method: 'GET',
      token,
    });
    ensureStatus(meResp, 200);
    const meId = Number(ensureJsonField(meResp, 'id'));
    const meUsername = String(ensureJsonField(meResp, 'username'));

    const settingsResp = await request({
      base: apiBase,
      path: '/api/train-exam/settings',
      method: 'GET',
      token,
    });
    ensureStatus(settingsResp, 200);
    const currentDocThreshold = Number(settingsResp.json?.doc_preview_min_seconds || 45);
    expect(currentDocThreshold).toBeGreaterThanOrEqual(15);
    expect(currentDocThreshold).toBeLessThanOrEqual(600);

    const nextDocThreshold = currentDocThreshold >= 90 ? 45 : 90;
    const updateSettingsResp = await request({
      base: apiBase,
      path: '/api/train-exam/settings/doc-preview-threshold',
      method: 'PUT',
      token,
      body: {
        min_read_seconds: nextDocThreshold,
      },
    });
    ensureStatus(updateSettingsResp, 200);
    expect(Number(updateSettingsResp.json?.doc_preview_min_seconds || 0)).toBe(nextDocThreshold);

    const restoreSettingsResp = await request({
      base: apiBase,
      path: '/api/train-exam/settings/doc-preview-threshold',
      method: 'PUT',
      token,
      body: {
        min_read_seconds: currentDocThreshold,
      },
    });
    ensureStatus(restoreSettingsResp, 200);
    expect(Number(restoreSettingsResp.json?.doc_preview_min_seconds || 0)).toBe(currentDocThreshold);

    const modelsResp = await request({
      base: apiBase,
      path: '/api/train-exam/ai/models',
      method: 'GET',
      token,
    });
    ensureStatus(modelsResp, 200);
    const modelKeys = Array.isArray(modelsResp.json) ? modelsResp.json.map((item) => normalizeText(item?.model_key)) : [];
    expect(modelKeys).toEqual(expect.arrayContaining(['kimi_2_5', 'chatgpt', 'doubao']));
    const firstModelId = Number((Array.isArray(modelsResp.json) ? modelsResp.json[0]?.id : 0) || 0);
    if (firstModelId > 0) {
      const testModelResp = await request({
        base: apiBase,
        path: `/api/train-exam/ai/models/${firstModelId}/test`,
        method: 'POST',
        token,
        body: {},
        timeoutMs: 30000,
      });
      ensureStatus(testModelResp, 200);
      expect(typeof testModelResp.json?.available).toBe('boolean');
      expect(typeof testModelResp.json?.status).toBe('string');
    }

    const profileResp = await request({
      base: apiBase,
      path: `/api/train-exam/user-profiles/${meId}`,
      method: 'PUT',
      token,
      body: {
        username: meUsername,
        department: '研发部',
        position_title: '工程师',
      },
    });
    ensureStatus(profileResp, 200);

    const courseResp = await request({
      base: apiBase,
      path: '/api/train-exam/courses',
      method: 'POST',
      token,
      body: {
        title: uniqueCode('COURSE'),
        description: 'smoke course',
        duration_minutes: 60,
      },
    });
    ensureStatus(courseResp, 201);
    const courseId = Number(ensureJsonField(courseResp, 'id'));

    const resourceResp = await request({
      base: apiBase,
      path: `/api/train-exam/courses/${courseId}/resources`,
      method: 'POST',
      token,
      body: {
        name: uniqueCode('RESOURCE') + ' 学习资料',
        resource_type: 'link',
        source_mode: 'external',
        source_url: 'https://example.com/train-exam-learning',
        sort_order: 1,
      },
    });
    ensureStatus(resourceResp, 201);
    const resourceId = Number(ensureJsonField(resourceResp, 'id'));

    const progressResp = await request({
      base: apiBase,
      path: `/api/train-exam/resources/${resourceId}/progress`,
      method: 'POST',
      token,
      body: {
        progress_percent: 100,
        mark_completed: true,
      },
    });
    ensureStatus(progressResp, 200);
    expect(Number(progressResp.json?.progress_percent || 0)).toBeGreaterThanOrEqual(100);

    const learningPathResp = await request({
      base: apiBase,
      path: `/api/train-exam/courses/${courseId}/learning-path`,
      method: 'GET',
      token,
    });
    ensureStatus(learningPathResp, 200);
    expect(Number(learningPathResp.json?.summary?.completed_resources || 0)).toBeGreaterThanOrEqual(1);

    const myLearningResp = await request({
      base: apiBase,
      path: '/api/train-exam/my/learning-progress',
      method: 'GET',
      token,
    });
    ensureStatus(myLearningResp, 200);
    expect(Number(myLearningResp.json?.summary?.total_courses || 0)).toBeGreaterThanOrEqual(1);

    const questionResp1 = await request({
      base: apiBase,
      path: '/api/train-exam/questions',
      method: 'POST',
      token,
      body: {
        stem: uniqueCode('QUESTION') + ' 第一题：以下哪项描述是正确的？',
        question_type: 'single_choice',
        difficulty: 'easy',
        points: 2,
        options: [
          { key: 'A', text: '正确选项' },
          { key: 'B', text: '错误选项1' },
          { key: 'C', text: '错误选项2' },
        ],
        answer: ['A'],
        explanation: 'A is correct',
        tags: ['smoke', 'policy'],
      },
    });
    ensureStatus(questionResp1, 201);
    const questionId1 = Number(ensureJsonField(questionResp1, 'id'));

    const questionResp2 = await request({
      base: apiBase,
      path: '/api/train-exam/questions',
      method: 'POST',
      token,
      body: {
        stem: uniqueCode('QUESTION') + ' 第二题：以下哪项描述是正确的？',
        question_type: 'single_choice',
        difficulty: 'easy',
        points: 2,
        options: [
          { key: 'A', text: '错误选项' },
          { key: 'B', text: '正确选项' },
        ],
        answer: ['B'],
        explanation: 'B is correct',
        tags: ['smoke', 'ops'],
      },
    });
    ensureStatus(questionResp2, 201);
    const questionId2 = Number(ensureJsonField(questionResp2, 'id'));

    const reviewResp1 = await request({
      base: apiBase,
      path: `/api/train-exam/questions/${questionId1}/review`,
      method: 'POST',
      token,
      body: {
        action: 'approve',
        comment: 'smoke approve',
      },
    });
    ensureStatus(reviewResp1, 200);

    const reviewResp2 = await request({
      base: apiBase,
      path: `/api/train-exam/questions/${questionId2}/review`,
      method: 'POST',
      token,
      body: {
        action: 'approve',
        comment: 'smoke approve',
      },
    });
    ensureStatus(reviewResp2, 200);

    const paperResp = await request({
      base: apiBase,
      path: '/api/train-exam/papers',
      method: 'POST',
      token,
      body: {
        name: uniqueCode('PAPER'),
        paper_mode: 'fixed',
        pass_score: 1,
        duration_minutes: 60,
        max_attempts: 3,
        fixed_question_ids: [questionId1, questionId2],
      },
    });
    ensureStatus(paperResp, 201);
    const paperId = Number(ensureJsonField(paperResp, 'id'));

    const publishResp = await request({
      base: apiBase,
      path: `/api/train-exam/papers/${paperId}/publish`,
      method: 'POST',
      token,
      body: {},
    });
    ensureStatus(publishResp, 200);

    const startResp = await request({
      base: apiBase,
      path: `/api/train-exam/papers/${paperId}/exam/start`,
      method: 'POST',
      token,
      body: {},
    });
    ensureStatus(startResp, 201);
    const sessionId = Number(startResp.json?.session?.id || 0);
    expect(sessionId).toBeGreaterThan(0);

    const examQuestions = Array.isArray(startResp.json?.questions) ? startResp.json.questions : [];
    expect(examQuestions.length).toBeGreaterThanOrEqual(2);

    const resumeResp = await request({
      base: apiBase,
      path: `/api/train-exam/papers/${paperId}/exam/start`,
      method: 'POST',
      token,
      body: {},
    });
    ensureStatus(resumeResp, 200);
    expect(Number(resumeResp.json?.session?.id || 0)).toBe(sessionId);
    expect(String(resumeResp.json?.session?.status || '').toLowerCase()).toBe('started');
    expect(Array.isArray(resumeResp.json?.questions)).toBe(true);
    expect(resumeResp.json.questions.length).toBe(examQuestions.length);

    for (const question of examQuestions) {
      const qid = Number(question?.question_id || 0);
      const userAnswer = ['A'];
      const answerResp = await request({
        base: apiBase,
        path: `/api/train-exam/exam-sessions/${sessionId}/answers`,
        method: 'POST',
        token,
        body: {
          question_id: qid,
          user_answer: userAnswer,
        },
      });
      ensureStatus(answerResp, 200);
    }

    const submitResp = await request({
      base: apiBase,
      path: `/api/train-exam/exam-sessions/${sessionId}/submit`,
      method: 'POST',
      token,
      body: {},
    });
    ensureStatus(submitResp, 200);
    const resultId = Number(ensureJsonField(submitResp, 'id'));
    expect(Number(submitResp.json?.passed || 0)).toBe(1);
    expect(submitResp.json?.ai_advice).toBeTruthy();
    expect(typeof submitResp.json?.ai_advice?.advice_text).toBe('string');

    const adviceResp = await request({
      base: apiBase,
      path: `/api/train-exam/results/${resultId}/advice`,
      method: 'GET',
      token,
    });
    ensureStatus(adviceResp, 200);
    expect(adviceResp.json).toBeTruthy();
    expect(typeof adviceResp.json?.advice_text).toBe('string');

    const orgResp = await request({
      base: apiBase,
      path: '/api/train-exam/stats/org-breakdown?group_by=department&final_only=true',
      method: 'GET',
      token,
    });
    ensureStatus(orgResp, 200);
    expect(Array.isArray(orgResp.json?.items)).toBe(true);
    expect(orgResp.json.items.length).toBeGreaterThan(0);

    const wrongResp = await request({
      base: apiBase,
      path: '/api/train-exam/my/wrong-questions?page=1&limit=20',
      method: 'GET',
      token,
    });
    ensureStatus(wrongResp, 200);
    const wrongItems = Array.isArray(wrongResp.json?.items) ? wrongResp.json.items : [];
    expect(wrongItems.length).toBeGreaterThan(0);
    expect(wrongItems.some((item) => Number(item.question_id) === questionId2)).toBe(true);

    const retrainResp = await request({
      base: apiBase,
      path: '/api/train-exam/my/retrain-recommendations?limit=3',
      method: 'GET',
      token,
    });
    ensureStatus(retrainResp, 200);
    expect(Number(retrainResp.json?.summary?.wrong_question_total || 0)).toBeGreaterThan(0);
    expect(Array.isArray(retrainResp.json?.recommendations)).toBe(true);

    const retrainStartByResultResp = await request({
      base: apiBase,
      path: '/api/train-exam/retrain/start',
      method: 'POST',
      token,
      body: {
        mode: 'result',
        result_id: resultId,
        question_type: 'single_choice',
        question_category: '手工创建',
      },
    });
    ensureStatus(retrainStartByResultResp, 201);
    const retrainSessionId1 = Number(retrainStartByResultResp.json?.session?.id || 0);
    expect(retrainSessionId1).toBeGreaterThan(0);
    expect(Array.isArray(retrainStartByResultResp.json?.questions)).toBe(true);
    expect(retrainStartByResultResp.json.questions.length).toBeGreaterThan(0);

    const retrainStartByResultResp2 = await request({
      base: apiBase,
      path: '/api/train-exam/retrain/start',
      method: 'POST',
      token,
      body: {
        mode: 'result',
        result_id: resultId,
      },
    });
    ensureStatus(retrainStartByResultResp2, 201);
    const retrainSessionId2 = Number(retrainStartByResultResp2.json?.session?.id || 0);
    expect(retrainSessionId2).toBeGreaterThan(0);
    expect(retrainSessionId2).not.toBe(retrainSessionId1);

    const certResp = await request({
      base: apiBase,
      path: `/api/train-exam/results/${resultId}/certificate/generate`,
      method: 'POST',
      token,
      body: {},
    });
    ensureStatus(certResp, 201);
    expect(normalizeText(certResp.json?.certificate_no)).toContain('CERT-');

    const myCertResp = await request({
      base: apiBase,
      path: '/api/train-exam/my/certificates',
      method: 'GET',
      token,
    });
    ensureStatus(myCertResp, 200);
    expect(Array.isArray(myCertResp.json)).toBe(true);
    expect(myCertResp.json.some((item) => Number(item.result_id) === resultId)).toBe(true);

    const recertResp = await request({
      base: apiBase,
      path: '/api/train-exam/my/recertification',
      method: 'GET',
      token,
    });
    ensureStatus(recertResp, 200);
    expect(Array.isArray(recertResp.json)).toBe(true);

    const deletePaperResp = await request({
      base: apiBase,
      path: `/api/train-exam/papers/${paperId}?force=1`,
      method: 'DELETE',
      token,
      body: {},
    });
    ensureStatus(deletePaperResp, 200);
    expect(Number(deletePaperResp.json?.removed_results || 0)).toBeGreaterThanOrEqual(1);

    const deletedPaperDetailResp = await request({
      base: apiBase,
      path: `/api/train-exam/papers/${paperId}`,
      method: 'GET',
      token,
    });
    ensureStatus(deletedPaperDetailResp, 404);

    const bulkPaperIds = [];
    for (let i = 0; i < 2; i += 1) {
      const draftPaperResp = await request({
        base: apiBase,
        path: '/api/train-exam/papers',
        method: 'POST',
        token,
        body: {
          name: uniqueCode('PAPER-DEL'),
          paper_mode: 'fixed',
          pass_score: 60,
          duration_minutes: 45,
          max_attempts: 3,
          fixed_question_ids: [questionId1, questionId2],
        },
      });
      ensureStatus(draftPaperResp, 201);
      bulkPaperIds.push(Number(ensureJsonField(draftPaperResp, 'id')));
    }

    const bulkDeleteResp = await request({
      base: apiBase,
      path: '/api/train-exam/papers/bulk-delete',
      method: 'POST',
      token,
      body: {
        paper_ids: bulkPaperIds,
        force: true,
      },
    });
    ensureStatus(bulkDeleteResp, 200);
    expect(Number(bulkDeleteResp.json?.success_count || 0)).toBeGreaterThanOrEqual(2);

    const categoryListBeforeResp = await request({
      base: apiBase,
      path: '/api/train-exam/question-categories',
      method: 'GET',
      token,
    });
    ensureStatus(categoryListBeforeResp, 200);
    const categoryRowsBefore = Array.isArray(categoryListBeforeResp.json) ? categoryListBeforeResp.json : [];
    const editableSystemCategory = categoryRowsBefore.find(
      (row) =>
        Number(row?.is_system || 0) === 1 &&
        normalizeText(row?.name) !== '未分类' &&
        Number(row?.question_count || 0) === 0
    ) || categoryRowsBefore.find(
      (row) => Number(row?.is_system || 0) === 1 && normalizeText(row?.name) !== '未分类'
    );
    expect(Boolean(editableSystemCategory)).toBe(true);

    const systemCategoryId = Number(editableSystemCategory?.id || 0);
    const renamedSystemCategory = uniqueCode('SYS-CAT');
    const updateSystemCategoryResp = await request({
      base: apiBase,
      path: `/api/train-exam/question-categories/${systemCategoryId}`,
      method: 'PUT',
      token,
      body: {
        name: renamedSystemCategory,
      },
    });
    ensureStatus(updateSystemCategoryResp, 200);
    expect(normalizeText(updateSystemCategoryResp.json?.name)).toBe(renamedSystemCategory);

    const deleteSystemCategoryResp = await request({
      base: apiBase,
      path: `/api/train-exam/question-categories/${systemCategoryId}`,
      method: 'DELETE',
      token,
      body: {},
    });
    ensureStatus(deleteSystemCategoryResp, 200);
    expect(Number(deleteSystemCategoryResp.json?.deleted_id || 0)).toBe(systemCategoryId);

    const categoryListAfterResp = await request({
      base: apiBase,
      path: '/api/train-exam/question-categories',
      method: 'GET',
      token,
    });
    ensureStatus(categoryListAfterResp, 200);
    const categoryRowsAfter = Array.isArray(categoryListAfterResp.json) ? categoryListAfterResp.json : [];
    expect(categoryRowsAfter.some((row) => Number(row?.id || 0) === systemCategoryId)).toBe(false);
  });
});
