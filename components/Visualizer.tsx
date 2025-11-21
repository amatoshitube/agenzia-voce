import React, { useEffect, useRef } from 'react';

interface VisualizerProps {
  isActive: boolean;
  isSpeaking: boolean;
}

const Visualizer: React.FC<VisualizerProps> = ({ isActive, isSpeaking }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;
    let offset = 0;

    const draw = () => {
      const width = canvas.width;
      const height = canvas.height;
      ctx.clearRect(0, 0, width, height);

      if (!isActive) {
        // Flat line
        ctx.beginPath();
        ctx.moveTo(0, height / 2);
        ctx.lineTo(width, height / 2);
        ctx.strokeStyle = '#e5e7eb';
        ctx.lineWidth = 2;
        ctx.stroke();
        return;
      }

      ctx.beginPath();
      const centerY = height / 2;
      
      // Use different colors/amplitude based on state
      const color = isSpeaking ? '#2563eb' : '#10b981'; // Blue for agent, Green for listening
      const amplitude = isSpeaking ? 25 : 10;
      const frequency = isSpeaking ? 0.05 : 0.02;
      const speed = isSpeaking ? 0.2 : 0.1;

      for (let x = 0; x < width; x++) {
        const y = centerY + Math.sin(x * frequency + offset) * amplitude * Math.sin(x * 0.01);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }

      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.stroke();

      offset += speed;
      animationId = requestAnimationFrame(draw);
    };

    draw();

    return () => cancelAnimationFrame(animationId);
  }, [isActive, isSpeaking]);

  return (
    <canvas 
      ref={canvasRef} 
      width={300} 
      height={80} 
      className="w-full h-20 rounded-lg bg-gray-50 border border-gray-200"
    />
  );
};

export default Visualizer;