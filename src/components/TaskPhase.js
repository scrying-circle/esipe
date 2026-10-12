"use client";

import { useState, useEffect, useRef } from 'react';

export default function TaskPhase({ currentTriplet, currentTaskIndex, totalTasks, onTaskComplete, initialData, isLocked }) {
  const [studentDescription, setStudentDescription] = useState(initialData?.studentDescription || '');
  const startTimeRef = useRef(Date.now());
  const submitTimeRef = useRef(null);
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [timeLeft, setTimeLeft] = useState(3);

  const handleSubmitTask = (e) => {
    e.preventDefault();
    if (!studentDescription.trim()) return;
    submitTimeRef.current = Date.now() - startTimeRef.current;
    setIsSubmitting(true);
    setTimeLeft(3);
  };

  useEffect(() => {
    let timer;
    if (isSubmitting && timeLeft > 0) {
      timer = setTimeout(() => setTimeLeft(timeLeft - 1), 1000);
    } else if (isSubmitting && timeLeft === 0) {
      setIsSubmitting(false);
      const writingTimeMs = submitTimeRef.current || (Date.now() - startTimeRef.current);
      onTaskComplete({ 
        studentDescription, 
        writingTimeMs,
        keyIdea: currentTriplet.key_idea,
        blocks: currentTriplet.blocks,
        keyElements: currentTriplet.key_elements,
        contextualElements: currentTriplet.contextual_elements
      });
    }
    return () => clearTimeout(timer);
  }, [isSubmitting, timeLeft, studentDescription, currentTriplet, onTaskComplete]);

  const cancelSubmit = () => {
    setIsSubmitting(false);
    setTimeLeft(3);
    submitTimeRef.current = null;
  };

  const disabled = isLocked || isSubmitting;

  return (
    <div className="glass-panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Interpret the Sketch</h2>
        <span style={{ fontSize: '0.9rem', color: '#94a3b8' }}>Task {currentTaskIndex + 1} of {totalTasks}</span>
      </div>
      
      <p style={{ fontSize: '0.95rem', color: '#cbd5e1', marginBottom: '1.5rem', paddingBottom: '1rem', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
        <strong>Task:</strong> Write a short, English-language description of the following sketch, focusing on the high-level concept(s). While referring to visual elements is perfectly acceptable, do not give an element-by-element description of the sketch.
      </p>
      
      <div className="sketch-container">
        <img src={currentTriplet.sketchUrl} alt="Sketch to interpret" className="sketch-image" />
      </div>

      <form onSubmit={handleSubmitTask}>
        <div className="input-group">
          <label htmlFor="description">Your explanation</label>
          <textarea 
            id="description" 
            value={studentDescription}
            onChange={(e) => setStudentDescription(e.target.value)}
            placeholder="Write a short description focusing on the high-level concept(s)..."
            autoComplete="off"
            required
            disabled={disabled}
            rows={6}
          ></textarea>
        </div>
        
        {isSubmitting ? (
          <button type="button" className="btn btn-cancel" onClick={cancelSubmit}>
            <svg className="tech-svg" viewBox="0 0 200 20" preserveAspectRatio="none">
              <path className="tech-path" d="M -10,10 h50 V5 h50 V15 h50 V10 h50" />
            </svg>
            <span style={{ position: 'relative', zIndex: 10 }}>Cancel Submission ({timeLeft}s)</span>
          </button>
        ) : (
          <button type="submit" className="btn" disabled={disabled}>
            {isLocked ? 'Submitted' : 'Submit Interpretation'}
          </button>
        )}
      </form>
    </div>
  );
}
