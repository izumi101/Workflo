import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module.js";
import { PrismaService } from "../src/prisma/prisma.service.js";

/**
 * End-to-end authZ flow against a REAL Postgres (from docker-compose, migrated).
 * Uses TWO users to prove workspace membership + role enforcement:
 *  - User A creates a workspace (becomes OWNER) → creates a project.
 *  - User B (non-member) is 403'd on reads.
 *  - A adds B as MEMBER → B can read, but owner-only actions as B are 403'd.
 *  - Owner-only actions as A succeed.
 *  - Project key conflicts 409.
 *  - Last-owner demotion/removal is blocked.
 *
 * Reuses the auth endpoints (register/login) to get real bearer tokens.
 */
describe("Workspaces + Projects (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const userAEmail = `e2e_wsA_${Date.now()}@example.com`;
  const userBEmail = `e2e_wsB_${Date.now()}@example.com`;
  const password = "supersecret123";

  let tokenA: string;
  let tokenB: string;
  let workspaceId: string;
  let projectId: string;

  const authHeader = (token: string) => `Bearer ${token}`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    app.use(cookieParser());
    await app.init();

    prisma = app.get(PrismaService);

    const regA = await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({ email: userAEmail, password, name: "User A" })
      .expect(201);
    tokenA = regA.body.accessToken;

    const regB = await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({ email: userBEmail, password, name: "User B" })
      .expect(201);
    tokenB = regB.body.accessToken;
  });

  afterAll(async () => {
    if (prisma) {
      // Cascades: workspace -> members/projects are FK'd to workspace/user; clean up explicitly.
      if (workspaceId) {
        await prisma.project.deleteMany({ where: { workspaceId } });
        await prisma.workspaceMember.deleteMany({ where: { workspaceId } });
        await prisma.workspace.deleteMany({ where: { id: workspaceId } });
      }
      await prisma.user.deleteMany({ where: { email: { in: [userAEmail, userBEmail] } } });
    }
    if (app) await app.close();
  });

  it("A creates a workspace and becomes its OWNER", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/workspaces")
      .set("Authorization", authHeader(tokenA))
      .send({ name: "Acme Corp" })
      .expect(201);

    expect(res.body.id).toEqual(expect.any(String));
    expect(res.body.name).toBe("Acme Corp");
    expect(res.body.slug).toEqual(expect.any(String));
    workspaceId = res.body.id;

    const members = await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceId}/members`)
      .set("Authorization", authHeader(tokenA))
      .expect(200);
    expect(members.body).toHaveLength(1);
    expect(members.body[0]).toMatchObject({ role: "OWNER" });
  });

  it("A creates a project in the workspace", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/projects")
      .set("Authorization", authHeader(tokenA))
      .send({ workspaceId, key: "ACME", name: "Acme Project" })
      .expect(201);

    expect(res.body.id).toEqual(expect.any(String));
    expect(res.body.key).toBe("ACME");
    projectId = res.body.id;
  });

  it("B (non-member) gets 403 reading the workspace", async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceId}`)
      .set("Authorization", authHeader(tokenB))
      .expect(403);
  });

  it("B (non-member) gets 403 reading the project", async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${projectId}`)
      .set("Authorization", authHeader(tokenB))
      .expect(403);
  });

  it("B (non-member) gets 403 listing projects by workspaceId", async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/projects?workspaceId=${workspaceId}`)
      .set("Authorization", authHeader(tokenB))
      .expect(403);
  });

  it("reading a nonexistent workspace is 404 (even for the owner)", async () => {
    await request(app.getHttpServer())
      .get("/api/v1/workspaces/nonexistent-id")
      .set("Authorization", authHeader(tokenA))
      .expect(404);
  });

  it("A adds B as a MEMBER", async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceId}/members`)
      .set("Authorization", authHeader(tokenA))
      .send({ email: userBEmail })
      .expect(201);

    expect(res.body).toMatchObject({ role: "MEMBER" });
    expect(res.body.user.email).toBe(userBEmail);
  });

  it("adding the same member again conflicts (409)", async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceId}/members`)
      .set("Authorization", authHeader(tokenA))
      .send({ email: userBEmail })
      .expect(409);
  });

  it("adding a nonexistent user's email 404s", async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceId}/members`)
      .set("Authorization", authHeader(tokenA))
      .send({ email: `ghost_${Date.now()}@example.com` })
      .expect(404);
  });

  it("B can now read the workspace and the project", async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceId}`)
      .set("Authorization", authHeader(tokenB))
      .expect(200);

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${projectId}`)
      .set("Authorization", authHeader(tokenB))
      .expect(200);
  });

  it("B (MEMBER) can update the project name", async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/projects/${projectId}`)
      .set("Authorization", authHeader(tokenB))
      .send({ name: "Renamed by B" })
      .expect(200);
    expect(res.body.name).toBe("Renamed by B");
  });

  it("B (MEMBER) is 403'd patching the workspace (owner-only)", async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceId}`)
      .set("Authorization", authHeader(tokenB))
      .send({ name: "Hijacked" })
      .expect(403);
  });

  it("B (MEMBER) is 403'd deleting the project (owner-only)", async () => {
    await request(app.getHttpServer())
      .delete(`/api/v1/projects/${projectId}`)
      .set("Authorization", authHeader(tokenB))
      .expect(403);
  });

  it("B (MEMBER) is 403'd adding members (owner-only)", async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceId}/members`)
      .set("Authorization", authHeader(tokenB))
      .send({ email: `someone_${Date.now()}@example.com` })
      .expect(403);
  });

  it("owner-only: A can PATCH the workspace name", async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceId}`)
      .set("Authorization", authHeader(tokenA))
      .send({ name: "Acme Corp Renamed" })
      .expect(200);
    expect(res.body.name).toBe("Acme Corp Renamed");
  });

  it("creating a second project with a duplicate key in the same workspace 409s", async () => {
    await request(app.getHttpServer())
      .post("/api/v1/projects")
      .set("Authorization", authHeader(tokenA))
      .send({ workspaceId, key: "ACME", name: "Duplicate Key Project" })
      .expect(409);
  });

  it("blocks demoting the last OWNER", async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceId}/members/${await userId(userAEmail)}`)
      .set("Authorization", authHeader(tokenA))
      .send({ role: "MEMBER" })
      .expect(400);
  });

  it("A promotes B to OWNER, then A can safely be demoted (no longer the last owner)", async () => {
    const bId = await userId(userBEmail);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceId}/members/${bId}`)
      .set("Authorization", authHeader(tokenA))
      .send({ role: "OWNER" })
      .expect(200);

    const aId = await userId(userAEmail);
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceId}/members/${aId}`)
      .set("Authorization", authHeader(tokenB))
      .send({ role: "MEMBER" })
      .expect(200);
    expect(res.body.role).toBe("MEMBER");
  });

  it("owner-only: B (now OWNER) can delete the project", async () => {
    await request(app.getHttpServer())
      .delete(`/api/v1/projects/${projectId}`)
      .set("Authorization", authHeader(tokenB))
      .expect(200);

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${projectId}`)
      .set("Authorization", authHeader(tokenB))
      .expect(404);
  });

  it("blocks removing the last OWNER", async () => {
    // Only B is OWNER now; A is MEMBER. Removing B (last owner) must be blocked.
    const bId = await userId(userBEmail);
    await request(app.getHttpServer())
      .delete(`/api/v1/workspaces/${workspaceId}/members/${bId}`)
      .set("Authorization", authHeader(tokenB))
      .expect(400);
  });

  async function userId(email: string): Promise<string> {
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    return user.id;
  }
});
