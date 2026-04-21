'use client';
import { useSearchParams } from 'next/navigation';
import { ClubOverview } from './ClubOverview';
import { MatchesView } from './MatchesView';

export function HomeRouter() {
  const searchParams = useSearchParams();
  const ageGroup = searchParams.get('ageGroup');

  if (ageGroup) {
    return <MatchesView />;
  }
  return <ClubOverview />;
}
