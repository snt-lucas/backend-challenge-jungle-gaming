import {
  Injectable,
  HttpStatus,
  HttpException,
  Optional,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { createHmac } from "node:crypto";
import { IS_PUBLIC_KEY } from "./public.decorator";

/**
 * Decoded claims representation of an authenticated user token.
 */
export interface AuthenticatedUser {
  sub: string;
  providerId?: string;
  roles?: string[];
  [key: string]: unknown;
}

/**
 * Utility helper to issue signed test JWT tokens using HS256 algorithm.
 *
 * @param payload - Token claims to serialize and sign.
 * @param secret - Cryptographic secret key used for HMAC-SHA256 signature.
 * @returns Serialized JWT string in header.payload.signature format.
 */
export function signTestJwt(
  payload: Record<string, unknown>,
  secret: string = process.env.JWT_SECRET || "jungle-gaming-super-secret-jwt-key-2026",
): string {
  const header = { alg: "HS256", typ: "JWT" };
  const base64UrlEncode = (obj: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(obj))
      .toString("base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");

  const encodedHeader = base64UrlEncode(header);
  const encodedPayload = base64UrlEncode(payload);
  const signatureInput = `${encodedHeader}.${encodedPayload}`;

  const signature = createHmac("sha256", secret)
    .update(signatureInput)
    .digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  return `${signatureInput}.${signature}`;
}

/**
 * Authentication guard validating Bearer JWT tokens on incoming HTTP requests.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly secret: string;

  constructor(@Optional() private readonly reflector?: Reflector) {
    this.secret = process.env.JWT_SECRET || "jungle-gaming-super-secret-jwt-key-2026";
  }

  /**
   * Determines whether the current request is authorized to proceed.
   *
   * @param context - Execution context providing access to HTTP request and route metadata.
   * @returns Boolean indicating whether the request has valid credentials.
   * @throws HttpException if Authorization header is missing or token is invalid/expired.
   */
  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector?.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest();
    const url = request?.url || "";

    if (
      isPublic ||
      url.includes("/health/live") ||
      url.includes("/health/ready") ||
      url.includes("/metrics")
    ) {
      return true;
    }

    const authHeader =
      request?.headers?.authorization || request?.headers?.Authorization;

    const isAuthEnabled = process.env.AUTH_ENABLED === "true";

    if (!authHeader) {
      if (!isAuthEnabled) {
        return true;
      }
      throw new HttpException(
        {
          statusCode: HttpStatus.UNAUTHORIZED,
          error: "Unauthorized",
          message: "Cabeçalho Authorization Bearer token ausente",
        },
        HttpStatus.UNAUTHORIZED,
      );
    }

    const [scheme, token] = authHeader.split(" ");
    if (scheme?.toLowerCase() !== "bearer" || !token) {
      throw new HttpException(
        {
          statusCode: HttpStatus.UNAUTHORIZED,
          error: "Unauthorized",
          message: "Formato de autorização inválido. Esperado: Bearer <token>",
        },
        HttpStatus.UNAUTHORIZED,
      );
    }

    try {
      const claims = this.verifyToken(token);
      request.user = claims;
      return true;
    } catch (err: any) {
      throw new HttpException(
        {
          statusCode: HttpStatus.UNAUTHORIZED,
          error: "Unauthorized",
          message: `Token JWT inválido ou expirado: ${err.message}`,
        },
        HttpStatus.UNAUTHORIZED,
      );
    }
  }

  /**
   * Validates structure, HMAC-SHA256 signature, and expiration of a JWT token.
   *
   * @param token - Serialized JWT token string.
   * @returns Decoded payload claims of the authenticated user.
   * @throws Error if token format is invalid, signature mismatch occurs, or token is expired.
   */
  private verifyToken(token: string): AuthenticatedUser {
    const parts = token.split(".");
    if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
      throw new Error("Estrutura JWT malformada");
    }

    const encodedHeader = parts[0];
    const encodedPayload = parts[1];
    const signature = parts[2];
    const signatureInput = `${encodedHeader}.${encodedPayload}`;

    const expectedSignature = createHmac("sha256", this.secret)
      .update(signatureInput)
      .digest("base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");

    if (signature !== expectedSignature) {
      throw new Error("Assinatura criptográfica JWT inválida");
    }

    const payloadJson = Buffer.from(encodedPayload, "base64").toString("utf-8");
    const payload = JSON.parse(payloadJson) as AuthenticatedUser & { exp?: number };

    if (payload.exp && Date.now() >= payload.exp * 1000) {
      throw new Error("Token expirado");
    }

    return payload;
  }
}
