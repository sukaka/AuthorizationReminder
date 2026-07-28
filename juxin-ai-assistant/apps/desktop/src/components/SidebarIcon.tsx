type SidebarIconName =
  | 'chat'
  | 'project'
  | 'tasks'
  | 'ai'
  | 'knowledge'
  | 'enterprise'
  | 'management'
  | 'audit'
  | 'settings'
  | 'help';

export function SidebarIcon({ name }: { name: SidebarIconName }) {
  const content = {
    chat: <path d="M5 5.75h14v9.5H9l-4 3V5.75Z" />,
    project: <path d="M3.75 7.25h6l1.6 2h8.9v8.5a1.5 1.5 0 0 1-1.5 1.5H5.25a1.5 1.5 0 0 1-1.5-1.5V7.25Z" />,
    tasks: (
      <>
        <path d="M8 4.75h8M7 3.75h10v16.5H7z" />
        <path d="m9.5 12 1.5 1.5 3.5-4" />
      </>
    ),
    ai: (
      <>
        <path d="m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2L12 3Z" />
        <path d="m18.5 14 .7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7.7-2.3Z" />
      </>
    ),
    knowledge: (
      <>
        <path d="M4.25 5.25A2.25 2.25 0 0 1 6.5 3h5.5v16H6.5a2.25 2.25 0 0 0-2.25 2V5.25Z" />
        <path d="M19.75 5.25A2.25 2.25 0 0 0 17.5 3H12v16h5.5a2.25 2.25 0 0 1 2.25 2V5.25Z" />
      </>
    ),
    enterprise: (
      <>
        <path d="M5 20V7h9v13M14 11h5v9M8 10h3M8 13.5h3M8 17h3M17 14h1" />
      </>
    ),
    management: (
      <>
        <path d="M4 7h10M18 7h2M4 12h2M10 12h10M4 17h8M16 17h4" />
        <circle cx="16" cy="7" r="2" />
        <circle cx="8" cy="12" r="2" />
        <circle cx="14" cy="17" r="2" />
      </>
    ),
    audit: (
      <>
        <path d="M6 3.75h9l3 3v13.5H6zM15 3.75v3h3M9 11h6M9 14.5h6" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6 18 18M18 6l-1.4 1.4M7.4 16.6 6 18" />
      </>
    ),
    help: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M9.75 9a2.35 2.35 0 1 1 3.15 2.2c-.9.4-.9 1-.9 1.8M12 16.5h.01" />
      </>
    ),
  }[name];

  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7">
        {content}
      </g>
    </svg>
  );
}
