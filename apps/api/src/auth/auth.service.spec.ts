import { ConflictException, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import * as argon2 from "argon2";
import { AuthService } from "./auth.service.js";
import { PrismaService } from "../prisma/prisma.service.js";

/**
 * Unit tests for AuthService with a fully mocked Prisma layer and a real
 * JwtService (a test secret is simpler and more faithful than mocking sign).
 */
describe("AuthService", () => {
  let service: AuthService;

  // Minimal in-memory mock of the Prisma delegates AuthService touches.
  const prismaMock = {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      upsert: jest.fn(),
    },
    refreshToken: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  };

  const configMock = {
    get: (key: string) => {
      const values: Record<string, string> = {
        JWT_REFRESH_TTL: "7d",
        JWT_ACCESS_TTL: "15m",
        JWT_ACCESS_SECRET: "test-access-secret",
      };
      return values[key];
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: ConfigService, useValue: configMock },
        {
          provide: JwtService,
          useValue: new JwtService({ secret: "test-access-secret" }),
        },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
    // refreshToken.create just echoes the input by default.
    prismaMock.refreshToken.create.mockResolvedValue({});
  });

  describe("register", () => {
    it("hashes the password with argon2id and issues tokens", async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);
      prismaMock.user.create.mockImplementation(async ({ data }: any) => ({
        id: "user_1",
        email: data.email,
        name: data.name,
        avatarUrl: null,
        passwordHash: data.passwordHash,
      }));

      const result = await service.register({
        email: "a@b.com",
        password: "supersecret",
        name: "Ada",
      });

      // The persisted hash must be a real argon2id hash and verify correctly.
      const createArg = prismaMock.user.create.mock.calls[0][0];
      const storedHash: string = createArg.data.passwordHash;
      expect(storedHash).toMatch(/^\$argon2id\$/);
      expect(storedHash).not.toContain("supersecret");
      await expect(argon2.verify(storedHash, "supersecret")).resolves.toBe(true);

      expect(result.accessToken).toEqual(expect.any(String));
      expect(result.user).toEqual({
        id: "user_1",
        email: "a@b.com",
        name: "Ada",
        avatarUrl: null,
      });
      expect(prismaMock.refreshToken.create).toHaveBeenCalledTimes(1);
    });

    it("rejects a duplicate email with 409", async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: "existing" });

      await expect(
        service.register({ email: "a@b.com", password: "supersecret", name: "Ada" }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prismaMock.user.create).not.toHaveBeenCalled();
    });
  });

  describe("login", () => {
    it("rejects a wrong password with a generic 401", async () => {
      const passwordHash = await argon2.hash("correct-password", {
        type: argon2.argon2id,
      });
      prismaMock.user.findUnique.mockResolvedValue({
        id: "user_1",
        email: "a@b.com",
        name: "Ada",
        avatarUrl: null,
        passwordHash,
      });

      await expect(
        service.login({ email: "a@b.com", password: "wrong-password" }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it("rejects an unknown email with the same generic 401", async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login({ email: "nobody@b.com", password: "whatever12" }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it("issues tokens for valid credentials", async () => {
      const passwordHash = await argon2.hash("correct-password", {
        type: argon2.argon2id,
      });
      prismaMock.user.findUnique.mockResolvedValue({
        id: "user_1",
        email: "a@b.com",
        name: "Ada",
        avatarUrl: null,
        passwordHash,
      });

      const result = await service.login({
        email: "a@b.com",
        password: "correct-password",
      });

      expect(result.accessToken).toEqual(expect.any(String));
      expect(result.user.id).toBe("user_1");
      expect(result.user).not.toHaveProperty("passwordHash");
    });
  });

  describe("issueTokens", () => {
    it("signs an access token and persists a hashed refresh token in a new family", async () => {
      const result = await service.issueTokens({
        id: "user_1",
        email: "a@b.com",
        name: "Ada",
        avatarUrl: null,
      });

      expect(result.accessToken).toEqual(expect.any(String));
      expect(result.refreshToken).toMatch(/^[0-9a-f]{64}$/); // 32 random bytes hex

      const persisted = prismaMock.refreshToken.create.mock.calls[0][0].data;
      // Stored value is a hash, never the raw token.
      expect(persisted.tokenHash).not.toBe(result.refreshToken);
      expect(persisted.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(persisted.family).toEqual(expect.any(String));
      expect(persisted.userId).toBe("user_1");
    });

    it("keeps the same family when rotating", async () => {
      await service.issueTokens(
        { id: "user_1", email: "a@b.com", name: "Ada", avatarUrl: null },
        "family-123",
      );
      const persisted = prismaMock.refreshToken.create.mock.calls[0][0].data;
      expect(persisted.family).toBe("family-123");
    });
  });

  describe("refresh (rotation)", () => {
    it("revokes the presented token and issues a new one in the same family", async () => {
      prismaMock.refreshToken.findUnique.mockResolvedValue({
        id: "rt_1",
        userId: "user_1",
        family: "family-1",
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
      });
      prismaMock.user.findUnique.mockResolvedValue({
        id: "user_1",
        email: "a@b.com",
        name: "Ada",
        avatarUrl: null,
      });
      prismaMock.refreshToken.update.mockResolvedValue({});

      const result = await service.refresh("some-valid-token");

      // Old token marked revoked.
      expect(prismaMock.refreshToken.update).toHaveBeenCalledWith({
        where: { id: "rt_1" },
        data: { revokedAt: expect.any(Date) },
      });
      // New token created in the same family.
      const created = prismaMock.refreshToken.create.mock.calls[0][0].data;
      expect(created.family).toBe("family-1");
      expect(result.accessToken).toEqual(expect.any(String));
    });

    it("rejects an unknown token with 401", async () => {
      prismaMock.refreshToken.findUnique.mockResolvedValue(null);
      await expect(service.refresh("ghost")).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });

  describe("refresh (reuse detection)", () => {
    it("revokes the entire family and 401s when an already-revoked token is reused", async () => {
      prismaMock.refreshToken.findUnique.mockResolvedValue({
        id: "rt_old",
        userId: "user_1",
        family: "family-compromised",
        revokedAt: new Date(), // already rotated → reuse
        expiresAt: new Date(Date.now() + 60_000),
      });

      await expect(service.refresh("stolen-token")).rejects.toBeInstanceOf(
        UnauthorizedException,
      );

      // The whole family is nuked as a theft response.
      expect(prismaMock.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { family: "family-compromised", revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      // No new token is issued on a reuse attempt.
      expect(prismaMock.refreshToken.create).not.toHaveBeenCalled();
    });
  });

  describe("logout", () => {
    it("revokes the whole family of the presented token", async () => {
      prismaMock.refreshToken.findUnique.mockResolvedValue({
        id: "rt_1",
        family: "family-1",
      });

      await service.logout("some-token");

      expect(prismaMock.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { family: "family-1", revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });
  });
});
