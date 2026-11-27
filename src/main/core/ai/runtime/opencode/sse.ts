export interface SseMessage {
  event?: string;
  id?: string;
  retry?: number;
  data: string;
}

export class SseParser {
  private buffer = "";

  push(chunk: string): SseMessage[] {
    if (!chunk) return [];
    this.buffer += chunk.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const messages: SseMessage[] = [];
    let index = this.buffer.indexOf("\n\n");
    while (index >= 0) {
      const block = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + 2);
      const message = parseSseBlock(block);
      if (message) messages.push(message);
      index = this.buffer.indexOf("\n\n");
    }
    return messages;
  }

  flush(): SseMessage[] {
    const block = this.buffer.trim();
    this.buffer = "";
    if (!block) return [];
    const message = parseSseBlock(block);
    return message ? [message] : [];
  }
}

function parseSseBlock(block: string): SseMessage | null {
  const dataLines: string[] = [];
  let event: string | undefined;
  let id: string | undefined;
  let retry: number | undefined;

  for (const line of block.split("\n")) {
    if (!line || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);

    if (field === "data") dataLines.push(value);
    else if (field === "event") event = value;
    else if (field === "id") id = value;
    else if (field === "retry") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) retry = parsed;
    }
  }

  if (dataLines.length === 0) return null;
  return { event, id, retry, data: dataLines.join("\n") };
}
