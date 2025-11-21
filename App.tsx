import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { LogEntry, LeadData } from './types';
import { SYSTEM_INSTRUCTION, TOOLS } from './constants';
import { createPcmBlob, decodeAudioData, base64ToArrayBuffer, SAMPLE_RATE_INPUT, SAMPLE_RATE_OUTPUT } from './utils/audio';
import Visualizer from './components/Visualizer';

const App: React.FC = () => {
  // API Key State
  const [apiKey, setApiKey] = useState<string>(process.env.API_KEY || '');
  
  // Session State
  const [isConnected, setIsConnected] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [isAgentSpeaking, setIsAgentSpeaking] = useState(false);
  const [callerId, setCallerId] = useState("+39 333 1234567");
  
  // Logs & CRM State
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [crmData, setCrmData] = useState<LeadData | null>(null);
  const [currentSessionId, setCurrentSessionId] = useState<string>("");

  // Refs for Audio/Connection
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const outputContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const outputNodeRef = useRef<GainNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const audioSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  // Refs for Transcription
  const currentInputTranscription = useRef<string>("");
  const currentOutputTranscription = useRef<string>("");

  // Helper to add logs
  const addLog = useCallback((type: LogEntry['type'], message: string, data?: any) => {
    setLogs(prev => [{
      timestamp: new Date().toLocaleTimeString(),
      type,
      message,
      data
    }, ...prev]);
  }, []);

  // Clean up audio resources
  const cleanupAudio = useCallback(() => {
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current.onaudioprocess = null;
      processorRef.current = null;
    }
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (outputContextRef.current) {
      outputContextRef.current.close();
      outputContextRef.current = null;
    }
    audioSourcesRef.current.forEach(source => source.stop());
    audioSourcesRef.current.clear();
  }, []);

  const handleDisconnect = useCallback(async () => {
    if (sessionPromiseRef.current) {
      try {
        const session = await sessionPromiseRef.current;
        session.close();
      } catch (e) {
        console.error("Error closing session", e);
      }
    }
    cleanupAudio();
    setIsConnected(false);
    setIsAgentSpeaking(false);
    addLog('info', 'Sessione terminata');
  }, [cleanupAudio, addLog]);

  const handleConnect = async () => {
    if (!apiKey) {
      alert("API Key mancante (controllare environment)");
      return;
    }

    try {
      addLog('info', 'Inizializzazione connessione...');
      
      // 1. Setup Audio Input
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: SAMPLE_RATE_INPUT });
      audioContextRef.current = audioContext;
      
      const source = audioContext.createMediaStreamSource(stream);
      sourceRef.current = source;
      
      // Using ScriptProcessor as per guidelines for quick PCM access
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      // 2. Setup Audio Output
      const outputContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: SAMPLE_RATE_OUTPUT });
      outputContextRef.current = outputContext;
      const outputNode = outputContext.createGain();
      outputNode.connect(outputContext.destination);
      outputNodeRef.current = outputNode;
      nextStartTimeRef.current = outputContext.currentTime;

      // 3. Initialize Gemini Client
      const ai = new GoogleGenAI({ apiKey });
      
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: SYSTEM_INSTRUCTION,
          speechConfig: {
            // Puck is the male voice requested ("Simpatico")
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } },
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          tools: [{ functionDeclarations: TOOLS }]
        },
        callbacks: {
          onopen: () => {
            addLog('info', 'Connesso a Gemini Live API');
            setIsConnected(true);
            
            // Connect input audio chain
            source.connect(processor);
            processor.connect(audioContext.destination);
            
            // Handle Input Streaming
            processor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmBlob = createPcmBlob(inputData);
              
              if (sessionPromiseRef.current) {
                 sessionPromiseRef.current.then(session => {
                   session.sendRealtimeInput({ media: pcmBlob });
                 });
              }
            };
          },
          onmessage: async (message: LiveServerMessage) => {
             // 1. Handle Audio Response
             const audioData = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
             if (audioData) {
               setIsAgentSpeaking(true);
               setIsThinking(false);
               
               if (outputContextRef.current && outputNodeRef.current) {
                 const ctx = outputContextRef.current;
                 const buffer = await decodeAudioData(
                   base64ToArrayBuffer(audioData),
                   ctx,
                   SAMPLE_RATE_OUTPUT,
                   1
                 );
                 
                 const source = ctx.createBufferSource();
                 source.buffer = buffer;
                 source.connect(outputNodeRef.current);
                 
                 // Schedule playback
                 const startTime = Math.max(nextStartTimeRef.current, ctx.currentTime);
                 source.start(startTime);
                 nextStartTimeRef.current = startTime + buffer.duration;
                 
                 audioSourcesRef.current.add(source);
                 source.onended = () => {
                   audioSourcesRef.current.delete(source);
                   if (audioSourcesRef.current.size === 0) {
                      setIsAgentSpeaking(false);
                   }
                 };
               }
             }

             // 2. Handle Transcription
             if (message.serverContent?.outputTranscription) {
                currentOutputTranscription.current += message.serverContent.outputTranscription.text;
             } else if (message.serverContent?.inputTranscription) {
                currentInputTranscription.current += message.serverContent.inputTranscription.text;
             }

             if (message.serverContent?.turnComplete) {
                if (currentInputTranscription.current) {
                    addLog('transcript', `Utente: ${currentInputTranscription.current}`);
                    currentInputTranscription.current = "";
                }
                if (currentOutputTranscription.current) {
                    addLog('transcript', `Agente: ${currentOutputTranscription.current}`);
                    currentOutputTranscription.current = "";
                }
             }

             // 3. Handle Function Calls (Tool Use)
             if (message.toolCall) {
               setIsThinking(true); // Processing tool
               for (const fc of message.toolCall.functionCalls) {
                 addLog('tool_call', `Richiesta Funzione: ${fc.name}`, fc.args);
                 
                 let result: any = { error: "Unknown error" };
                 const BASE_URL = "https://workspace.amatoshitube.repl.co/api/voice";
                 
                 try {
                   switch(fc.name) {
                     case 'start_lead_session':
                       addLog('info', 'Calling API: start_lead_session...');
                       const startRes = await fetch(`${BASE_URL}/start`, {
                         method: 'POST',
                         headers: { 'Content-Type': 'application/json' },
                         body: JSON.stringify(fc.args)
                       });
                       result = await startRes.json();
                       if (result.session_id) setCurrentSessionId(result.session_id);
                       addLog('tool_response', `Session Started: ${result.session_id}`, result);
                       break;
                       
                     case 'save_lead_data':
                       addLog('info', 'Calling API: save_lead_data...');
                       const leadData = fc.args['lead_data'] as LeadData;
                       setCrmData(prev => ({ ...prev, ...leadData })); // Optimistic UI update
                       
                       const saveRes = await fetch(`${BASE_URL}/save`, {
                         method: 'POST',
                         headers: { 'Content-Type': 'application/json' },
                         body: JSON.stringify(fc.args)
                       });
                       result = await saveRes.json();
                       addLog('tool_response', `Data Saved`, result);
                       break;
                       
                     case 'get_property_info':
                       addLog('info', `Calling API: get_property_info for ${fc.args['property_code']}...`);
                       const propCode = fc.args['property_code'];
                       const propRes = await fetch(`${BASE_URL}/property/${propCode}`);
                       result = await propRes.json();
                       addLog('tool_response', `Property Info Received`, result);
                       break;

                     case 'handle_contact_refusal':
                       addLog('info', 'Calling API: handle_contact_refusal...');
                       const refRes = await fetch(`${BASE_URL}/refusal`, {
                         method: 'POST',
                         headers: { 'Content-Type': 'application/json' },
                         body: JSON.stringify(fc.args)
                       });
                       result = await refRes.json();
                       addLog('tool_response', `Refusal Logged`, result);
                       break;
                   }
                 } catch (error: any) {
                    console.error(`Error calling tool ${fc.name}:`, error);
                    addLog('error', `Errore esecuzione ${fc.name}`, { message: error.message });
                    result = { error: error.message, status: "failed" };
                 }

                 // Send Response back to Gemini
                 if (sessionPromiseRef.current) {
                   const session = await sessionPromiseRef.current;
                   session.sendToolResponse({
                     functionResponses: {
                       id: fc.id,
                       name: fc.name,
                       response: { result }
                     }
                   });
                 }
               }
             }
             
             // 4. Handle Interruption
             if (message.serverContent?.interrupted) {
               addLog('info', 'Interruzione rilevata');
               audioSourcesRef.current.forEach(src => src.stop());
               audioSourcesRef.current.clear();
               if (outputContextRef.current) {
                   nextStartTimeRef.current = outputContextRef.current.currentTime;
               }
               setIsAgentSpeaking(false);
               // Clear any pending transcriptions on interruption to avoid confused context
               currentOutputTranscription.current = ""; 
             }
          },
          onclose: () => {
            addLog('info', 'Connessione chiusa dal server');
            handleDisconnect();
          },
          onerror: (e) => {
            addLog('error', 'Errore WebSocket', e);
            setIsConnected(false);
          }
        }
      });
      
      sessionPromiseRef.current = sessionPromise;

    } catch (err: any) {
      console.error(err);
      addLog('error', `Impossibile connettere: ${err.message}`);
      cleanupAudio();
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      handleDisconnect();
    };
  }, [handleDisconnect]);


  return (
    <div className="min-h-screen flex flex-col md:flex-row text-slate-800">
      {/* Left Panel: Agent Interface */}
      <div className="w-full md:w-1/2 bg-white p-6 flex flex-col border-r border-slate-200 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-blue-500 to-teal-400"></div>
        
        <header className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center text-blue-600">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-slate-900">Agenzia CasaFelice AI</h1>
          </div>
          <p className="text-slate-500 text-sm">Agente Virtuale: <b>Marco</b> (Gemini Live)</p>
        </header>

        <div className="flex-1 flex flex-col justify-center items-center gap-8">
           {/* Status Indicator */}
           <div className={`relative w-32 h-32 rounded-full flex items-center justify-center transition-all duration-500 ${
             isConnected ? 'bg-blue-50 ring-4 ring-blue-100' : 'bg-gray-50'
           }`}>
              {isConnected ? (
                <div className={`w-24 h-24 rounded-full flex items-center justify-center transition-all duration-300 ${isAgentSpeaking ? 'bg-blue-500 scale-110 shadow-lg shadow-blue-200' : 'bg-blue-400'}`}>
                   <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                     <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                   </svg>
                </div>
              ) : (
                <div className="w-24 h-24 rounded-full bg-slate-200 flex items-center justify-center">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                  </svg>
                </div>
              )}
              {isThinking && isConnected && (
                 <div className="absolute -top-2 -right-2 bg-amber-400 text-white text-xs px-2 py-1 rounded-full animate-bounce">
                   Thinking...
                 </div>
              )}
           </div>

           <div className="w-full max-w-md space-y-2">
              <div className="flex justify-between text-xs text-slate-400 uppercase tracking-wider font-semibold">
                <span>Visualizzatore Audio</span>
                <span>{isConnected ? (isAgentSpeaking ? "Marco sta parlando..." : "Marco ascolta...") : "Disconnesso"}</span>
              </div>
              <Visualizer isActive={isConnected} isSpeaking={isAgentSpeaking} />
           </div>

           {!isConnected && (
             <div className="w-full max-w-md bg-slate-50 p-4 rounded-lg border border-slate-200">
               <label className="block text-xs font-medium text-slate-500 mb-1">Simulazione ID Chiamante</label>
               <input 
                 type="text" 
                 value={callerId} 
                 onChange={(e) => setCallerId(e.target.value)}
                 className="w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 p-2 text-sm mb-4"
               />
               <p className="text-xs text-slate-400 mb-4 italic">
                 Nota: Questo simula il numero di telefono che il sistema riceverebbe da un gateway VoIP.
               </p>
               <button 
                 onClick={handleConnect}
                 className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors flex items-center justify-center gap-2 shadow-md"
               >
                 <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                   <path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z" />
                 </svg>
                 Chiama Agenzia (Inizia Sessione)
               </button>
             </div>
           )}

           {isConnected && (
             <button 
                onClick={handleDisconnect}
                className="bg-red-100 hover:bg-red-200 text-red-700 font-medium py-2 px-6 rounded-full transition-colors text-sm"
             >
               Termina Chiamata
             </button>
           )}
        </div>
      </div>

      {/* Right Panel: CRM & Logs */}
      <div className="w-full md:w-1/2 bg-slate-50 p-6 flex flex-col h-screen md:h-auto overflow-hidden">
        
        {/* Live CRM Card */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 mb-6">
          <div className="flex justify-between items-center mb-4 border-b border-slate-100 pb-2">
            <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide">Live CRM Data</h2>
            <span className={`px-2 py-1 rounded text-xs font-mono ${currentSessionId ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
              {currentSessionId || "NO SESSION"}
            </span>
          </div>
          
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
               <label className="block text-xs text-slate-400">Cliente</label>
               <div className="font-medium text-slate-800 h-6">{crmData?.full_name || "---"}</div>
            </div>
            <div>
               <label className="block text-xs text-slate-400">Tipo Richiesta</label>
               <div className="font-medium text-slate-800 h-6">
                 {crmData?.request_type ? (
                   <span className={`px-2 py-0.5 rounded-full text-xs ${
                     crmData.request_type === 'BUYER' ? 'bg-purple-100 text-purple-700' :
                     crmData.request_type === 'SELLER' ? 'bg-orange-100 text-orange-700' : 
                     'bg-blue-100 text-blue-700'
                   }`}>
                     {crmData.request_type}
                   </span>
                 ) : "---"}
               </div>
            </div>
            <div>
               <label className="block text-xs text-slate-400">Telefono</label>
               <div className="font-medium text-slate-800">{crmData?.phone || callerId}</div>
            </div>
            <div>
               <label className="block text-xs text-slate-400">Budget/Prezzo</label>
               <div className="font-medium text-slate-800">{crmData?.budget || crmData?.price || "---"}</div>
            </div>
            <div className="col-span-2">
               <label className="block text-xs text-slate-400">Zona / Interesse</label>
               <div className="font-medium text-slate-800">{crmData?.area || crmData?.property_type || "---"}</div>
            </div>
          </div>
        </div>

        {/* System Logs */}
        <div className="flex-1 bg-slate-900 rounded-xl overflow-hidden flex flex-col shadow-inner border border-slate-800">
          <div className="bg-slate-800 px-4 py-2 flex justify-between items-center">
             <h3 className="text-xs font-mono text-slate-400">SYSTEM LOGS & TRANSCRIPT</h3>
             <div className="flex gap-1">
               <div className="w-2 h-2 rounded-full bg-red-500"></div>
               <div className="w-2 h-2 rounded-full bg-yellow-500"></div>
               <div className="w-2 h-2 rounded-full bg-green-500"></div>
             </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4 font-mono text-xs space-y-2 scrollbar-thin scrollbar-thumb-slate-700">
            {logs.length === 0 && (
              <div className="text-slate-600 text-center mt-10">Waiting for connection...</div>
            )}
            {logs.map((log, i) => (
              <div key={i} className="flex gap-3">
                <span className="text-slate-500 shrink-0">[{log.timestamp}]</span>
                <div className="break-all">
                  {log.type === 'tool_call' && (
                     <span className="text-yellow-400 font-bold mr-2">⚡ TOOL CALL:</span>
                  )}
                  {log.type === 'tool_response' && (
                     <span className="text-green-400 font-bold mr-2">✓ TOOL RESP:</span>
                  )}
                  {log.type === 'info' && (
                     <span className="text-blue-400 font-bold mr-2">ℹ INFO:</span>
                  )}
                  {log.type === 'error' && (
                     <span className="text-red-400 font-bold mr-2">✖ ERROR:</span>
                  )}
                  {log.type === 'transcript' && (
                     <span className="text-purple-400 font-bold mr-2">💬 CHAT:</span>
                  )}
                  <span className={`text-slate-300 ${log.type === 'transcript' ? 'text-white italic' : ''}`}>{log.message}</span>
                  {log.data && (
                    <pre className="mt-1 text-slate-500 bg-slate-950/50 p-2 rounded overflow-x-auto">
                      {JSON.stringify(log.data, null, 2)}
                    </pre>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
};

export default App;