export interface LeadData {
  full_name?: string;
  request_type?: "BUYER" | "SELLER" | "INFO";
  property_type?: string;
  area?: string;
  budget?: string;
  motivation?: string;
  urgency?: string;
  address?: string;
  price?: string;
  email?: string;
  phone?: string;
  conversation_transcript?: string;
}

export interface LogEntry {
  timestamp: string;
  type: 'info' | 'tool_call' | 'tool_response' | 'error' | 'transcript';
  message: string;
  data?: any;
}

export interface PropertyInfo {
  code: string;
  price: string;
  area: string;
  zone: string;
  type: string;
}
