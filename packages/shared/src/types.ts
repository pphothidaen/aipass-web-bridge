export interface ModelInfo {
  id: string;
  object?: string;
  owned_by?: string;
  name?: string;
  provider?: string;
  kind?: string;
  description?: string;
  ready?: boolean;
  selectable?: boolean;
  free_credit?: boolean;
  is_default?: boolean;
  [key: string]: unknown;
}

export interface ModelsResponse {
  object: string;
  data: ModelInfo[];
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionRequest {
  model?: string;
  messages: ChatMessage[];
}

export interface ChatCompletionResponse {
  choices: { message: ChatMessage }[];
}