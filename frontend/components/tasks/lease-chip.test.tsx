import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { LeaseChip } from "@/components/tasks/lease-chip";

describe("lease chip", () => {
  it("renders the advisory countdown while the estimate still holds", () => {
    render(<LeaseChip secondsRemaining={612} />);
    expect(screen.getByTitle(/Lease 10m 12s remaining/)).toHaveTextContent("10:12");
  });

  it("renders OVERDUE as words, not colour alone", () => {
    render(<LeaseChip secondsRemaining={0} isOverdue secondsOverdue={540} />);
    const chip = screen.getByLabelText(/Lease 9m 00s over the agent's estimate/);
    expect(chip).toHaveTextContent("OVERDUE");
    expect(chip).toHaveAttribute("data-overdue", "true");
  });

  it("falls back to a readable label when the overdue duration is missing", () => {
    render(<LeaseChip secondsRemaining={null} isOverdue secondsOverdue={Number.NaN} />);
    expect(screen.getByLabelText(/Lease overdue — past the agent's estimate/)).toHaveTextContent("OVERDUE");
  });

  it("can hide an idle lease on compact surfaces", () => {
    const { container } = render(<LeaseChip secondsRemaining={null} hideWhenIdle />);
    expect(container).toBeEmptyDOMElement();
  });
});
