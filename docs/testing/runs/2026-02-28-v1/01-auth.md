# 01 — Authentication

> Login, session persistence, and protected route tests.

| #   | Scenario                     | Steps                                                    | Expected                                     | Result | Notes |
|-----|------------------------------|----------------------------------------------------------|----------------------------------------------|--------|-------|
| 1.1 | Login with valid credentials | Go to `/login`, enter `admin` / `Admin123!`, click Login | Redirected to dashboard, no errors           | pass   |       |
| 1.2 | Login with invalid password  | Enter `admin` / `wrongpassword`, click Login             | Error message displayed, stays on login page | pass   |       |
| 1.3 | Login with empty fields      | Click Login with empty username/password                 | Validation errors shown on required fields   | pass   |       |
| 1.4 | Session persists on refresh  | After login, refresh the browser (F5)                    | Still logged in, not redirected to login     | pass   |       |
| 1.5 | Protected route redirect     | While logged out, navigate to `/channels`                | Redirected to `/login`                       | pass   |       |
