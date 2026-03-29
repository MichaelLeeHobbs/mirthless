# Reference Configs and Utilities

Companion to the [Coding Standard](CodingStandard.md). Copy-paste reference for project setup.

---

## tsconfig.json

```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "strictBindCallApply": true,
    "strictPropertyInitialization": true,
    "noImplicitThis": true,
    "useUnknownInCatchVariables": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noFallthroughCasesInSwitch": true,
    "noImplicitReturns": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "skipLibCheck": false,
    "allowUnusedLabels": false,
    "allowUnreachableCode": false,
    "declaration": true,
    "outDir": "./dist"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "**/*.test.ts"]
}
```

---

## ESLint Configuration (.eslintrc.json)

```json
{
  "parser": "@typescript-eslint/parser",
  "extends": [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:@typescript-eslint/recommended-requiring-type-checking"
  ],
  "parserOptions": {
    "project": "./tsconfig.json"
  },
  "rules": {
    "@typescript-eslint/no-floating-promises": "error",
    "@typescript-eslint/no-misused-promises": "error",
    "@typescript-eslint/prefer-readonly-parameter-types": "warn",
    "@typescript-eslint/explicit-function-return-type": "error",
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
    "no-console": ["warn", { "allow": ["warn", "error"] }],
    "max-lines-per-function": ["warn", { "max": 40, "skipBlankLines": true, "skipComments": true }],
    "complexity": ["error", 10]
  }
}
```

---

## Pre-commit Hook (Husky)

```bash
#!/bin/sh
. "$(dirname "$0")/_/husky.sh"

npm run lint
npm run type-check
npm run test:unit
```

---

## Result Pattern Utilities

### Core Type

```typescript
export type Result<T, E = Error> =
    | { ok: true; value: T }
    | { ok: false; error: E extends Error ? E : Error };
```

### tryCatchSync

```typescript
export function tryCatchSync<T, E = unknown>(
    fn: () => T,
    mapError?: (error: unknown) => E,
): Result<T, E> {
    try {
        return { ok: true, value: fn() };
    } catch (error) {
        return { ok: false, error: mapError ? mapError(error) : (error as E) };
    }
}
```

### tryCatch (async)

```typescript
export async function tryCatch<T, E = unknown>(
    promise: Promise<T>,
    mapError?: (error: unknown) => E,
): Promise<Result<T, E>> {
    try {
        return { ok: true, value: await promise };
    } catch (error) {
        return { ok: false, error: mapError ? mapError(error) : (error as E) };
    }
}
```

### assertUnreachable

```typescript
export function assertUnreachable(x: never): never {
    throw new Error(`Exhaustive check failed: ${JSON.stringify(x)}`);
}
```

---

## Brand Type Utility

```typescript
declare const __brand: unique symbol;
export type Brand<T, TBrand extends string> = T & { readonly [__brand]: TBrand };
```
