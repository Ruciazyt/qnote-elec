import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function AssistantMarkdown({ text }: { text: string }) {
  return (
    <div className="ai-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a
              href={href}
              onClick={(event) => {
                if (!href) return;
                event.preventDefault();
                void window.electron.openExternal(href);
              }}>
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className="ai-markdown-table-wrap">
              <table>{children}</table>
            </div>
          ),
        }}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
