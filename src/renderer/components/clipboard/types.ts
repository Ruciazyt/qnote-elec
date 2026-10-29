import type { AssistantBlock } from "@shared/aiBlocks";
import type { AiImageAttachment } from "@shared/aiImages";

export interface ClipboardRecord {
    id?: number;
    type: "text" | "image";
    content: string;
    time: Date | string;
    ocr_result?: string;
    vector_indexed?: number;
    vector_id?: string;
    /** 置顶时间（毫秒时间戳），null/缺省 = 未置顶 */
    pinned_at?: number | null;
    /** 重要标记：清空记录时会被跳过 */
    is_important?: number;
}

/**
 * 置顶的排前面，组内保持传入顺序。
 *
 * 主进程已经按「置顶时间倒序 / 记录时间倒序」排好了，界面里只需要做分组 ——
 * 新复制的记录（未置顶）和刚点下置顶的记录要在本地重排时靠它维持这个次序。
 */
export function sortPinned<T extends { pinned_at?: number | null }>(list: T[]): T[] {
    return [...list.filter((r) => r.pinned_at), ...list.filter((r) => !r.pinned_at)];
}

export interface ChatMessage {
    id: number;
    role: "user" | "assistant" | "system";
    content: string;
    /**
     * AI 回复的有序分块：思考 / 工具调用 / 输出，按真实发生顺序排。
     * 从 ai_chat.blocks 列读回（见 shared/aiBlocks）。
     */
    blocks?: AssistantBlock[];
    /**
     * 用户这一轮带的图片附件。
     * 从 ai_chat.images 列读回（见 shared/aiImages）。
     */
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

