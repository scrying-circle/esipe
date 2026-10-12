"use client";

export default function CompletePhase({ studentId, onRestart }) {
  return (
    <div className="glass-panel" style={{ textAlign: 'center' }}>
      <h1>Session Complete!</h1>
      <p>Thank you for participating, {studentId}.</p>
      <p>Your responses have been recorded and graded.</p>
      <button onClick={onRestart} className="btn" style={{ marginTop: '1rem' }}>
        Restart
      </button>
    </div>
  );
}
