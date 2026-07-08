import type { ReactNode } from 'react';

export function AdminPageState({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="governance-page">
      <header>
        <span className="eyebrow">AI Governance</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </header>
      {children}
    </section>
  );
}

export function RequestNotice({ message }: { message: string }) {
  return message ? <p className="request-notice" role="status">{message}</p> : null;
}
