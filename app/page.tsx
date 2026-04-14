import { G16_TEAMS } from '@/lib/mockData';
import { MatchesView } from '@/components/MatchesView';

export default function Home() {
  return <MatchesView teams={G16_TEAMS} />;
}
