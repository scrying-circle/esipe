import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  try {
    const data = await request.json();
    
    // data.evaluations is an array of objects:
    // { conditionId, modelName, aiGrade, aiFeedback, studentRating, isTiebreakerWinner, waitMs }
    const { studentId, tripletId, studentDescription, writingTimeMs, evaluations } = data;

    const savedEvaluations = await prisma.$transaction(
      evaluations.map((ev) => 
        prisma.evaluation.create({
          data: {
            studentId,
            tripletId,
            studentDescription,
            studentPromptGuess: '',
            conditionId: ev.conditionId,
            modelName: ev.modelName,
            aiGrade: ev.aiGrade,
            aiFeedback: ev.aiFeedback,
            studentRating: ev.studentRating,
            isTiebreakerWinner: ev.isTiebreakerWinner || false,
            waitMs: ev.waitMs,
            writingTimeMs: writingTimeMs ? Math.round(writingTimeMs) : null,
            extraction: ev.extraction || null,
            classification: ev.classification || null
          }
        })
      ),
      { maxWait: 10_000 }
    );

    return NextResponse.json({ success: true, savedEvaluations });
  } catch (error) {
    console.error("Error saving evaluation:", error);
    return NextResponse.json({ error: "Failed to save evaluation", details: error.message, stack: error.stack }, { status: 500 });
  }
}
