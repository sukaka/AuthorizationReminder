const DEFAULT_REMINDER_SUBJECT = '授权到期提醒';
const DEFAULT_REMINDER_MESSAGE = '【{customer_name}】的{license_name}将于{end_date}到期，剩余{days_left}天。';

const replaceTokens = (template, context = {}) => {
  if (!template) return '';
  return String(template).replace(/\{\{?\s*(\w+)\s*\}?\}/g, (match, key) => {
    const value = context[key];
    return value === undefined || value === null ? '' : String(value);
  });
};

const buildContext = ({ contact, license, subject, message }) => ({
  contact_name: contact?.name || '',
  customer_name: license?.customer_name || contact?.customer_name || '',
  contact_phone: contact?.phone || '',
  contact_email: contact?.email || '',
  wecom_id: contact?.wecom_id || '',
  license_name: license?.name || '',
  end_date: license?.end_date || '',
  days_left: license?.days_left ?? '',
  subject: subject || '',
  message: message || '',
});

const buildSendContent = ({ subject, message, contact, license, configs, channel }) => {
  const reminderConfig = (configs && configs.reminder) || {};
  const subjectTemplate = reminderConfig.subject || DEFAULT_REMINDER_SUBJECT;
  const messageTemplate = reminderConfig.message || DEFAULT_REMINDER_MESSAGE;
  const subjectForContext = channel === 'email' ? subject || subjectTemplate : '';
  const context = buildContext({ contact, license, subject: subjectForContext, message });
  const finalSubject = channel === 'email' ? subject || replaceTokens(subjectTemplate, context) : '';
  const finalMessage = message || replaceTokens(messageTemplate, context);
  return { finalSubject, finalMessage };
};

module.exports = {
  DEFAULT_REMINDER_MESSAGE,
  DEFAULT_REMINDER_SUBJECT,
  buildContext,
  buildSendContent,
  replaceTokens,
};
