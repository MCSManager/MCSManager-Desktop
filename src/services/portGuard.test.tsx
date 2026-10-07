import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { useState } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "../i18n";
import en from "../i18n/locales/en.json";
import { PortGuardProvider, usePortGuard } from "./portGuard";

function Probe() {
  const guard = usePortGuard();
  const [result, setResult] = useState("pending");
  return (
    <div>
      <button
        type="button"
        onClick={() => {
          void guard.confirmPortKill(23333).then((ok) => setResult(ok ? "confirmed" : "cancelled"));
        }}
      >
        ask
      </button>
      <span data-testid="result">{result}</span>
    </div>
  );
}

function renderGuard() {
  return render(
    <I18nProvider initialLanguage="en">
      <PortGuardProvider>
        <Probe />
      </PortGuardProvider>
    </I18nProvider>,
  );
}

describe("port guard dialog", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows a confirmation dialog with the port number and hint", async () => {
    const user = userEvent.setup();
    renderGuard();

    expect(screen.queryByTestId("port-conflict-dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "ask" }));

    expect(screen.getByTestId("port-conflict-dialog")).toBeInTheDocument();
    expect(
      screen.getByText(en["portConflict.message"].replace("{port}", "23333")),
    ).toBeInTheDocument();
    expect(screen.getByText(en["portConflict.hint"])).toBeInTheDocument();
  });

  it("resolves true and closes when confirmed", async () => {
    const user = userEvent.setup();
    renderGuard();
    await user.click(screen.getByRole("button", { name: "ask" }));
    await user.click(screen.getByRole("button", { name: en["portConflict.confirm"] }));

    expect(screen.getByTestId("result").textContent).toBe("confirmed");
    expect(screen.queryByTestId("port-conflict-dialog")).not.toBeInTheDocument();
  });

  it("resolves false and closes when cancelled", async () => {
    const user = userEvent.setup();
    renderGuard();
    await user.click(screen.getByRole("button", { name: "ask" }));
    await user.click(screen.getByRole("button", { name: en["portConflict.cancel"] }));

    expect(screen.getByTestId("result").textContent).toBe("cancelled");
    expect(screen.queryByTestId("port-conflict-dialog")).not.toBeInTheDocument();
  });
});
