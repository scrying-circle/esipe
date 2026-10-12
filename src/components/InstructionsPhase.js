"use client";

export default function InstructionsPhase({ onStartTasks }) {
  return (
    <div className="glass-panel">
      <h2>Instructions</h2>
      <p>
        In this activity, you will be shown various sketches depicting Computer Graphics concepts.
      </p>
      <p>
        For each sketch, there are 2 steps for you to complete:
        <br/><br/>
        1. <strong>Explain the sketch</strong>: Write a short, English-language description of the sketch, focusing on the high-level concept(s). While referring to visual elements is perfectly acceptable, do not give an element-by-element description of the sketch.
        <br/><br/>
        2. <strong>Rate AI feedback</strong>: After submitting your explanation, you will receive three
        different AI-generated feedback responses. Rate each response on how helpful you find it.
      </p>
      <p style={{ color: '#fbbf24', fontStyle: 'italic' }}>
        You should aim to spend about 2–3 minutes writing your explanation, and then 1–2 minutes examining and rating the feedback.
      </p>


      <div style={{ display: 'flex', justifyContent: 'center', marginTop: '2rem' }}>
        <button 
          type="button" 
          className="btn" 
          onClick={onStartTasks}
        >
          Start Tasks
        </button>
      </div>
    </div>
  );
}
