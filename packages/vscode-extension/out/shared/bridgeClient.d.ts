import { ModelInfo, ChatCompletionRequest, ChatCompletionResponse } from './types';
export declare class BridgeClient {
    private baseUrl;
    constructor(baseUrl: string);
    listModels(): Promise<ModelInfo[]>;
    chatCompletion(req: ChatCompletionRequest): Promise<ChatCompletionResponse>;
    resetConversation(): Promise<void>;
    createNewConversation(options?: {
        model?: string;
        message?: string;
        temporary?: boolean;
        assistant?: string;
    }): Promise<{
        id?: string;
        temporary?: boolean;
    }>;
}
