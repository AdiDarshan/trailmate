// Shared domain types, used by both the server layer and the React client
// (type-only imports — erased at build, so no client/server runtime coupling).

export interface Place {
  name?: string;
  address?: string;
  maps?: string;
}

export interface Trail {
  name?: string;
  distance_km?: string;
  duration?: string;
  difficulty?: string;
  start_maps?: string;
  waze?: string;
  tiuli_url?: string;
  description?: string;
}

export interface Day {
  day_number: number;
  date?: string;
  weather?: string;
  weather_note?: string;
  trail?: Trail | null;
  lunch?: Place | null;
  dinner?: Place | null;
  hotel?: Place | null;
}

export interface Itinerary {
  id?: string;
  title: string;
  dates?: string;
  days: Day[];
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}
