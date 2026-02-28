# 00 — Site-Wide

> Global layout, navigation, and responsiveness tests.

## Layout

| #   | Scenario                       | Steps                                 | Expected                                                          | Result | Notes |
|-----|--------------------------------|---------------------------------------|-------------------------------------------------------------------|--------|-------|
| 0.1 | No unnecessary vertical scroll | Log in, navigate to any page          | No vertical scrollbar when content fits the viewport              |        |       |
| 0.2 | No horizontal scroll           | Navigate to any page                  | No horizontal scrollbar regardless of content                     |        |       |
| 0.3 | Sidebar collapses              | Click hamburger menu icon             | Sidebar collapses to icon-only, main content expands              |        |       |
| 0.4 | Sidebar expands                | Click hamburger menu icon again       | Sidebar expands to show labels, main content adjusts              |        |       |
| 0.5 | Long content doesn't break     | Create a channel with a 255-char name | Name truncates with ellipsis in list and editor, no layout breaks |        |       |

## Navigation

| #   | Scenario                      | Steps                                                           | Expected                                               | Result | Notes |
|-----|-------------------------------|-----------------------------------------------------------------|--------------------------------------------------------|--------|-------|
| 0.6 | Sidebar nav highlights        | Click each sidebar item                                         | Active item is highlighted, correct page loads         |        |       |
| 0.7 | Placeholder pages don't crash | Click Messages, Code Templates, Alerts, Events, Users, Settings | Each loads without error (placeholder content is fine) |        |       |
| 0.8 | User menu and logout          | Click user icon in top bar, click Logout                        | Menu shows username/role, logout redirects to login    |        |       |
