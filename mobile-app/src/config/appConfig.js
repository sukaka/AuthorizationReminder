export const AUTH_COOKIE_NAME = 'juxin_auth_token';

const DEFAULT_PROTOCOL = 'http';
const HTTPS_PROTOCOL = 'https';
const DEFAULT_HOST = 'localhost';
const AUTH_PORT = 5180;

const SYSTEM_DEFINITIONS = [
  {
    key: 'train-exam',
    name: '培训考试',
    description: '课程学习、考试、题库与证书',
    port: 18087,
  },
  {
    key: 'inventory',
    name: '库存管理',
    description: '库存台账、入库出库与物流查询',
    port: 18082,
  },
  {
    key: 'device-flow',
    name: '设备流转',
    description: '设备领用、归还、维修与流转记录',
    port: 18083,
  },
];

const resolveProtocol = (env) => (
  env.EXPO_PUBLIC_APP_PROTOCOL === HTTPS_PROTOCOL ? HTTPS_PROTOCOL : DEFAULT_PROTOCOL
);

const resolveHost = (env) => env.EXPO_PUBLIC_APP_HOST || env.PUBLIC_HOST || DEFAULT_HOST;

const createBaseUrl = ({ protocol, host, port }) => `${protocol}://${host}:${port}`;

export const createMobileAppConfig = (env = {}) => {
  const protocol = resolveProtocol(env);
  const host = resolveHost(env);
  const authBaseUrl = createBaseUrl({ protocol, host, port: AUTH_PORT });

  return {
    auth: {
      cookieName: AUTH_COOKIE_NAME,
      baseUrl: authBaseUrl,
      loginUrl: `${authBaseUrl}/api/auth/login`,
      meUrl: `${authBaseUrl}/api/auth/me`,
      logoutUrl: `${authBaseUrl}/api/auth/logout`,
    },
    systems: SYSTEM_DEFINITIONS.map((system) => ({
      key: system.key,
      name: system.name,
      description: system.description,
      url: createBaseUrl({ protocol, host, port: system.port }),
    })),
  };
};

export const getSystemByKey = (systems, key) => (
  systems.find((system) => system.key === key) || null
);
