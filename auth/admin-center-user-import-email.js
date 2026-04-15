const trimText = (value) => String(value || '').trim();

const buildImportedUserPasswordEmail = ({
  username,
  initialPassword,
  loginUrl,
}) => {
  const safeUsername = trimText(username) || '用户';
  const safePassword = trimText(initialPassword);
  const safeLoginUrl = trimText(loginUrl);
  return {
    subject: '聚信统一登录平台账号已开通',
    message: [
      `您好，${safeUsername}：`,
      '',
      '您的聚信统一登录平台账号已创建成功。',
      `账号：${safeUsername}`,
      `初始密码：${safePassword}`,
      safeLoginUrl ? `登录入口：${safeLoginUrl}` : '',
      '',
      '登录后请尽快修改密码，并妥善保管账号信息。',
    ].filter(Boolean).join('\n'),
  };
};

const buildImportedUsersAdminSummaryEmail = ({
  rows = [],
  loginUrl,
}) => {
  const safeRows = Array.isArray(rows) ? rows : [];
  const safeLoginUrl = trimText(loginUrl);
  const lines = safeRows.map((row, index) => {
    const username = trimText(row?.username) || '-';
    const email = trimText(row?.email) || '未填写邮箱';
    const initialPassword = trimText(row?.initialPassword) || '-';
    return [
      `${index + 1}. 账号：${username}`,
      `   邮箱：${email}`,
      `   初始密码：${initialPassword}`,
    ].join('\n');
  });
  return {
    subject: '聚信统一登录平台批量导入账号汇总',
    message: [
      '您好，admin：',
      '',
      `本次共导入成功 ${safeRows.length} 个用户。`,
      safeLoginUrl ? `登录入口：${safeLoginUrl}` : '',
      '',
      ...lines,
      '',
      '请妥善保管本邮件中的初始密码，并提醒相关用户首次登录后立即修改密码。',
    ].filter(Boolean).join('\n'),
  };
};

module.exports = {
  buildImportedUserPasswordEmail,
  buildImportedUsersAdminSummaryEmail,
};
