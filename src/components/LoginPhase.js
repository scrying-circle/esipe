"use client";
import { useState } from 'react';

export default function LoginPhase({ studentId, setStudentId, onLogin }) {
  const [isLoading, setIsLoading] = useState(false);
  const handleLogin = async (e) => {
    e.preventDefault();
    if (studentId.trim().length > 0) {
      setIsLoading(true);
      try {
        const response = await fetch(`/api/progress?studentId=${encodeURIComponent(studentId)}`);
        if (response.ok) {
          const data = await response.json();
          onLogin(data.completedTriplets || []);
        } else {
          onLogin([]);
        }
      } catch (error) {
        console.error("Error fetching progress:", error);
        onLogin([]);
      } finally {
        setIsLoading(false);
      }
    }
  };

  return (
    <div className="glass-panel">
      <h1>Sketching EIPE</h1>
      <p>Welcome to 'Explaining Sketches in Plain English'!</p>
      <form onSubmit={handleLogin}>
        <div className="input-group">
          <label htmlFor="studentId">Participant ID</label>
          <input 
            type="text" 
            id="studentId" 
            value={studentId}
            onChange={(e) => setStudentId(e.target.value)}
            placeholder="Enter your Participant ID"
            autoComplete="off"
            required
            disabled={isLoading}
          />
        </div>
        <button type="submit" className="btn" disabled={isLoading}>
          {isLoading ? 'Checking Progress...' : 'Start Session'}
        </button>
      </form>
    </div>
  );
}
