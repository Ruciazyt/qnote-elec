export interface ClipboardRecord {
    id?: number;
    type: "text" | "image";
    content: string;
    time: Date | string;
    ocr_result?: string;
    vector_indexed?: number;
    vector_id?: string;
    pinned_at?: number | null;
    is_important?: number;
}

export function sortPinned<T extends { pinned_at?: number | null }>(list: T[]): T[] {
    return [...list.filter((r) => r.pinned_at), ...list.filter((r) => !r.pinned_at)];
}
