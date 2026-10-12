import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const studentId = searchParams.get('studentId');

    if (!studentId) {
      return NextResponse.json({ error: 'Missing studentId' }, { status: 400 });
    }

    const evaluations = await prisma.evaluation.findMany({
      where: {
        studentId: studentId
      },
      select: {
        tripletId: true
      },
      distinct: ['tripletId']
    });

    const completedTriplets = evaluations.map(e => e.tripletId);

    return NextResponse.json({ completedTriplets });
  } catch (error) {
    console.error("Failed to fetch progress:", error);
    return NextResponse.json({ error: "Failed to fetch progress" }, { status: 500 });
  }
}
