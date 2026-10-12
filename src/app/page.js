"use client";

import { useState, useEffect, useMemo } from 'react';
import triplets from '@/data/triplets.json';
import { getOrderedTriplets } from '@/lib/taskOrder';

import LoginPhase from '@/components/LoginPhase';
import InstructionsPhase from '@/components/InstructionsPhase';
import TaskPhase from '@/components/TaskPhase';
import FeedbackPhase from '@/components/FeedbackPhase';
import CompletePhase from '@/components/CompletePhase';

export default function Home() {
  const [studentId, setStudentId] = useState('');
  const [completedTriplets, setCompletedTriplets] = useState([]);
  
  // Phase can be: 'login', 'instructions', 'task', 'complete'
  const [phase, setPhase] = useState('login');
  const [feedbackData, setFeedbackData] = useState(null);
  const [trayOpen, setTrayOpen] = useState(false);
  const [trayTab, setTrayTab] = useState('instructions');

  const allTaskTriplets = useMemo(() => {
    return getOrderedTriplets(triplets, studentId);
  }, [studentId]);

  const remainingTriplets = allTaskTriplets.filter(t => !completedTriplets.includes(t.id));
  
  const currentTriplet = remainingTriplets.length > 0 ? remainingTriplets[0] : null;
  const isLastTask = remainingTriplets.length <= 1;

  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (phase !== 'login' && phase !== 'complete') {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [phase]);

  const handleLogin = (fetchedCompleted = []) => {
    setCompletedTriplets(fetchedCompleted);
    
    const ordered = getOrderedTriplets(triplets, studentId);
    const remaining = ordered.filter(t => !fetchedCompleted.includes(t.id));
    
    if (remaining.length === 0) {
      setPhase('complete');
    } else if (fetchedCompleted.length > 0) {
      setPhase('task');
    } else {
      setPhase('instructions');
    }
  };

  const handleStartTasks = () => {
    setPhase('task');
  };

  const handleTaskComplete = (data) => {
    setFeedbackData(data);
    setTrayTab('feedback');
    setTrayOpen(true);
  };

  const handleNextTask = async (results) => {
    const currentId = currentTriplet.id;
    // Save the records to our Prisma database
    try {
      const res = await fetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId,
          tripletId: currentTriplet.id,
          studentDescription: feedbackData.studentDescription,
          writingTimeMs: feedbackData.writingTimeMs || null,
          evaluations: results
        })
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        console.error("Failed to save evaluation to database:", errData);
        alert("Warning: Could not save evaluation to database. Please check console or connection.");
      }
    } catch (error) {
      console.error("Failed to save evaluation to database:", error);
    }

    setCompletedTriplets(prev => [...prev, currentId]);

    if (!isLastTask) {
      setFeedbackData(null);
      setTrayTab('instructions');
      setTrayOpen(false);
    } else {
      setPhase('complete');
    }
  };

  const handleRestart = () => {
    window.location.reload();
  };

  return (
    <main className={phase === 'task' ? '' : 'app-container'}>
      {phase === 'login' && (
        <LoginPhase 
          studentId={studentId} 
          setStudentId={setStudentId} 
          onLogin={handleLogin} 
        />
      )}

      {phase === 'instructions' && (
        <InstructionsPhase 
          onStartTasks={handleStartTasks} 
        />
      )}

      {phase === 'task' && currentTriplet && (
        <div className="workspace">
          <div className="workspace-main">
            {!trayOpen && (
              <button className="tray-toggle" onClick={() => setTrayOpen(true)}>
                ☰ Instructions
              </button>
            )}
            <div className="app-container">
              <TaskPhase 
                key={currentTriplet.id}
                currentTriplet={currentTriplet}
                currentTaskIndex={completedTriplets.length}
                totalTasks={allTaskTriplets.length}
                onTaskComplete={handleTaskComplete}
                initialData={feedbackData}
                isLocked={!!feedbackData}
              />
            </div>
          </div>
          <div className={`workspace-tray ${trayOpen ? 'open' : ''}`}>
             <div style={{ padding: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
               <h3 style={{ margin: 0, fontSize: '1.2rem' }}>Reference</h3>
               <button onClick={() => setTrayOpen(false)} style={{ background: 'transparent', border: 'none', color: '#cbd5e1', cursor: 'pointer', fontSize: '1.5rem', lineHeight: 1 }}>×</button>
             </div>
             <div className="tray-tabs">
                <button className={`tray-tab ${trayTab === 'instructions' ? 'active' : ''}`} onClick={() => setTrayTab('instructions')}>Instructions</button>
                <button className={`tray-tab ${trayTab === 'feedback' ? 'active' : ''}`} onClick={() => setTrayTab('feedback')} disabled={!feedbackData}>Feedback</button>
             </div>
             <div className="tray-content">
                {trayTab === 'instructions' && (
                  <div style={{ fontSize: '0.95rem', lineHeight: '1.6' }}>
                    <p>For each sketch, there are 2 steps:</p>
                    <p>
                      <strong>1. Explain the sketch:</strong> Write a short, English-language description of the sketch, focusing on the high-level concept(s). While referring to visual elements is perfectly acceptable, do not give an element-by-element description of the sketch.
                    </p>
                    <p>
                      <strong>2. Rate AI feedback:</strong> After submitting your explanation, you will receive three
                      different AI-generated feedback responses. Rate each on how helpful you find it.
                    </p>
                    <p style={{ color: '#fbbf24', fontStyle: 'italic' }}>
                      Aim for about 2–3 minutes explaining, and 1–2 minutes examining and rating feedback.
                    </p>
                  </div>
                )}
                {trayTab === 'feedback' && (
                  feedbackData ? (
                    <FeedbackPhase 
                      feedbackData={feedbackData}
                      isLastTask={isLastTask}
                      onNextTask={handleNextTask}
                      studentId={studentId}
                    />
                  ) : (
                    <p style={{ padding: '1rem', color: '#94a3b8' }}>Submit your explanation to receive feedback.</p>
                  )
                )}
             </div>
          </div>
        </div>
      )}

      {phase === 'complete' && (
        <CompletePhase 
          studentId={studentId}
          onRestart={handleRestart}
        />
      )}
    </main>
  );
}
