export type TrailStop = {
  name: string;
  aliases?: string[];
  lat?: number;
  lng?: number;
  required?: boolean;
};

export type TrailRoute = {
  id?: string;
  aliases: string[];
  stops: TrailStop[];
  // 嵩山=太室山+少室山这类多徒步区需要把已知线路分到不同景区池；
  // 恒山这类单主线目的地可以不填。
  scenicName?: string;
  zoneId?: string;
  notes?: string;
};

export type RouteZone = {
  id: string;
  name: string;
  aliases?: string[];
  entranceStopNames?: string[];
  exitStopNames?: string[];
};

export type RouteEdge = {
  from: string;
  to: string;
  mode: "walk" | "cableway" | "shuttle" | "car" | "other";
  duration?: string;
  note?: string;
  source?: string;
  confidence?: number;
};

export type DestinationRouteKnowledge = {
  destinationName: string;
  aliases: string[];
  zones: RouteZone[];
  trails: TrailRoute[];
  edges: RouteEdge[];
  source: string;
  confidence: number;
};

export type DestinationRouteKnowledgeRow = {
  destination_name?: string;
  aliases?: string[];
  model?: {
    zones?: RouteZone[];
    trails?: TrailRoute[];
    edges?: RouteEdge[];
  };
  source?: string;
  confidence?: number | string;
};
