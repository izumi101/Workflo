import { Test } from "@nestjs/testing";
import { SearchService } from "./search.service.js";
import { PrismaService } from "../prisma/prisma.service.js";

describe("SearchService", () => {
  let service: SearchService;

  const prismaMock = {
    $queryRaw: jest.fn(),
  };

  const baseRow = (overrides: Record<string, unknown> = {}) => ({
    id: "issue_1",
    title: "Fix the login bug",
    status: "TODO",
    priority: "MEDIUM",
    projectId: "proj_1",
    projectKey: "WF",
    number: 1,
    ...overrides,
  });

  beforeEach(async () => {
    jest.resetAllMocks();

    const moduleRef = await Test.createTestingModule({
      providers: [SearchService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();

    service = moduleRef.get(SearchService);
  });

  it("short-circuits to an empty array for a blank q, without querying the DB", async () => {
    const result = await service.search({ q: "", workspaceId: "ws_1", limit: 20 } as any);

    expect(result).toEqual([]);
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
  });

  it("short-circuits to an empty array for a whitespace-only q", async () => {
    const result = await service.search({ q: "   ", workspaceId: "ws_1", limit: 20 } as any);

    expect(result).toEqual([]);
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
  });

  it("maps raw rows into the lightweight SearchResult shape, including the composed human key", async () => {
    prismaMock.$queryRaw.mockResolvedValue([baseRow()]);

    const result = await service.search({ q: "login", workspaceId: "ws_1", limit: 20 } as any);

    expect(result).toEqual([
      {
        id: "issue_1",
        key: "WF-1",
        title: "Fix the login bug",
        status: "TODO",
        priority: "MEDIUM",
        projectId: "proj_1",
      },
    ]);
  });

  it("passes the schema-clamped limit through to the raw query (respecting the caller's value)", async () => {
    prismaMock.$queryRaw.mockResolvedValue([]);

    await service.search({ q: "login", workspaceId: "ws_1", limit: 5 } as any);

    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1);
    const sqlArg = prismaMock.$queryRaw.mock.calls[0][0];
    // Prisma.sql tagged templates carry their interpolated values on `.values`.
    expect(sqlArg.values).toEqual(expect.arrayContaining(["ws_1", 5]));
  });

  it("trims q before using it (so query building still runs for surrounding whitespace)", async () => {
    prismaMock.$queryRaw.mockResolvedValue([]);

    await service.search({ q: "  login  ", workspaceId: "ws_1", limit: 20 } as any);

    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1);
    const sqlArg = prismaMock.$queryRaw.mock.calls[0][0];
    expect(sqlArg.values).toEqual(expect.arrayContaining(["login"]));
  });
});
