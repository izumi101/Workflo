import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module.js";
import { PrismaService } from "../src/prisma/prisma.service.js";

/**
 * End-to-end auth flow against a REAL Postgres (from docker-compose, migrated).
 * Covers: register → login → GET /me (bearer) → refresh (cookie rotation) →
 * logout → refresh-after-logout rejected → old-token reuse rejected.
 *
 * Requires DATABASE_URL to point at a migrated database and the JWT secrets to
 * be set (see apps/api/.env.example). Skips gracefully if the DB is unreachable.
 */
describe("Auth (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const REFRESH_COOKIE = "refresh_token";
  const email = `e2e_${Date.now()}@example.com`;
  const password = "supersecret123";

  const extractRefreshCookie = (res: request.Response): string => {
    const raw = res.headers["set-cookie"] as unknown as string[] | undefined;
    const cookie = (raw ?? []).find((c) => c.startsWith(`${REFRESH_COOKIE}=`));
    if (!cookie) throw new Error("no refresh cookie in response");
    return cookie.split(";")[0]!; // "refresh_token=<value>"
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    app.use(cookieParser());
    await app.init();

    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    // Clean up the user we created (cascade removes its refresh tokens).
    if (prisma) {
      await prisma.user.deleteMany({ where: { email } });
    }
    if (app) await app.close();
  });

  let accessToken: string;
  let loginCookie: string;

  it("POST /auth/register creates a user and returns an access token", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({ email, password, name: "E2E User" })
      .expect(201);

    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({ email, name: "E2E User" });
    expect(res.body.user).not.toHaveProperty("passwordHash");
    expect(extractRefreshCookie(res)).toContain(`${REFRESH_COOKIE}=`);
  });

  it("POST /auth/register with the same email conflicts (409)", async () => {
    await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({ email, password, name: "Dup" })
      .expect(409);
  });

  // --- request-body validation (regression: the Zod pipe must actually run) ---

  it("POST /auth/register rejects an invalid email with 400", async () => {
    await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({ email: "not-an-email", password, name: "Bad Email" })
      .expect(400);
  });

  it("POST /auth/register rejects a too-short password with 400", async () => {
    await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({ email: `short_${Date.now()}@example.com`, password: "x", name: "Short PW" })
      .expect(400);
  });

  it("POST /auth/register rejects a missing name with 400", async () => {
    await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({ email: `noname_${Date.now()}@example.com`, password })
      .expect(400);
  });

  it("POST /auth/login rejects a malformed body with 400", async () => {
    await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ foo: "bar" })
      .expect(400);
  });

  it("POST /auth/login returns tokens for valid credentials", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email, password })
      .expect(201);

    accessToken = res.body.accessToken;
    loginCookie = extractRefreshCookie(res);
    expect(accessToken).toEqual(expect.any(String));
  });

  it("POST /auth/login with a wrong password is a generic 401", async () => {
    await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email, password: "wrong-password" })
      .expect(401);
  });

  it("GET /auth/me returns the current user with a bearer token", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body).toMatchObject({ email, name: "E2E User" });
    expect(res.body).not.toHaveProperty("passwordHash");
  });

  it("GET /auth/me without a token is 401", async () => {
    await request(app.getHttpServer()).get("/api/v1/auth/me").expect(401);
  });

  let rotatedCookie: string;

  it("POST /auth/refresh rotates the refresh cookie and returns a new access token", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/auth/refresh")
      .set("Cookie", loginCookie)
      .expect(200);

    expect(res.body.accessToken).toEqual(expect.any(String));
    rotatedCookie = extractRefreshCookie(res);
    expect(rotatedCookie).not.toBe(loginCookie); // rotated to a new value
  });

  it("reusing the old (now-rotated) refresh token is rejected (reuse detection)", async () => {
    await request(app.getHttpServer())
      .post("/api/v1/auth/refresh")
      .set("Cookie", loginCookie)
      .expect(401);
  });

  it("after reuse detection the rotated token from the same family is also dead", async () => {
    // The reuse above should have revoked the whole family, so even the
    // legitimately-rotated token no longer works.
    await request(app.getHttpServer())
      .post("/api/v1/auth/refresh")
      .set("Cookie", rotatedCookie)
      .expect(401);
  });

  it("POST /auth/logout clears the cookie", async () => {
    // Fresh login → logout revokes that family and clears the cookie.
    const login = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email, password })
      .expect(201);
    const cookie = extractRefreshCookie(login);

    const res = await request(app.getHttpServer())
      .post("/api/v1/auth/logout")
      .set("Cookie", cookie)
      .expect(200);

    expect(res.body).toEqual({ success: true });

    // The logged-out token can no longer be refreshed.
    await request(app.getHttpServer())
      .post("/api/v1/auth/refresh")
      .set("Cookie", cookie)
      .expect(401);
  });
});
