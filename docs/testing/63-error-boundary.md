# 63 — Error Boundary

## Error Catching

- [ ] Component render error — ErrorBoundary catches and shows error card
- [ ] Error card displays "Something went wrong" message
- [ ] Error card shows "Reload Page" button
- [ ] Click "Reload Page" — page reloads (window.location.reload)
- [ ] Error details logged to console (componentDidCatch)

## Scope

- [ ] ErrorBoundary wraps the main RouterProvider in App.tsx
- [ ] Errors in individual pages are caught by the boundary
- [ ] App shell (notification snackbar) remains functional during error state

## Recovery

- [ ] After reload, app returns to normal state
- [ ] Non-erroring pages continue to work normally
