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

module.exports = {
  buildImportedUserPasswordEmail,
};
