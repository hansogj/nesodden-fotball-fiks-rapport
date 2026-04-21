import { Suspense } from 'react';
import { HomeRouter } from '@/components/HomeRouter';

export default function Home() {
  return (
    <Suspense>
      <HomeRouter />
    </Suspense>
  );
}
