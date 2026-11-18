import type { AssistantBlock } from "@shared/ai/aiBlocks";
import type { AiImageAttachment } from "@shared/ai/aiImages";

export interface ChatMessage {
    id: number;
    role: "user" | "assistant" | "system";
    content: string;
    blocks?: AssistantBlock[];
    images?: AiImageAttachment[];
    created_at: Date;
}

export interface AiChatSession {
    id: string;
    title: string;
    preview: string;
    created_at: Date;
    updated_at: Date;
}
