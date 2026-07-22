import type { ConfigService } from "@nestjs/config";
import { TriageCacheService } from "./triage-cache.service.js";

const mockOn = jest.fn();
const mockScanStream = jest.fn();
const mockDel = jest.fn();
const mockQuit = jest.fn();

jest.mock("ioredis", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    on: mockOn,
    scanStream: mockScanStream,
    del: mockDel,
    quit: mockQuit,
    get: jest.fn(),
    set: jest.fn(),
  })),
}));

/** A fake Redis `scanStream` — emits one batch of `keys` then ends. */
function fakeScanStream(keys: string[]) {
  const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
  const stream = {
    on(event: string, cb: (...args: unknown[]) => void) {
      (handlers[event] ??= []).push(cb);
      return stream;
    },
  };
  queueMicrotask(() => {
    if (keys.length > 0) handlers.data?.forEach((cb) => cb(keys));
    handlers.end?.forEach((cb) => cb());
  });
  return stream;
}

describe("TriageCacheService", () => {
  let service: TriageCacheService;

  beforeEach(() => {
    jest.clearAllMocks();
    const configMock = {
      get: jest.fn().mockReturnValue("redis://localhost:6380"),
    } as unknown as ConfigService<Record<string, unknown>, true>;
    service = new TriageCacheService(configMock);
  });

  it("delByWorkspace scans using the SAME prefix cacheKey produces (cacheKey(ws, '') is exactly that prefix)", async () => {
    const expectedPrefix = TriageCacheService.cacheKey("ws_1", ""); // "triage:ws_1:" — the prefix, by construction
    mockScanStream.mockImplementation(() => fakeScanStream([]));

    await service.delByWorkspace("ws_1");

    expect(mockScanStream).toHaveBeenCalledWith({ match: `${expectedPrefix}*`, count: 100 });
  });

  it("deletes every key the scan turns up", async () => {
    mockScanStream.mockImplementation(() => fakeScanStream(["triage:ws_1:userA", "triage:ws_1:userB"]));

    await service.delByWorkspace("ws_1");

    expect(mockDel).toHaveBeenCalledWith("triage:ws_1:userA", "triage:ws_1:userB");
  });

  it("does not call del when the scan finds no keys", async () => {
    mockScanStream.mockImplementation(() => fakeScanStream([]));

    await service.delByWorkspace("ws_1");

    expect(mockDel).not.toHaveBeenCalled();
  });

  it("fails open (never throws) if scanStream itself throws synchronously", async () => {
    mockScanStream.mockImplementation(() => {
      throw new Error("redis down");
    });

    await expect(service.delByWorkspace("ws_1")).resolves.toBeUndefined();
  });

  it("fails open (never throws) if the scan stream emits an error event", async () => {
    mockScanStream.mockImplementation(() => {
      const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
      const stream = {
        on(event: string, cb: (...args: unknown[]) => void) {
          (handlers[event] ??= []).push(cb);
          return stream;
        },
      };
      queueMicrotask(() => handlers.error?.forEach((cb) => cb(new Error("scan failed"))));
      return stream;
    });

    await expect(service.delByWorkspace("ws_1")).resolves.toBeUndefined();
    expect(mockDel).not.toHaveBeenCalled();
  });

  it("fails open (never throws) if del itself rejects", async () => {
    mockScanStream.mockImplementation(() => fakeScanStream(["triage:ws_1:userA"]));
    mockDel.mockRejectedValue(new Error("redis down"));

    await expect(service.delByWorkspace("ws_1")).resolves.toBeUndefined();
  });
});
