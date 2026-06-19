export type SessionPayload = {
  user: {
    id: string | number;
    username: string;
    role: string;
  };
  scope: {
    department: string | null;
    managedDepartments: string[];
  };
  apps: string[];
};

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function getSession(): Promise<SessionPayload> {
  const response = await fetch('/api/ai/session', { credentials: 'include' });

  if (response.status === 401) {
    const returnTo = encodeURIComponent(window.location.href);
    const authUrl = import.meta.env.VITE_AUTH_PUBLIC_URL || 'http://localhost:5180';
    window.location.assign(`${authUrl}/login?system=ai-assistant&return_to=${returnTo}`);
    throw new ApiError(401, 'AUTH_REDIRECT');
  }

  if (!response.ok) {
    throw new ApiError(response.status, `SESSION_${response.status}`);
  }

  return response.json() as Promise<SessionPayload>;
}
