import { parseQueryDeterministic } from "./query-parse.js";

describe("parseQueryDeterministic", () => {
  it("returns an all-text AST for a plain sentence with no recognized grammar", () => {
    const { ast, warnings } = parseQueryDeterministic("flaky test stuff from standup");
    expect(ast).toMatchObject({ v: 1, text: "flaky test stuff from standup" });
    expect(ast.assignee).toBeUndefined();
    expect(warnings).toEqual([]);
  });

  it("never throws on empty input", () => {
    const { ast } = parseQueryDeterministic("");
    expect(ast).toEqual({ v: 1 });
  });

  it("never throws on garbage/very long input", () => {
    const garbage = "a".repeat(2000) + " !!! -- \"'";
    expect(() => parseQueryDeterministic(garbage)).not.toThrow();
    const { ast } = parseQueryDeterministic(garbage);
    expect(ast.text!.length).toBeLessThanOrEqual(255);
  });

  describe("assignee", () => {
    it("'assigned to me' -> assignee: me", () => {
      const { ast } = parseQueryDeterministic("assigned to me");
      expect(ast.assignee).toBe("me");
      expect(ast.text).toBeUndefined();
    });

    it("'my bugs' -> assignee: me + type: BUG", () => {
      const { ast } = parseQueryDeterministic("my bugs");
      expect(ast.assignee).toBe("me");
      expect(ast.type).toEqual({ in: ["BUG"] });
    });

    it("'unassigned' -> assignee: unassigned", () => {
      const { ast } = parseQueryDeterministic("unassigned issues");
      expect(ast.assignee).toBe("unassigned");
    });

    it("does not let 'unassigned' also set assignee: me when both somehow present (first match wins)", () => {
      const { ast } = parseQueryDeterministic("assigned to me unassigned");
      expect(ast.assignee).toBe("me");
    });
  });

  describe("reporter", () => {
    it("'reported by me' -> reporter: me", () => {
      const { ast } = parseQueryDeterministic("reported by me");
      expect(ast.reporter).toBe("me");
    });
  });

  describe("@mentions (syntactic only — no directory)", () => {
    it("bare @Name -> assignee mention warning, removed from text", () => {
      const { ast, warnings } = parseQueryDeterministic("@Sarah bugs");
      expect(warnings).toContainEqual({ field: "assignee", kind: "mention", text: "Sarah" });
      expect(ast.type).toEqual({ in: ["BUG"] });
      expect(ast.text).toBeUndefined();
    });

    it("'assigned to @Name' -> assignee mention warning", () => {
      const { warnings } = parseQueryDeterministic("assigned to @Bob");
      expect(warnings).toContainEqual({ field: "assignee", kind: "mention", text: "Bob" });
    });

    it("'reported by @Name' -> reporter mention warning", () => {
      const { warnings } = parseQueryDeterministic("reported by @Alice");
      expect(warnings).toContainEqual({ field: "reporter", kind: "mention", text: "Alice" });
    });
  });

  describe("priority words", () => {
    it("urgent -> priority: {in: [URGENT]}", () => {
      expect(parseQueryDeterministic("urgent stuff").ast.priority).toEqual({ in: ["URGENT"] });
    });

    it("p1 -> priority: {in: [URGENT]}", () => {
      expect(parseQueryDeterministic("p1 items").ast.priority).toEqual({ in: ["URGENT"] });
    });

    it("high -> priority: {in: [HIGH]}", () => {
      expect(parseQueryDeterministic("high priority bugs").ast.priority).toEqual({ in: ["HIGH"] });
    });

    it("high+ -> priority: {atLeast: HIGH}, takes precedence over bare high", () => {
      const { ast } = parseQueryDeterministic("high+ priority bugs");
      expect(ast.priority).toEqual({ atLeast: "HIGH" });
    });
  });

  describe("type words", () => {
    it("bug/bugs -> type: {in: [BUG]}", () => {
      expect(parseQueryDeterministic("bug").ast.type).toEqual({ in: ["BUG"] });
      expect(parseQueryDeterministic("bugs").ast.type).toEqual({ in: ["BUG"] });
    });

    it("task -> type: {in: [TASK]}", () => {
      expect(parseQueryDeterministic("tasks").ast.type).toEqual({ in: ["TASK"] });
    });

    it("epic -> type: {in: [EPIC]}", () => {
      expect(parseQueryDeterministic("epics").ast.type).toEqual({ in: ["EPIC"] });
    });

    it("collects multiple distinct type words", () => {
      const { ast } = parseQueryDeterministic("bugs and tasks");
      expect(ast.type?.in.sort()).toEqual(["BUG", "TASK"]);
    });
  });

  describe("status words", () => {
    it("open -> status: {not: DONE}", () => {
      expect(parseQueryDeterministic("open issues").ast.status).toEqual({ not: "DONE" });
    });

    it("in progress -> status: {in: [IN_PROGRESS]}", () => {
      expect(parseQueryDeterministic("in progress").ast.status).toEqual({ in: ["IN_PROGRESS"] });
    });

    it("done -> status: {in: [DONE]}", () => {
      expect(parseQueryDeterministic("done").ast.status).toEqual({ in: ["DONE"] });
    });

    it("todo / to do -> status: {in: [TODO]}", () => {
      expect(parseQueryDeterministic("todo").ast.status).toEqual({ in: ["TODO"] });
      expect(parseQueryDeterministic("to do").ast.status).toEqual({ in: ["TODO"] });
    });

    it("explicit status word takes precedence over 'open' when both present", () => {
      const { ast } = parseQueryDeterministic("open done");
      expect(ast.status).toEqual({ in: ["DONE"] });
    });
  });

  describe("due / overdue", () => {
    it("overdue -> due: {overdue: true}", () => {
      expect(parseQueryDeterministic("overdue").ast.due).toEqual({ overdue: true });
    });

    it("due today -> due: {withinDays: 1}", () => {
      expect(parseQueryDeterministic("due today").ast.due).toEqual({ withinDays: 1 });
    });

    it("due this week -> due: {withinDays: 7}", () => {
      expect(parseQueryDeterministic("due this week").ast.due).toEqual({ withinDays: 7 });
    });

    it("due before <date> -> due: {between: [epoch, endOfDate]}", () => {
      const { ast } = parseQueryDeterministic("due before 2026-08-01");
      expect(ast.due).toEqual({
        between: ["1970-01-01T00:00:00.000Z", "2026-08-01T23:59:59.999Z"],
      });
    });

    it("overdue takes precedence over a conflicting due-today in the same sentence", () => {
      const { ast } = parseQueryDeterministic("overdue due today");
      expect(ast.due).toEqual({ overdue: true });
    });
  });

  describe("updated / created / stale", () => {
    it("updated in last N days -> updated: {withinDays: N}", () => {
      expect(parseQueryDeterministic("updated in last 3 days").ast.updated).toEqual({ withinDays: 3 });
      expect(parseQueryDeterministic("updated in the last 14 days").ast.updated).toEqual({ withinDays: 14 });
    });

    it("created in last N days -> created: {withinDays: N}", () => {
      expect(parseQueryDeterministic("created in last 5 days").ast.created).toEqual({ withinDays: 5 });
    });

    it("stale -> updated: {olderThanDays: 7}", () => {
      expect(parseQueryDeterministic("stale issues").ast.updated).toEqual({ olderThanDays: 7 });
    });

    it("untouched -> updated: {olderThanDays: 7}", () => {
      expect(parseQueryDeterministic("untouched bugs").ast.updated).toEqual({ olderThanDays: 7 });
    });

    it("'updated in last N days' takes precedence over a conflicting 'stale' in the same sentence", () => {
      const { ast } = parseQueryDeterministic("updated in last 2 days stale");
      expect(ast.updated).toEqual({ withinDays: 2 });
    });
  });

  describe("sort by", () => {
    it("sort by priority -> order: priority", () => {
      expect(parseQueryDeterministic("sort by priority").ast.order).toBe("priority");
    });

    it("sort by due -> order: due, and doesn't leak 'due' into the residual text", () => {
      const { ast } = parseQueryDeterministic("sort by due");
      expect(ast.order).toBe("due");
      expect(ast.text).toBeUndefined();
    });

    it("sort by updated/created/smart", () => {
      expect(parseQueryDeterministic("sort by updated").ast.order).toBe("updated");
      expect(parseQueryDeterministic("sort by created").ast.order).toBe("created");
      expect(parseQueryDeterministic("sort by smart").ast.order).toBe("smart");
    });
  });

  describe("the flagship demo sentence", () => {
    it("'high-priority bugs assigned to me, untouched for a week' resolves to 4 clauses", () => {
      const { ast } = parseQueryDeterministic("high-priority bugs assigned to me, untouched for a week");
      expect(ast.type).toEqual({ in: ["BUG"] });
      expect(ast.priority).toEqual({ in: ["HIGH"] });
      expect(ast.assignee).toBe("me");
      expect(ast.updated).toEqual({ olderThanDays: 7 });
    });
  });

  describe("composition", () => {
    it("combines multiple recognized clauses and leaves genuinely unmapped words as text", () => {
      const { ast } = parseQueryDeterministic("urgent bugs assigned to me about the login flow");
      expect(ast.priority).toEqual({ in: ["URGENT"] });
      expect(ast.type).toEqual({ in: ["BUG"] });
      expect(ast.assignee).toBe("me");
      expect(ast.text).toBe("about the login flow");
    });
  });
});
