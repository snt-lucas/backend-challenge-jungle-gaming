import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";

/**
 * Inert authentication extension point implementing standard NestJS CanActivate contract.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(_context: ExecutionContext): boolean {
    return true;
  }
}
