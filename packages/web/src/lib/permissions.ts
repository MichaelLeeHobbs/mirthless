// ===========================================
// Permission Strings (UI)
// ===========================================
// The permission list lives in core-models, shared with the server. Used purely
// for UI gating; the server enforces the real authorization.

export { PERMISSIONS as PERMISSION, type Permission as PermissionString } from '@galvanigraph/core-models';
