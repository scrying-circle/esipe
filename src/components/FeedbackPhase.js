"use client";

import { useState, useMemo, useEffect, useRef } from 'react';

// Fisher-Yates shuffle
function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const generateRandomTechPath = () => {
  let path = "M -10,10";
  let x = -10;
  let y = 10;
  while (x < 210) {
    const dx = Math.floor(Math.random() * 15) + 10;
    path += ` h${dx}`;
    x += dx;
    
    if (x >= 210) break;

    let newY = y;
    while (Math.abs(newY - y) < 4) {
      newY = Math.floor(Math.random() * 16) + 2;
    }
    path += ` V${newY}`;
    y = newY;
  }
  return path;
};

export default function FeedbackPhase({ feedbackData, isLastTask, onNextTask, onGoBack, studentId }) {
  const [evaluations, setEvaluations] = useState([]);
  const [ratings, setRatings] = useState({});
  const [hoverRatings, setHoverRatings] = useState({});
  const [tiebreakers, setTiebreakers] = useState({});
  const [isTransitioning, setIsTransitioning] = useState(false);
  const isTransitioningRef = useRef(false);
  const abortControllerRef = useRef(null);
  
  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const delay = (ms) => new Promise(r => setTimeout(r, ms));

    // Fetch with automatic retry on rate limits (429) or server errors (500)
    const fetchWithRetry = async (body, signal, retries = 3) => {
      for (let attempt = 0; attempt < retries; attempt++) {
        const res = await fetch('/api/grade', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal
        });
        if ((res.status === 429 || res.status === 500) && attempt < retries - 1) {
          const errData = await res.json().catch(() => ({}));
          const waitMatch = (errData?.details || errData?.error?.message || '').match(/try again in (\d+\.?\d*)/i);
          const waitSec = waitMatch ? Math.ceil(parseFloat(waitMatch[1])) + 2 : 30;
          await delay(waitSec * 1000);
          continue;
        }
        return res;
      }
    };

    const fetchEvaluations = async () => {
      try {
        const res = await fetch('/api/grade');
        const data = await res.json();
        
        if (!isMounted) return;

        const shuffledConditions = shuffle(data.conditions).map((cond, idx) => ({
          conditionId: cond.id,
          modelName: data.model,
          uiId: `AI ${idx + 1}`,
          loading: true,
          grade: null,
          feedback: null,
          waitMs: null,
          techPath: generateRandomTechPath()
        }));

        setEvaluations(shuffledConditions);

        // Fire all requests in parallel — retry logic handles rate limits
        shuffledConditions.forEach(async (uiCond) => {
          const startTime = Date.now();
          try {
            const evalRes = await fetchWithRetry(
              { ...feedbackData, conditionId: uiCond.conditionId },
              controller.signal
            );
            const evalData = await evalRes.json();
            
            if (!isMounted) return;

            if (evalRes.ok) {
              setEvaluations(prev => prev.map(ev => 
                ev.conditionId === uiCond.conditionId 
                  ? { 
                      ...ev, 
                      loading: false, 
                      grade: evalData.grade, 
                      feedback: evalData.feedback, 
                      waitMs: Date.now() - startTime, 
                      tokens: evalData.tokens,
                      extraction: evalData.extraction || null,
                      classification: evalData.classification || null
                    } 
                  : ev
              ));
            } else {
              setEvaluations(prev => prev.map(ev => 
                ev.conditionId === uiCond.conditionId 
                  ? { ...ev, loading: false, grade: 'Error', feedback: 'Failed to evaluate: ' + (evalData.error || 'Unknown error'), details: evalData.details, waitMs: Date.now() - startTime } 
                  : ev
              ));
            }
          } catch (error) {
            if (error.name !== 'AbortError' && isMounted) {
              setEvaluations(prev => prev.map(ev => 
                ev.conditionId === uiCond.conditionId 
                  ? { ...ev, loading: false, grade: 'Error', feedback: 'Failed to evaluate.', waitMs: Date.now() - startTime } 
                  : ev
              ));
            }
          }
        });

      } catch (err) {
        console.error("Failed to fetch conditions", err);
      }
    };

    fetchEvaluations();

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [feedbackData]);

  const handleRatingChange = (id, newRating) => {
    setRatings(prev => ({ ...prev, [id]: newRating }));
  };

  const tiedGroups = useMemo(() => {
    const groups = {};
    Object.entries(ratings).forEach(([id, rating]) => {
      if (!groups[rating]) groups[rating] = [];
      groups[rating].push(id);
    });
    return Object.entries(groups)
      .filter(([r, ids]) => ids.length > 1)
      .map(([r, ids]) => ({ rating: Number(r), ids }))
      .sort((a, b) => b.rating - a.rating);
  }, [ratings]);

  const handleNext = () => {
    if (!canProceed || isTransitioningRef.current) return;

    isTransitioningRef.current = true;
    setIsTransitioning(true);

    const results = evaluations.map(ev => {
      const rating = ratings[ev.uiId];
      const isWinner = tiedGroups.some(g => g.rating === rating && tiebreakers[rating] === ev.uiId);

      return {
        conditionId: ev.conditionId,
        modelName: ev.modelName,
        aiGrade: ev.grade,
        aiFeedback: ev.feedback,
        studentRating: rating,
        isTiebreakerWinner: isWinner,
        waitMs: ev.waitMs,
        extraction: ev.extraction || null,
        classification: ev.classification || null
      };
    });
    
    onNextTask(results);
  };

  const handleGoBack = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    if (onGoBack) onGoBack();
  };

  const calculateRating = (e, index) => {
    const { left, width } = e.currentTarget.getBoundingClientRect();
    const percent = (e.clientX - left) / width;
    return index + (percent < 0.5 ? 0.5 : 1);
  };

  const renderStars = (id, currentRating, currentHover) => {
    const activeRating = currentHover > 0 ? currentHover : currentRating;
    return [0, 1, 2, 3, 4].map((index) => {
      const starValue = index + 1;
      
      let fillType = 'empty';
      if (activeRating >= starValue) {
        fillType = 'full';
      } else if (activeRating >= starValue - 0.5) {
        fillType = 'half';
      }

      return (
        <span 
          key={index} 
          style={{ 
            position: 'relative', 
            color: fillType === 'full' ? '#fbbf24' : '#64748b', 
            cursor: 'pointer',
            transition: 'color 0.1s'
          }}
          onMouseMove={(e) => {
            const r = calculateRating(e, index);
            setHoverRatings(prev => ({ ...prev, [id]: r }));
          }}
          onClick={(e) => {
            const r = calculateRating(e, index);
            handleRatingChange(id, r);
          }}
        >
          ★
          {fillType === 'half' && (
            <span style={{ 
              position: 'absolute', left: 0, top: 0, overflow: 'hidden', 
              width: '50%', color: '#fbbf24', pointerEvents: 'none' 
            }}>★</span>
          )}
        </span>
      );
    });
  };

  const allFinished = evaluations.length > 0 && evaluations.every(ev => !ev.loading);
  const allRated = evaluations.length > 0 && evaluations.every(ev => ratings[ev.uiId]);
  const allTiesResolved = tiedGroups.every(g => g.ids.includes(tiebreakers[g.rating]));
  const canProceed = allFinished && allRated && allTiesResolved;

  if (evaluations.length === 0) return null;

  return (
    <div style={{ position: 'relative' }}>


      <h2>Evaluate AI Outputs</h2>
      <p style={{ marginBottom: '2rem' }}>Please review the feedback and rate each one.</p>
      
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
        {evaluations.map((ev) => (
          <div key={ev.uiId} className="feedback-box" style={{ background: 'rgba(255,255,255,0.03)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0, color: '#e2e8f0' }}>{ev.uiId}</h3>
            </div>
            
            {ev.loading ? (
              <div style={{ padding: '2rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
                <svg viewBox="0 0 200 20" preserveAspectRatio="none" style={{ width: '200px', height: '20px', opacity: 0.8 }}>
                  <path className="tech-path" d={ev.techPath} style={{ stroke: '#fbbf24', strokeWidth: 2 }} />
                </svg>
                <span style={{ fontSize: '0.9rem', color: '#94a3b8', letterSpacing: '0.05em' }}>evaluating...</span>
              </div>
            ) : (
              <>
                <p className="feedback-text" style={{ fontSize: '0.95rem' }}>
                  {ev.feedback}
                </p>
                {ev.details && (
                  <pre style={{ fontSize: '0.8rem', color: '#f87171', background: 'rgba(0,0,0,0.3)', padding: '1rem', overflowX: 'auto', marginTop: '1rem', borderRadius: '4px' }}>
                    {ev.details}
                  </pre>
                )}
                <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '0.5rem', textAlign: 'right' }}>
                  Generated in {(ev.waitMs / 1000).toFixed(1)}s
                  {studentId === 'admin' && ev.tokens && (
                    <span style={{ marginLeft: '8px', color: '#8b5cf6' }}>
                      [{ev.modelName} • {ev.tokens} tok]
                    </span>
                  )}
                </div>

                <div style={{ marginTop: '1.5rem', textAlign: 'center', background: 'rgba(0,0,0,0.2)', padding: '1rem', borderRadius: '8px' }}>
                  <p style={{ marginBottom: '0.5rem', fontWeight: 'bold', fontSize: '0.9rem' }}>
                    How helpful was this feedback? ({ratings[ev.uiId] || 0} stars)
                  </p>
                  <div 
                    style={{ display: 'flex', justifyContent: 'center', gap: '0.2rem', fontSize: '2rem' }}
                    onMouseLeave={() => setHoverRatings(prev => ({ ...prev, [ev.uiId]: 0 }))}
                  >
                    {renderStars(ev.uiId, ratings[ev.uiId] || 0, hoverRatings[ev.uiId] || 0)}
                  </div>
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      {tiedGroups.length > 0 && (
        <div style={{ marginTop: '3rem', padding: '1.5rem', border: '1px solid rgba(251, 191, 36, 0.3)', borderRadius: '12px', background: 'rgba(251, 191, 36, 0.05)' }}>
          <h3 style={{ color: '#fbbf24', marginTop: 0 }}>Tie-Breakers</h3>
          <p style={{ fontSize: '0.9rem', color: '#cbd5e1' }}>You gave the same rating to multiple outputs. Please select the best among them for each group.</p>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', marginTop: '1.5rem' }}>
            {tiedGroups.map(group => (
              <div key={group.rating} style={{ background: 'rgba(0,0,0,0.2)', padding: '1rem', borderRadius: '8px' }}>
                <p style={{ fontWeight: 'bold', margin: '0 0 1rem 0' }}>Tied at {group.rating} stars:</p>
                <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
                  {group.ids.map(id => (
                    <label key={id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                      <input 
                        type="radio" 
                        name={`tiebreak-${group.rating}`} 
                        value={id}
                        checked={tiebreakers[group.rating] === id}
                        onChange={() => setTiebreakers(prev => ({ ...prev, [group.rating]: id }))}
                        style={{ width: '1.2rem', height: '1.2rem', accentColor: '#fbbf24' }}
                      />
                      <span>{id}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ marginTop: '3rem', textAlign: 'center' }}>
        <button 
          onClick={handleNext} 
          className={`btn${isTransitioning ? ' btn-loading' : ''}`}
          disabled={!canProceed || isTransitioning}
          aria-busy={isTransitioning}
          style={{ width: '100%', maxWidth: '300px' }}
        >
          {isTransitioning && <span className="spinner" aria-hidden="true" />}
          {isTransitioning ? 'Saving...' : !isLastTask ? 'Next Sketch' : 'Finish Session'}
        </button>
      </div>
    </div>
  );
}
