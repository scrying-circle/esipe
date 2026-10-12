"use client";

export default function CompletePhase({ studentId, onRestart }) {
  return (
    <div className="glass-panel" style={{ textAlign: 'center' }}>
      <h1>Session Complete!</h1>
      <p>Thank you for participating!</p>
      <p>Your responses have been recorded and graded. Please return to the Qualtrics page to continue the study.</p>
    </div>
  );
}
