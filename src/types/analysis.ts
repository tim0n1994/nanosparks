import { EpisodeStatus } from '@prisma/client';

export interface Speaker {
  id: string;
  name: string;
  color: string;
  speakingTime: number;
}

export interface Argument {
  id: string;
  text: string;
  speakerId: string;
  parentId?: string;
  type: 'claim' | 'support' | 'oppose' | 'refine';
  timestamp: number;
  children?: Argument[];
}

export interface Topic {
  id: string;
  name: string;
  mentionCount: number;
  sentiment: 'positive' | 'neutral' | 'negative';
  timestamps: number[];
}

export interface Quote {
  id: string;
  text: string;
  speakerId: string;
  timestamp: number;
  context: string;
}

export interface ReferenceLink {
  id: string;
  url: string;
  title: string;
  description?: string;
  relevanceScore: number;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  speakerId?: string;
}

export interface AnalysisResult {
  arguments: Argument[];
  speakers: Speaker[];
  topics: Topic[];
  quotes: Quote[];
  references: ReferenceLink[];
  summary?: {
    summary: string;
    takeaways: string[];
    language: string;
    host?: string;
  };
  generatedAt: Date;
}

export interface Episode {
  id: string;
  youtubeId: string;
  title: string;
  description: string;
  duration: number;
  thumbnailUrl: string;
  channelId: string;
  transcript?: TranscriptSegment[];
  analysis?: AnalysisResult | null;
  status: 'pending' | 'downloading' | 'transcribing' | 'analyzing' | 'completed' | 'failed';
  createdAt: Date;
  updatedAt: Date;
}
