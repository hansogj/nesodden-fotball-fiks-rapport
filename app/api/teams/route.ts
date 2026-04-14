import { NextResponse } from 'next/server';
import { G16_TEAMS } from '@/lib/mockData';

export async function GET() {
  return NextResponse.json({ teams: G16_TEAMS });
}
