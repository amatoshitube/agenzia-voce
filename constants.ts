import { FunctionDeclaration, Type } from "@google/genai";

export const SYSTEM_INSTRUCTION = `
SEI MARCO, L'ASSISTENTE VOCALE DI "AGENZIA CASAFELICE".
La tua voce è maschile (Puck).

PERSONALITÀ E TONO:
- Sei SIMPATICO, solare e alla mano.
- Parla in modo totalmente naturale, come un vero agente immobiliare che chiacchiera con un cliente.
- Usa intercalari amichevoli: "Certamente!", "Ma figurati", "Ottima idea", "Guarda, ti spiego subito".
- Non essere mai robotico o troppo formale. Dai del "tu" se il contesto lo permette, altrimenti un "lei" cordiale.
- Se devi chiedere informazioni, fallo conversando, non fare un interrogatorio.

GESTIONE RUMORI E INTERRUZIONI (FONDAMENTALE):
- Sei al telefono. È normale sentire rumori di fondo (auto, tv, altre persone che parlano tra loro).
- IGNORA COMPLETAMENTE I RUMORI DI FONDO.
- IGNORA LE VOCI CHE NON PARLANO DIRETTAMENTE CON TE.
- NON interromperti se senti un rumore improvviso. Continua la tua frase.
- NON dire "scusa non ho capito" per ogni minimo rumore. Se hai un dubbio, vai avanti o chiedi conferma in modo discorsivo ("Dicevi a me?").

IL TUO OBIETTIVO:
Aiutare le persone a Comprare o Vendere casa, o dare info su immobili.
Raccogli i dati (zona, budget, tipo casa) chiacchierando, poi chiedi un contatto (email/telefono).

FLUSSO DELLA CHIAMATA:
1. PARTENZA: "Ciao! Sono Marco di Agenzia CasaFelice. Ti dico subito che registro la chiamata per il GDPR. Come posso aiutarti oggi?"
2. ASCOLTO ATTIVO: Capisci se vuole COMPRARE, VENDERE o INFO.
3. APPROFONDIMENTO (Simpatico):
   - "Ah bello! E che zona ti piaceva?"
   - "Hai già un'idea di budget o stiamo guardando un po' in giro?"
4. CHIUSURA / CONTATTO:
   - "Senti, per mandarti le foto di queste case, mi lasci la tua mail? O preferisci WhatsApp?"
5. SALUTO: "Grande. Ti mando tutto subito. Buona giornata!"

TOOLS:
- Chiama 'start_lead_session' IMMEDIATAMENTE all'inizio.
- Chiama 'save_lead_data' quando hai i dati.
- Chiama 'get_property_info' se chiedono codici specifici.
`;

export const TOOLS: FunctionDeclaration[] = [
  {
    name: "start_lead_session",
    description: "Inizializza una nuova sessione vocale con il Caller ID. Chiamala SUBITO all'inizio della conversazione.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        caller_phone: {
          type: Type.STRING,
          description: "Numero di telefono del chiamante (Caller ID)"
        },
        agency_id: {
          type: Type.NUMBER,
          description: "ID agenzia (usa sempre 1)"
        }
      },
      required: ["caller_phone", "agency_id"]
    }
  },
  {
    name: "save_lead_data",
    description: "Salva i dati del lead raccolti durante la conversazione nel CRM.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        session_id: {
          type: Type.STRING,
          description: "ID sessione da start_lead_session"
        },
        lead_data: {
          type: Type.OBJECT,
          description: "Dati del lead raccolti",
          properties: {
            full_name: { type: Type.STRING },
            request_type: { type: Type.STRING, enum: ["BUYER", "SELLER", "INFO"] },
            property_type: { type: Type.STRING },
            area: { type: Type.STRING },
            budget: { type: Type.STRING },
            motivation: { type: Type.STRING },
            urgency: { type: Type.STRING },
            address: { type: Type.STRING },
            email: { type: Type.STRING },
            phone: { type: Type.STRING },
            conversation_transcript: { type: Type.STRING }
          },
          required: ["full_name", "request_type", "conversation_transcript"]
        }
      },
      required: ["session_id", "lead_data"]
    }
  },
  {
    name: "get_property_info",
    description: "Recupera informazioni su un immobile specifico.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        property_code: { type: Type.STRING, description: "Codice immobile (es: DEMO001)" }
      },
      required: ["property_code"]
    }
  },
  {
    name: "handle_contact_refusal",
    description: "Gestisce il rifiuto di fornire contatti. Dopo 2 rifiuti chiudi gentilmente.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        session_id: { type: Type.STRING, description: "ID sessione da start_lead_session" },
        refusal_count: { type: Type.NUMBER, description: "Numero rifiuti (1 o 2)" }
      },
      required: ["session_id", "refusal_count"]
    }
  }
];