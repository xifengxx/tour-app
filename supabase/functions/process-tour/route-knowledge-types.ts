export type TrailStop = {
  name: string;
  aliases?: string[];
  lat?: number;
  lng?: number;
  required?: boolean;
  /** 坐标是否来自外部证据（POI/OSM）绑定，而不是模型自己给的数字。 */
  evidenceBound?: boolean;
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

/** 可解释的知识完整度评分（v91）：替代"数证据条数"的伪置信度。 */
export type KnowledgeQuality = {
  score: number;
  grade: "strong" | "usable" | "weak" | "unusable";
  parts: {
    sourceTrust: number;
    coordCoverage: number;
    evidenceCoverage: number;
    sitePurity: number;
    structureCompleteness: number;
  };
  transportCoverage: number;
  stops: number;
  trails: number;
  edges: number;
};

export type DestinationRouteKnowledge = {
  destinationName: string;
  aliases: string[];
  zones: RouteZone[];
  trails: TrailRoute[];
  edges: RouteEdge[];
  source: string;
  confidence: number;
  quality?: KnowledgeQuality;
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
