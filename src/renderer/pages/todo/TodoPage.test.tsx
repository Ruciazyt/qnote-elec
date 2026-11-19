import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElectronStub } from "@/test/electron-stub";
import { TooltipProvider } from "@/components/ui/tooltip";
import TodoPage from "./TodoPage";
import type { Todo } from "./types";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();

function todo(overrides: Partial<Todo>): Todo {
  return {
    id: 1,
    title: "任务",
    notes: null,
    priority: "medium",
    due_date: null,
    completed: 0,
    completed_at: null,
    archived_at: null,
    remind_at: null,
    reminded_at: null,
    created_at: NOW,
    updated_at: NOW,
    attachments: [],
    ...overrides,
  };
}

const TODOS: Todo[] = [
  todo({ id: 1, title: "本周新建的活" }),
  todo({
    id: 2,
    title: "本周完成的活",
    created_at: NOW - 40 * DAY,
    completed: 1,
    completed_at: NOW,
  }),
  todo({
    id: 3,
    title: "上周的活",
    created_at: NOW - 40 * DAY,
    completed: 1,
    completed_at: NOW - 40 * DAY,
  }),
  todo({ id: 4, title: "归档的活", archived_at: NOW }),
];

beforeEach(() => {
  window.electron = createElectronStub({
    todoList: vi.fn(async () => TODOS),
    onTodosChanged: vi.fn(() => () => {}),
  });
});

async function renderPage() {
  render(
    <TooltipProvider>
      <TodoPage />
    </TooltipProvider>
  );
  await waitFor(() => expect(screen.getByText("本周新建的活")).toBeInTheDocument());
}

describe("Todo「本周」页签", () => {
  it("本周新建与本周完成的都算进来，计数为 2", async () => {
    await renderPage();

    const tab = screen.getByRole("button", { name: /本周/ });
    expect(tab.textContent).toContain("2");
  });

  it("点开只显示本周创建或完成的，归档的不算", async () => {
    await renderPage();

    await userEvent.click(screen.getByRole("button", { name: /本周/ }));

    expect(screen.getByText("本周新建的活")).toBeInTheDocument();
    expect(screen.getByText("本周完成的活")).toBeInTheDocument();
    expect(screen.queryByText("上周的活")).not.toBeInTheDocument();
    expect(screen.queryByText("归档的活")).not.toBeInTheDocument();
  });

  it("全部页签里三条未归档的都在", async () => {
    await renderPage();

    await userEvent.click(screen.getByRole("button", { name: /全部/ }));

    expect(screen.getByText("本周新建的活")).toBeInTheDocument();
    expect(screen.getByText("本周完成的活")).toBeInTheDocument();
    expect(screen.getByText("上周的活")).toBeInTheDocument();
    expect(screen.queryByText("归档的活")).not.toBeInTheDocument();
  });
});
