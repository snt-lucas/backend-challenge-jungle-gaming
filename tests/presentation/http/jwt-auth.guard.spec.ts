import { describe, it, expect, beforeEach } from "bun:test";
import { HttpException, HttpStatus } from "@nestjs/common";
import { JwtAuthGuard, signTestJwt } from "../../../src/presentation/http/guards/jwt-auth.guard";

describe("JwtAuthGuard & Integração OIDC / JWT (Seção 2)", () => {
  let guard: JwtAuthGuard;

  beforeEach(() => {
    process.env.AUTH_ENABLED = "true";
    process.env.JWT_SECRET = "test-secret-key-jungle-123456789";
    guard = new JwtAuthGuard();
  });

  const createMockContext = (url: string, headers: Record<string, string> = {}) => {
    const request = { url, headers, user: undefined as any };
    return {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({}),
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
      request,
    };
  };

  describe("1. Exceções de Segurança e Rotas Abertas", () => {
    it("deve permitir acesso irrestrito a /health/live sem cabeçalho Authorization", () => {
      const mockCtx = createMockContext("/health/live");
      const canActivate = guard.canActivate(mockCtx as any);
      expect(canActivate).toBe(true);
    });

    it("deve permitir acesso irrestrito a /health/ready sem cabeçalho Authorization", () => {
      const mockCtx = createMockContext("/health/ready");
      const canActivate = guard.canActivate(mockCtx as any);
      expect(canActivate).toBe(true);
    });

    it("deve permitir acesso irrestrito a /metrics sem cabeçalho Authorization", () => {
      const mockCtx = createMockContext("/metrics");
      const canActivate = guard.canActivate(mockCtx as any);
      expect(canActivate).toBe(true);
    });
  });

  describe("2. Validação de Token JWT e Injeção de Claims", () => {
    it("deve autenticar com sucesso um Bearer Token válido e injetar claims no request.user", () => {
      const claims = {
        sub: "user-123",
        providerId: "pragmatic",
        roles: ["provider", "operator"],
      };
      const token = signTestJwt(claims, process.env.JWT_SECRET);

      const mockCtx = createMockContext("/wagering/transactions", {
        authorization: `Bearer ${token}`,
      });

      const canActivate = guard.canActivate(mockCtx as any);
      expect(canActivate).toBe(true);
      expect(mockCtx.request.user).toBeDefined();
      expect(mockCtx.request.user.sub).toBe("user-123");
      expect(mockCtx.request.user.providerId).toBe("pragmatic");
      expect(mockCtx.request.user.roles).toEqual(["provider", "operator"]);
    });

    it("deve bloquear requisição sem cabeçalho de autorização com HTTP 401 Unauthorized", () => {
      const mockCtx = createMockContext("/wagering/transactions", {});

      expect(() => {
        guard.canActivate(mockCtx as any);
      }).toThrow(HttpException);

      try {
        guard.canActivate(mockCtx as any);
      } catch (err: any) {
        expect(err.getStatus()).toBe(HttpStatus.UNAUTHORIZED);
        expect(err.getResponse().message).toContain("Bearer token ausente");
      }
    });

    it("deve bloquear requisição com token adulterado/assinatura inválida com HTTP 401 Unauthorized", () => {
      const fakeToken = signTestJwt({ sub: "hacker" }, "wrong-secret-key-fake");
      const mockCtx = createMockContext("/wallets", {
        authorization: `Bearer ${fakeToken}`,
      });

      expect(() => {
        guard.canActivate(mockCtx as any);
      }).toThrow(HttpException);

      try {
        guard.canActivate(mockCtx as any);
      } catch (err: any) {
        expect(err.getStatus()).toBe(HttpStatus.UNAUTHORIZED);
        expect(err.getResponse().message).toContain("Assinatura criptográfica JWT inválida");
      }
    });

    it("deve rejeitar token expirado com HTTP 401 Unauthorized", () => {
      const expiredClaims = {
        sub: "user-old",
        exp: Math.floor(Date.now() / 1000) - 60, // Expirado há 1 minuto
      };
      const expiredToken = signTestJwt(expiredClaims, process.env.JWT_SECRET);
      const mockCtx = createMockContext("/wallets", {
        authorization: `Bearer ${expiredToken}`,
      });

      expect(() => {
        guard.canActivate(mockCtx as any);
      }).toThrow(HttpException);

      try {
        guard.canActivate(mockCtx as any);
      } catch (err: any) {
        expect(err.getStatus()).toBe(HttpStatus.UNAUTHORIZED);
        expect(err.getResponse().message).toContain("Token expirado");
      }
    });
  });
});
