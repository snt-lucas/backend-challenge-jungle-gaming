import { SetMetadata } from "@nestjs/common";

/**
 * Metadata key for marking route handlers or controllers as public (unauthenticated).
 */
export const IS_PUBLIC_KEY = "isPublic";

/**
 * Route decorator to bypass authentication guards for public endpoints.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
