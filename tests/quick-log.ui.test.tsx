// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuickLog } from "@/components/quick-log";

function renderQL(canWrite = true) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <QuickLog canWrite={canWrite} />
    </QueryClientProvider>,
  );
}

const reply = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("QuickLog component", () => {
  it("disables Log It until there is input and sends the text with an idempotency key", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(() => reply({ status: "saved", message: "Added AJ1 Chicago (size 10) @ ₹18,000 to stock", elapsedMs: 120 }));
    renderQL();
    const btn = screen.getByRole("button", { name: /log it/i });
    expect(btn).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/describe a purchase or a sale/i), { target: { value: "Bought AJ1 Chicago size 10 for 18k" } });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByText(/Added AJ1 Chicago/)).toBeInTheDocument());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/log");
    const fd = (init as RequestInit).body as FormData;
    expect(fd.get("text")).toBe("Bought AJ1 Chicago size 10 for 18k");
    expect(String(fd.get("idempotencyKey")).length).toBeGreaterThan(8);
    expect(screen.getByText(/server/)).toBeInTheDocument(); // real elapsed timing is displayed
  });

  it("shows a yellow review message and keeps nothing saved", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => reply({ status: "needs_review", message: "x", problems: ["No item in stock matches this sale"], elapsedMs: 80 }));
    renderQL();
    fireEvent.change(screen.getByLabelText(/describe a purchase or a sale/i), { target: { value: "Sold the Yeezy for 15k" } });
    fireEvent.click(screen.getByRole("button", { name: /log it/i }));
    await waitFor(() => expect(screen.getByText(/Needs your review/)).toBeInTheDocument());
    expect(screen.getByText(/No item in stock matches/)).toBeInTheDocument();
  });

  it("keeps the text and reuses the same key after a network failure so a retry cannot duplicate", async () => {
    const keys: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation((_u, init) => {
      keys.push(String(((init as RequestInit).body as FormData).get("idempotencyKey")));
      return keys.length === 1 ? Promise.reject(new TypeError("network down")) : reply({ status: "saved", message: "Added", elapsedMs: 10 });
    });
    renderQL();
    const box = screen.getByLabelText(/describe a purchase or a sale/i) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "Bought Dunk size 9 for 12k" } });
    fireEvent.click(screen.getByRole("button", { name: /log it/i }));
    await waitFor(() => expect(screen.getByText(/retrying is safe/i)).toBeInTheDocument());
    expect(box.value).toBe("Bought Dunk size 9 for 12k");
    fireEvent.click(screen.getByRole("button", { name: /log it/i }));
    await waitFor(() => expect(keys).toHaveLength(2));
    expect(keys[0]).toBe(keys[1]);
  });

  it("is read-only for roles without write access", () => {
    renderQL(false);
    expect(screen.getByLabelText(/describe a purchase or a sale/i)).toBeDisabled();
  });
});
