'use client';
import { useState } from 'react';

interface Props {
  logoUrl: string;
  teamName: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const sizes = { sm: 'w-8 h-8', md: 'w-12 h-12', lg: 'w-16 h-16', xl: 'w-24 h-24' };

export function TeamEmblem({ logoUrl, teamName, size = 'md', className = '' }: Props) {
  const [failed, setFailed] = useState(false);

  if (failed || !logoUrl) {
    return (
      <div
        data-testid="team-emblem"
        className={`${sizes[size]} ${className} rounded-full bg-dark-card border border-dark-border flex items-center justify-center text-xs font-bold text-dark-muted shrink-0`}
      >
        {teamName.slice(0, 2).toUpperCase()}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      data-testid="team-emblem"
      src={logoUrl}
      alt={`${teamName} emblem`}
      className={`${sizes[size]} ${className} object-contain drop-shadow-md shrink-0`}
      onError={() => setFailed(true)}
    />
  );
}
