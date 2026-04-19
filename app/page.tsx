import { Suspense } from 'react';
import { G16_TEAMS } from '@/lib/mockData';
import { MatchesView } from '@/components/MatchesView';

export default function Home() {
  return (
    <Suspense>
      <MatchesView teams={G16_TEAMS} />
    </Suspense>
  );
}
