# 60 — Default Channel Group

## Seed

- [ ] Run `db:seed` on fresh DB — "Default" channel group is created
- [ ] Run `db:seed` again — no duplicate "Default" group (idempotent)
- [ ] "Default" group appears in Channel Groups page

## Auto-Assignment

- [ ] Create a new channel — channel is automatically added to "Default" group
- [ ] Create channel when "Default" group exists — membership visible in groups page
- [ ] Delete "Default" group (should be blocked) — then create channel — no error (graceful skip)
- [ ] Channel creation succeeds even if auto-assign fails (non-blocking)

## Delete Protection

- [ ] Attempt to delete "Default" group — error returned, group not deleted
- [ ] Attempt to delete other groups — succeeds normally
- [ ] Error message indicates "Default" group cannot be deleted

## Channel Editor Integration

- [ ] Open newly created channel editor — "Default" group chip is shown
- [ ] Remove channel from "Default" group — chip disappears
- [ ] Add channel to another group — new chip appears
