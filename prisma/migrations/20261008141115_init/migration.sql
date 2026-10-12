-- CreateTable
CREATE TABLE "Evaluation" (
    "id" SERIAL NOT NULL,
    "studentId" TEXT NOT NULL,
    "tripletId" TEXT NOT NULL,
    "studentDescription" TEXT NOT NULL,
    "studentPromptGuess" TEXT NOT NULL,
    "conditionId" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "aiGrade" TEXT NOT NULL,
    "aiFeedback" TEXT NOT NULL,
    "studentRating" DOUBLE PRECISION NOT NULL,
    "isTiebreakerWinner" BOOLEAN NOT NULL DEFAULT false,
    "waitMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Evaluation_pkey" PRIMARY KEY ("id")
);
