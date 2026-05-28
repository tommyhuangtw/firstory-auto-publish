import { NextRequest, NextResponse } from 'next/server';
import { getAllDocs, getDocCategories } from '@/services/knowledgeService';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const search = searchParams.get('search') || undefined;
  const category = searchParams.get('category') || undefined;

  const docs = getAllDocs({ search, category });
  const categories = getDocCategories();

  return NextResponse.json({ docs, categories });
}
